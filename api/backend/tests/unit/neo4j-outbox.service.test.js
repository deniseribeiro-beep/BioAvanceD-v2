const { Neo4jOutboxService, hashPayload } = require('../../src/services/neo4jOutbox.service');

describe('Neo4jOutboxService', () => {
  beforeEach(() => {
    process.env.GRAPH_PSEUDONYMIZATION_SALT = 'test-salt';
  });

  it('hashes payload deterministically regardless of key order', () => {
    const first = hashPayload({ b: 2, a: 1 });
    const second = hashPayload({ a: 1, b: 2 });
    expect(first).toBe(second);
  });

  it('builds append-only outbox documents with a deterministic payload hash', async () => {
    const updates = [];
    const indexes = [];
    const collection = {
      createIndex: async (...args) => { indexes.push(args); },
      updateOne: async (...args) => { updates.push(args); },
      find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }) }),
      updateMany: async () => ({ modifiedCount: 0 }),
    };
    const db = { collection: () => collection };
    const service = new Neo4jOutboxService();

    const event = await service.appendEvent(db, {
      eventId: 'evt-1',
      eventType: 'CONSENT_UPSERTED',
      aggregateType: 'EthicalConsent',
      aggregateId: 'consent-1',
      payload: { sampleId: 'sample-1', donorKey: 'patient-1' },
      sourceService: 'unit-test'
    });

    expect(event.eventId).toBe('evt-1');
    expect(event.payloadHash).toBe(hashPayload({ sampleId: 'sample-1', donorKey: 'patient-1' }));
    expect(updates).toHaveLength(1);
    expect(updates[0][0]).toEqual({ eventId: 'evt-1' });
    expect(updates[0][1].$setOnInsert.status).toBe('PENDING');
    expect(updates[0][1].$setOnInsert.schemaVersion).toBe(1);
    expect(indexes.length).toBe(0);
  });

  it('reschedules abandoned processing events back to retrying', async () => {
    const updateManyCalls = [];
    const collection = {
      createIndex: async () => undefined,
      updateOne: async () => undefined,
      updateMany: async (...args) => {
        updateManyCalls.push(args);
        return { modifiedCount: 2 };
      },
      find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }) }),
    };
    const db = { collection: () => collection };
    const service = new Neo4jOutboxService();

    const modified = await service.rescheduleStaleProcessing(db, { leaseMs: 1 });

    expect(modified).toBe(2);
    expect(updateManyCalls.length).toBe(1);
    expect(updateManyCalls[0][0].status).toBe('PROCESSING');
  });
});
