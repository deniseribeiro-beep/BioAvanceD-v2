import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { migrateSpecimenRole } = require('../../src/scripts/migrateSpecimenRole');

// The specimenRole backfill (ELM-0121 1..1 Core, #1201): a sample with no
// role gets the default a create would give it (derivative with parents,
// else primary), a valid role is left alone whatever its case, and any other
// value is reported, not written.

function fakeCollection(seed = []) {
  const docs = seed.map((doc) => ({ ...doc }));
  const matches = (doc, filter) => Object.entries(filter).every(([key, value]) => (
    value === null ? doc[key] === undefined || doc[key] === null : doc[key] === value
  ));
  return {
    docs,
    find: () => ({ toArray: async () => docs.map((doc) => ({ ...doc })) }),
    async updateOne(filter, update) {
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
    { _id: 'r1', specimenId: 'SP-NONE' },
    { _id: 'r2', specimenId: 'SP-NULL', specimenRole: null, parentSpecimenIds: ['SP-NONE', 'SP-AL'] },
    { _id: 'r3', specimenId: 'SP-AL', specimenRole: 'aliquot', parentSpecimenIds: ['SP-NONE'] },
    { _id: 'r4', specimenId: 'SP-CT', specimenRole: 'Control' },
    { _id: 'r5', specimenId: 'SP-BAD', specimenRole: 'mother' },
  ];
}

const byId = (db, id) => db.collections.samples.docs.find((doc) => doc._id === id);

describe('migrateSpecimenRole', () => {
  it('fills a missing role with primary, and a null role with parents with derivative', async () => {
    const db = fakeDb(fixture());
    await migrateSpecimenRole(db);

    expect(byId(db, 'r1').specimenRole).toBe('primary');
    expect(byId(db, 'r2').specimenRole).toBe('derivative');
  });

  it('leaves a valid role, whatever its case, and an unknown value untouched', async () => {
    const db = fakeDb(fixture());
    await migrateSpecimenRole(db);

    expect(byId(db, 'r3').specimenRole).toBe('aliquot');
    expect(byId(db, 'r4').specimenRole).toBe('Control');
    expect(byId(db, 'r5').specimenRole).toBe('mother');
  });

  it('counts each outcome and lists the unknown value by specimenId', async () => {
    const summary = await migrateSpecimenRole(fakeDb(fixture()));

    expect(summary).toMatchObject({
      scanned: 5, unchanged: 2, primary: 1, derivative: 1, invalid: ['SP-BAD'],
    });
  });

  it('writes nothing under dryRun and returns the same counts', async () => {
    const db = fakeDb(fixture());
    const spy = vi.spyOn(db.collections.samples, 'updateOne');
    const dry = await migrateSpecimenRole(db, { dryRun: true });

    expect(spy).not.toHaveBeenCalled();
    expect(db.collections.samples.docs).toEqual(fixture());
    const applied = await migrateSpecimenRole(fakeDb(fixture()));
    expect({ ...dry, mode: undefined }).toEqual({ ...applied, mode: undefined });
  });

  it('writes nothing on a second run', async () => {
    const db = fakeDb(fixture());
    await migrateSpecimenRole(db);
    const afterFirst = db.collections.samples.docs.map((doc) => ({ ...doc }));
    const spy = vi.spyOn(db.collections.samples, 'updateOne');
    const second = await migrateSpecimenRole(db);

    expect(spy).not.toHaveBeenCalled();
    expect(db.collections.samples.docs).toEqual(afterFirst);
    expect(second).toMatchObject({ unchanged: 4, primary: 0, derivative: 0, invalid: ['SP-BAD'] });
  });
});
