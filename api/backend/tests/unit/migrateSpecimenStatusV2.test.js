import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { migrateSpecimenStatusV2 } = require('../../src/scripts/migrateSpecimenStatusV2');

// The v1.3.0 -> v2 specimenStatus migration (ELM-0123 -> V2E-0544, RF006
// AC2/AC3, RF026 AC7): legacy values convert per the mapping, the original is
// preserved, each conversion appends an OperationalStateDecision, every
// document gets a derived quantityStatus, and a destroyed/disposed specimen
// closes only with an executed destroy or transfer naming it.

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
    async insertOne(doc) {
      docs.push(doc);
      return { insertedId: docs.length };
    },
  };
}

function fakeDb({ samples = [], dispositionActions = [] } = {}) {
  const collections = {
    samples: fakeCollection(samples),
    dispositionActions: fakeCollection(dispositionActions),
    operationalStateDecisions: fakeCollection(),
  };
  return {
    collections,
    collection(name) {
      if (!collections[name]) throw new Error(`unexpected collection: ${name}`);
      return collections[name];
    },
  };
}

const NOW = new Date('2026-10-11T00:00:00Z');

function legacyFixture() {
  return {
    samples: [
      { _id: 'o1', specimenId: 'SP-AV', specimenStatus: 'available', initialQuantity: 10, currentQuantity: 10 },
      { _id: 'o2', specimenId: 'SP-PA', specimenStatus: 'partial', initialQuantity: 10, currentQuantity: 4 },
      { _id: 'o3', specimenId: 'SP-DE', specimenStatus: 'depleted', initialQuantity: 10, currentQuantity: 0 },
      { _id: 'o4', specimenId: 'SP-DX', specimenStatus: 'destroyed', initialQuantity: 10, currentQuantity: 10 },
      { _id: 'o5', specimenId: 'SP-DN', specimenStatus: 'disposed', initialQuantity: 10, currentQuantity: 2 },
      { _id: 'o6', specimenId: 'SP-QU', specimenStatus: 'quarantined', quantity: 5 },
      { _id: 'o7', specimenId: 'SP-OK', specimenStatus: 'reserved', initialQuantity: 10, currentQuantity: 10, quantityStatus: 'full' },
    ],
    dispositionActions: [
      { dispositionActionId: 'DA-1', entityType: 'Specimen', dispositionAction: 'destroy', actionStatus: 'executed', affectedRecordIds: ['SP-DX'] },
      // Not evidence: planned, or an action that does not end custody.
      { dispositionActionId: 'DA-2', entityType: 'Specimen', dispositionAction: 'destroy', actionStatus: 'planned', affectedRecordIds: ['SP-DN'] },
      { dispositionActionId: 'DA-3', entityType: 'Specimen', dispositionAction: 'preserve', actionStatus: 'executed', affectedRecordIds: ['SP-DN'] },
    ],
  };
}

