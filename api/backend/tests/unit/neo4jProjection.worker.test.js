// neo4jProjection.worker.js destructures connectDB/connectNeo4j at require-time
// (`const { connectDB } = require(...)`), so vi.mock() factories don't reliably
// intercept these CJS require() call sites in this repo's vitest setup (confirmed
// pattern documented in tests/unit/daily-merkle.job.test.js). Instead: require the
// real singleton modules first, spy on their exports BEFORE requiring the worker,
// so the worker's own destructuring captures the already-patched functions.
const mongo = require('../../src/database/mongo');
const neo4jConnection = require('../../src/infrastructure/database/neo4j/connection');

vi.spyOn(mongo, 'connectDB').mockResolvedValue({ __fakeDb: true });
vi.spyOn(neo4jConnection, 'connectNeo4j').mockResolvedValue({
  session: () => ({ close: async () => undefined }),
});

const { runProjectionOnce, runProjectionWorker } = require('../../src/workers/neo4jProjection.worker');

describe('neo4jProjection.worker', () => {
  it('replays outbox events idempotently and marks dead letters after repeated failures', async () => {
    const events = [
      { eventId: 'evt-1', eventType: 'CONSENT_UPSERTED', aggregateType: 'EthicalConsent', aggregateId: 'consent-1', attempts: 0, schemaVersion: 1, payload: { donorKey: 'patient-1' } },
      { eventId: 'evt-2', eventType: 'QUALITY_ASSESSED', aggregateType: 'Sample', aggregateId: 'sample-1', attempts: 7, schemaVersion: 1, payload: { sampleId: 'sample-1' } },
    ];

    const state = {
      projected: [],
      retrying: [],
      dead: [],
    };

    const outboxService = {
      rescheduleStaleProcessing: async () => 1,
      leaseNextBatch: async () => events,
      markProjected: async (_db, eventId) => state.projected.push(eventId),
      markRetrying: async (_db, eventId) => state.retrying.push(eventId),
      markDeadLetter: async (_db, eventId) => state.dead.push(eventId),
    };

    const projector = {
      applyEvent: async (_session, event) => {
        if (event.eventId === 'evt-1') return { projected: true };
        throw new Error('neo4j offline');
      }
    };

    const session = { close: async () => {} };
    const neo4jDriver = { session: () => session };

    const result = await runProjectionOnce({ db: {}, neo4jDriver, outboxService, projector, maxAttempts: 8 });

    expect(result.processed).toBe(2);
    expect(state.projected).toEqual(['evt-1']);
    expect(state.dead).toEqual(['evt-2']);
    expect(state.retrying).toEqual([]);
  });

  it('recovers abandoned PROCESSING events before leasing new ones', async () => {
    let recovered = 0;
    const calls = [];
    const outboxService = {
      rescheduleStaleProcessing: async () => { recovered += 1; return 2; },
      leaseNextBatch: async () => { calls.push('lease'); return []; },
      markProjected: async () => undefined,
      markRetrying: async () => undefined,
      markDeadLetter: async () => undefined,
    };
    const projector = { applyEvent: async () => ({ projected: true }) };
    const neo4jDriver = { session: () => ({ close: async () => undefined }) };

    const result = await runProjectionOnce({ db: {}, neo4jDriver, outboxService, projector, maxAttempts: 8 });

    expect(recovered).toBe(1);
    expect(calls).toEqual(['lease']);
    expect(result.processed).toBe(0);
  });

  it('marks an event for retry (not dead letter) when attempts remain below maxAttempts', async () => {
    const state = { projected: [], retrying: [], dead: [] };
    const events = [
      { eventId: 'evt-3', eventType: 'SAMPLE_MOVED', aggregateType: 'Sample', aggregateId: 'sample-3', attempts: 1, schemaVersion: 1, payload: {} },
    ];

    const outboxService = {
      rescheduleStaleProcessing: async () => 0,
      leaseNextBatch: async () => events,
      markProjected: async (_db, eventId) => state.projected.push(eventId),
      markRetrying: async (_db, eventId) => state.retrying.push(eventId),
      markDeadLetter: async (_db, eventId) => state.dead.push(eventId),
    };

    const projector = { applyEvent: async () => { throw new Error('transient neo4j error'); } };
    const neo4jDriver = { session: () => ({ close: async () => undefined }) };

    const result = await runProjectionOnce({ db: {}, neo4jDriver, outboxService, projector, maxAttempts: 8 });

    expect(result.processed).toBe(1);
    expect(result.projected).toBe(0);
    expect(result.failed).toBe(1);
    expect(state.retrying).toEqual(['evt-3']);
    expect(state.dead).toEqual([]);
  });

  it('falls back to connectDB()/connectNeo4j() when options.db/neo4jDriver are not provided', async () => {
    mongo.connectDB.mockClear();
    neo4jConnection.connectNeo4j.mockClear();

    const outboxService = {
      rescheduleStaleProcessing: async () => 0,
      leaseNextBatch: async () => [],
      markProjected: async () => undefined,
      markRetrying: async () => undefined,
      markDeadLetter: async () => undefined,
    };
    const projector = { applyEvent: async () => ({ projected: true }) };

    const result = await runProjectionOnce({ outboxService, projector, maxAttempts: 8 });

    expect(mongo.connectDB).toHaveBeenCalledTimes(1);
    expect(neo4jConnection.connectNeo4j).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ processed: 0, projected: 0, failed: 0 });
  });

  it('returns default processed/projected/failed counts when the batch is empty', async () => {
    const outboxService = {
      rescheduleStaleProcessing: async () => 0,
      leaseNextBatch: async () => [],
      markProjected: async () => undefined,
      markRetrying: async () => undefined,
      markDeadLetter: async () => undefined,
    };
    const projector = { applyEvent: async () => ({ projected: true }) };
    const neo4jDriver = { session: () => ({ close: async () => undefined }) };

    const result = await runProjectionOnce({ db: {}, neo4jDriver, outboxService, projector, maxAttempts: 8 });

    expect(result).toEqual({ processed: 0, projected: 0, failed: 0 });
  });
});

