// #1313 (RNF019 C7): the reconciliation script reports stalled aggregates
// and, with --repair, requeues the dead letters that hold them.
const { reconcile } = require('../../../scripts/graph-projection-reconcile');
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
    expect(result).toEqual({ projectorName: PROJECTOR_NAME, unprojected: [stalled, gap], needsRebuild: [gap], requeued: 0 });
  });

  it('requeues every reported dead letter when asked to repair', async () => {
    const outbox = makeOutbox([stalled, gap]);

    const result = await reconcile({}, { outboxService: outbox, repair: true });

    expect(outbox.calls[1]).toEqual(['requeue', ['d-2']]);
    expect(result.requeued).toBe(1);
  });
});
