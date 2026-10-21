import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';

process.env.ENCRYPTION_KEY = 'dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGtleXQ=';
process.env.ENCRYPTION_KEY_ID = 'test-key-1';

const require = createRequire(import.meta.url);
const { ObjectId } = require('mongodb');
const keyRegistry = require('../../src/config/keyRegistry');
const { encryptValue, decryptValue } = require('../../src/utils/fieldEncryption');
const participantIdentityService = require('../../src/services/participantIdentity.service');
const ParticipantIdentityModel = require('../../src/models/ParticipantIdentity');
const { migrateParticipantRecordNumbers } = require('../../src/scripts/migrateParticipantRecordNumbers');

// The record-number migration (#1386, P1X-0355): a number still stored in
// plaintext on `patients.recordNumber` moves onto the participant's identity
// as recordNumberCiphertext and recordNumberHash, and the Patient copy is
// unset. An identity that already holds the number, a null included, is
// authoritative and is never overwritten.

// A query-matching fake: equality (ObjectIds by string), `$exists`, and
// `$set`/`$unset` updates.
function same(a, b) {
  if (a === b) return true;
  if (a && b && typeof a === 'object' && typeof b === 'object') return String(a) === String(b);
  return false;
}

function matches(doc, filter) {
  return Object.entries(filter).every(([key, value]) => {
    const actual = doc[key];
    if (value && typeof value === 'object' && '$exists' in value) return (actual !== undefined) === value.$exists;
    if (value === null) return actual === null || actual === undefined;
    return same(actual, value);
  });
}

function createCollection(seed, writes, name) {
  const docs = seed.map((doc) => ({ ...doc }));
  const collection = {
    docs,
    // Runs on the stored documents before an update is matched: a live write
    // landing between the migration's read and its update.
    beforeUpdate: null,
    async updateOne(filter, update) {
      writes.push({ collection: name, filter, update });
      if (collection.beforeUpdate) collection.beforeUpdate(docs);
      const doc = docs.find((row) => matches(row, filter));
      if (doc) {
        Object.assign(doc, update.$set || {});
        for (const key of Object.keys(update.$unset || {})) delete doc[key];
      }
      return { matchedCount: doc ? 1 : 0 };
    },
    async findOne(filter = {}) {
      const doc = docs.find((row) => matches(row, filter));
      return doc ? { ...doc } : null;
    },
    find(filter = {}) {
      return { toArray: async () => docs.filter((doc) => matches(doc, filter)).map((doc) => ({ ...doc })) };
    },
    async countDocuments(filter = {}) {
      return docs.filter((doc) => matches(doc, filter)).length;
    },
  };
  return collection;
}

function createFakeDb({ patients = [], identities = [] } = {}) {
  const writes = [];
  const collections = {
    patients: createCollection(patients, writes, 'patients'),
    participantIdentities: createCollection(identities, writes, 'participantIdentities'),
  };
  return {
    writes,
    patients: collections.patients,
    identities: collections.participantIdentities,
    collection(name) {
      if (!collections[name]) throw new Error(`unexpected collection requested: ${name}`);
      return collections[name];
    },
  };
}

const byParticipant = (collection, participantId) => collection.docs.find((doc) => doc.participantId === participantId);

let nextId = 1;
const oid = () => new ObjectId(String(nextId++).padStart(24, '0'));

