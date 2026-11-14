const {
  Neo4jOutboxService,
  hashPayload,
  stableStringify,
  buildIdempotencyKey,
  MAX_RETRY_BACKOFF_MS,
} = require('../../src/services/neo4jOutbox.service');
const { CANONICAL_MODEL_RELEASE_ID } = require('../../src/foundation/readiness');
const { runWithRequestId } = require('../../src/utils/requestContext');

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
      findOneAndUpdate: async () => ({ version: 1 }),
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
    expect(indexes.length).toBe(4);
    // No session given: the append is its own write.
    expect(updates[0][2]).toEqual({ upsert: true });
  });

  // #1313 (RF023 AC3, RNF019 C1): the event commits with its aggregate.
  it('appends inside the caller transaction when given its session', async () => {
    const updates = [];
    const collection = {
      createIndex: async () => {},
      updateOne: async (...args) => { updates.push(args); },
      findOneAndUpdate: async () => ({ version: 1 }),
    };
    const session = { id: 'session-1' };
    const service = new Neo4jOutboxService({ collectionName: 'outbox_session_case' });

    await service.appendEvent({ collection: () => collection }, {
      eventId: 'evt-s',
      eventType: 'CONSENT_UPSERTED',
      aggregateType: 'EthicalConsent',
      aggregateId: 'consent-1',
    }, { session });

    expect(updates[0][2]).toEqual({ upsert: true, session });
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

    // #1529: the dead-letter sweep and the retry sweep each report 2 here.
    expect(modified).toBe(4);
    expect(updateManyCalls.length).toBe(2);
    expect(updateManyCalls[0][1].$set.status).toBe('DEAD_LETTER');
    expect(updateManyCalls[1][0].status).toBe('PROCESSING');
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
    expect(indexes).toHaveLength(4);
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
        findOneAndUpdate: async () => ({ version: 1 }),
      };
    }

    it('builds the eventId unique index (and the other three) via appendEvent, pinned by value', async () => {
      const collection = makeCollection();
      const db = { collection: () => collection };
      const service = new Neo4jOutboxService({ collectionName: '941_wiring_value_pin' });

      await service.appendEvent(db, { eventId: 'e1', eventType: 'T', aggregateType: 'A', aggregateId: '1', payload: {} });

      expect(collection.indexes).toHaveLength(4);
      expect(collection.indexes[0][0]).toEqual({ eventId: 1 });
      expect(collection.indexes[0][1]).toEqual({ unique: true, name: 'graph_projection_outbox_eventId_unique' });
      expect(collection.indexes[1][0]).toEqual({ status: 1, aggregateType: 1, aggregateId: 1, occurredAt: 1 });
      expect(collection.indexes[1][1]).toEqual({ name: 'graph_projection_outbox_status_aggregate_idx' });
      expect(collection.indexes[2][0]).toEqual({ leaseUntil: 1, status: 1, occurredAt: 1 });
      expect(collection.indexes[2][1]).toEqual({ name: 'graph_projection_outbox_lease_idx' });
      expect(collection.indexes[3][0]).toEqual({ idempotencyKey: 1 });
      expect(collection.indexes[3][1]).toEqual({
        unique: true,
        name: 'graph_projection_outbox_idempotencyKey_unique',
        partialFilterExpression: { idempotencyKey: { $type: 'string' } },
      });
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

      expect(collection.indexes).toHaveLength(4);
      expect(collection.updates).toHaveLength(3);
    });

    it('does not rebuild indexes for one collection name when another collection name is appended to', async () => {
      const collection = makeCollection();
      const db = { collection: () => collection };

      const serviceA = new Neo4jOutboxService({ collectionName: '941_wiring_name_a' });
      const serviceB = new Neo4jOutboxService({ collectionName: '941_wiring_name_b' });

      await serviceA.appendEvent(db, { eventId: 'e1', eventType: 'T', aggregateType: 'A', aggregateId: '1', payload: {} });
      await serviceB.appendEvent(db, { eventId: 'e2', eventType: 'T', aggregateType: 'A', aggregateId: '1', payload: {} });

      expect(collection.indexes).toHaveLength(8);
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
      const collection = {
        updateOne: async (...args) => { updates.push(args); return { upsertedCount: 1 }; },
        findOneAndUpdate: async () => ({ version: 1 }),
      };
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
    // #1529: dead-letter sweep, retry sweep, then the claim.
    expect(updateManyCalls).toHaveLength(3);
    expect(updateManyCalls[0][1].$set.status).toBe('DEAD_LETTER');
    expect(updateManyCalls[1][0]).toMatchObject({ status: 'PROCESSING' });
    // #1550: the claim re-checks the find's selector.
    expect(updateManyCalls[2][0]).toEqual({ eventId: { $in: ['evt-1', 'evt-2'] }, ...findCalls[0] });
    expect(updateManyCalls[2][1].$set.status).toBe('PROCESSING');
    expect(typeof updateManyCalls[2][1].$set.leaseId).toBe('string');
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
    // #1529: the dead-letter sweep and the retry sweep; no claim.
    expect(updateManyCalls).toHaveLength(2);
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

  // #1313 (RF023 AC1/AC2, RNF019 C2): every event carries its type's
  // version, its aggregate's version, a replay key and the canonical release.
  describe('#1313 versioned events', () => {
    function makeVersionedDb() {
      const versions = new Map();
      const counterCalls = [];
      const updates = [];
      const collection = {
        createIndex: async () => {},
        updateOne: async (...args) => { updates.push(args); },
        findOneAndUpdate: async (filter, update, options) => {
          counterCalls.push({ filter, update, options });
          const version = (versions.get(filter._id) || 0) + update.$inc.version;
          versions.set(filter._id, version);
          return { _id: filter._id, version };
        },
      };
      const names = [];
      return { db: { collection: (name) => { names.push(name); return collection; } }, counterCalls, updates, names };
    }

    it('stamps eventTypeVersion, aggregateVersion, idempotencyKey and canonicalModelReleaseId', async () => {
      const { db, counterCalls, updates, names } = makeVersionedDb();
      const service = new Neo4jOutboxService({ collectionName: '1313_versioned_fields' });
      const session = { id: 'tx-1' };

      const event = await service.appendEvent(db, {
        eventType: 'CONSENT_UPSERTED',
        aggregateType: 'EthicalConsent',
        aggregateId: 'consent-1',
        payload: { status: 'ACTIVE' },
      }, { session });

      expect(event.eventTypeVersion).toBe('1');
      expect(event.aggregateVersion).toBe(1);
      expect(event.canonicalModelReleaseId).toBe(CANONICAL_MODEL_RELEASE_ID);
      expect(event.idempotencyKey).toBe(buildIdempotencyKey({
        aggregateType: 'EthicalConsent',
        aggregateId: 'consent-1',
        aggregateVersion: 1,
        eventType: 'CONSENT_UPSERTED',
        eventTypeVersion: '1',
        payloadHash: hashPayload({ status: 'ACTIVE' }),
      }));
      expect(updates[0][1].$setOnInsert).toMatchObject({
        eventTypeVersion: '1',
        aggregateVersion: 1,
        idempotencyKey: event.idempotencyKey,
        canonicalModelReleaseId: CANONICAL_MODEL_RELEASE_ID,
        nextAttemptAt: null,
      });
      // The version is taken in the aggregate's own transaction.
      expect(names).toContain('1313_versioned_fields_aggregate_versions');
      expect(counterCalls).toHaveLength(1);
      expect(counterCalls[0].filter).toEqual({ _id: 'EthicalConsent:consent-1' });
      expect(counterCalls[0].update.$inc).toEqual({ version: 1 });
      expect(counterCalls[0].options).toMatchObject({ upsert: true, returnDocument: 'after', session });
    });

    it('gives each append to one aggregate the next version and its own replay key, even with the same payload', async () => {
      const { db } = makeVersionedDb();
      const service = new Neo4jOutboxService({ collectionName: '1313_versioned_sequence' });
      const append = (aggregateId) => service.appendEvent(db, {
        eventType: 'SPECIMEN_UPSERTED', aggregateType: 'Sample', aggregateId, payload: { specimenId: aggregateId },
      });

      const first = await append('s-1');
      const second = await append('s-1');
      const other = await append('s-2');

      expect([first.aggregateVersion, second.aggregateVersion, other.aggregateVersion]).toEqual([1, 2, 1]);
      expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
      expect(second.payloadHash).toBe(first.payloadHash);
    });

    it('keeps a caller-supplied aggregateVersion, eventTypeVersion and release without taking a counter version', async () => {
      const { db, counterCalls } = makeVersionedDb();
      const service = new Neo4jOutboxService({ collectionName: '1313_versioned_supplied' });

      const event = await service.appendEvent(db, {
        eventType: 'T', eventTypeVersion: '2', aggregateType: 'A', aggregateId: '1',
        aggregateVersion: 7, canonicalModelReleaseId: 'release-x', payload: {},
      });

      expect(counterCalls).toHaveLength(0);
      expect(event).toMatchObject({ aggregateVersion: 7, eventTypeVersion: '2', canonicalModelReleaseId: 'release-x' });
    });
  });

  // #1313 (RNF019 C5): exponential backoff between attempts.
  describe('#1313 retry backoff', () => {
    it('doubles the delay per attempt from the base and caps it', () => {
      const service = new Neo4jOutboxService();
      expect(service.retryDelayMs(1, { backoffBaseMs: 1000 })).toBe(1000);
      expect(service.retryDelayMs(2, { backoffBaseMs: 1000 })).toBe(2000);
      expect(service.retryDelayMs(4, { backoffBaseMs: 1000 })).toBe(8000);
      expect(service.retryDelayMs(30, { backoffBaseMs: 1000 })).toBe(MAX_RETRY_BACKOFF_MS);
    });

    it('sets nextAttemptAt on a retry', async () => {
      const updates = [];
      const db = { collection: () => ({ updateOne: async (...args) => { updates.push(args); } }) };
      const service = new Neo4jOutboxService();
      const before = Date.now();

      await service.markRetrying(db, 'evt-r', new Error('neo4j offline'), { attempts: 3, backoffBaseMs: 1000 });

      const nextAttemptAt = updates[0][1].$set.nextAttemptAt.getTime();
      expect(nextAttemptAt).toBeGreaterThanOrEqual(before + 4000);
      expect(nextAttemptAt).toBeLessThanOrEqual(Date.now() + 4000);
      expect(updates[0][1].$set.status).toBe('RETRYING');
    });

    it('leases only events whose backoff has passed, in aggregate version order', async () => {
      let query;
      let sort;
      const collection = {
        updateMany: async () => ({ modifiedCount: 0 }),
        find: (q) => {
          query = q;
          return { sort: (s) => { sort = s; return { limit: () => ({ toArray: async () => [] }) }; } };
        },
      };
      const service = new Neo4jOutboxService();

      await service.leaseNextBatch({ collection: () => collection }, { batchSize: 5 });

      expect(query.$or[0]).toEqual({ nextAttemptAt: null });
      expect(query.$or[1].nextAttemptAt.$lte).toBeInstanceOf(Date);
      expect(Object.keys(sort)).toEqual(['aggregateType', 'aggregateId', 'aggregateVersion', 'occurredAt', '_id']);
    });
  });

  // #1313 (RF023 AC4, RNF019 C4): ordering and the projection checkpoint.
  describe('#1313 ordering and checkpoint', () => {
    it('finds an earlier unprojected version of the same aggregate, a dead letter included', async () => {
      let query;
      const blocker = { eventId: 'evt-0', status: 'DEAD_LETTER' };
      const db = { collection: () => ({ findOne: async (q) => { query = q; return blocker; } }) };
      const service = new Neo4jOutboxService();

      const found = await service.findEarlierUnprojectedVersion(db, { aggregateType: 'Sample', aggregateId: 's-1', aggregateVersion: 3 });

      expect(found).toBe(blocker);
      expect(query).toEqual({
        aggregateType: 'Sample',
        aggregateId: 's-1',
        aggregateVersion: { $lt: 3 },
        status: { $in: ['PENDING', 'RETRYING', 'PROCESSING', 'DEAD_LETTER'] },
      });
    });

    it('holds an event behind a dead letter for the longest backoff', async () => {
      const updates = [];
      const db = { collection: () => ({ updateOne: async (...args) => { updates.push(args); } }) };
      const before = Date.now();

      await new Neo4jOutboxService().markDeferred(db, 'evt-h', { blockedByDeadLetter: true });

      expect(updates[0][1].$set.lastError).toBe('awaiting_dead_letter_repair');
      expect(updates[0][1].$set.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(before + MAX_RETRY_BACKOFF_MS);
    });

    it('defers an event and gives its lease attempt back', async () => {
      const updates = [];
      const db = { collection: () => ({ updateOne: async (...args) => { updates.push(args); } }) };

      await new Neo4jOutboxService().markDeferred(db, 'evt-d');

      expect(updates[0][0]).toEqual({ eventId: 'evt-d' });
      expect(updates[0][1].$set).toMatchObject({ status: 'RETRYING', lastError: 'awaiting_earlier_aggregate_version' });
      expect(updates[0][1].$inc).toEqual({ attempts: -1 });
    });

    it('records the checkpoint per projector and aggregate, never moving it backwards', async () => {
      const updates = [];
      const names = [];
      const db = { collection: (name) => { names.push(name); return { updateOne: async (...args) => { updates.push(args); } }; } };
      const service = new Neo4jOutboxService();

      await service.recordCheckpoint(db, 'projector-a', {
        eventId: 'evt-5', aggregateType: 'Sample', aggregateId: 's-1', aggregateVersion: 5, schemaVersion: 1,
      });

      expect(names).toEqual(['graph_projection_checkpoints']);
      expect(updates[0][0]).toEqual({ _id: 'projector-a:Sample:s-1' });
      expect(updates[0][1].$max).toEqual({ lastAggregateVersion: 5 });
      expect(updates[0][1].$setOnInsert).toMatchObject({ projectorName: 'projector-a', partitionKey: 'Sample:s-1' });
      expect(updates[0][2]).toEqual({ upsert: true });
      // Only the event that holds the version names itself on it.
      expect(updates[1][0]).toEqual({ _id: 'projector-a:Sample:s-1', lastAggregateVersion: 5 });
      expect(updates[1][1].$set).toMatchObject({ lastEventId: 'evt-5', projectionSchemaVersion: '1' });
    });

    it('reads the checkpoint by projector and partition', async () => {
      let query;
      const db = { collection: () => ({ findOne: async (q) => { query = q; return null; } }) };

      await new Neo4jOutboxService().getCheckpoint(db, 'projector-a', 'Sample:s-1');

      expect(query).toEqual({ _id: 'projector-a:Sample:s-1' });
    });
  });

  // #1313 (RNF019 C7): detecting and repairing stalled projections.
  describe('#1313 reconciliation', () => {
    // In-memory collections matching the filter shapes the reconciliation
    // issues: equality, $in, $gt and $lt.
    function matches(doc, filter) {
      return Object.entries(filter).every(([key, cond]) => {
        if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
          if ('$in' in cond) return cond.$in.includes(doc[key]);
          if ('$gt' in cond) return doc[key] > cond.$gt;
          if ('$lt' in cond) return doc[key] < cond.$lt;
        }
        return doc[key] === cond;
      });
    }
    function makeCollection(docs) {
      return {
        docs,
        find: (filter) => ({ toArray: async () => docs.filter((doc) => matches(doc, filter)) }),
        findOne: async (filter) => docs.find((doc) => matches(doc, filter)) || null,
        updateMany: async (filter, update) => {
          const hit = docs.filter((doc) => matches(doc, filter));
          hit.forEach((doc) => Object.assign(doc, update.$set));
          return { modifiedCount: hit.length };
        },
      };
    }
    function makeDb({ counters, checkpoints, events }) {
      const collections = {
        graph_projection_outbox: makeCollection(events),
        graph_projection_outbox_aggregate_versions: makeCollection(counters),
        graph_projection_checkpoints: makeCollection(checkpoints),
      };
      return { collections, collection: (name) => collections[name] };
    }
    const counter = (aggregateId, version) => ({ _id: `Sample:${aggregateId}`, aggregateType: 'Sample', aggregateId, version });
    const checkpoint = (aggregateId, lastAggregateVersion) => ({ _id: `p:Sample:${aggregateId}`, lastAggregateVersion });
    const event = (eventId, aggregateId, aggregateVersion, status, extra = {}) => ({
      eventId, aggregateType: 'Sample', aggregateId, aggregateVersion, status, attempts: 8, ...extra,
    });

    it('reports a stalled aggregate with its dead letters, and passes one caught up or still queued', async () => {
      const db = makeDb({
        counters: [counter('caught-up', 2), counter('queued', 3), counter('stalled', 3), counter('gap', 2)],
        checkpoints: [checkpoint('caught-up', 2), checkpoint('queued', 2), checkpoint('stalled', 1), checkpoint('gap', 1)],
        events: [
          event('q-3', 'queued', 3, 'RETRYING'),
          event('s-2', 'stalled', 2, 'DEAD_LETTER'),
          event('s-3', 'stalled', 3, 'RETRYING'),
        ],
      });

      const found = await new Neo4jOutboxService().findUnprojectedAggregates(db, 'p');

      expect(found).toEqual([
        { aggregateType: 'Sample', aggregateId: 'stalled', aggregateVersion: 3, checkpointVersion: 1, deadLetterEventIds: ['s-2'] },
        { aggregateType: 'Sample', aggregateId: 'gap', aggregateVersion: 2, checkpointVersion: 1, deadLetterEventIds: [] },
      ]);
    });

    it('requeues dead letters with their attempts reset and releases the events they held', async () => {
      const db = makeDb({
        counters: [],
        checkpoints: [],
        events: [
          event('s-2', 'stalled', 2, 'DEAD_LETTER', { lastError: 'neo4j offline' }),
          event('s-3', 'stalled', 3, 'RETRYING', { lastError: 'awaiting_dead_letter_repair', nextAttemptAt: new Date(Date.now() + 60000) }),
          event('other', 'other', 1, 'DEAD_LETTER'),
        ],
      });

      const requeued = await new Neo4jOutboxService().requeueDeadLetters(db, ['s-2']);

      const [deadLetter, held, other] = db.collections.graph_projection_outbox.docs;
      expect(requeued).toBe(1);
      expect(deadLetter).toMatchObject({ status: 'PENDING', attempts: 0, nextAttemptAt: null, lastError: 'neo4j offline' });
      expect(held.nextAttemptAt).toBeNull();
      expect(other.status).toBe('DEAD_LETTER');
    });

    it('requeues nothing when given no event ids', async () => {
      const db = makeDb({ counters: [], checkpoints: [], events: [] });
      expect(await new Neo4jOutboxService().requeueDeadLetters(db, [])).toBe(0);
    });
  });

  // #1527 (RNF019 C5): the lease counts a try once; a lease timeout does not
  // count it again.
  describe('#1527 lease timeout', () => {
    const valueOf = (doc, key) => doc[key];

    const matches = (doc, query) => Object.entries(query).every(([key, cond]) => {
      if (key === '$or') return cond.some((sub) => matches(doc, sub));
      const value = valueOf(doc, key);
      if (cond === null) return value == null;
      if (cond instanceof Date) return value instanceof Date && value.getTime() === cond.getTime();
      if (cond && typeof cond === 'object') {
        if ('$in' in cond) return cond.$in.includes(value);
        if ('$lt' in cond) return value != null && value < cond.$lt;
        if ('$gte' in cond) return value != null && value >= cond.$gte;
        if ('$lte' in cond) return value != null && value <= cond.$lte;
      }
      return value === cond;
    });

    const makeFakeDb = (doc) => {
      const docs = [doc];
      const collection = {
        updateMany: async (q, u) => {
          let modifiedCount = 0;
          for (const d of docs) {
            if (!matches(d, q)) continue;
            if (u.$set) Object.assign(d, u.$set);
            if (u.$inc) {
              for (const [field, by] of Object.entries(u.$inc)) d[field] = (d[field] || 0) + by;
            }
            modifiedCount += 1;
          }
          return { modifiedCount };
        },
        find: (q) => {
          const found = () => docs.filter((d) => matches(d, q)).map((d) => ({ ...d }));
          const chain = {
            sort: () => chain,
            limit: () => chain,
            toArray: async () => found(),
          };
          return chain;
        },
      };
      return { collection: () => collection };
    };

    const leaseThenExpire = async (doc, db, service) => {
      const leased = await service.leaseNextBatch(db, { batchSize: 5, leaseMs: 1000, maxAttempts: 8 });
      expect(leased).toHaveLength(1);
      expect(doc.attempts).toBe(1);
      expect(doc.status).toBe('PROCESSING');
      doc.updatedAt = new Date(Date.now() - 10 * 1000);
      doc.nextAttemptAt = new Date(Date.now() + 60 * 1000);
    };

    it('a lease timeout found by rescheduleStaleProcessing leaves the one try the lease counted', async () => {
      const doc = { eventId: 'evt-t', status: 'PENDING', attempts: 0, nextAttemptAt: null, updatedAt: new Date() };
      const db = makeFakeDb(doc);
      const service = new Neo4jOutboxService();
      await leaseThenExpire(doc, db, service);

      await service.rescheduleStaleProcessing(db, { leaseMs: 1000 });

      expect(doc.status).toBe('RETRYING');
      expect(doc.attempts).toBe(1);
    });

    it('a lease timeout swept by leaseNextBatch leaves the one try the lease counted', async () => {
      const doc = { eventId: 'evt-t', status: 'PENDING', attempts: 0, nextAttemptAt: null, updatedAt: new Date() };
      const db = makeFakeDb(doc);
      const service = new Neo4jOutboxService();
      await leaseThenExpire(doc, db, service);

      const leased = await service.leaseNextBatch(db, { batchSize: 5, leaseMs: 1000, maxAttempts: 8 });

      expect(leased).toEqual([]);
      expect(doc.status).toBe('RETRYING');
      expect(doc.attempts).toBe(1);
    });

    // #1529 (RNF019 C5): no lease claims an event whose tries are spent, so a
    // timeout on the last allowed try dead-letters it.
    const leaseLastTryThenExpire = async (doc, db, service) => {
      const leased = await service.leaseNextBatch(db, { batchSize: 5, leaseMs: 1000, maxAttempts: 2 });
      expect(leased).toHaveLength(1);
      expect(doc.attempts).toBe(2);
      doc.updatedAt = new Date(Date.now() - 10 * 1000);
    };

    it('#1529 a lease timeout on the last allowed try found by rescheduleStaleProcessing dead-letters the event', async () => {
      const doc = { eventId: 'evt-l', status: 'RETRYING', attempts: 1, nextAttemptAt: null, updatedAt: new Date() };
      const db = makeFakeDb(doc);
      const service = new Neo4jOutboxService();
      await leaseLastTryThenExpire(doc, db, service);

      const moved = await service.rescheduleStaleProcessing(db, { leaseMs: 1000, maxAttempts: 2 });

      expect(moved).toBe(1);
      expect(doc.status).toBe('DEAD_LETTER');
      expect(doc.attempts).toBe(2);
      expect(doc.lastError).toBe('processing_lease_expired');
      expect(doc.leaseUntil).toBeNull();
    });

    it('#1529 a lease timeout on the last allowed try swept by leaseNextBatch dead-letters the event', async () => {
      const doc = { eventId: 'evt-l', status: 'RETRYING', attempts: 1, nextAttemptAt: null, updatedAt: new Date() };
      const db = makeFakeDb(doc);
      const service = new Neo4jOutboxService();
      await leaseLastTryThenExpire(doc, db, service);

      const leased = await service.leaseNextBatch(db, { batchSize: 5, leaseMs: 1000, maxAttempts: 2 });

      expect(leased).toEqual([]);
      expect(doc.status).toBe('DEAD_LETTER');
      expect(doc.attempts).toBe(2);
      expect(doc.lastError).toBe('leased_processing_timeout');
    });

    it('#1529 a sweep dead-letters a RETRYING event already left with its tries spent', async () => {
      const doc = { eventId: 'evt-s', status: 'RETRYING', attempts: 2, nextAttemptAt: null, updatedAt: new Date(), lastError: 'processing_lease_expired' };
      const db = makeFakeDb(doc);

      await new Neo4jOutboxService().rescheduleStaleProcessing(db, { leaseMs: 1000, maxAttempts: 2 });

      expect(doc.status).toBe('DEAD_LETTER');
    });

    it('#1529 a sweep leaves a fresh lease on its last try alone', async () => {
      const doc = { eventId: 'evt-f', status: 'RETRYING', attempts: 1, nextAttemptAt: null, updatedAt: new Date() };
      const db = makeFakeDb(doc);
      const service = new Neo4jOutboxService();
      await service.leaseNextBatch(db, { batchSize: 5, leaseMs: 60 * 1000, maxAttempts: 2 });

      await service.rescheduleStaleProcessing(db, { leaseMs: 60 * 1000, maxAttempts: 2 });

      expect(doc.status).toBe('PROCESSING');
      expect(doc.attempts).toBe(2);
    });
  });

  // #1550: the claim re-checks what the find selected, so two leases that
  // read the same batch never both claim an event, nor claim one another
  // lease has since put into backoff.
  describe('#1550 atomic lease', () => {
    const matches = (doc, query) => Object.entries(query).every(([key, cond]) => {
      if (key === '$or') return cond.some((sub) => matches(doc, sub));
      const value = doc[key];
      if (cond === null) return value == null;
      if (cond instanceof Date) return value instanceof Date && value.getTime() === cond.getTime();
      if (cond && typeof cond === 'object') {
        if ('$in' in cond) return cond.$in.includes(value);
        if ('$lt' in cond) return value != null && value < cond.$lt;
        if ('$gte' in cond) return value != null && value >= cond.$gte;
        if ('$lte' in cond) return value != null && value <= cond.$lte;
      }
      return value === cond;
    });

    const makeFakeDb = (docs, { beforeUpdate } = {}) => {
      const collection = {
        updateMany: async (q, u) => {
          if (beforeUpdate) beforeUpdate(q, u);
          let modifiedCount = 0;
          for (const d of docs) {
            if (!matches(d, q)) continue;
            if (u.$set) Object.assign(d, u.$set);
            if (u.$inc) {
              for (const [field, by] of Object.entries(u.$inc)) d[field] = (d[field] || 0) + by;
            }
            modifiedCount += 1;
          }
          return { modifiedCount };
        },
        find: (q) => {
          const found = () => docs.filter((d) => matches(d, q)).map((d) => ({ ...d }));
          const chain = {
            sort: () => chain,
            limit: () => chain,
            toArray: async () => found(),
          };
          return chain;
        },
      };
      return { collection: () => collection };
    };

    const pending = (eventId) => ({ eventId, status: 'PENDING', attempts: 0, nextAttemptAt: null, updatedAt: new Date() });

    it('two leases that read the same batch claim each event once and count its try once', async () => {
      const docs = [pending('evt-1'), pending('evt-2')];
      const db = makeFakeDb(docs);
      const service = new Neo4jOutboxService();

      const [a, b] = await Promise.all([
        service.leaseNextBatch(db, { batchSize: 5, leaseMs: 60000 }),
        service.leaseNextBatch(db, { batchSize: 5, leaseMs: 60000 }),
      ]);

      const idsA = a.map((event) => event.eventId);
      const idsB = b.map((event) => event.eventId);
      expect(idsA.filter((id) => idsB.includes(id))).toEqual([]);
      expect([...idsA, ...idsB].sort()).toEqual(['evt-1', 'evt-2']);
      expect(docs.map((d) => d.attempts)).toEqual([1, 1]);
    });

    it('a claim skips an event another lease put into backoff after the find', async () => {
      const doc = pending('evt-1');
      let raced = false;
      const db = makeFakeDb([doc], {
        beforeUpdate: (q, u) => {
          if (raced || !u.$set || u.$set.status !== 'PROCESSING' || !('eventId' in q)) return;
          raced = true;
          Object.assign(doc, { status: 'RETRYING', attempts: 1, nextAttemptAt: new Date(Date.now() + 60 * 1000) });
        },
      });

      const leased = await new Neo4jOutboxService().leaseNextBatch(db, { batchSize: 5, leaseMs: 60000 });

      expect(raced).toBe(true);
      expect(leased).toEqual([]);
      expect(doc.attempts).toBe(1);
      expect(doc.status).toBe('RETRYING');
    });
  });
});

// #1323: RNF015 C1 -- an outbox event appended during a request carries its
// id as the P1X-0391 traceId, so the projection worker can tag its write.
describe('Neo4jOutboxService.buildEvent traceId', () => {
  const base = { eventType: 'SPECIMEN_UPSERTED', aggregateType: 'Specimen', aggregateId: 's-1', payload: {} };

  it('#1323 takes the current request id as traceId inside a request', () => {
    const event = runWithRequestId('req-outbox-0001', () => new Neo4jOutboxService().buildEvent(base));
    expect(event.traceId).toBe('req-outbox-0001');
  });

  it('#1323 keeps the own traceId of the caller inside a request', () => {
    const event = runWithRequestId('req-outbox-0001', () =>
      new Neo4jOutboxService().buildEvent({ ...base, traceId: 't-own' })
    );
    expect(event.traceId).toBe('t-own');
  });

  it('#1323 leaves traceId null outside any request', () => {
    expect(new Neo4jOutboxService().buildEvent(base).traceId).toBeNull();
  });
});
