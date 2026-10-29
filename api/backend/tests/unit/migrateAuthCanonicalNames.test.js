import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ObjectId } = require('mongodb');
const UserModel = require('../../src/models/User');
const SessionModel = require('../../src/models/Session');
const { migrateAuthCanonicalNames } = require('../../src/scripts/migrateAuthCanonicalNames');

// The users/sessions legacy-name migration (#1330): a document that no live
// write ever rewrites is moved to its dict-02 names in one guarded update, so
// the readers' fallbacks can go later. A canonical value already present is
// kept, and a document changed since it was read is left for the next run.

// A query-matching fake: equality (ObjectIds by string), `null` as
// missing-or-null, `$exists`, a top-level `$or`, and `$set`/`$unset` updates.
function same(a, b) {
  if (a === b) return true;
  if (a instanceof Date || b instanceof Date) return a != null && b != null && new Date(a).getTime() === new Date(b).getTime();
  if (a && b && typeof a === 'object' && typeof b === 'object') return String(a) === String(b);
  return false;
}

function matches(doc, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return value.some((branch) => matches(doc, branch));
    if (value === null) return doc[key] === null || doc[key] === undefined;
    if (value && typeof value === 'object' && '$exists' in value) return (doc[key] !== undefined) === value.$exists;
    return same(doc[key], value);
  });
}

