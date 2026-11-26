import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  migrateSecurityConfigCanonicalKeys,
  rollbackSecurityConfigCanonicalKeys
} = require('../../src/scripts/migrateSecurityConfigCanonicalKeys');

// $rename is an $unset of both names then a $set of the new one.
function getPath(doc, p) { return p.split('.').reduce((n, k) => (n == null ? undefined : n[k]), doc); }
function hasPath(doc, p) {
  let n = doc;
  for (const k of p.split('.')) {
    if (!n || typeof n !== 'object' || !(k in n)) return false;
    n = n[k];
  }
  return true;
}
function unsetPath(doc, p) {
  const ks = p.split('.');
  const last = ks.pop();
  const parent = ks.reduce((n, k) => (n == null ? undefined : n[k]), doc);
  if (parent && typeof parent === 'object') delete parent[last];
}
function setPath(doc, p, v) {
  const ks = p.split('.');
  const last = ks.pop();
  let n = doc;
  for (const k of ks) {
    if (!n[k] || typeof n[k] !== 'object') n[k] = {};
    n = n[k];
  }
  n[last] = v;
}

function fakeDb(seed) {
  const docs = seed ? [structuredClone(seed)] : [];
  const writes = [];
  const fake = {
    async findOne(f) {
      const d = docs.find((x) => x._id === f._id);
      return d ? structuredClone(d) : null;
    },
    async updateOne(f, u) {
      writes.push(u);
      const d = docs.find((x) => x._id === f._id);
      if (!d) return { matchedCount: 0 };
      for (const [from, to] of Object.entries(u.$rename || {})) {
        if (!hasPath(d, from)) continue;
        const v = getPath(d, from);
        unsetPath(d, from);
        unsetPath(d, to);
        setPath(d, to, v);
      }
      for (const p of Object.keys(u.$unset || {})) unsetPath(d, p);
      return { matchedCount: 1 };
    }
  };
  return { db: { collection: () => fake }, docs, writes };
}

const LEGACY = {
  _id: 'main',
  authentication: { lockoutDuration: 30, mfaRequired: true },
  loginAttempts: { maxAttempts: 5, lockoutDuration: 15 },
  session: { maxSessionDuration: 8, idleTimeoutMinutes: 30 },
  metadata: { version: 3, lastUpdated: new Date('2026-10-01T12:00:00Z'), lastUpdatedBy: 'admin@x' }
};
const CANONICAL = {
  _id: 'main',
  authentication: { mfaRequired: true, lockoutDurationMinutes: 30 },
  loginAttempts: { maxAttempts: 5, lockoutDurationMinutes: 15 },
  session: { idleTimeoutMinutes: 30, maxSessionDurationHours: 8 },
  configVersion: 3,
  lastUpdatedAt: new Date('2026-10-01T12:00:00Z'),
  lastUpdatedBy: 'admin@x'
};

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// #1576, RNF023 C2: the migration, its rollback, and a second run of each, against an in-memory fake collection.
describe('migrateSecurityConfigCanonicalKeys (#1576)', () => {
  it('migrates: renames the six legacy keys and removes the emptied metadata group', async () => {
    const { db, docs } = fakeDb(LEGACY);
    const summary = await migrateSecurityConfigCanonicalKeys({ db });
    expect(summary).toEqual({ documentFound: true, keysRenamed: 6, metadataRemoved: true });
    expect(docs[0]).toStrictEqual(CANONICAL);
  });

  it('a second migration changes nothing', async () => {
    const { db, docs, writes } = fakeDb(LEGACY);
    await migrateSecurityConfigCanonicalKeys({ db });
    const writesBefore = writes.length;
    const before = structuredClone(docs[0]);

    const summary = await migrateSecurityConfigCanonicalKeys({ db });

    expect(summary).toEqual({ documentFound: true, keysRenamed: 0, metadataRemoved: false });
    expect(writes.length).toBe(writesBefore);
    expect(docs[0]).toStrictEqual(before);
  });

  it('finds no document and writes nothing', async () => {
    const { db, docs, writes } = fakeDb(null);
    expect(await migrateSecurityConfigCanonicalKeys({ db }))
      .toEqual({ documentFound: false, keysRenamed: 0, metadataRemoved: false });
    expect(await rollbackSecurityConfigCanonicalKeys({ db }))
      .toEqual({ documentFound: false, keysRestored: 0, conflicts: [] });
    expect(writes).toEqual([]);
    expect(docs).toEqual([]);
  });
});

describe('rollbackSecurityConfigCanonicalKeys (#1576)', () => {
  it('rollback restores the legacy shape exactly', async () => {
    const { db, docs } = fakeDb(LEGACY);
    await migrateSecurityConfigCanonicalKeys({ db });

    const summary = await rollbackSecurityConfigCanonicalKeys({ db });

    expect(summary).toEqual({ documentFound: true, keysRestored: 6, conflicts: [] });
    expect(docs[0]).toStrictEqual(LEGACY);
  });

  it('a second rollback changes nothing', async () => {
    const { db, docs, writes } = fakeDb(LEGACY);
    await migrateSecurityConfigCanonicalKeys({ db });
    await rollbackSecurityConfigCanonicalKeys({ db });
    const writesBefore = writes.length;

    const summary = await rollbackSecurityConfigCanonicalKeys({ db });

    expect(summary).toEqual({ documentFound: true, keysRestored: 0, conflicts: [] });
    expect(writes.length).toBe(writesBefore);
    expect(docs[0]).toStrictEqual(LEGACY);
  });

  it('a migration after a rollback gives the canonical shape again', async () => {
    const { db, docs } = fakeDb(LEGACY);
    await migrateSecurityConfigCanonicalKeys({ db });
    await rollbackSecurityConfigCanonicalKeys({ db });

    const summary = await migrateSecurityConfigCanonicalKeys({ db });

    expect(summary).toEqual({ documentFound: true, keysRenamed: 6, metadataRemoved: true });
    expect(docs[0]).toStrictEqual(CANONICAL);
  });

  it('rollback leaves a key whose two spellings are both stored, and lists it', async () => {
    const session = { maxSessionDuration: 4, maxSessionDurationHours: 8, idleTimeoutMinutes: 30 };
    const { db, docs } = fakeDb({ ...structuredClone(CANONICAL), session: { ...session } });

    const summary = await rollbackSecurityConfigCanonicalKeys({ db });

    expect(summary).toEqual({
      documentFound: true,
      keysRestored: 5,
      conflicts: ['session.maxSessionDurationHours']
    });
    expect(docs[0].session).toStrictEqual(session);
  });
});
