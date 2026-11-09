// #1313 (RNF019 C7): the reconciliation script reports stalled aggregates
// and, with --repair, requeues the dead letters that hold them.
const { reconcile, findSamplesMissingFromGraph, findSamplesDriftedFromGraph, planDriftRepair } = require('../../../scripts/graph-projection-reconcile');
const { PROJECTOR_NAME } = require('../../../src/workers/neo4jProjection.worker');
const { ObjectId } = require('mongodb');

function makeOutbox(unprojected) {
  const calls = [];
  return {
    calls,
    findUnprojectedAggregates: async (_db, projectorName) => { calls.push(['find', projectorName]); return unprojected; },
    requeueDeadLetters: async (_db, eventIds) => { calls.push(['requeue', eventIds]); return eventIds.length; },
  };
}

// samples: the Mongo samples. openAssignments: the open StorageAssignment
// records the drift check reads for Mongo's position. chain: the normalized
// chain's SpecimenContainerAssignment and ContainerPositionAssignment rows.
function makeDb(samples, openAssignments = [], chain = {}) {
  const readChain = (rows, key, filter) => ({
    toArray: async () => rows.filter((row) => filter[key].$in.includes(row[key]) && row.assignmentStatus === filter.assignmentStatus),
  });
  return {
    collection: (name) => {
      if (name === 'specimenContainerAssignments') {
        return { find: (filter) => readChain(chain.loads || [], 'specimenId', filter) };
      }
      if (name === 'containerPositionAssignments') {
        return { find: (filter) => readChain(chain.placements || [], 'containerId', filter) };
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

// nodes: the Sample nodes, each with what the drift query reads for it, its
// donors and open positions; a node given {} has neither.
function makeNeo4jSession(nodes) {
  const runs = [];
  return {
    runs,
    run: async (cypher, params) => {
      runs.push({ cypher, params });
      const present = params.ids.filter((id) => id in nodes);
      if (!cypher.includes('donorIds')) {
        return { records: present.map((id) => ({ get: () => id })) };
      }
      return {
        records: present.map((id) => {
          const row = { id, donorIds: [], openPositions: [], ...nodes[id] };
          return { get: (key) => row[key] };
        }),
      };
    },
  };
}

const stalled = { aggregateType: 'Sample', aggregateId: 's-1', aggregateVersion: 3, checkpointVersion: 1, deadLetterEventIds: ['d-2'] };
const gap = { aggregateType: 'Sample', aggregateId: 's-2', aggregateVersion: 2, checkpointVersion: 1, deadLetterEventIds: [] };

describe('graph-projection-reconcile', () => {
  it('reports without repairing by default, against the worker projector', async () => {
    const outbox = makeOutbox([stalled, gap]);

    const result = await reconcile({}, { outboxService: outbox });

    expect(outbox.calls).toEqual([['find', PROJECTOR_NAME]]);
    expect(result).toEqual({
      projectorName: PROJECTOR_NAME, unprojected: [stalled, gap], needsRebuild: [gap], requeued: 0,
      samplesMissingFromGraph: [], reappended: 0,
      samplesDriftedFromGraph: [], donorCheck: null, driftRepaired: 0, driftNeedsRebuild: [],
    });
  });

  it('requeues every reported dead letter when asked to repair', async () => {
    const outbox = makeOutbox([stalled, gap]);

    const result = await reconcile({}, { outboxService: outbox, repair: true });

    expect(outbox.calls[1]).toEqual(['requeue', ['d-2']]);
    expect(result.requeued).toBe(1);
  });

  // The graph side: Mongo samples with no Sample node.
  describe('samples missing from the graph', () => {
    const samples = [
      { _id: 'smp-1', participantId: 'p-1' },
      { _id: 'smp-2', participantId: 'p-2' },
      { _id: 'smp-3' },
    ];
    // smp-1's node carries its donor, so the drift check finds nothing here.
    const pseudonymizeDonorId = (participantId) => `DONOR_${participantId}`;
    const present = { 'smp-1': { donorIds: ['DONOR_p-1'] } };

    it('reads the graph for every Mongo sample and reports the ones with no node', async () => {
      const neo4jSession = makeNeo4jSession(present);

      const missing = await findSamplesMissingFromGraph(makeDb(samples), neo4jSession);

      expect(neo4jSession.runs).toHaveLength(1);
      expect(neo4jSession.runs[0].cypher).toBe('MATCH (s:Sample) WHERE s.id IN $ids RETURN s.id AS id');
      expect(neo4jSession.runs[0].params).toEqual({ ids: ['smp-1', 'smp-2', 'smp-3'] });
      expect(missing).toEqual([
        { specimenId: 'smp-2', participantId: 'p-2' },
        { specimenId: 'smp-3', participantId: null },
      ]);
    });

    it('reports them without repairing by default, and re-appends each through the outbox on repair', async () => {
      const appended = [];
      const graphProjection = { appendSpecimenEvent: async (_db, payload) => { appended.push(payload); } };

      const reported = await reconcile(makeDb(samples), {
        outboxService: makeOutbox([]), neo4jSession: makeNeo4jSession(present), graphProjection, pseudonymizeDonorId,
      });
      expect(reported.samplesMissingFromGraph).toHaveLength(2);
      expect(reported.samplesDriftedFromGraph).toEqual([]);
      expect(appended).toEqual([]);

      const repaired = await reconcile(makeDb(samples), {
        outboxService: makeOutbox([]), neo4jSession: makeNeo4jSession(present), graphProjection, pseudonymizeDonorId, repair: true,
      });
      expect(repaired.reappended).toBe(2);
      expect(appended).toEqual([
        { specimenId: 'smp-2', participantId: 'p-2', sourceService: 'graph-projection-reconcile' },
        { specimenId: 'smp-3', participantId: null, sourceService: 'graph-projection-reconcile' },
      ]);
    });
  });

  // The graph side: a node that exists but drifted from its Mongo aggregate.
  describe('samples drifted from the graph', () => {
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
      // Its own donor is there, and a second one that should not be.
      'smp-extradonor': { donorIds: ['DONOR_p-5', 'DONOR_p-8'] },
      'smp-released': { openPositions: ['box-1/C03'] },
    };

    it('reports each node whose donor or open position differs from Mongo, and skips the matching and the missing ones', async () => {
      const { drifted, donorCheck } = await findSamplesDriftedFromGraph(
        makeDb(samples, openAssignments), makeNeo4jSession(nodes), { pseudonymizeDonorId },
      );

      expect(donorCheck).toBe('ran');
      expect(drifted).toEqual([
        { specimenId: 'smp-moved', participantId: 'p-1', position: { expected: 'box-2/B02', actual: ['box-1/A05'] } },
        { specimenId: 'smp-nodonor', participantId: 'p-2', donor: { expected: 'DONOR_p-2', actual: [] } },
        { specimenId: 'smp-wrongdonor', participantId: 'p-3', donor: { expected: 'DONOR_p-3', actual: ['DONOR_p-9'] } },
        { specimenId: 'smp-extradonor', participantId: 'p-5', donor: { expected: 'DONOR_p-5', actual: ['DONOR_p-5', 'DONOR_p-8'] } },
        { specimenId: 'smp-released', participantId: null, position: { expected: null, actual: ['box-1/C03'] } },
      ]);
    });

    it('skips the donor comparison, and says so, when the participant cannot be pseudonymized', async () => {
      const { drifted, donorCheck } = await findSamplesDriftedFromGraph(
        makeDb(samples, openAssignments), makeNeo4jSession(nodes),
        { pseudonymizeDonorId: () => { throw new Error('Salt de pseudonimização ausente'); } },
      );

      expect(donorCheck).toBe('skipped');
      expect(drifted.map((entry) => entry.specimenId)).toEqual(['smp-moved', 'smp-released']);
    });

    // #1220: the open assignment may be keyed by the canonical specimenId or,
    // on a legacy row, by the sample's _id; the graph node is keyed by the _id.
    const placed = [{ _id: 'smp-canon', specimenId: 'SPC-1' }];
    const placedNode = { 'smp-canon': { openPositions: ['box-1/A01'] } };

    it('matches a node to the open assignment keyed by the canonical specimenId', async () => {
      const { drifted } = await findSamplesDriftedFromGraph(
        makeDb(placed, [{ specimenId: 'SPC-1', boxId: 'box-1', positionCode: 'A01' }]),
        makeNeo4jSession(placedNode), { pseudonymizeDonorId },
      );

      expect(drifted).toEqual([]);
    });

    it('still matches a node to a legacy open assignment keyed by the sample _id', async () => {
      const { drifted } = await findSamplesDriftedFromGraph(
        makeDb(placed, [{ specimenId: 'smp-canon', boxId: 'box-1', positionCode: 'A01' }]),
        makeNeo4jSession(placedNode), { pseudonymizeDonorId },
      );

      expect(drifted).toEqual([]);
    });

    // #1314: the normalized chain is read first; a legacy row is the fallback.
    const chain = {
      loads: [{ specimenId: 'SPC-1', containerId: 'CTN-1', assignmentStatus: 'active' }],
      placements: [
        { containerId: 'CTN-1', storagePositionId: 'box-1:A03', assignmentStatus: 'removed' },
        { containerId: 'CTN-1', storagePositionId: 'box-1:A01', assignmentStatus: 'active' },
      ],
    };

    it('matches a chain-placed sample to its node, the position read in its legacy form', async () => {
      const { drifted } = await findSamplesDriftedFromGraph(
        makeDb(placed, [], chain), makeNeo4jSession({ 'smp-canon': { openPositions: ['box-1/A1'] } }), { pseudonymizeDonorId },
      );

      expect(drifted).toEqual([]);
    });

    it('takes the chain placement over a stale open legacy row for the same sample', async () => {
      const { drifted } = await findSamplesDriftedFromGraph(
        makeDb(placed, [{ specimenId: 'smp-canon', boxId: 'box-2', positionCode: 'B02' }], chain),
        makeNeo4jSession({ 'smp-canon': { openPositions: ['box-2/B02'] } }), { pseudonymizeDonorId },
      );

      expect(drifted).toEqual([
        { specimenId: 'smp-canon', participantId: null, position: { expected: 'box-1/A1', actual: ['box-2/B02'] } },
      ]);
    });

    it('expects no position for a chain-released sample, whatever a stale open legacy row says (#1374)', async () => {
      const released = {
        loads: chain.loads,
        placements: [{ containerId: 'CTN-1', storagePositionId: 'box-1:A01', assignmentStatus: 'removed' }],
      };
      const { drifted } = await findSamplesDriftedFromGraph(
        makeDb(placed, [{ specimenId: 'smp-canon', boxId: 'box-2', positionCode: 'B02' }], released),
        makeNeo4jSession({ 'smp-canon': {} }), { pseudonymizeDonorId },
      );

      expect(drifted).toEqual([]);
    });

    it('plans a repair only where an event can make it, and a rebuild for what no event removes', () => {
      expect(planDriftRepair({ donor: { expected: 'D1', actual: [] } })).toEqual({ actions: ['specimen'], needsRebuild: false });
      expect(planDriftRepair({ donor: { expected: 'D1', actual: ['D9'] } })).toEqual({ actions: ['specimen'], needsRebuild: true });
      expect(planDriftRepair({ position: { expected: 'b/A01', actual: ['b/A05'] } })).toEqual({ actions: ['position'], needsRebuild: false });
      expect(planDriftRepair({ position: { expected: null, actual: ['b/A05'] } })).toEqual({ actions: [], needsRebuild: true });
    });

    it('on repair appends the donor and position events through the outbox, and reports the rest for a rebuild', async () => {
      const appended = [];
      const graphProjection = {
        appendSpecimenEvent: async (_db, payload) => { appended.push(['specimen', payload]); },
        appendStoragePositionEvent: async (_db, payload) => { appended.push(['position', payload]); },
      };

      const result = await reconcile(makeDb(samples, openAssignments), {
        outboxService: makeOutbox([]), neo4jSession: makeNeo4jSession(nodes), graphProjection, pseudonymizeDonorId, repair: true,
      });

      expect(result.samplesDriftedFromGraph).toHaveLength(5);
      expect(result.driftRepaired).toBe(3);
      expect(result.driftNeedsRebuild.map((entry) => entry.specimenId)).toEqual(['smp-wrongdonor', 'smp-extradonor', 'smp-released']);
      expect(appended).toEqual([
        ['specimen', { specimenId: 'smp-missing', participantId: 'p-4', sourceService: 'graph-projection-reconcile' }],
        ['position', { specimenId: 'smp-moved', boxId: 'box-2', position: 'B02', sourceService: 'graph-projection-reconcile' }],
        ['specimen', { specimenId: 'smp-nodonor', participantId: 'p-2', sourceService: 'graph-projection-reconcile' }],
        ['specimen', { specimenId: 'smp-wrongdonor', participantId: 'p-3', sourceService: 'graph-projection-reconcile' }],
      ]);
    });
  });

  // #1502: the test-support route scopes the reconciliation to the samples it
  // names, so a repair on the shared e2e database touches no other sample.
  describe('scoped to named samples', () => {
    const samples = [
      { _id: 'smp-1', participantId: 'p-1' },
      { _id: 'smp-2', participantId: 'p-2' },
      { _id: 'smp-3' },
    ];
    const pseudonymizeDonorId = (participantId) => `DONOR_${participantId}`;
    const present = { 'smp-1': { donorIds: ['DONOR_p-1'] } };

    // makeDb whose samples.find records its filter and honours an _id.$in.
    function makeScopedDb(rows) {
      const filters = [];
      const base = makeDb(rows);
      return {
        filters,
        collection: (name) => {
          if (name !== 'samples') return base.collection(name);
          return {
            find: (filter) => {
              filters.push(filter);
              const keys = filter._id ? filter._id.$in.map(String) : null;
              const yielded = keys ? rows.filter((row) => keys.includes(String(row._id))) : rows;
              return { async *[Symbol.asyncIterator]() { yield* yielded; } };
            },
          };
        },
      };
    }

    it('reports and re-appends only the named sample missing from the graph', async () => {
      const appended = [];
      const graphProjection = { appendSpecimenEvent: async (_db, payload) => { appended.push(payload); } };

      const result = await reconcile(makeScopedDb(samples), {
        specimenIds: ['smp-2'], repair: true, neo4jSession: makeNeo4jSession(present),
        outboxService: makeOutbox([]), graphProjection, pseudonymizeDonorId,
      });

      expect(result.samplesMissingFromGraph).toEqual([{ specimenId: 'smp-2', participantId: 'p-2' }]);
      expect(result.reappended).toBe(1);
      expect(appended).toEqual([{ specimenId: 'smp-2', participantId: 'p-2', sourceService: 'graph-projection-reconcile' }]);
    });

    it('matches a 24-hex id as its string and its ObjectId, and any other id as its string only', async () => {
      const hex = '64b0c0ffee0000000000abcd';
      const hexDb = makeScopedDb([]);
      await findSamplesMissingFromGraph(hexDb, makeNeo4jSession({}), { specimenIds: [hex] });
      const [hexFilter] = hexDb.filters;
      expect(hexFilter._id.$in).toHaveLength(2);
      expect(hexFilter._id.$in[0]).toBe(hex);
      expect(hexFilter._id.$in[1]).toBeInstanceOf(ObjectId);
      expect(String(hexFilter._id.$in[1])).toBe(hex);

      const plainDb = makeScopedDb([]);
      await findSamplesMissingFromGraph(plainDb, makeNeo4jSession({}), { specimenIds: ['smp-2'] });
      expect(plainDb.filters).toEqual([{ _id: { $in: ['smp-2'] } }]);
    });

    it('reports and requeues only the named samples\' stalled aggregates', async () => {
      const first = makeOutbox([stalled, gap]);
      const stalledOnly = await reconcile({}, { outboxService: first, specimenIds: ['s-1'], repair: true });
      expect(stalledOnly.unprojected).toEqual([stalled]);
      expect(stalledOnly.needsRebuild).toEqual([]);
      expect(first.calls[1]).toEqual(['requeue', ['d-2']]);

      const second = makeOutbox([stalled, gap]);
      const gapOnly = await reconcile({}, { outboxService: second, specimenIds: ['s-2'], repair: true });
      expect(gapOnly.unprojected).toEqual([gap]);
      expect(second.calls[1]).toEqual(['requeue', []]);
      expect(gapOnly.requeued).toBe(0);
    });
  });
});
