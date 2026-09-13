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
    // #941: appendEvent now ensures the outbox indexes (including the
    // eventId unique index) on its own write path, not only from the
    // manual rebuild script.
    expect(indexes.length).toBe(3);
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

  // #941: ensureIndexes (including the eventId unique index that makes
  // outbox delivery idempotent) was only ever called from the manual
  // scripts/neo4j-canonical-rebuild.js script. appendEvent must now build
  // it on its own write path, latched once per process -- and, unlike
  // sampleIndexes.js/cid.service.js, a build failure must still surface
  // rather than be swallowed, because that is ensureIndexes's own existing
  // posture (no internal try/catch) and the manual-script call must keep
  // failing loudly too.
  describe('#941 appendEvent index wiring', () => {
    function makeCollection(createIndexImpl) {
      const indexes = [];
      const updates = [];
      return {
        indexes,
        updates,
        createIndex: async (...args) => {
          if (createIndexImpl) return createIndexImpl(...args);
          indexes.push(args);
        },
        updateOne: async (...args) => { updates.push(args); },
      };
    }

    it('builds the eventId unique index (and the other two) via appendEvent, pinned by value', async () => {
      const collection = makeCollection();
      const db = { collection: () => collection };
      const service = new Neo4jOutboxService({ collectionName: '941_wiring_value_pin' });

      await service.appendEvent(db, { eventId: 'e1', eventType: 'T', aggregateType: 'A', aggregateId: '1', payload: {} });

      expect(collection.indexes).toHaveLength(3);
      expect(collection.indexes[0][0]).toEqual({ eventId: 1 });
      expect(collection.indexes[0][1]).toEqual({ unique: true, name: 'graph_projection_outbox_eventId_unique' });
      expect(collection.indexes[1][0]).toEqual({ status: 1, aggregateType: 1, aggregateId: 1, occurredAt: 1 });
      expect(collection.indexes[1][1]).toEqual({ name: 'graph_projection_outbox_status_aggregate_idx' });
      expect(collection.indexes[2][0]).toEqual({ leaseUntil: 1, status: 1, occurredAt: 1 });
      expect(collection.indexes[2][1]).toEqual({ name: 'graph_projection_outbox_lease_idx' });
    });

    it('builds the indexes only once per process across multiple appendEvent calls and service instances', async () => {
      const collection = makeCollection();
      const db = { collection: () => collection };
      const collectionName = '941_wiring_once_per_process';

      const first = new Neo4jOutboxService({ collectionName });
      const second = new Neo4jOutboxService({ collectionName });

      await first.appendEvent(db, { eventId: 'e1', eventType: 'T', aggregateType: 'A', aggregateId: '1', payload: {} });
      await first.appendEvent(db, { eventId: 'e2', eventType: 'T', aggregateType: 'A', aggregateId: '1', payload: {} });
      await second.appendEvent(db, { eventId: 'e3', eventType: 'T', aggregateType: 'A', aggregateId: '1', payload: {} });

      expect(collection.indexes).toHaveLength(3);
      expect(collection.updates).toHaveLength(3);
    });

    it('does not rebuild indexes for one collection name when another collection name is appended to', async () => {
      const collection = makeCollection();
      const db = { collection: () => collection };

      const serviceA = new Neo4jOutboxService({ collectionName: '941_wiring_name_a' });
      const serviceB = new Neo4jOutboxService({ collectionName: '941_wiring_name_b' });

      await serviceA.appendEvent(db, { eventId: 'e1', eventType: 'T', aggregateType: 'A', aggregateId: '1', payload: {} });
      await serviceB.appendEvent(db, { eventId: 'e2', eventType: 'T', aggregateType: 'A', aggregateId: '1', payload: {} });

      expect(collection.indexes).toHaveLength(6);
    });

    // #941: appendEvent must NOT propagate an index-build failure. The index
    // is a backstop and the append is the mechanism -- letting a failed build
    // take down every outbox append would trade a missing index for a broken
    // projection pipeline. ensureIndexes itself still throws, because its other
    // caller (scripts/neo4j-canonical-rebuild.js) is ASKING for the indexes and
    // a failure there IS its result. Two callers, opposite defaults -- the same
    // split #923 documents for probeTopology.
    //
    // Found by a two-hop consumer sweep: the first draft threw, which broke
    // tests/unit/reference-imports/pipeline.test.js, whose fake collection has
    // no createIndex at all.
    it('does not let an index-build failure break the append', async () => {
      const collection = makeCollection(async () => {
        throw new Error('E11000 duplicate key error');
      });
      const db = { collection: () => collection };
      const service = new Neo4jOutboxService({ collectionName: '941_wiring_logs' });

      await expect(
        service.appendEvent(db, { eventId: 'e1', eventType: 'T', aggregateType: 'A', aggregateId: '1', payload: {} })
      ).resolves.not.toThrow();

      expect(collection.updates).toHaveLength(1);
      expect(collection.updates[0][0]).toEqual({ eventId: 'e1' });
    });

    it('survives a collection with no createIndex at all (the pipeline.test.js fake)', async () => {
      const updates = [];
      const collection = { updateOne: async (...args) => { updates.push(args); return { upsertedCount: 1 }; } };
      const db = { collection: () => collection };
      const service = new Neo4jOutboxService({ collectionName: '941_no_createIndex' });

      await expect(
        service.appendEvent(db, { eventId: 'e2', eventType: 'T', aggregateType: 'A', aggregateId: '2', payload: {} })
      ).resolves.not.toThrow();

      expect(updates).toHaveLength(1);
    });
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
