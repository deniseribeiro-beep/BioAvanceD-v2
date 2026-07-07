const { runProjectionOnce } = require('../../src/workers/neo4jProjection.worker');

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
});
