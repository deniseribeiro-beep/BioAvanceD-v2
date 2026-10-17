import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

process.env.ENCRYPTION_KEY = 'dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGtleXQ=';
process.env.ENCRYPTION_KEY_ID = 'test-key-1';

const require = createRequire(import.meta.url);
const { ObjectId } = require('mongodb');
const { encryptValue } = require('../../src/utils/fieldEncryption');
const participantIdentityService = require('../../src/services/participantIdentity.service');
const { migrateParticipantIdentityCiphertextNames } = require('../../src/scripts/migrateParticipantIdentityCiphertextNames');

// The participantIdentities ciphertext-name migration (#1386): an envelope
// still stored under its old <field>Encrypted name moves, unchanged, to
// <field>Ciphertext. Where the new name is already present, a null included,
// the old envelope is stale and is only removed.

// A query-matching fake: equality (ObjectIds by string), dotted paths,
// `$exists`, a top-level `$or`, and `$set`/`$unset` updates.
function valueAt(doc, path) {
  return path.split('.').reduce((value, key) => (value === null || value === undefined ? undefined : value[key]), doc);
}

function same(a, b) {
  if (a === b) return true;
  if (a && b && typeof a === 'object' && typeof b === 'object') return String(a) === String(b);
  return false;
}

function matches(doc, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return value.some((branch) => matches(doc, branch));
    const actual = valueAt(doc, key);
    if (value && typeof value === 'object' && '$exists' in value) return (actual !== undefined) === value.$exists;
    if (value === null) return actual === null || actual === undefined;
    return same(actual, value);
  });
}

function createFakeDb(seed = []) {
  const docs = seed.map((doc) => ({ ...doc }));
  const writes = [];
  const collection = {
    docs,
    // Runs on the stored documents before an update is matched: a live write
    // landing between the migration's find and its update.
    beforeUpdate: null,
    async updateOne(filter, update) {
      writes.push({ op: 'updateOne', filter, update });
      if (collection.beforeUpdate) collection.beforeUpdate(docs);
      const doc = docs.find((row) => matches(row, filter));
      if (doc) {
        Object.assign(doc, update.$set || {});
        for (const key of Object.keys(update.$unset || {})) delete doc[key];
      }
      return { matchedCount: doc ? 1 : 0 };
    },
    find(filter = {}) {
      return { toArray: async () => docs.filter((doc) => matches(doc, filter)).map((doc) => ({ ...doc })) };
    },
    async countDocuments(filter = {}) {
      return docs.filter((doc) => matches(doc, filter)).length;
    },
  };
  return {
    writes,
    identities: collection,
    collection(name) {
      if (name !== 'participantIdentities') throw new Error(`unexpected collection requested: ${name}`);
      return collection;
    },
  };
}

const stored = (db, id) => db.identities.docs.find((doc) => String(doc._id) === String(id));

function legacyOnly() {
  return {
    _id: new ObjectId('64d000000000000000000001'),
    participantId: '11111111',
    patientName: null,
    patientNameEncrypted: encryptValue('Paciente Legado'),
    phone: null,
    phoneEncrypted: encryptValue('11988887777'),
    encryptionKeyVersion: 'test-key-1',
  };
}

function clearedWithStaleLegacy() {
  return {
    _id: new ObjectId('64d000000000000000000002'),
    participantId: '22222222',
    birthDate: null,
    birthDateCiphertext: null,
    birthDateEncrypted: encryptValue('1990-01-20'),
  };
}

const MIGRATED = {
  _id: new ObjectId('64d000000000000000000003'),
  participantId: '33333333',
  patientNameCiphertext: { iv: 'kept' },
};

