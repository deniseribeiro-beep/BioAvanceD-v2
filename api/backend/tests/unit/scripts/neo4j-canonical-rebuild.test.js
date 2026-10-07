import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { seedCanonicalOutbox } = require('../../../scripts/neo4j-canonical-rebuild');

/**
 * Real query-matching fake (exact-match filter + sort + $in), not a canned
 * stub — proves seedCanonicalOutbox's RcsAssessment resolution actually
 * scopes by specimenId, per this repo's native-only "real backend" proof
 * bar.
 */
function createFakeCollection() {
  const docs = [];
  const matchesCondition = (value, condition) => {
    if (condition && typeof condition === 'object' && condition.$in) {
      return condition.$in.some((candidate) => String(value) === String(candidate));
    }
    if (condition && typeof condition === 'object' && condition.$exists !== undefined) {
      return (value !== undefined) === condition.$exists;
    }
    return value === condition;
  };
  const matches = (doc, filter) => Object.keys(filter || {}).every((key) => matchesCondition(doc[key], filter[key]));
  return {
    docs,
    async insertOne(doc) {
      doc._id = doc._id || `fake-${docs.length + 1}`;
      docs.push(doc);
      return { insertedId: doc._id };
    },
    async updateOne(filter, update) {
      const existing = docs.find((doc) => matches(doc, filter));
      if (existing) {
        Object.assign(existing, update.$set || {});
        return { matchedCount: 1, upsertedId: null };
      }
      const created = { ...(update.$setOnInsert || {}), ...(update.$set || {}) };
      created._id = `fake-${docs.length + 1}`;
      docs.push(created);
      return { matchedCount: 0, upsertedId: created._id };
    },
    async createIndex() {
      return true;
    },
    find(filter = {}, options = {}) {
      let current = docs.filter((doc) => matches(doc, filter));
      if (options.projection) {
        current = current.map((doc) => doc);
      }
      const cursor = {
        sort(criteria = {}) {
          const [[field, direction = 1]] = Object.entries(criteria);
          current = [...current].sort((a, b) => {
            const left = a?.[field]?.getTime ? a[field].getTime() : a?.[field];
            const right = b?.[field]?.getTime ? b[field].getTime() : b?.[field];
            if (left === right) return 0;
            return direction >= 0 ? (left > right ? 1 : -1) : (left > right ? -1 : 1);
          });
          return cursor;
        },
        async toArray() {
          return current;
        },
      };
      return cursor;
    },
  };
}

function createFakeDb(seed = {}) {
  const collections = {
    patients: createFakeCollection(),
    consents: createFakeCollection(),
    samples: createFakeCollection(),
    rcsAssessments: createFakeCollection(),
    graph_projection_outbox: createFakeCollection(),
  };
  for (const [name, docs] of Object.entries(seed)) {
    collections[name].docs.push(...docs);
  }
  return {
    collections,
    collection(name) {
      if (!collections[name]) throw new Error(`unexpected collection: ${name}`);
      return collections[name];
    },
  };
}

function fakeOutbox() {
  return {
    async ensureIndexes() {
      return true;
    },
    async appendEvent(db, event) {
      const collection = db.collection('graph_projection_outbox');
      await collection.insertOne({ ...event, eventId: `${event.aggregateId}-${event.eventType}` });
    },
  };
}

describe('neo4j-canonical-rebuild#seedCanonicalOutbox', () => {
  it('resolves QUALITY_ASSESSED score from the canonical RcsAssessment snapshot, not the embedded Sample.rcsScore (#525)', async () => {
    const db = createFakeDb({
      samples: [
        { _id: 's1', participantId: 'P1', specimenId: 'SPEC-1', quality: 'A', rcsScore: 40 },
      ],
      rcsAssessments: [
        { specimenId: 'SPEC-1', rcsScore: 91, assessedAt: new Date('2026-06-01') },
        { specimenId: 'SPEC-1', rcsScore: 55, assessedAt: new Date('2026-01-01') },
      ],
    });

    await seedCanonicalOutbox(db, fakeOutbox());

    const qualityEvent = db.collections.graph_projection_outbox.docs.find((e) => e.eventType === 'QUALITY_ASSESSED');
    expect(qualityEvent.payload.score).toBe(91);
  });

  it('falls back to the embedded Sample.rcsScore when no RcsAssessment snapshot has been recorded for the specimen', async () => {
    const db = createFakeDb({
      samples: [
        { _id: 's2', participantId: 'P2', specimenId: 'SPEC-2', quality: 'B', rcsScore: 62 },
      ],
    });

    await seedCanonicalOutbox(db, fakeOutbox());

    const qualityEvent = db.collections.graph_projection_outbox.docs.find((e) => e.eventType === 'QUALITY_ASSESSED');
    expect(qualityEvent.payload.score).toBe(62);
  });

  it('emits SPECIMEN_UPSERTED with the donor for each sample, and never a CONSENT_UPSERTED keyed by a sample (#1225)', async () => {
    const db = createFakeDb({
      samples: [
        { _id: 's4', participantId: 'P4', specimenId: 'SPEC-4' },
      ],
    });

    await seedCanonicalOutbox(db, fakeOutbox());

    const events = db.collections.graph_projection_outbox.docs;
    const specimenEvent = events.find((e) => e.eventType === 'SPECIMEN_UPSERTED');
    expect(specimenEvent.aggregateId).toBe('s4');
    expect(specimenEvent.payload).toEqual({ specimenId: 's4', participantId: 'P4' });
    expect(events.filter((e) => e.eventType === 'CONSENT_UPSERTED' && e.aggregateType === 'Sample')).toHaveLength(0);
  });

  it('does not emit a QUALITY_ASSESSED event for a sample with no quality field at all', async () => {
    const db = createFakeDb({
      samples: [
        { _id: 's3', participantId: 'P3', specimenId: 'SPEC-3' },
      ],
    });

    await seedCanonicalOutbox(db, fakeOutbox());

    const qualityEvents = db.collections.graph_projection_outbox.docs.filter((e) => e.eventType === 'QUALITY_ASSESSED');
    expect(qualityEvents).toHaveLength(0);
  });
});
