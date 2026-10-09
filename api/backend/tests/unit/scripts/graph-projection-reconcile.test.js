// #1313 (RNF019 C7): the reconciliation script reports stalled aggregates
// and, with --repair, requeues the dead letters that hold them.
const { reconcile, findSamplesMissingFromGraph } = require('../../../scripts/graph-projection-reconcile');
const { PROJECTOR_NAME } = require('../../../src/workers/neo4jProjection.worker');

function makeOutbox(unprojected) {
  const calls = [];
  return {
    calls,
    findUnprojectedAggregates: async (_db, projectorName) => { calls.push(['find', projectorName]); return unprojected; },
    requeueDeadLetters: async (_db, eventIds) => { calls.push(['requeue', eventIds]); return eventIds.length; },
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
    function makeDb(samples) {
      return {
        collection: (name) => {
          expect(name).toBe('samples');
          return {
            find: () => ({
              async *[Symbol.asyncIterator]() { yield* samples; },
            }),
          };
        },
      };
    }
    function makeNeo4jSession(presentIds) {
      const runs = [];
      return {
        runs,
        run: async (cypher, params) => {
          runs.push({ cypher, params });
          const records = params.ids.filter((id) => presentIds.includes(id)).map((id) => ({ get: () => id }));
          return { records };
        },
      };
    }
    const samples = [
      { _id: 'smp-1', participantId: 'p-1' },
      { _id: 'smp-2', participantId: 'p-2' },
      { _id: 'smp-3' },
    ];

    it('reads the graph for every Mongo sample and reports the ones with no node', async () => {
      const neo4jSession = makeNeo4jSession(['smp-1']);

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
        outboxService: makeOutbox([]), neo4jSession: makeNeo4jSession(['smp-1']), graphProjection,
      });
      expect(reported.samplesMissingFromGraph).toHaveLength(2);
      expect(appended).toEqual([]);

      const repaired = await reconcile(makeDb(samples), {
        outboxService: makeOutbox([]), neo4jSession: makeNeo4jSession(['smp-1']), graphProjection, repair: true,
      });
      expect(repaired.reappended).toBe(2);
      expect(appended).toEqual([
        { specimenId: 'smp-2', participantId: 'p-2', sourceService: 'graph-projection-reconcile' },
        { specimenId: 'smp-3', participantId: null, sourceService: 'graph-projection-reconcile' },
      ]);
    });
  });
});
