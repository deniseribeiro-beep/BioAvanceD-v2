import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  seedCanonicalOutbox,
  canonicalConsentStatus,
  canonicalSpecimenId,
} = require('../../../scripts/neo4j-canonical-rebuild');

/**
 * Real query-matching fake (exact-match filter + sort + $in), not a canned
 * stub — proves seedCanonicalOutbox's RcsAssessment resolution actually
 * scopes by specimenId, per build-loop's native-only "real backend" proof
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
  it('rebuilds consent/specimen using the same v2 semantics as runtime (#1026)', async () => {
    const db = createFakeDb({
      consents: [
        {
          _id: 'mongo-c1',
          consentId: 'CONSENT-1',
          participantId: 'P1',
          currentStateDerived: 'active',
          templateVersionId: 'T1',
          effectivePeriod: { start: new Date('2026-01-01T00:00:00Z') },
          updatedAt: new Date('2026-01-01T00:00:00Z'),
        },
        {
          _id: 'mongo-c2',
          consentId: 'CONSENT-2',
          participantId: 'P1',
          currentStateDerived: 'revoked',
          templateVersionId: 'T2',
          effectivePeriod: { start: new Date('2026-02-01T00:00:00Z') },
          updatedAt: new Date('2026-03-01T00:00:00Z'),
        },
      ],
      samples: [
        {
          _id: 'mongo-s1',
          specimenId: 'SPEC-1',
          participantId: 'P1',
          parentSpecimenIds: ['SPEC-PARENT'],
          barcode: 'BC-1',
          specimenStatus: 'available',
        },
      ],
    });

    await seedCanonicalOutbox(db, fakeOutbox());

    const events = db.collections.graph_projection_outbox.docs;
    const consentEvents = events.filter((event) => event.aggregateType === 'EthicalConsent');
    expect(consentEvents).toHaveLength(2);
    expect(consentEvents.map((event) => [event.aggregateId, event.eventType, event.payload.status])).toEqual([
      ['CONSENT-1', 'CONSENT_UPSERTED', 'ACTIVE'],
      ['CONSENT-2', 'CONSENT_REVOKED', 'REVOKED'],
    ]);
    expect(consentEvents.every((event) => event.payload.participantId === 'P1')).toBe(true);

    const specimenEvents = events.filter((event) => event.eventType === 'SPECIMEN_UPSERTED');
    expect(specimenEvents).toHaveLength(1);
    expect(specimenEvents[0]).toEqual(expect.objectContaining({
      aggregateType: 'Specimen',
      aggregateId: 'SPEC-1',
      schemaVersion: 2,
      payload: expect.objectContaining({
        specimenId: 'SPEC-1',
        participantId: 'P1',
        parentSpecimenIds: ['SPEC-PARENT'],
        barcode: 'BC-1',
        specimenStatus: 'available',
      }),
    }));

    // The old #1026 rebuild defect emitted CONSENT_UPSERTED with aggregateType
    // Sample and no real status, which fabricated ACTIVE consent per specimen.
    expect(events.some((event) => event.eventType === 'CONSENT_UPSERTED' && event.aggregateType !== 'EthicalConsent')).toBe(false);
  });

  it('refuses to infer ACTIVE from a missing/legacy status field (#1026)', async () => {
    const db = createFakeDb({
      consents: [
        {
          _id: 'mongo-legacy-consent',
          consentId: 'CONSENT-LEGACY',
          participantId: 'P1',
          status: 'ACTIVE',
        },
      ],
    });

    await expect(seedCanonicalOutbox(db, fakeOutbox()))
      .rejects.toThrow('sem currentStateDerived canônico ativo/revogado');
    expect(db.collections.graph_projection_outbox.docs).toHaveLength(0);
  });

  it('maps only explicit canonical consent states', () => {
    expect(canonicalConsentStatus({ consentId: 'a', currentStateDerived: 'active' })).toBe('ACTIVE');
    expect(canonicalConsentStatus({ consentId: 'b', currentStateDerived: 'revoked' })).toBe('REVOKED');
    expect(() => canonicalConsentStatus({ consentId: 'c', currentStateDerived: '' }))
      .toThrow('Consent c sem currentStateDerived');
  });

  it('uses specimenId as graph identity and only falls back to Mongo _id when canonical id is absent', () => {
    expect(canonicalSpecimenId({ _id: 'mongo-id', specimenId: 'SPEC-CANONICAL' })).toBe('SPEC-CANONICAL');
    expect(canonicalSpecimenId({ _id: 'mongo-id' })).toBe('mongo-id');
  });

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
    expect(qualityEvent.aggregateId).toBe('SPEC-1');
    expect(qualityEvent.payload.specimenId).toBe('SPEC-1');
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
