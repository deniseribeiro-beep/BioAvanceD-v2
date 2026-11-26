import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { seedCanonicalOutbox, appendExtraEdgeRemovals } = require('../../../scripts/neo4j-canonical-rebuild');

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
        // An inclusion projection keeps _id plus the keys set to 1, so a
        // field the script reads but does not project is missing here too.
        const included = Object.keys(options.projection).filter((key) => options.projection[key] === 1);
        current = current.map((doc) => Object.fromEntries(
          Object.entries(doc).filter(([key]) => key === '_id' || included.includes(key)),
        ));
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
    expect(events.filter((e) => e.eventType === 'LINEAGE_REGISTERED')).toHaveLength(0);
  });

  it('emits one LINEAGE_REGISTERED per stored parent, keyed by the child and parent _id, trimmed and de-duplicated in order (#1371)', async () => {
    const db = createFakeDb({
      samples: [
        { _id: 'sp', specimenId: 'SP-P', participantId: 'P1' },
        { _id: 'sp2', specimenId: 'SP-P2', participantId: 'P1' },
        { _id: 'sc', specimenId: 'SP-C', participantId: 'P1', parentSpecimenIds: ['SP-P', ' SP-P ', 'SP-P2'] },
      ],
    });

    await seedCanonicalOutbox(db, fakeOutbox());

    const lineageEvents = db.collections.graph_projection_outbox.docs.filter((e) => e.eventType === 'LINEAGE_REGISTERED');
    expect(lineageEvents.map((e) => ({ aggregateType: e.aggregateType, aggregateId: e.aggregateId, payload: e.payload }))).toEqual([
      { aggregateType: 'Sample', aggregateId: 'sc', payload: { specimenId: 'sc', parentSpecimenId: 'sp' } },
      { aggregateType: 'Sample', aggregateId: 'sc', payload: { specimenId: 'sc', parentSpecimenId: 'sp2' } },
    ]);
  });

  it('skips a parent that resolves to no stored sample or to the sample itself, without throwing (#1371)', async () => {
    const db = createFakeDb({
      samples: [
        { _id: 'sc', specimenId: 'SP-C', participantId: 'P1', parentSpecimenIds: ['SP-GONE', 'SP-C'] },
      ],
    });

    await expect(seedCanonicalOutbox(db, fakeOutbox())).resolves.toBeUndefined();

    const lineageEvents = db.collections.graph_projection_outbox.docs.filter((e) => e.eventType === 'LINEAGE_REGISTERED');
    expect(lineageEvents).toHaveLength(0);
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

// #1550: the drift check's inputs, the same shapes the reconcile's test
// gives it. samples: the Mongo samples; openAssignments: their open
// StorageAssignment rows; nodes: what the drift query reads per Sample node.
function makeDriftDb(samples, openAssignments = []) {
  return {
    collection: (name) => {
      if (name === 'specimenContainerAssignments' || name === 'containerPositionAssignments') {
        return { find: () => ({ toArray: async () => [] }) };
      }
      if (name === 'storageAssignments') {
        return {
          find: (filter) => ({
            toArray: async () => openAssignments.filter((a) => filter.specimenId.$in.includes(a.specimenId) && filter.removedAt === null),
          }),
        };
      }
      expect(name).toBe('samples');
      return {
        find: () => ({
          async *[Symbol.asyncIterator]() { yield* samples; },
        }),
      };
    },
  };
}

function makeNeo4jSession(nodes) {
  return {
    run: async (_cypher, params) => ({
      records: params.ids.filter((id) => id in nodes).map((id) => {
        const row = { id, donorIds: [], openPositions: [], ...nodes[id] };
        return { get: (key) => row[key] };
      }),
    }),
  };
}

describe('neo4j-canonical-rebuild#appendExtraEdgeRemovals', () => {
  const pseudonymizeDonorId = (participantId) => `DONOR_${participantId}`;
  const samples = [
    { _id: 'smp-ok', participantId: 'p-1' },
    { _id: 'smp-moved', participantId: 'p-1' },
    { _id: 'smp-nodonor', participantId: 'p-2' },
    { _id: 'smp-wrongdonor', participantId: 'p-3' },
    { _id: 'smp-extradonor', participantId: 'p-5' },
    { _id: 'smp-released' },
    { _id: 'smp-missing', participantId: 'p-4' },
  ];
  const openAssignments = [
    { specimenId: 'smp-ok', boxId: 'box-1', positionCode: 'A01' },
    { specimenId: 'smp-moved', boxId: 'box-2', positionCode: 'B02' },
  ];
  const nodes = {
    'smp-ok': { donorIds: ['DONOR_p-1'], openPositions: ['box-1/A01'] },
    'smp-moved': { donorIds: ['DONOR_p-1'], openPositions: ['box-1/A05'] },
    'smp-nodonor': { donorIds: [] },
    'smp-wrongdonor': { donorIds: ['DONOR_p-9'] },
    'smp-extradonor': { donorIds: ['DONOR_p-5', 'DONOR_p-8'] },
    'smp-released': { openPositions: ['box-1/C03'] },
  };

  it('appendExtraEdgeRemovals appends an unlink per extra donor and a release per open position Mongo holds nowhere, and nothing for what an event repairs', async () => {
    const appended = [];
    const outbox = { appendEvent: async (_db, event) => { appended.push(event); } };

    const result = await appendExtraEdgeRemovals(
      makeDriftDb(samples, openAssignments), outbox, makeNeo4jSession(nodes), { pseudonymizeDonorId },
    );

    expect(result).toEqual({ donorUnlinks: 2, positionReleases: 1, donorCheck: 'ran' });
    expect(appended.map((event) => [event.eventType, event.aggregateType, event.aggregateId, event.payload.donorId])).toEqual([
      ['SPECIMEN_DONOR_UNLINKED', 'Sample', 'smp-wrongdonor', 'DONOR_p-9'],
      ['SPECIMEN_DONOR_UNLINKED', 'Sample', 'smp-extradonor', 'DONOR_p-8'],
      ['STORAGE_POSITION_RELEASED', 'Sample', 'smp-released', undefined],
    ]);
    expect(appended[0].payload).toEqual({ specimenId: 'smp-wrongdonor', donorId: 'DONOR_p-9' });
    expect(appended[1].payload).toEqual({ specimenId: 'smp-extradonor', donorId: 'DONOR_p-8' });
    expect(appended[2].payload.specimenId).toBe('smp-released');
    expect(new Date(appended[2].payload.releasedAt).toISOString()).toBe(appended[2].payload.releasedAt);
    for (const event of appended) expect(event.sourceService).toBe('neo4j-canonical-rebuild');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // A sample stored while the drift scan runs is projected before the
  // release, with a validFrom after the Mongo read. The release instant is
  // taken before that read, so the release leaves the new placement open.
  it('appendExtraEdgeRemovals takes releasedAt before the drift scan reads anything', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-13T10:00:00.000Z'));
    const appended = [];
    const outbox = { appendEvent: async (_db, event) => { appended.push(event); } };
    const session = makeNeo4jSession({ 'smp-released': { openPositions: ['box-1/C03'] } });
    const run = session.run;
    session.run = async (cypher, params) => {
      vi.setSystemTime(new Date('2026-11-13T10:05:00.000Z'));
      return run(cypher, params);
    };

    await appendExtraEdgeRemovals(makeDriftDb([{ _id: 'smp-released' }]), outbox, session, { pseudonymizeDonorId });

    expect(appended).toHaveLength(1);
    expect(appended[0].payload).toEqual({ specimenId: 'smp-released', releasedAt: '2026-11-13T10:00:00.000Z' });
  });

  // A sample whose wrong donor needs the rebuild may also sit at a wrong but
  // known position: that one is the position event's, not a release.
  it('appendExtraEdgeRemovals unlinks the wrong donor of a sample whose known position moved, and releases nothing for it', async () => {
    const appended = [];
    const outbox = { appendEvent: async (_db, event) => { appended.push(event); } };

    const result = await appendExtraEdgeRemovals(
      makeDriftDb([{ _id: 'smp-both', participantId: 'p-6' }], [{ specimenId: 'smp-both', boxId: 'box-3', positionCode: 'C01' }]),
      outbox,
      makeNeo4jSession({ 'smp-both': { donorIds: ['DONOR_p-7'], openPositions: ['box-3/C09'] } }),
      { pseudonymizeDonorId },
    );

    expect(result).toEqual({ donorUnlinks: 1, positionReleases: 0, donorCheck: 'ran' });
    expect(appended.map((event) => [event.eventType, event.payload])).toEqual([
      ['SPECIMEN_DONOR_UNLINKED', { specimenId: 'smp-both', donorId: 'DONOR_p-7' }],
    ]);
  });
});
