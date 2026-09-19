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

  it('stops gracefully and returns normally once options.shouldStop() reports true (issue #177)', async () => {
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation((fn) => { fn(); return 0; });

    let calls = 0;
    const outboxService = {
      rescheduleStaleProcessing: async () => 0,
      leaseNextBatch: async () => {
        calls += 1;
        // Safety net: if shouldStop isn't honored the loop would spin forever;
        // fail fast with a clear error instead of hanging the test run.
        if (calls > 5) throw new Error('shouldStop was not honored');
        return [];
      },
      markProjected: async () => undefined,
      markRetrying: async () => undefined,
      markDeadLetter: async () => undefined,
    };
    const projector = { applyEvent: async () => ({ projected: true }) };
    const neo4jDriver = { session: () => ({ close: async () => undefined }) };

    const result = await runProjectionWorker({
      db: {}, neo4jDriver, outboxService, projector, maxAttempts: 8, intervalMs: 1, once: false,
      shouldStop: () => calls >= 3,
    });

    expect(calls).toBe(3);
    expect(result).toEqual({ processed: 0, projected: 0, failed: 0 });

    setTimeoutSpy.mockRestore();
  });
});


describe('neo4jProjection.worker item 8 governance branches', () => {
  const env = require('../../src/config/env');
  const fs = require('fs');
  const logger = require('../../src/utils/logger');

  it('defers projection when Neo4j is unavailable and fail-open is configured', async () => {
    const previousRequired = env.NEO4J_REQUIRED;
    env.NEO4J_REQUIRED = false;
    neo4jConnection.connectNeo4j.mockRejectedValueOnce(new Error('neo4j unavailable'));
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    const result = await runProjectionOnce({ db: {} });

    expect(result).toEqual({ processed: 0, projected: 0, failed: 0, deferred: true });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('projeção adiada'),
      { error: 'neo4j unavailable' }
    );

    env.NEO4J_REQUIRED = previousRequired;
    warnSpy.mockRestore();
  });

  it('propagates Neo4j connection errors when worker fail-closed is required', async () => {
    const previousRequired = env.NEO4J_REQUIRED;
    env.NEO4J_REQUIRED = true;
    neo4jConnection.connectNeo4j.mockRejectedValueOnce(new Error('required neo4j unavailable'));

    await expect(runProjectionOnce({ db: {} })).rejects.toThrow('required neo4j unavailable');

    env.NEO4J_REQUIRED = previousRequired;
  });

  it('uses environment/default lease, batch, max-attempt and database fallbacks', async () => {
    const snapshot = {
      max: env.GRAPH_OUTBOX_MAX_ATTEMPTS,
      lease: env.GRAPH_OUTBOX_LEASE_MS,
      batch: env.GRAPH_OUTBOX_BATCH_SIZE,
      database: env.NEO4J_DATABASE,
    };
    env.GRAPH_OUTBOX_MAX_ATTEMPTS = 4;
    env.GRAPH_OUTBOX_LEASE_MS = 321;
    env.GRAPH_OUTBOX_BATCH_SIZE = 7;
    env.NEO4J_DATABASE = '';

    const outboxService = {
      rescheduleStaleProcessing: vi.fn().mockResolvedValue(0),
      leaseNextBatch: vi.fn().mockResolvedValue([]),
    };
    const session = { close: vi.fn().mockResolvedValue(undefined) };
    const neo4jDriver = { session: vi.fn(() => session) };
    const projector = { applyEvent: vi.fn() };

    const result = await runProjectionOnce({ db: {}, neo4jDriver, outboxService, projector });

    expect(result).toEqual({ processed: 0, projected: 0, failed: 0 });
    expect(outboxService.rescheduleStaleProcessing).toHaveBeenCalledWith({}, { leaseMs: 321 });
    expect(outboxService.leaseNextBatch).toHaveBeenCalledWith({}, {
      batchSize: 7,
      leaseMs: 321,
      maxAttempts: 4,
    });

    env.GRAPH_OUTBOX_MAX_ATTEMPTS = snapshot.max;
    env.GRAPH_OUTBOX_LEASE_MS = snapshot.lease;
    env.GRAPH_OUTBOX_BATCH_SIZE = snapshot.batch;
    env.NEO4J_DATABASE = snapshot.database;
  });

  it('covers hard-coded queue defaults when environment values are absent', async () => {
    const snapshot = {
      max: env.GRAPH_OUTBOX_MAX_ATTEMPTS,
      lease: env.GRAPH_OUTBOX_LEASE_MS,
      batch: env.GRAPH_OUTBOX_BATCH_SIZE,
      database: env.NEO4J_DATABASE,
    };
    env.GRAPH_OUTBOX_MAX_ATTEMPTS = 0;
    env.GRAPH_OUTBOX_LEASE_MS = 0;
    env.GRAPH_OUTBOX_BATCH_SIZE = 0;
    env.NEO4J_DATABASE = '';

    const outboxService = {
      rescheduleStaleProcessing: vi.fn().mockResolvedValue(0),
      leaseNextBatch: vi.fn().mockResolvedValue([]),
    };
    const neo4jDriver = { session: vi.fn(() => ({ close: vi.fn() })) };

    await runProjectionOnce({ db: {}, neo4jDriver, outboxService, projector: { applyEvent: vi.fn() } });

    expect(outboxService.rescheduleStaleProcessing).toHaveBeenCalledWith({}, { leaseMs: 5 * 60 * 1000 });
    expect(outboxService.leaseNextBatch).toHaveBeenCalledWith({}, {
      batchSize: 100,
      leaseMs: 5 * 60 * 1000,
      maxAttempts: 8,
    });

    env.GRAPH_OUTBOX_MAX_ATTEMPTS = snapshot.max;
    env.GRAPH_OUTBOX_LEASE_MS = snapshot.lease;
    env.GRAPH_OUTBOX_BATCH_SIZE = snapshot.batch;
    env.NEO4J_DATABASE = snapshot.database;
  });

  it('writes heartbeat on a one-shot cycle and tolerates heartbeat write failures', async () => {
    const outboxService = {
      rescheduleStaleProcessing: vi.fn().mockResolvedValue(0),
      leaseNextBatch: vi.fn().mockResolvedValue([]),
    };
    const neo4jDriver = { session: vi.fn(() => ({ close: vi.fn() })) };
    const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);

    await runProjectionWorker({
      db: {},
      neo4jDriver,
      outboxService,
      projector: { applyEvent: vi.fn() },
      once: true,
      heartbeatPath: '/tmp/item8-heartbeat',
    });
    expect(writeSpy).toHaveBeenCalled();

    writeSpy.mockImplementationOnce(() => { throw 'raw heartbeat failure'; });
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    await expect(runProjectionWorker({
      db: {},
      neo4jDriver,
      outboxService,
      projector: { applyEvent: vi.fn() },
      once: true,
      heartbeatPath: '/tmp/item8-heartbeat',
    })).resolves.toEqual({ processed: 0, projected: 0, failed: 0 });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('heartbeat'),
      { error: 'raw heartbeat failure' }
    );

    writeSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('continues immediately after a processed batch before stopping on the next pass', async () => {
    const events = [[{ eventId: 'evt-processed', attempts: 0 }], []];
    const outboxService = {
      rescheduleStaleProcessing: vi.fn().mockResolvedValue(0),
      leaseNextBatch: vi.fn(async () => events.shift() || []),
      markProjected: vi.fn().mockResolvedValue(undefined),
      markRetrying: vi.fn().mockResolvedValue(undefined),
      markDeadLetter: vi.fn().mockResolvedValue(undefined),
    };
    const projector = { applyEvent: vi.fn().mockResolvedValue({ projected: true }) };
    const neo4jDriver = { session: vi.fn(() => ({ close: vi.fn().mockResolvedValue(undefined) })) };
    let stopChecks = 0;

    const result = await runProjectionWorker({
      db: {},
      neo4jDriver,
      outboxService,
      projector,
      intervalMs: 1,
      shouldStop: () => {
        stopChecks += 1;
        return stopChecks >= 2;
      },
    });

    expect(projector.applyEvent).toHaveBeenCalledOnce();
    expect(result).toEqual({ processed: 0, projected: 0, failed: 0 });
  });
});