describe('neo4jProjection.worker - runProjectionWorker', () => {
  it('runs a single pass and returns its result when options.once is true', async () => {
    const outboxService = {
      rescheduleStaleProcessing: async () => 0,
      leaseNextBatch: async () => [{ eventId: 'evt-1', eventType: 'CONSENT_UPSERTED', aggregateType: 'EthicalConsent', aggregateId: 'consent-1', attempts: 0, schemaVersion: 1, payload: {} }],
      markProjected: async () => undefined,
      markRetrying: async () => undefined,
      markDeadLetter: async () => undefined,
    };
    const projector = { applyEvent: async () => ({ projected: true }) };
    const neo4jDriver = { session: () => ({ close: async () => undefined }) };

    const result = await runProjectionWorker({ db: {}, neo4jDriver, outboxService, projector, maxAttempts: 8, once: true });

    expect(result).toEqual({ processed: 1, projected: 1, failed: 0 });
  });

  it('backs off between empty polls and keeps looping while options.once is not true', async () => {
    // runProjectionWorker's `do..while` only exits via `stopAfterOne`, captured once
    // at call time from options.once === true — with once:false it polls forever.
    // Force the third poll to throw so the loop (and the sleep branch on empty
    // batches) can be observed without actually running forever.
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation((fn) => { fn(); return 0; });

    let calls = 0;
    const outboxService = {
      rescheduleStaleProcessing: async () => 0,
      leaseNextBatch: async () => {
        calls += 1;
        if (calls >= 3) throw new Error('lease exhausted');
        return [];
      },
      markProjected: async () => undefined,
      markRetrying: async () => undefined,
      markDeadLetter: async () => undefined,
    };
    const projector = { applyEvent: async () => ({ projected: true }) };
    const neo4jDriver = { session: () => ({ close: async () => undefined }) };

    await expect(runProjectionWorker({ db: {}, neo4jDriver, outboxService, projector, maxAttempts: 8, intervalMs: 1, once: false }))
      .rejects.toThrow('lease exhausted');

    expect(calls).toBe(3);
    expect(setTimeoutSpy).toHaveBeenCalled();

    setTimeoutSpy.mockRestore();
  });
});