describe('migrateSpecimenStatusV2', () => {
  it('maps each v1.3.0 value per the mapping and backfills quantityStatus everywhere', async () => {
    const db = fakeDb(legacyFixture());
    await migrateSpecimenStatusV2(db, { now: NOW });

    const byId = Object.fromEntries(db.collections.samples.docs.map((doc) => [doc.specimenId, doc]));
    expect(byId['SP-AV']).toMatchObject({ specimenStatus: 'available', quantityStatus: 'full' });
    expect(byId['SP-PA']).toMatchObject({ specimenStatus: 'available', quantityStatus: 'partial', legacySpecimenStatus: 'partial', specimenStatusMigratedAt: NOW });
    expect(byId['SP-DE']).toMatchObject({ specimenStatus: 'available', quantityStatus: 'depleted', legacySpecimenStatus: 'depleted' });
    expect(byId['SP-DX']).toMatchObject({ specimenStatus: 'closed', legacySpecimenStatus: 'destroyed' });
    expect(byId['SP-DN']).toMatchObject({ specimenStatus: 'unavailable', quantityStatus: 'partial', legacySpecimenStatus: 'disposed' });
    expect(byId['SP-QU']).toMatchObject({ specimenStatus: 'quarantined', quantityStatus: 'full' });
    // An unchanged v2 value keeps no legacy provenance.
    expect(byId['SP-AV'].legacySpecimenStatus).toBeUndefined();
    expect(byId['SP-QU'].legacySpecimenStatus).toBeUndefined();
  });

  it('appends one OperationalStateDecision per converted specimen, triggered by the closing action when there is one', async () => {
    const db = fakeDb(legacyFixture());
    await migrateSpecimenStatusV2(db, { now: NOW });

    const decisions = db.collections.operationalStateDecisions.docs;
    expect(decisions.map((row) => row.specimenId).sort()).toEqual(['SP-DE', 'SP-DN', 'SP-DX', 'SP-PA']);
    expect(decisions.every((row) => row.rulesApplied.join() === 'v1_3_to_v2_migration')).toBe(true);
    expect(decisions.find((row) => row.specimenId === 'SP-DX')).toMatchObject({ previousStatus: 'destroyed', newStatus: 'closed', triggerEventId: 'DA-1' });
    expect(decisions.find((row) => row.specimenId === 'SP-PA')).toMatchObject({ previousStatus: 'partial', newStatus: 'available', reasonCodes: ['legacy_partial'] });
    expect(decisions.find((row) => row.specimenId === 'SP-PA').triggerEventId).toMatch(/^migration:v1_3_to_v2_migration:/);
  });

  it('reports what it did and the destroyed/disposed specimens lacking an executed disposition', async () => {
    const db = fakeDb(legacyFixture());
    const summary = await migrateSpecimenStatusV2(db, { now: NOW });

    expect(summary).toMatchObject({
      mode: 'apply',
      scanned: 7,
      converted: { partial: 1, depleted: 1, destroyed: 1, disposed: 1 },
      closed: 1,
      quantityStatusBackfilled: 6,
      decisionsRecorded: 4,
      needsDispositionEvidence: [{ specimenId: 'SP-DN', legacySpecimenStatus: 'disposed' }],
    });
  });

  it('treats a status-less legacy action as executed, and matches a specimen by its _id too', async () => {
    const db = fakeDb({
      samples: [{ _id: 'o9', specimenStatus: 'disposed', quantity: 1 }],
      dispositionActions: [{ dispositionActionId: 'DA-OLD', entityType: 'Sample', dispositionAction: 'transfer', affectedRecordIds: ['o9'] }],
    });
    await migrateSpecimenStatusV2(db, { now: NOW });
    expect(db.collections.samples.docs[0]).toMatchObject({ specimenStatus: 'closed', legacySpecimenStatus: 'disposed' });
  });

  it('writes nothing in dry-run, and reports the same counts', async () => {
    const db = fakeDb(legacyFixture());
    const before = JSON.stringify(db.collections.samples.docs);

    const summary = await migrateSpecimenStatusV2(db, { dryRun: true, now: NOW });

    expect(JSON.stringify(db.collections.samples.docs)).toBe(before);
    expect(db.collections.operationalStateDecisions.docs).toHaveLength(0);
    expect(summary).toMatchObject({ mode: 'dry-run', closed: 1, quantityStatusBackfilled: 6, decisionsRecorded: 4 });
  });

  it('is idempotent: a second run changes nothing, and still lists the unevidenced specimen', async () => {
    const db = fakeDb(legacyFixture());
    await migrateSpecimenStatusV2(db, { now: NOW });
    const after = JSON.stringify(db.collections.samples.docs);

    const second = await migrateSpecimenStatusV2(db, { now: new Date('2027-01-01T00:00:00Z') });

    expect(JSON.stringify(db.collections.samples.docs)).toBe(after);
    expect(db.collections.operationalStateDecisions.docs).toHaveLength(4);
    expect(second).toMatchObject({
      converted: { partial: 0, depleted: 0, destroyed: 0, disposed: 0 },
      quantityStatusBackfilled: 0,
      decisionsRecorded: 0,
      needsDispositionEvidence: [{ specimenId: 'SP-DN', legacySpecimenStatus: 'disposed' }],
    });
  });
});
