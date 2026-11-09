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

const { runProjectionOnce, runProjectionWorker, PROJECTOR_NAME } = require('../../src/workers/neo4jProjection.worker');

describe('neo4jProjection.worker', () => {
  it('replays outbox events idempotently and marks dead letters after repeated failures', async () => {
    const events = [
      { eventId: 'evt-1', eventType: 'CONSENT_UPSERTED', aggregateType: 'EthicalConsent', aggregateId: 'consent-1', attempts: 0, schemaVersion: 1, payload: { donorKey: 'patient-1' } },
      { eventId: 'evt-2', eventType: 'QUALITY_ASSESSED', aggregateType: 'Sample', aggregateId: 'sample-1', attempts: 8, schemaVersion: 1, payload: { sampleId: 'sample-1' } },
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

  // #1313 (RNF019 C5): the retry carries its attempt count, which sets its backoff.
  it('passes the attempt count to markRetrying', async () => {
    const retries = [];
    const outboxService = {
      rescheduleStaleProcessing: async () => 0,
      leaseNextBatch: async () => [{ eventId: 'evt-b', aggregateType: 'Sample', aggregateId: 's-b', attempts: 3 }],
      markProjected: async () => undefined,
      markRetrying: async (_db, eventId, _error, options) => retries.push({ eventId, options }),
      markDeadLetter: async () => undefined,
    };
    const projector = { applyEvent: async () => { throw new Error('transient neo4j error'); } };
    const neo4jDriver = { session: () => ({ close: async () => undefined }) };

    await runProjectionOnce({ db: {}, neo4jDriver, outboxService, projector, maxAttempts: 8 });

    expect(retries).toEqual([{ eventId: 'evt-b', options: { attempts: 3 } }]);
  });

  // #1501 (RNF019 C5): leaseNextBatch counts the try before the projector runs,
  // so an event leased on its seventh try of eight is retried, and only the
  // eighth try's failure dead-letters it.
  it('retries an event leased on its next-to-last try and dead-letters it on the last', async () => {
    const run = async (attempts) => {
      const state = { retrying: [], dead: [] };
      const outboxService = {
        rescheduleStaleProcessing: async () => 0,
        leaseNextBatch: async () => [{ eventId: `evt-${attempts}`, aggregateType: 'Sample', aggregateId: 's-l', attempts }],
        markProjected: async () => undefined,
        markRetrying: async (_db, eventId, _error, options) => state.retrying.push({ eventId, options }),
        markDeadLetter: async (_db, eventId) => state.dead.push(eventId),
      };
      const projector = { applyEvent: async () => { throw new Error('neo4j offline'); } };
      const neo4jDriver = { session: () => ({ close: async () => undefined }) };
      await runProjectionOnce({ db: {}, neo4jDriver, outboxService, projector, maxAttempts: 8 });
      return state;
    };

    expect(await run(7)).toEqual({ retrying: [{ eventId: 'evt-7', options: { attempts: 7 } }], dead: [] });
    expect(await run(8)).toEqual({ retrying: [], dead: ['evt-8'] });
  });

  // #1313 (RNF019 C5/C7): a dead letter is logged as an error, naming it.
  it('logs a dead letter as an error with its aggregate and version', async () => {
    const logger = require('../../src/utils/logger');
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const outboxService = {
      rescheduleStaleProcessing: async () => 0,
      leaseNextBatch: async () => [{ eventId: 'evt-x', eventType: 'T', aggregateType: 'Sample', aggregateId: 's-x', attempts: 8 }],
      markProjected: async () => undefined,
      markRetrying: async () => undefined,
      markDeadLetter: async () => undefined,
    };
    const projector = { applyEvent: async () => { throw new Error('neo4j offline'); } };
    const neo4jDriver = { session: () => ({ close: async () => undefined }) };

    try {
      await runProjectionOnce({ db: {}, neo4jDriver, outboxService, projector, maxAttempts: 8 });

      const deadLetterLogs = errorSpy.mock.calls.filter(([message]) => String(message).includes('DEAD_LETTER'));
      expect(deadLetterLogs).toHaveLength(1);
      expect(deadLetterLogs[0][1]).toMatchObject({ eventId: 'evt-x', aggregateId: 's-x', aggregateVersion: null, attempts: 8, error: 'neo4j offline' });
    } finally {
      errorSpy.mockRestore();
    }
  });

  // #1313 (RF023 AC4, RNF019 C3/C4): versioned events apply in aggregate
  // version order, once per projector, under a GraphProjectionCheckpoint.
  describe('#1313 versioned events and the checkpoint', () => {
    function makeOutbox({ checkpoint = null, blocker = null } = {}) {
      const calls = [];
      return {
        calls,
        service: {
          rescheduleStaleProcessing: async () => 0,
          leaseNextBatch: async () => [],
          getCheckpoint: async (_db, projectorName, partitionKey) => {
            calls.push(['getCheckpoint', projectorName, partitionKey]);
            return checkpoint;
          },
          findEarlierUnprojectedVersion: async (_db, event) => { calls.push(['hasEarlier', event.eventId]); return blocker; },
          markDeferred: async (_db, eventId, options) => calls.push(['deferred', eventId, options]),
          recordCheckpoint: async (_db, projectorName, event) => calls.push(['checkpoint', projectorName, event.eventId]),
          markProjected: async (_db, eventId) => calls.push(['projected', eventId]),
          markRetrying: async (_db, eventId) => calls.push(['retrying', eventId]),
          markDeadLetter: async (_db, eventId) => calls.push(['dead', eventId]),
        },
      };
    }
    const event = { eventId: 'evt-v3', aggregateType: 'Sample', aggregateId: 's-1', aggregateVersion: 3, attempts: 1 };
    const neo4jDriver = { session: () => ({ close: async () => undefined }) };

    async function run(outbox, applied) {
      outbox.service.leaseNextBatch = async () => [event];
      const projector = { applyEvent: async (_session, e) => { applied.push(e.eventId); } };
      return runProjectionOnce({ db: {}, neo4jDriver, outboxService: outbox.service, projector, maxAttempts: 8 });
    }

    it('applies a new version, then records the checkpoint, then marks it projected', async () => {
      const outbox = makeOutbox({ checkpoint: { lastAggregateVersion: 2 } });
      const applied = [];

      const result = await run(outbox, applied);

      expect(applied).toEqual(['evt-v3']);
      expect(outbox.calls).toEqual([
        ['getCheckpoint', PROJECTOR_NAME, 'Sample:s-1'],
        ['hasEarlier', 'evt-v3'],
        ['checkpoint', PROJECTOR_NAME, 'evt-v3'],
        ['projected', 'evt-v3'],
      ]);
      expect(result).toMatchObject({ processed: 1, projected: 1, skipped: 0, deferred: 0 });
    });

    it('skips a version the checkpoint already covers, without applying it again', async () => {
      const outbox = makeOutbox({ checkpoint: { lastAggregateVersion: 3 } });
      const applied = [];

      const result = await run(outbox, applied);

      expect(applied).toEqual([]);
      expect(outbox.calls.map((c) => c[0])).toEqual(['getCheckpoint', 'projected']);
      expect(result).toMatchObject({ projected: 0, skipped: 1, deferred: 0 });
    });

    it('defers a version while an earlier version of its aggregate is unprojected', async () => {
      const outbox = makeOutbox({ blocker: { eventId: 'evt-v2', status: 'RETRYING' } });
      const applied = [];

      const result = await run(outbox, applied);

      expect(applied).toEqual([]);
      expect(outbox.calls.map((c) => c[0])).toEqual(['getCheckpoint', 'hasEarlier', 'deferred']);
      expect(outbox.calls[2][2]).toEqual({ blockedByDeadLetter: false });
      expect(result).toMatchObject({ projected: 0, skipped: 0, deferred: 1, failed: 0 });
    });

    it('holds a version behind a dead letter of its aggregate', async () => {
      const outbox = makeOutbox({ blocker: { eventId: 'evt-v2', status: 'DEAD_LETTER' } });
      const applied = [];

      await run(outbox, applied);

      expect(applied).toEqual([]);
      expect(outbox.calls[2]).toEqual(['deferred', 'evt-v3', { blockedByDeadLetter: true }]);
    });

    it('applies an event from before the versioned contract without touching the checkpoint', async () => {
      const outbox = makeOutbox();
      const applied = [];
      outbox.service.leaseNextBatch = async () => [{ eventId: 'evt-old', aggregateType: 'Sample', aggregateId: 's-1', attempts: 1 }];
      const projector = { applyEvent: async (_session, e) => { applied.push(e.eventId); } };

      await runProjectionOnce({ db: {}, neo4jDriver, outboxService: outbox.service, projector, maxAttempts: 8 });

      expect(applied).toEqual(['evt-old']);
      expect(outbox.calls).toEqual([['projected', 'evt-old']]);
    });
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
    expect(result).toEqual({ processed: 0, projected: 0, failed: 0, skipped: 0, deferred: 0 });
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

    expect(result).toEqual({ processed: 0, projected: 0, failed: 0, skipped: 0, deferred: 0 });
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

    expect(result).toEqual({ processed: 1, projected: 1, failed: 0, skipped: 0, deferred: 0 });
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
    expect(result).toEqual({ processed: 0, projected: 0, failed: 0, skipped: 0, deferred: 0 });

    setTimeoutSpy.mockRestore();
  });
});
