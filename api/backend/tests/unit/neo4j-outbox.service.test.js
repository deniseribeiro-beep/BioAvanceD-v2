const { Neo4jOutboxService, hashPayload, stableStringify } = require('../../src/services/neo4jOutbox.service');

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

  it('hashes Date and array values as ISO strings and sorted-key objects', () => {
    const first = hashPayload({ when: new Date('2026-01-01T00:00:00.000Z'), items: [{ b: 2, a: 1 }] });
    const second = hashPayload({ items: [{ a: 1, b: 2 }], when: new Date('2026-01-01T00:00:00.000Z') });
    expect(first).toBe(second);
    expect(stableStringify({ when: new Date('2026-01-01T00:00:00.000Z') })).toBe('{"when":"2026-01-01T00:00:00.000Z"}');
  });

  it('throws when the provided db has no collection function', () => {
    const service = new Neo4jOutboxService();
    expect(() => service.getCollection(null)).toThrow('Database MongoDB indisponível para outbox do grafo');
    expect(() => service.getCollection({})).toThrow('Database MongoDB indisponível para outbox do grafo');
  });

  it('uses a custom collection name when provided', () => {
    const seen = [];
    const db = { collection: (name) => { seen.push(name); return {}; } };
    const service = new Neo4jOutboxService({ collectionName: 'custom_outbox' });

    service.getCollection(db);

    expect(seen).toEqual(['custom_outbox']);
  });

  it('creates the expected indexes', async () => {
    const indexes = [];
    const collection = {
      createIndex: async (...args) => { indexes.push(args); },
    };
    const db = { collection: () => collection };
    const service = new Neo4jOutboxService();

    const result = await service.ensureIndexes(db);

    expect(result).toBe(true);
    expect(indexes).toHaveLength(3);
    expect(indexes[0][0]).toEqual({ eventId: 1 });
    expect(indexes[0][1]).toMatchObject({ unique: true, name: 'graph_projection_outbox_eventId_unique' });
    expect(indexes[1][1]).toMatchObject({ name: 'graph_projection_outbox_status_aggregate_idx' });
    expect(indexes[2][1]).toMatchObject({ name: 'graph_projection_outbox_lease_idx' });
  });

  it('leases the next batch of pending/retrying events and marks them processing', async () => {
    const events = [{ eventId: 'evt-1' }, { eventId: 'evt-2' }];
    const updateManyCalls = [];
    const findCalls = [];
    const collection = {
      updateMany: async (...args) => { updateManyCalls.push(args); return { modifiedCount: 0 }; },
      find: (query) => {
        findCalls.push(query);
        return {
          sort: () => ({ limit: () => ({ toArray: async () => events }) }),
          toArray: async () => events,
        };
      },
    };
    const db = { collection: () => collection };
    const service = new Neo4jOutboxService();

    const leased = await service.leaseNextBatch(db, { batchSize: 5, leaseMs: 1000 });

    expect(leased).toEqual(events);
    expect(findCalls[0]).toMatchObject({ status: { $in: ['PENDING', 'RETRYING'] } });
    expect(updateManyCalls).toHaveLength(2);
    expect(updateManyCalls[0][0]).toMatchObject({ status: 'PROCESSING' });
    expect(updateManyCalls[1][0]).toEqual({ eventId: { $in: ['evt-1', 'evt-2'] } });
    expect(updateManyCalls[1][1].$set.status).toBe('PROCESSING');
  });

  it('returns an empty array from leaseNextBatch when there is nothing to lease', async () => {
    const updateManyCalls = [];
    const collection = {
      updateMany: async (...args) => { updateManyCalls.push(args); return { modifiedCount: 0 }; },
      find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }) }),
    };
    const db = { collection: () => collection };
    const service = new Neo4jOutboxService();

    const leased = await service.leaseNextBatch(db);

    expect(leased).toEqual([]);
    expect(updateManyCalls).toHaveLength(1);
  });

  it('marks an event as projected', async () => {
    const updates = [];
    const collection = { updateOne: async (...args) => { updates.push(args); } };
    const db = { collection: () => collection };
    const service = new Neo4jOutboxService();

    await service.markProjected(db, 'evt-1');

    expect(updates[0][0]).toEqual({ eventId: 'evt-1' });
    expect(updates[0][1].$set.status).toBe('PROJECTED');
    expect(updates[0][1].$set.lastError).toBeNull();
  });

  it('marks an event as retrying, stringifying an Error instance', async () => {
    const updates = [];
    const collection = { updateOne: async (...args) => { updates.push(args); } };
    const db = { collection: () => collection };
    const service = new Neo4jOutboxService();

    await service.markRetrying(db, 'evt-1', new Error('boom'));

    expect(updates[0][1].$set.status).toBe('RETRYING');
    expect(updates[0][1].$set.lastError).toBe('boom');
  });

  it('marks an event as retrying with a fallback message when no error message exists', async () => {
    const updates = [];
    const collection = { updateOne: async (...args) => { updates.push(args); } };
    const db = { collection: () => collection };
    const service = new Neo4jOutboxService();

    await service.markRetrying(db, 'evt-1', null);

    expect(updates[0][1].$set.lastError).toBe('unknown_error');
  });

  it('marks an event as dead letter', async () => {
    const updates = [];
    const collection = { updateOne: async (...args) => { updates.push(args); } };
    const db = { collection: () => collection };
    const service = new Neo4jOutboxService();

    await service.markDeadLetter(db, 'evt-1', 'fatal error');

    expect(updates[0][1].$set.status).toBe('DEAD_LETTER');
    expect(updates[0][1].$set.lastError).toBe('fatal error');
    expect(updates[0][1].$set.leaseUntil).toBeNull();
  });

  it('recovers stale processing events back to retrying', async () => {
    const updateManyCalls = [];
    const collection = {
      updateMany: async (...args) => { updateManyCalls.push(args); return { modifiedCount: 3 }; },
    };
    const db = { collection: () => collection };
    const service = new Neo4jOutboxService();

    const recovered = await service.recoverProcessing(db, 1);

    expect(recovered).toBe(3);
    expect(updateManyCalls[0][0]).toMatchObject({ status: 'PROCESSING' });
    expect(updateManyCalls[0][1].$set.status).toBe('RETRYING');
  });
});
