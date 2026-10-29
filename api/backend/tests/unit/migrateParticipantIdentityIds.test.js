import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ObjectId } = require('mongodb');
const { migrateParticipantIdentityIds } = require('../../src/scripts/migrateParticipantIdentityIds');

// The participantIdentities id/status migration (#1386): a record inserted
// before every writer set participantIdentityId (P1X-0348) and identityStatus
// (P1X-0361) gets the missing one in one guarded update. A value already set
// is kept, and a record changed since it was read is left for the next run.

// A query-matching fake: equality (ObjectIds by string), `null` as
// missing-or-null, a top-level `$or`, and `$set` updates.
function same(a, b) {
  if (a === b) return true;
  if (a && b && typeof a === 'object' && typeof b === 'object') return String(a) === String(b);
  return false;
}

function matches(doc, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return value.some((branch) => matches(doc, branch));
    if (value === null) return doc[key] === null || doc[key] === undefined;
    return same(doc[key], value);
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
      if (doc) Object.assign(doc, update.$set);
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

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const BARE = { _id: new ObjectId('64c000000000000000000001'), participantId: '11111111' };
const ID_ONLY = { _id: new ObjectId('64c000000000000000000002'), participantId: '22222222', participantIdentityId: 'kept-id' };
const MERGED_NO_ID = { _id: new ObjectId('64c000000000000000000003'), participantId: '33333333', identityStatus: 'merged', participantIdentityId: null };

const stored = (db, id) => db.identities.docs.find((doc) => String(doc._id) === String(id));

describe('migrateParticipantIdentityIds (#1386)', () => {
  it('gives a record with neither field a uuid and identityStatus active', async () => {
    const db = createFakeDb([BARE]);
    const summary = await migrateParticipantIdentityIds(db);

    expect(summary).toEqual({ mode: 'apply', scanned: 1, assigned: 1, raced: 0, remaining: 0 });
    expect(stored(db, BARE._id).participantIdentityId).toMatch(UUID_V4);
    expect(stored(db, BARE._id).identityStatus).toBe('active');
  });

  it('keeps an assigned id and sets only the missing status', async () => {
    const db = createFakeDb([ID_ONLY]);
    await migrateParticipantIdentityIds(db);

    expect(stored(db, ID_ONLY._id)).toEqual({ ...ID_ONLY, identityStatus: 'active' });
  });

  it('never resets a merged status to active, and gives the record an id', async () => {
    const db = createFakeDb([MERGED_NO_ID]);
    await migrateParticipantIdentityIds(db);

    const record = stored(db, MERGED_NO_ID._id);
    expect(record.identityStatus).toBe('merged');
    expect(record.participantIdentityId).toMatch(UUID_V4);
  });

  it('--dry-run writes nothing and reports every record remaining', async () => {
    const db = createFakeDb([BARE, ID_ONLY, MERGED_NO_ID]);
    const summary = await migrateParticipantIdentityIds(db, { dryRun: true });

    expect(summary).toEqual({ mode: 'dry-run', scanned: 3, assigned: 3, raced: 0, remaining: 3 });
    expect(db.writes).toEqual([]);
    expect(stored(db, BARE._id)).toEqual(BARE);
  });

  it('counts a record a live write gave an id between the find and the update as raced, keeping that id', async () => {
    const db = createFakeDb([BARE]);
    db.identities.beforeUpdate = (docs) => {
      docs[0].participantIdentityId = 'live-write-id';
    };
    const summary = await migrateParticipantIdentityIds(db);

    expect(summary).toEqual({ mode: 'apply', scanned: 1, assigned: 0, raced: 1, remaining: 1 });
    expect(stored(db, BARE._id).participantIdentityId).toBe('live-write-id');
  });

  it('a second run finds nothing', async () => {
    const db = createFakeDb([BARE, ID_ONLY, MERGED_NO_ID]);
    const first = await migrateParticipantIdentityIds(db);
    expect(first.remaining).toBe(0);

    const second = await migrateParticipantIdentityIds(db);
    expect(second).toEqual({ mode: 'apply', scanned: 0, assigned: 0, raced: 0, remaining: 0 });
  });
});