function createFakeCollection(name, writes) {
  const docs = [];
  const collection = {
    docs,
    // Runs on the stored document before an update is matched: a live write
    // landing between the migration's find and its update.
    beforeUpdate: null,
    async updateOne(filter, update) {
      writes.push({ collection: name, op: 'updateOne' });
      if (collection.beforeUpdate) collection.beforeUpdate(docs);
      const doc = docs.find((row) => matches(row, filter));
      if (doc) {
        Object.assign(doc, update.$set);
        for (const field of Object.keys(update.$unset || {})) delete doc[field];
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
  return collection;
}

function createFakeDb(seed = {}) {
  const collections = {};
  const writes = [];
  const db = {
    collections,
    writes,
    collection(name) {
      collections[name] = collections[name] || createFakeCollection(name, writes);
      return collections[name];
    },
  };
  for (const [name, docs] of Object.entries(seed)) db.collection(name).docs.push(...docs.map((doc) => ({ ...doc })));
  return db;
}

const STARTED = new Date('2026-09-01T08:00:00.000Z');
const ACTIVE = new Date('2026-09-01T09:00:00.000Z');
const LOGIN = new Date('2026-08-30T10:00:00.000Z');

const LEGACY_USER = {
  _id: new ObjectId('64b000000000000000000001'),
  email: 'ana@example.org',
  name: 'Ana',
  password: '$2b$12$hash',
  status: 'active',
  mfaActivationDate: LOGIN,
  lastLogin: LOGIN,
  passwordHistory: ['$2b$12$old'],
  forceReset: false,
  passwordResetExpires: null,
};

const LEGACY_SESSION = {
  _id: new ObjectId('64b000000000000000000101'),
  sessionID: 'sess-1',
  userID: 'user-1',
  tokenHash: 'hash-1',
  lastActivity: ACTIVE,
  createdAt: STARTED,
  inactiveTimeout: 30 * 60 * 1000,
  isActive: false,
  isRevoked: true,
};

const CANONICAL_USER = {
  _id: new ObjectId('64b000000000000000000002'),
  email: 'bia@example.org',
  displayName: 'Bia',
  passwordHash: '$2b$12$hash',
  accountStatus: 'active',
};

const CANONICAL_SESSION = {
  _id: new ObjectId('64b000000000000000000102'),
  sessionId: 'sess-2',
  userAccountId: 'user-2',
  accessTokenHash: 'hash-2',
  lastActivityAt: ACTIVE,
  sessionStartedAt: STARTED,
  inactivityTimeoutMs: 30 * 60 * 1000,
};

const stored = (db, name, id) => db.collections[name].docs.find((doc) => String(doc._id) === String(id));
const updatesTo = (db, name) => db.writes.filter((write) => write.collection === name && write.op === 'updateOne');

describe('migrateAuthCanonicalNames (#1330)', () => {
  it('moves a legacy-only user whole, leaving none of its legacy names', async () => {
    const db = createFakeDb({ users: [LEGACY_USER] });
    const summary = await migrateAuthCanonicalNames(db);

    expect(summary.users).toEqual({ scanned: 1, moved: 1, raced: 0 });
    const user = stored(db, 'users', LEGACY_USER._id);
    for (const legacy of UserModel.LEGACY_FIELDS) expect(user).not.toHaveProperty(legacy);
    expect(user).toMatchObject({
      email: 'ana@example.org',
      displayName: 'Ana',
      passwordHash: '$2b$12$hash',
      accountStatus: 'active',
      mfaSetupAt: LOGIN,
      lastLoginAt: LOGIN,
      passwordHistoryHashes: ['$2b$12$old'],
      forcePasswordReset: false,
      passwordResetExpiresAt: null,
    });
  });

  it('removes a user\'s status when accountStatus is present, and accountStatus keeps its value', async () => {
    const both = { _id: new ObjectId('64b000000000000000000003'), accountStatus: 'blocked', status: 'active' };
    const db = createFakeDb({ users: [both] });
    const summary = await migrateAuthCanonicalNames(db);

    expect(summary.users).toEqual({ scanned: 1, moved: 1, raced: 0 });
    expect(stored(db, 'users', both._id)).toEqual({ _id: both._id, accountStatus: 'blocked' });
    expect(summary.remaining.users).toBe(0);
  });

  it('moves all six legacy session names, createdAt becoming sessionStartedAt', async () => {
    const db = createFakeDb({ sessions: [LEGACY_SESSION] });
    const summary = await migrateAuthCanonicalNames(db);

    expect(summary.sessions).toEqual({ scanned: 1, moved: 1, raced: 0 });
    const session = stored(db, 'sessions', LEGACY_SESSION._id);
    for (const legacy of SessionModel.LEGACY_FIELDS) expect(session).not.toHaveProperty(legacy);
    expect(session).toEqual({
      _id: LEGACY_SESSION._id,
      sessionId: 'sess-1',
      userAccountId: 'user-1',
      accessTokenHash: 'hash-1',
      lastActivityAt: ACTIVE,
      sessionStartedAt: STARTED,
      inactivityTimeoutMs: 30 * 60 * 1000,
      isActive: false,
      isRevoked: true,
    });
  });

  it('moves a session\'s legacy sessionID over a null sessionId, as the ?? readers do', async () => {
    const nullId = { _id: new ObjectId('64b000000000000000000103'), sessionId: null, sessionID: 'x' };
    const db = createFakeDb({ sessions: [nullId] });
    await migrateAuthCanonicalNames(db);

    expect(stored(db, 'sessions', nullId._id)).toEqual({ _id: nullId._id, sessionId: 'x' });
  });

  it('--dry-run writes nothing and reports the would-move counts', async () => {
    const db = createFakeDb({ users: [LEGACY_USER, CANONICAL_USER], sessions: [LEGACY_SESSION, CANONICAL_SESSION] });
    const summary = await migrateAuthCanonicalNames(db, { dryRun: true });

    expect(summary).toEqual({
      mode: 'dry-run',
      users: { scanned: 1, moved: 1, raced: 0 },
      sessions: { scanned: 1, moved: 1, raced: 0 },
      remaining: { users: 1, sessions: 1 },
    });
    expect(db.writes).toEqual([]);
    expect(stored(db, 'users', LEGACY_USER._id)).toEqual(LEGACY_USER);
    expect(stored(db, 'sessions', LEGACY_SESSION._id)).toEqual(LEGACY_SESSION);
  });

  it('a second run moves nothing and reports none remaining', async () => {
    const db = createFakeDb({ users: [LEGACY_USER], sessions: [LEGACY_SESSION] });
    const first = await migrateAuthCanonicalNames(db);
    expect(first.remaining).toEqual({ users: 0, sessions: 0 });

    const second = await migrateAuthCanonicalNames(db);
    expect(second).toEqual({
      mode: 'apply',
      users: { scanned: 0, moved: 0, raced: 0 },
      sessions: { scanned: 0, moved: 0, raced: 0 },
      remaining: { users: 0, sessions: 0 },
    });
  });

  it('counts a session changed between the find and the update as raced, without overwriting its new lastActivityAt', async () => {
    const db = createFakeDb({ sessions: [LEGACY_SESSION] });
    const later = new Date('2026-10-16T12:00:00.000Z');
    // The live write sets lastActivityAt; lastActivity stays, so only the
    // canonical-name filter tells the document changed.
    db.collection('sessions').beforeUpdate = (docs) => {
      docs[0].lastActivityAt = later;
    };
    const summary = await migrateAuthCanonicalNames(db);

    expect(summary.sessions).toEqual({ scanned: 1, moved: 0, raced: 1 });
    expect(stored(db, 'sessions', LEGACY_SESSION._id).lastActivityAt).toEqual(later);
    expect(summary.remaining.sessions).toBe(1);
  });

  it('does not touch canonical-only users and sessions', async () => {
    const db = createFakeDb({ users: [CANONICAL_USER], sessions: [CANONICAL_SESSION] });
    const summary = await migrateAuthCanonicalNames(db);

    expect(summary.users).toEqual({ scanned: 0, moved: 0, raced: 0 });
    expect(summary.sessions).toEqual({ scanned: 0, moved: 0, raced: 0 });
    expect(updatesTo(db, 'users')).toEqual([]);
    expect(updatesTo(db, 'sessions')).toEqual([]);
    expect(stored(db, 'users', CANONICAL_USER._id)).toEqual(CANONICAL_USER);
    expect(stored(db, 'sessions', CANONICAL_SESSION._id)).toEqual(CANONICAL_SESSION);
  });
});
