import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { backfillSealedSnapshotPins } = require('../../../src/services/sealed-snapshot-backfill.service');

/**
 * Real query-matching fake — exact-match on scalar fields plus a sort-by-date
 * `find().sort().toArray()` chain, per build-loop's native-only "real
 * backend" proof bar (this repo has no live-Mongo tier). Mirrors
 * location-storage-backfill.service.test.js's fake shape.
 */
function createFakeCollection(name, { dateField } = {}) {
  const docs = [];
  const matches = (doc, filter) =>
    Object.keys(filter).every((key) => String(doc[key]) === String(filter[key]));
  let autoId = 1;
  return {
    name,
    docs,
    async insertOne(doc) {
      const _id = doc._id || `${name}-${autoId++}`;
      const stored = { _id, ...doc };
      docs.push(stored);
      return { insertedId: _id };
    },
    async findOne(filter = {}) {
      return docs.find((d) => matches(d, filter)) || null;
    },
    find(filter = {}) {
      const current = docs.filter((d) => matches(d, filter));
      return {
        sort: () => ({
          toArray: async () =>
            dateField ? [...current].sort((a, b) => new Date(b[dateField]) - new Date(a[dateField])) : current,
        }),
        toArray: async () => current,
      };
    },
    async updateOne(filter, update) {
      const doc = docs.find((d) => matches(d, filter));
      if (doc && update.$set) Object.assign(doc, update.$set);
      return { matchedCount: doc ? 1 : 0 };
    },
  };
}

function createFakeDb(seed = {}) {
  const collections = {
    samples: createFakeCollection('samples'),
    rcsAssessments: createFakeCollection('rcsAssessments', { dateField: 'assessedAt' }),
    specimenPreanalytics: createFakeCollection('specimenPreanalytics', { dateField: 'recordedAt' }),
  };
  for (const [key, docs] of Object.entries(seed)) {
    for (const doc of docs) collections[key].docs.push(doc);
  }
  return {
    collections,
    collection(collectionName) {
      if (!collections[collectionName]) throw new Error(`unexpected collection: ${collectionName}`);
      return collections[collectionName];
    },
  };
}

describe('sealed-snapshot-backfill.service', () => {
  it('pins the existing RcsAssessment/SpecimenPreanalytics snapshot for a pre-#502 sample with no sealed*Id own-property', async () => {
    const db = createFakeDb({
      samples: [{ _id: 'sample-1', specimenId: 'SPEC-1' }],
      rcsAssessments: [{ _id: 'rcs-1', specimenId: 'SPEC-1', assessedAt: '2025-01-01T00:00:00Z' }],
      specimenPreanalytics: [{ _id: 'sprec-1', specimenId: 'SPEC-1', recordedAt: '2025-01-01T00:00:00Z' }],
    });

    const { summary } = await backfillSealedSnapshotPins(db);

    expect(summary).toEqual({ samplesProcessed: 1, rcsPinned: 1, sprecPinned: 1 });
    const sample = db.collections.samples.docs[0];
    expect(sample.sealedRcsAssessmentId).toBe('rcs-1');
    expect(sample.sealedSpecimenPreanalyticsId).toBe('sprec-1');
  });

  it('picks the newest snapshot when a specimenId has more than one (pre-#502 samples predate the one-snapshot invariant)', async () => {
    const db = createFakeDb({
      samples: [{ _id: 'sample-1', specimenId: 'SPEC-1' }],
      rcsAssessments: [
        { _id: 'rcs-old', specimenId: 'SPEC-1', assessedAt: '2024-01-01T00:00:00Z' },
        { _id: 'rcs-new', specimenId: 'SPEC-1', assessedAt: '2025-06-01T00:00:00Z' },
      ],
    });

    const { summary } = await backfillSealedSnapshotPins(db);

    expect(summary.rcsPinned).toBe(1);
    expect(db.collections.samples.docs[0].sealedRcsAssessmentId).toBe('rcs-new');
  });

  it('is a no-op for a sample that already carries the sealed*Id own-property, even if the value is null', async () => {
    const db = createFakeDb({
      samples: [{ _id: 'sample-1', specimenId: 'SPEC-1', sealedRcsAssessmentId: null, sealedSpecimenPreanalyticsId: null }],
      rcsAssessments: [{ _id: 'rcs-1', specimenId: 'SPEC-1', assessedAt: '2025-01-01T00:00:00Z' }],
    });

    const { summary } = await backfillSealedSnapshotPins(db);

    expect(summary).toEqual({ samplesProcessed: 1, rcsPinned: 0, sprecPinned: 0 });
    expect(db.collections.samples.docs[0].sealedRcsAssessmentId).toBeNull();
  });

  it('leaves a sample with no recorded snapshot untouched (no matching specimenId in either collection)', async () => {
    const db = createFakeDb({
      samples: [{ _id: 'sample-1', specimenId: 'SPEC-NONE' }],
    });

    const { summary } = await backfillSealedSnapshotPins(db);

    expect(summary).toEqual({ samplesProcessed: 1, rcsPinned: 0, sprecPinned: 0 });
    expect(db.collections.samples.docs[0]).not.toHaveProperty('sealedRcsAssessmentId');
  });
});