describe('migrateParticipantIdentityCiphertextNames (#1386)', () => {
  it('moves a legacy-only envelope, unchanged, to the new name and removes the old one', async () => {
    const seed = legacyOnly();
    const db = createFakeDb([seed]);

    const summary = await migrateParticipantIdentityCiphertextNames(db);

    expect(summary).toEqual({ mode: 'apply', candidates: 1, moved: 1, raced: 0, remaining: 0 });
    const doc = stored(db, seed._id);
    expect(doc.patientNameCiphertext).toEqual(seed.patientNameEncrypted);
    expect(doc.phoneCiphertext).toEqual(seed.phoneEncrypted);
    expect(doc).not.toHaveProperty('patientNameEncrypted');
    expect(doc).not.toHaveProperty('phoneEncrypted');
    expect(doc.encryptionKeyVersion).toBe('test-key-1');
    expect(participantIdentityService.decryptIdentity(doc)).toMatchObject({
      patientName: 'Paciente Legado',
      phone: '11988887777',
    });
  });

  it('only unsets a stale old envelope where the new name holds null, so the value stays null', async () => {
    const seed = clearedWithStaleLegacy();
    const db = createFakeDb([seed]);

    const summary = await migrateParticipantIdentityCiphertextNames(db);

    expect(summary).toMatchObject({ candidates: 1, moved: 1, raced: 0, remaining: 0 });
    expect(db.writes[0].update).toEqual({ $unset: { birthDateEncrypted: '' } });
    const doc = stored(db, seed._id);
    expect(doc.birthDateCiphertext).toBeNull();
    expect(doc).not.toHaveProperty('birthDateEncrypted');
    expect(participantIdentityService.decryptIdentity(doc).birthDate).toBeNull();
  });

  it('leaves a record that holds no old name alone', async () => {
    const db = createFakeDb([MIGRATED]);

    const summary = await migrateParticipantIdentityCiphertextNames(db);

    expect(summary).toEqual({ mode: 'apply', candidates: 0, moved: 0, raced: 0, remaining: 0 });
    expect(db.writes).toEqual([]);
  });

  it('counts but writes nothing on a dry run', async () => {
    const db = createFakeDb([legacyOnly(), clearedWithStaleLegacy(), MIGRATED]);

    const summary = await migrateParticipantIdentityCiphertextNames(db, { dryRun: true });

    expect(summary).toEqual({ mode: 'dry-run', candidates: 2, moved: 2, raced: 0, remaining: 2 });
    expect(db.writes).toEqual([]);
  });

  it('is idempotent: a second run finds nothing', async () => {
    const db = createFakeDb([legacyOnly(), clearedWithStaleLegacy(), MIGRATED]);
    await migrateParticipantIdentityCiphertextNames(db);
    const writesAfterFirst = db.writes.length;

    const summary = await migrateParticipantIdentityCiphertextNames(db);

    expect(summary).toEqual({ mode: 'apply', candidates: 0, moved: 0, raced: 0, remaining: 0 });
    expect(db.writes).toHaveLength(writesAfterFirst);
  });

  it('counts a record a live write gave the new name since it was read as raced, and keeps that write', async () => {
    const seed = legacyOnly();
    const db = createFakeDb([seed]);
    const live = encryptValue('Nome Novo');
    // A writer sets the new name between the find and the update, without
    // removing the old one.
    db.identities.beforeUpdate = (docs) => {
      docs[0].patientNameCiphertext = live;
    };

    const summary = await migrateParticipantIdentityCiphertextNames(db);

    expect(summary).toEqual({ mode: 'apply', candidates: 1, moved: 0, raced: 1, remaining: 1 });
    const doc = stored(db, seed._id);
    expect(doc.patientNameCiphertext).toEqual(live);
    expect(participantIdentityService.decryptIdentity(doc).patientName).toBe('Nome Novo');
  });

  it('counts a record whose old envelope a live write replaced since it was read as raced', async () => {
    const seed = clearedWithStaleLegacy();
    const db = createFakeDb([seed]);
    const replaced = encryptValue('1985-05-05');
    db.identities.beforeUpdate = (docs) => {
      docs[0].birthDateEncrypted = replaced;
    };

    const summary = await migrateParticipantIdentityCiphertextNames(db);

    expect(summary).toEqual({ mode: 'apply', candidates: 1, moved: 0, raced: 1, remaining: 1 });
    expect(stored(db, seed._id).birthDateEncrypted).toEqual(replaced);
  });
});
