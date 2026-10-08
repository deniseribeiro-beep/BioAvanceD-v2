import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const { rewriteEncryptedFields } = require('../../src/scripts/rewriteEncryptedFields');
const { encryptValue, decryptValue } = require('../../src/utils/fieldEncryption');
const { sealStagedRecord, revealStagedRecord } = require('../../src/utils/stagedRowCrypto');
const participantIdentityService = require('../../src/services/participantIdentity.service');
const biomarkerObservationService = require('../../src/services/biomarker-observation.service');

// #1103: the rewrite is exercised across a real key rotation. Documents are
// written by the real writers under the old key, the env is rotated the way
// keyRegistry.js's runbook says, and the test ends by emptying the previous
// slot and decrypting everything with the new key alone.
//
// The fake matches the query shapes the script sends (dotted paths, $or,
// $exists, $ne, $nin, $type 'object', equality) with Mongo's semantics for
// a missing field, so the worklist is selected by the filter, not by the
// fake.
function getPath(doc, path) {
  return path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), doc);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function matchesCondition(value, cond) {
  if (!isObject(cond) || !Object.keys(cond).some((k) => k.startsWith('$'))) return value === cond;
  return Object.entries(cond).every(([op, arg]) => {
    if (op === '$exists') return (value !== undefined) === arg;
    if (op === '$ne') return value !== arg;
    if (op === '$nin') return !arg.includes(value === undefined ? null : value);
    if (op === '$type') return arg === 'object' && isObject(value);
    throw new Error(`fake: unsupported operator ${op}`);
  });
}

function matches(doc, filter) {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === '$or') return cond.some((sub) => matches(doc, sub));
    return matchesCondition(getPath(doc, key), cond);
  });
}

function createFakeDb() {
  const store = {};
  const collectionOf = (name) => {
    if (!store[name]) {
      const docs = [];
      store[name] = {
        docs,
        collectionName: name,
        async createIndex() { return 'ok'; },
        async createIndexes() { return ['ok']; },
        find(filter = {}) {
          return { toArray: async () => docs.filter((d) => matches(d, filter)).map((d) => structuredClone(d)) };
        },
        async countDocuments(filter = {}) { return docs.filter((d) => matches(d, filter)).length; },
        async updateOne(filter, update) {
          const doc = docs.find((d) => matches(d, filter));
          if (!doc) return { matchedCount: 0, modifiedCount: 0 };
          Object.assign(doc, structuredClone(update.$set));
          return { matchedCount: 1, modifiedCount: 1 };
        },
      };
    }
    return store[name];
  };
  return {
    store,
    collection: collectionOf,
    listCollections() { return { toArray: async () => Object.keys(store).map((name) => ({ name })) }; },
  };
}

const KEY_ENV = ['ENCRYPTION_KEY', 'ENCRYPTION_KEY_ID', 'ENCRYPTION_KEY_PREVIOUS', 'ENCRYPTION_KEY_PREVIOUS_ID'];

function useKeys(active, activeId, previous, previousId) {
  for (const name of KEY_ENV) delete process.env[name];
  if (active) { process.env.ENCRYPTION_KEY = active; process.env.ENCRYPTION_KEY_ID = activeId; }
  if (previous) { process.env.ENCRYPTION_KEY_PREVIOUS = previous; process.env.ENCRYPTION_KEY_PREVIOUS_ID = previousId; }
}

const IDENTITY = { patientName: 'Maria da Silva', identityDocument: '529.982.247-25', birthDate: '1980-05-17', phone: '+5511999998888' };

async function seedUnderOldKey(db) {
  const identity = participantIdentityService.encryptIdentityFields({ participantId: 'P-1', ...IDENTITY });
  db.collection('participantIdentities').docs.push({ _id: 'pi-1', ...identity });
  const observation = biomarkerObservationService.encryptObservationValue({ value: 42.5 });
  db.collection('biomarker_observations').docs.push({ _id: 'bo-1', ...observation });
  db.collection('users').docs.push({ _id: 'u-1', mfaSecretCiphertext: encryptValue('JBSWY3DPEHPK3PXP') });
  db.collection('import_staging_records').docs.push({ _id: 'st-1', ...sealStagedRecord({ batchId: 'b-1', row: { nome: 'Maria' }, normalized: { x: 1 } }) });
  db.collection('patients').docs.push({ _id: 'pa-1', participantId: 'P-1' });
}