const patient = (participantId, recordNumber) => ({ _id: oid(), participantId, recordNumber });
// An identity as ParticipantIdentityModel.create() builds it with no number:
// neither recordNumber nor recordNumberCiphertext present.
const bareIdentity = (participantId) => ({ _id: oid(), ...ParticipantIdentityModel.create({ participantId }) });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('migrateParticipantRecordNumbers (#1386)', () => {
  it('moves a number onto the identity as a ciphertext and a blind index, and unsets the Patient copy', async () => {
    const db = createFakeDb({
      patients: [patient('11111111', ' PR-4512 ')],
      identities: [bareIdentity('11111111')],
    });

    const summary = await migrateParticipantRecordNumbers(db);

    expect(summary).toEqual({
      mode: 'apply', candidates: 1, moved: 1, cleared: 0, noIdentity: 0, conflict: 0, raced: 0, remaining: 0,
    });
    const identity = byParticipant(db.identities, '11111111');
    expect(decryptValue(identity.recordNumberCiphertext)).toBe('PR-4512');
    expect(identity.recordNumberHash).toBe(participantIdentityService.computeBlindIndex('recordNumber', 'PR-4512'));
    expect(identity.encryptionKeyVersion).toBe('test-key-1');
    expect(identity).not.toHaveProperty('recordNumber');
    expect(byParticipant(db.patients, '11111111')).not.toHaveProperty('recordNumber');
  });

  it('moves a numeric stored number as its string', async () => {
    const db = createFakeDb({
      patients: [patient('22222222', 4512)],
      identities: [bareIdentity('22222222')],
    });

    const summary = await migrateParticipantRecordNumbers(db);

    expect(summary).toMatchObject({ moved: 1, raced: 0, remaining: 0 });
    const identity = byParticipant(db.identities, '22222222');
    expect(decryptValue(identity.recordNumberCiphertext)).toBe('4512');
    expect(identity.recordNumberHash).toBe(participantIdentityService.computeBlindIndex('recordNumber', '4512'));
    expect(byParticipant(db.patients, '22222222')).not.toHaveProperty('recordNumber');
  });

  it('keeps an identity that already holds a ciphertext of the same number and only unsets the Patient copy', async () => {
    const live = encryptValue('PR-3333');
    const db = createFakeDb({
      patients: [patient('33333333', ' PR-3333')],
      identities: [{
        ...bareIdentity('33333333'),
        recordNumber: null,
        recordNumberCiphertext: live,
        recordNumberHash: participantIdentityService.computeBlindIndex('recordNumber', 'PR-3333'),
      }],
    });

    const summary = await migrateParticipantRecordNumbers(db);

    expect(summary).toMatchObject({ candidates: 1, moved: 1, conflict: 0, raced: 0, remaining: 0 });
    expect(db.writes.filter((write) => write.collection === 'participantIdentities')).toEqual([]);
    expect(byParticipant(db.identities, '33333333').recordNumberCiphertext).toEqual(live);
    expect(byParticipant(db.patients, '33333333')).not.toHaveProperty('recordNumber');
  });

  it('leaves a Patient whose number differs from the one its identity holds as a conflict, so no number is dropped', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = patient('12121212', 'PR-A');
    const second = patient('12121212', 'PR-B');
    const db = createFakeDb({ patients: [first, second], identities: [bareIdentity('12121212')] });

    const summary = await migrateParticipantRecordNumbers(db);

    expect(summary).toEqual({
      mode: 'apply', candidates: 2, moved: 1, cleared: 0, noIdentity: 0, conflict: 1, raced: 0, remaining: 1,
    });
    expect(decryptValue(byParticipant(db.identities, '12121212').recordNumberCiphertext)).toBe('PR-A');
    const stored = (id) => db.patients.docs.find((doc) => String(doc._id) === String(id));
    expect(stored(first._id)).not.toHaveProperty('recordNumber');
    expect(stored(second._id).recordNumber).toBe('PR-B');
    const logged = console.warn.mock.calls.flat().join(' ');
    expect(logged).toContain(String(second._id));
    expect(logged).not.toContain('PR-B');
  });

  it('unsets a second Patient holding the same number its identity already holds', async () => {
    const first = patient('13131313', 'PR-A');
    const second = patient('13131313', ' PR-A ');
    const db = createFakeDb({ patients: [first, second], identities: [bareIdentity('13131313')] });

    const summary = await migrateParticipantRecordNumbers(db);

    expect(summary).toEqual({
      mode: 'apply', candidates: 2, moved: 2, cleared: 0, noIdentity: 0, conflict: 0, raced: 0, remaining: 0,
    });
    expect(db.patients.docs.every((doc) => !('recordNumber' in doc))).toBe(true);
  });

  it('counts a conflict on a dry run and writes nothing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = createFakeDb({
      patients: [patient('14141414', 'PR-ANTIGO')],
      identities: [{
        ...bareIdentity('14141414'),
        recordNumber: null,
        recordNumberCiphertext: encryptValue('PR-NOVO'),
        recordNumberHash: participantIdentityService.computeBlindIndex('recordNumber', 'PR-NOVO'),
      }],
    });

    const summary = await migrateParticipantRecordNumbers(db, { dryRun: true });

    expect(summary).toEqual({
      mode: 'dry-run', candidates: 1, moved: 0, cleared: 0, noIdentity: 0, conflict: 1, raced: 0, remaining: 1,
    });
    expect(db.writes).toEqual([]);
  });

  it('keeps an identity whose number a clearing write set to null and only unsets the Patient copy', async () => {
    const db = createFakeDb({
      patients: [patient('44444444', 'PR-ANTIGO')],
      identities: [{ ...bareIdentity('44444444'), recordNumber: null, recordNumberCiphertext: null }],
    });

    const summary = await migrateParticipantRecordNumbers(db);

    expect(summary).toMatchObject({ candidates: 1, moved: 1, raced: 0, remaining: 0 });
    expect(db.writes.filter((write) => write.collection === 'participantIdentities')).toEqual([]);
    const identity = byParticipant(db.identities, '44444444');
    expect(identity.recordNumberCiphertext).toBeNull();
    expect(identity).not.toHaveProperty('recordNumberHash');
    expect(byParticipant(db.patients, '44444444')).not.toHaveProperty('recordNumber');
  });

  it('only unsets a Patient number stored as null or empty', async () => {
    const db = createFakeDb({
      patients: [patient('55555555', null), patient('55555556', '  ')],
      identities: [bareIdentity('55555555'), bareIdentity('55555556')],
    });

    const summary = await migrateParticipantRecordNumbers(db);

    expect(summary).toEqual({
      mode: 'apply', candidates: 2, moved: 0, cleared: 2, noIdentity: 0, conflict: 0, raced: 0, remaining: 0,
    });
    expect(db.writes.filter((write) => write.collection === 'participantIdentities')).toEqual([]);
    expect(byParticipant(db.identities, '55555555')).not.toHaveProperty('recordNumberCiphertext');
    expect(byParticipant(db.patients, '55555555')).not.toHaveProperty('recordNumber');
    expect(byParticipant(db.patients, '55555556')).not.toHaveProperty('recordNumber');
  });

  it('counts a Patient with no identity record as noIdentity and leaves it untouched', async () => {
    const db = createFakeDb({ patients: [patient('66666666', 'PR-6666')] });

    const summary = await migrateParticipantRecordNumbers(db);

    expect(summary).toEqual({
      mode: 'apply', candidates: 1, moved: 0, cleared: 0, noIdentity: 1, conflict: 0, raced: 0, remaining: 1,
    });
    expect(db.writes).toEqual([]);
    expect(byParticipant(db.patients, '66666666').recordNumber).toBe('PR-6666');
  });

  it('counts each candidate into its bucket but writes nothing on a dry run', async () => {
    const db = createFakeDb({
      patients: [patient('77777771', 'PR-1'), patient('77777772', null), patient('77777773', 'PR-3')],
      identities: [bareIdentity('77777771'), bareIdentity('77777772')],
    });

    const summary = await migrateParticipantRecordNumbers(db, { dryRun: true });

    expect(summary).toEqual({
      mode: 'dry-run', candidates: 3, moved: 1, cleared: 1, noIdentity: 1, conflict: 0, raced: 0, remaining: 3,
    });
    expect(db.writes).toEqual([]);
  });

  it('is idempotent: a second run finds nothing to move', async () => {
    const db = createFakeDb({
      patients: [patient('88888881', 'PR-1'), patient('88888882', null)],
      identities: [bareIdentity('88888881'), bareIdentity('88888882')],
    });
    await migrateParticipantRecordNumbers(db);
    const writesAfterFirst = db.writes.length;

    const summary = await migrateParticipantRecordNumbers(db);

    expect(summary).toEqual({
      mode: 'apply', candidates: 0, moved: 0, cleared: 0, noIdentity: 0, conflict: 0, raced: 0, remaining: 0,
    });
    expect(db.writes).toHaveLength(writesAfterFirst);
  });

  it('counts an identity a live write gave a ciphertext since it was read as raced, and keeps that write', async () => {
    const db = createFakeDb({
      patients: [patient('99999999', 'PR-ANTIGO')],
      identities: [bareIdentity('99999999')],
    });
    const live = encryptValue('PR-NOVO');
    db.identities.beforeUpdate = (docs) => {
      docs[0].recordNumberCiphertext = live;
    };

    const summary = await migrateParticipantRecordNumbers(db);

    expect(summary).toEqual({
      mode: 'apply', candidates: 1, moved: 0, cleared: 0, noIdentity: 0, conflict: 0, raced: 1, remaining: 1,
    });
    expect(decryptValue(byParticipant(db.identities, '99999999').recordNumberCiphertext)).toBe('PR-NOVO');
    expect(byParticipant(db.patients, '99999999').recordNumber).toBe('PR-ANTIGO');
  });

  it('throws before any write when applied on a keyless stack', async () => {
    vi.spyOn(keyRegistry, 'getActiveKey').mockReturnValue(null);
    const db = createFakeDb({
      patients: [patient('10101010', null), patient('10101011', 'PR-1011')],
      identities: [bareIdentity('10101010'), bareIdentity('10101011')],
    });

    await expect(migrateParticipantRecordNumbers(db)).rejects.toThrow(/ENCRYPTION_KEY/);
    expect(db.writes).toEqual([]);
    expect(byParticipant(db.patients, '10101011').recordNumber).toBe('PR-1011');
  });
});
