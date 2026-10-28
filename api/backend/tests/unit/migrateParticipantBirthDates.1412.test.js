import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';

process.env.ENCRYPTION_KEY = 'dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGtleXQ=';
process.env.ENCRYPTION_KEY_ID = 'test-key-1';

const require = createRequire(import.meta.url);
const { ObjectId } = require('mongodb');
const { encryptValue, decryptValue } = require('../../src/utils/fieldEncryption');
const participantIdentityService = require('../../src/services/participantIdentity.service');
const { migrateParticipantBirthDates } = require('../../src/scripts/migrateParticipantBirthDates');

// The birth-date migration (#1412): a participantIdentities birth date stored
// at a midnight instant is rewritten to 12:00 UTC of its calendar day, and its
// blind index is recomputed.

// A query-matching fake: equality (ObjectIds by string, Dates by instant),
// dotted paths, `$exists`, `$ne`, `$or`, and `$set` updates.
function same(a, b) {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a && b && typeof a === 'object' && typeof b === 'object') return String(a) === String(b);
  return false;
}

function valueAt(doc, path) {
  return path.split('.').reduce((value, key) => (value === undefined || value === null ? undefined : value[key]), doc);
}

function matchesValue(actual, condition) {
  if (condition && typeof condition === 'object' && !(condition instanceof Date) && !(condition instanceof ObjectId)
      && Object.keys(condition).some((key) => key.startsWith('$'))) {
    return Object.entries(condition).every(([op, operand]) => {
      if (op === '$exists') return (actual !== undefined) === operand;
      if (op === '$ne') return operand === null ? actual !== null && actual !== undefined : !same(actual, operand);
      throw new Error(`unsupported operator ${op}`);
    });
  }
  if (condition === null) return actual === null || actual === undefined;
  return same(actual, condition);
}

function matches(doc, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return value.some((arm) => matches(doc, arm));
    return matchesValue(valueAt(doc, key), value);
  });
}

function createFakeDb(seed = []) {
  const writes = [];
  const docs = seed.map((doc) => ({ ...doc }));
  const identities = {
    docs,
    // Runs on the stored documents before an update is matched: a live write
    // landing between the migration's read and its update.
    beforeUpdate: null,
    async updateOne(filter, update) {
      writes.push({ filter, update });
      if (identities.beforeUpdate) identities.beforeUpdate(docs);
      const doc = docs.find((row) => matches(row, filter));
      if (doc) Object.assign(doc, update.$set || {});
      return { matchedCount: doc ? 1 : 0 };
    },
    find(filter = {}) {
      return { toArray: async () => docs.filter((doc) => matches(doc, filter)).map((doc) => ({ ...doc })) };
    },
  };
  return {
    writes,
    identities,
    collection(name) {
      if (name !== 'participantIdentities') throw new Error(`unexpected collection requested: ${name}`);
      return identities;
    },
  };
}

let nextId = 1;
const oid = () => new ObjectId(String(nextId++).padStart(24, '0'));
const byParticipant = (db, participantId) => db.identities.docs.find((doc) => doc.participantId === participantId);

// A row written before #1412: an ISO date at UTC midnight, hashed on a UTC-3
// host as the day before.
const legacyCiphertextRow = (participantId) => ({
  _id: oid(),
  participantId,
  birthDate: null,
  birthDateCiphertext: encryptValue(new Date('1985-03-15T00:00:00.000Z')),
  birthDateHash: participantIdentityService.computeBlindIndex('birthDate', '1985-03-14'),
  encryptionKeyVersion: 'test-key-1',
});

const migratedRow = (participantId) => ({
  _id: oid(),
  participantId,
  birthDate: null,
  ...participantIdentityService.encryptIdentityFields({ birthDate: '1985-03-15' }),
});