describe('rewriteEncryptedFields (#1103)', () => {
  let saved;
  beforeEach(() => {
    saved = Object.fromEntries(KEY_ENV.map((name) => [name, process.env[name]]));
    delete process.env.ALLOW_UNENCRYPTED_FIELD_STORAGE;
  });
  afterEach(() => {
    for (const name of KEY_ENV) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  it('after a rotation, a dry run lists every document under the old key and writes nothing', async () => {
    const db = createFakeDb();
    useKeys('chave-antiga', 'key-2025');
    await seedUnderOldKey(db);
    useKeys('chave-nova', 'key-2026', 'chave-antiga', 'key-2025');
    const snapshot = () => JSON.stringify(Object.fromEntries(Object.entries(db.store).map(([n, c]) => [n, c.docs])));
    const before = snapshot();

    const summary = await rewriteEncryptedFields(db);

    expect(summary.mode).toBe('dry-run');
    expect(summary.fields.participantIdentities).toMatchObject({ candidates: 1, rewritten: 1, unreadable: 0 });
    expect(summary.fields.biomarkerObservations.candidates).toBe(1);
    expect(summary.fields.users.candidates).toBe(1);
    expect(summary.fields.import_staging_records.candidates).toBe(1);
    expect(summary.fields.patients.candidates).toBe(0);
    expect(summary.safeToEmptyPreviousSlot).toBe(false);
    expect(snapshot()).toBe(before);
  });

  it('--apply re-encrypts under the new key and re-derives the blind indexes; the old slot can then be emptied', async () => {
    const db = createFakeDb();
    useKeys('chave-antiga', 'key-2025');
    await seedUnderOldKey(db);
    const oldHash = db.store.participantIdentities.docs[0].identityDocumentHash;
    useKeys('chave-nova', 'key-2026', 'chave-antiga', 'key-2025');

    const applied = await rewriteEncryptedFields(db, { apply: true });
    expect(applied.fields.participantIdentities.rewritten).toBe(1);

    const identity = db.store.participantIdentities.docs[0];
    expect(identity.identityDocumentEncrypted.keyId).toBe('key-2026');
    expect(identity.encryptionKeyVersion).toBe('key-2026');
    expect(identity.identityDocumentHash).not.toBe(oldHash);
    expect(identity.identityDocumentHash).toBe(participantIdentityService.computeBlindIndex('identityDocument', IDENTITY.identityDocument));
    expect(identity.phoneHash).toBe(participantIdentityService.computeBlindIndex('phone', IDENTITY.phone));

    const verdict = await rewriteEncryptedFields(db);
    expect(verdict.safeToEmptyPreviousSlot).toBe(true);

    // The runbook's last step: the previous slot is emptied, and everything
    // still reads with the new key alone.
    useKeys('chave-nova', 'key-2026');
    const decrypted = participantIdentityService.decryptIdentity(identity);
    expect(decrypted.patientName).toBe(IDENTITY.patientName);
    expect(new Date(decrypted.birthDate).toISOString().slice(0, 10)).toBe(IDENTITY.birthDate);
    expect(biomarkerObservationService.decryptObservationValue(db.store.biomarker_observations.docs[0]).value).toBe(42.5);
    expect(decryptValue(db.store.users.docs[0].mfaSecretCiphertext)).toBe('JBSWY3DPEHPK3PXP');
    expect(revealStagedRecord(db.store.import_staging_records.docs[0]).row).toEqual({ nome: 'Maria' });
  });

  // Control for the test above: without the rewrite, emptying the slot
  // loses the data, which is what the verdict exists to prevent.
  it('control: without the rewrite, emptying the previous slot leaves the old envelopes unreadable', async () => {
    const db = createFakeDb();
    useKeys('chave-antiga', 'key-2025');
    await seedUnderOldKey(db);

    useKeys('chave-nova', 'key-2026');
    expect(decryptValue(db.store.users.docs[0].mfaSecretCiphertext)).toBeNull();
  });

  it('a document no registered key opens is counted unreadable, left untouched, and blocks the verdict', async () => {
    const db = createFakeDb();
    useKeys('chave-perdida', 'key-2024');
    db.collection('users').docs.push({ _id: 'u-lost', mfaSecretCiphertext: encryptValue('LOST') });
    const stored = structuredClone(db.store.users.docs[0]);
    useKeys('chave-nova', 'key-2026', 'chave-antiga', 'key-2025');

    const applied = await rewriteEncryptedFields(db, { apply: true });
    expect(applied.fields.users).toMatchObject({ unreadable: 1, rewritten: 0 });
    expect(db.store.users.docs[0]).toEqual(stored);

    expect((await rewriteEncryptedFields(db)).safeToEmptyPreviousSlot).toBe(false);
  });

  it('a file row under the old key is counted and blocks the verdict, though no field is left', async () => {
    const db = createFakeDb();
    useKeys('chave-nova', 'key-2026', 'chave-antiga', 'key-2025');
    db.collection('sample_files').docs.push({ _id: 'f-1', encryptionKeyId: 'key-2025' });
    db.collection('sample_files').docs.push({ _id: 'f-2', encryptionKeyId: 'key-2026' });
    db.collection('sample_files').docs.push({ _id: 'f-3', encryptionKeyId: null });

    const summary = await rewriteEncryptedFields(db);

    expect(summary.fileRowsUnderOtherKey).toEqual({ sample_files: 1 });
    expect(summary.safeToEmptyPreviousSlot).toBe(false);
  });

  it('a document rewritten between the read and the write is counted, not overwritten', async () => {
    const db = createFakeDb();
    useKeys('chave-antiga', 'key-2025');
    db.collection('users').docs.push({ _id: 'u-1', mfaSecretCiphertext: encryptValue('OLD') });
    useKeys('chave-nova', 'key-2026', 'chave-antiga', 'key-2025');

    const users = db.collection('users');
    const realFind = users.find.bind(users);
    users.find = (filter) => {
      const cursor = realFind(filter);
      return {
        toArray: async () => {
          const docs = await cursor.toArray();
          users.docs[0].mfaSecretCiphertext = encryptValue('NEW-FROM-ENROLMENT');
          return docs;
        },
      };
    };

    const applied = await rewriteEncryptedFields(db, { apply: true });

    expect(applied.fields.users).toMatchObject({ rewritten: 0, changedMeanwhile: 1 });
    expect(decryptValue(users.docs[0].mfaSecretCiphertext)).toBe('NEW-FROM-ENROLMENT');
  });

  it('refuses to run with no active key', async () => {
    useKeys(null);
    await expect(rewriteEncryptedFields(createFakeDb())).rejects.toThrow(/ENCRYPTION_KEY/);
  });
});
