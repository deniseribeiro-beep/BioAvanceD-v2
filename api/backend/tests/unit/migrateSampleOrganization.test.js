import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { migrateSampleOrganization } = require('../../src/scripts/migrateSampleOrganization');

// #1192: the backfill sets Sample.organizationId from collectionSite where it
// is unset, writes no other field, and changes nothing on a second run.

function fakeCollection(seed = []) {
  const docs = seed.map((doc) => ({ ...doc }));
  const matchesValue = (actual, expected) => {
    if (expected && typeof expected === 'object' && Array.isArray(expected.$in)) {
      return expected.$in.some((value) => (value === null ? actual === undefined || actual === null : actual === value));
    }
    return expected === null ? actual === undefined || actual === null : actual === expected;
  };
  const matches = (doc, filter) => Object.entries(filter).every(([key, value]) => matchesValue(doc[key], value));
  return {
    docs,
    updates: [],
    find: () => ({ toArray: async () => docs.map((doc) => ({ ...doc })) }),
    async updateOne(filter, update) {
      this.updates.push(update);
      const doc = docs.find((candidate) => matches(candidate, filter));
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      Object.assign(doc, update.$set);
      return { matchedCount: 1, modifiedCount: 1 };
    },
  };
}

function fakeDb(samples) {
  const collections = { samples: fakeCollection(samples) };
  return {
    collections,
    collection(name) {
      if (!collections[name]) throw new Error(`unexpected collection: ${name}`);
      return collections[name];
    },
  };
}

function fixture() {
  return [
    { _id: 'o1', specimenId: 'SP-NULL', organizationId: null, collectionSite: 'org-a' },
    { _id: 'o2', specimenId: 'SP-MISSING', collectionSite: 'org-b' },
    { _id: 'o3', specimenId: 'SP-EMPTY', organizationId: '', collectionSite: 'org-a' },
    { _id: 'o4', specimenId: 'SP-SET', organizationId: 'org-custodian', collectionSite: 'org-partner' },
    { _id: 'o5', specimenId: 'SP-NOSITE', organizationId: null, collectionSite: null },
    { _id: 'o6', specimenId: 'SP-NOFIELDS' },
  ];
}

const byId = (db) => Object.fromEntries(db.collections.samples.docs.map((doc) => [doc.specimenId, doc]));

describe('migrateSampleOrganization', () => {
  it('sets organizationId from collectionSite where it is null, missing or empty', async () => {
    const db = fakeDb(fixture());
    const summary = await migrateSampleOrganization(db);

    const docs = byId(db);
    expect(docs['SP-NULL'].organizationId).toBe('org-a');
    expect(docs['SP-MISSING'].organizationId).toBe('org-b');
    expect(docs['SP-EMPTY'].organizationId).toBe('org-a');
    expect(summary).toEqual({ mode: 'apply', scanned: 6, backfilled: 3, alreadySet: 1, noCollectionSite: 2 });
  });

  it('writes no other field', async () => {
    const db = fakeDb(fixture());
    await migrateSampleOrganization(db);

    const { updates } = db.collections.samples;
    expect(updates).toHaveLength(3);
    expect(updates.every((update) => Object.keys(update).join() === '$set'
      && Object.keys(update.$set).join() === 'organizationId')).toBe(true);
    expect(byId(db)['SP-NULL']).toEqual({ _id: 'o1', specimenId: 'SP-NULL', organizationId: 'org-a', collectionSite: 'org-a' });
  });

  it('leaves a document that already has organizationId alone', async () => {
    const db = fakeDb(fixture());
    await migrateSampleOrganization(db);
    expect(byId(db)['SP-SET']).toEqual({ _id: 'o4', specimenId: 'SP-SET', organizationId: 'org-custodian', collectionSite: 'org-partner' });
  });

  it('leaves a document with no collectionSite alone', async () => {
    const db = fakeDb(fixture());
    await migrateSampleOrganization(db);
    expect(byId(db)['SP-NOSITE']).toEqual({ _id: 'o5', specimenId: 'SP-NOSITE', organizationId: null, collectionSite: null });
    expect(byId(db)['SP-NOFIELDS']).toEqual({ _id: 'o6', specimenId: 'SP-NOFIELDS' });
  });

  it('writes nothing in dry-run, and reports the same counts', async () => {
    const db = fakeDb(fixture());
    const before = JSON.stringify(db.collections.samples.docs);

    const summary = await migrateSampleOrganization(db, { dryRun: true });

    expect(JSON.stringify(db.collections.samples.docs)).toBe(before);
    expect(db.collections.samples.updates).toHaveLength(0);
    expect(summary).toEqual({ mode: 'dry-run', scanned: 6, backfilled: 3, alreadySet: 1, noCollectionSite: 2 });
  });

  it('is idempotent: a second run changes nothing', async () => {
    const db = fakeDb(fixture());
    await migrateSampleOrganization(db);
    const after = JSON.stringify(db.collections.samples.docs);

    const second = await migrateSampleOrganization(db);

    expect(JSON.stringify(db.collections.samples.docs)).toBe(after);
    expect(second).toEqual({ mode: 'apply', scanned: 6, backfilled: 0, alreadySet: 4, noCollectionSite: 2 });
  });
});