const zeroes = { candidates: 0, migrated: 0, unchanged: 0, legacyName: 0, unreadable: 0, raced: 0, remaining: 0 };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('migrateParticipantBirthDates (#1412)', () => {
  it('migrates a UTC-midnight ciphertext to noon and recomputes its hash', async () => {
    const db = createFakeDb([legacyCiphertextRow('11111111')]);

    const summary = await migrateParticipantBirthDates(db);

    expect(summary).toEqual({ ...zeroes, mode: 'apply', candidates: 1, migrated: 1 });
    const identity = byParticipant(db, '11111111');
    expect(decryptValue(identity.birthDateCiphertext)).toBe('1985-03-15T12:00:00.000Z');
    expect(identity.birthDateHash).toBe(participantIdentityService.computeBlindIndex('birthDate', '1985-03-15'));
    expect(identity.encryptionKeyVersion).toBe('test-key-1');
  });

  it('leaves a migrated row unchanged and writes nothing', async () => {
    const db = createFakeDb([migratedRow('22222222')]);

    const summary = await migrateParticipantBirthDates(db);

    expect(summary).toEqual({ ...zeroes, mode: 'apply', candidates: 1, unchanged: 1 });
    expect(db.writes).toEqual([]);
  });

  it('rewrites a keyless plaintext birthDate to noon', async () => {
    const db = createFakeDb([{ _id: oid(), participantId: '33333333', birthDate: new Date('1985-03-15T00:00:00.000Z') }]);

    const summary = await migrateParticipantBirthDates(db);

    expect(summary).toEqual({ ...zeroes, mode: 'apply', candidates: 1, migrated: 1 });
    expect(byParticipant(db, '33333333').birthDate.toISOString()).toBe('1985-03-15T12:00:00.000Z');
  });

  it('counts a birthDateEncrypted row as legacyName and writes nothing', async () => {
    const db = createFakeDb([{
      _id: oid(),
      participantId: '44444444',
      birthDate: null,
      birthDateEncrypted: encryptValue(new Date('1985-03-15T00:00:00.000Z')),
    }]);

    const summary = await migrateParticipantBirthDates(db);

    expect(summary).toEqual({ ...zeroes, mode: 'apply', candidates: 1, legacyName: 1, remaining: 1 });
    expect(db.writes).toEqual([]);
  });

  it('counts an undecipherable ciphertext as unreadable', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const row = legacyCiphertextRow('55555555');
    row.birthDateCiphertext = { ...row.birthDateCiphertext, data: Buffer.from('not the date').toString('base64') };
    const db = createFakeDb([row]);

    const summary = await migrateParticipantBirthDates(db);

    expect(summary).toEqual({ ...zeroes, mode: 'apply', candidates: 1, unreadable: 1, remaining: 1 });
    expect(db.writes).toEqual([]);
    const logged = console.warn.mock.calls.flat().join(' ');
    expect(logged).toContain('55555555');
    expect(logged).not.toContain('1985');
  });

  it('counts a row a live write changed as raced', async () => {
    const db = createFakeDb([legacyCiphertextRow('66666666')]);
    db.identities.beforeUpdate = (docs) => {
      Object.assign(docs[0], participantIdentityService.encryptIdentityFields({ birthDate: '1990-01-01' }));
    };

    const summary = await migrateParticipantBirthDates(db);

    expect(summary).toEqual({ ...zeroes, mode: 'apply', candidates: 1, raced: 1, remaining: 1 });
    expect(decryptValue(byParticipant(db, '66666666').birthDateCiphertext)).toBe('1990-01-01T12:00:00.000Z');
  });

  it('dry run writes nothing', async () => {
    const seed = legacyCiphertextRow('77777777');
    const db = createFakeDb([seed, { _id: oid(), participantId: '77777778', birthDate: new Date('1985-03-15T00:00:00.000Z') }]);

    const summary = await migrateParticipantBirthDates(db, { dryRun: true });

    expect(summary).toEqual({ ...zeroes, mode: 'dry-run', candidates: 2, migrated: 2 });
    expect(db.writes).toEqual([]);
    expect(byParticipant(db, '77777777').birthDateCiphertext).toEqual(seed.birthDateCiphertext);
  });

  it('a second run migrates nothing', async () => {
    const db = createFakeDb([
      legacyCiphertextRow('88888888'),
      { _id: oid(), participantId: '88888889', birthDate: new Date('1985-03-15T00:00:00.000Z') },
    ]);

    const first = await migrateParticipantBirthDates(db);
    const writesAfterFirst = db.writes.length;
    const second = await migrateParticipantBirthDates(db);

    expect(first).toMatchObject({ migrated: 2 });
    expect(second).toEqual({ ...zeroes, mode: 'apply', candidates: 2, unchanged: 2 });
    expect(db.writes.length).toBe(writesAfterFirst);
  });
});
