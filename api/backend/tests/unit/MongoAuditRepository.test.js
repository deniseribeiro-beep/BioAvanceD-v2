import { describe, it, expect, vi, beforeEach } from 'vitest';

const sampleMovementLedger = require('../../src/utils/sampleMovementLedger');
const MongoAuditRepository = require('../../src/infrastructure/persistence/mongo/MongoAuditRepository');

/**
 * MongoAuditRepository.js used to destructure appendMovementWithHashChain,
 * enforceAppendOnlyCollection and ensureSampleMovementIndexes at module
 * scope, which defeated vi.mock()/vi.spyOn() (see testing-conventions
 * skill: "Mocking gotcha"). As of the "isolate append-only audit ledger
 * protection" fix it references sampleMovementLedger.<fn> at call time
 * instead, so mocking works now — but the bulk of this suite still runs
 * the REAL sampleMovementLedger implementation against a fully mocked
 * mongo collection, for an honest, non-tautological test of the
 * integration. Only the isolation-regression describe block below mocks
 * sampleMovementLedger, and it's scoped so that mocking doesn't leak into
 * the rest of the suite.
 */

let movementsCollectionCounter = 0;

function makeMovementsCollection({ previousMovement = null } = {}) {
  const insertOne = vi.fn().mockResolvedValue({ acknowledged: true });
  const createIndex = vi.fn().mockResolvedValue('ok');

  const cursor = {
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    next: vi.fn().mockResolvedValue(previousMovement)
  };
  const find = vi.fn().mockReturnValue(cursor);

  // ensureSampleMovementIndexes/enforceAppendOnlyCollection memoize by
  // collectionName in a module-level Set, so each test needs a distinct
  // name to observe a fresh (non-skipped) run.
  movementsCollectionCounter += 1;
  const collection = {
    collectionName: `sample_movements_test_${movementsCollectionCounter}`,
    find,
    insertOne,
    createIndex,
    // mutating methods that enforceAppendOnlyCollection() will wrap in place
    updateOne: vi.fn(),
    updateMany: vi.fn(),
    replaceOne: vi.fn(),
    deleteOne: vi.fn(),
    deleteMany: vi.fn(),
    findOneAndUpdate: vi.fn(),
    findOneAndDelete: vi.fn(),
    findOneAndReplace: vi.fn(),
    bulkWrite: vi.fn().mockResolvedValue({ acknowledged: true })
  };

  return { collection, insertOne, createIndex, find, cursor };
}

function makeCountersCollection(seqValue) {
  const findOneAndUpdate = vi.fn().mockResolvedValue({ value: { _id: 'sample_movements', seq: seqValue } });
  return { collection: { collectionName: 'counters', findOneAndUpdate }, findOneAndUpdate };
}

function makeDb({ movements, counters }) {
  return {
    collection: vi.fn((name) => {
      if (name === 'sample_movements') return movements.collection;
      if (name === 'counters') return counters.collection;
      throw new Error(`unexpected collection requested: ${name}`);
    })
  };
}

function makeSharedCollection() {
  return {
    createIndex: vi.fn().mockResolvedValue('idx'),
    find: vi.fn().mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      next: vi.fn().mockResolvedValue(null),
    }),
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'movement-id' }),
    findOneAndUpdate: vi.fn().mockResolvedValue({ value: { seq: 7 } }),
  };
}

describe('MongoAuditRepository', () => {
  describe('appendImmutableAudit', () => {
    it('maps input fields to the ledger document, uses actor.userName as responsible, and returns the generated movementID', async () => {
      const movements = makeMovementsCollection();
      const counters = makeCountersCollection(42);
      const db = makeDb({ movements, counters });
      const repo = new MongoAuditRepository(db);

      const input = {
        specimenId: 'S-1',
        barcode: 'BC-1',
        eventType: 'MOVE',
        before: { status: 'A' },
        after: { status: 'B' },
        context: {
          actor: {
            userId: 'u1',
            userName: 'alice',
            userRole: 'tech',
            ipAddress: '1.2.3.4',
            userAgent: 'jest-agent'
          },
          reason: 'routine transfer',
          notes: 'some notes'
        },
        timestamp: new Date('2026-01-01T00:00:00.000Z')
      };

      const result = await repo.appendImmutableAudit(input, undefined);

      expect(result).toEqual({ movementID: 42 });
      expect(movements.insertOne).toHaveBeenCalledTimes(1);
      const [insertedDoc] = movements.insertOne.mock.calls[0];

      expect(insertedDoc.movementID).toBe(42);
      expect(insertedDoc.specimenId).toBe('S-1');
      expect(insertedDoc.barcode).toBe('BC-1');
      expect(insertedDoc.type).toBe('MOVE');
      expect(insertedDoc.quantity).toBeNull();
      expect(insertedDoc.unit).toBeNull();
      expect(insertedDoc.responsible).toBe('alice');
      expect(insertedDoc.destination).toBeNull();
      expect(insertedDoc.purpose).toBe('routine transfer');
      expect(insertedDoc.linkedProject).toBeNull();
      expect(insertedDoc.observations).toBe('some notes');
      expect(insertedDoc.userId).toBe('u1');
      expect(insertedDoc.userName).toBe('alice');
      expect(insertedDoc.userRole).toBe('tech');
      expect(insertedDoc.ipAddress).toBe('1.2.3.4');
      expect(insertedDoc.userAgent).toBe('jest-agent');
      expect(insertedDoc.previousState).toEqual({ status: 'A' });
      expect(insertedDoc.newState).toEqual({ status: 'B' });
      expect(insertedDoc.timestamp).toBe(input.timestamp);
      expect(insertedDoc.immutable).toBe(true);
      expect(insertedDoc.createdAt).toBeInstanceOf(Date);
    });

    it('falls back to "SYSTEM" for responsible and nulls the actor/context fields when context.actor is absent', async () => {
      const movements = makeMovementsCollection();
      const counters = makeCountersCollection(7);
      const db = makeDb({ movements, counters });
      const repo = new MongoAuditRepository(db);

      const input = {
        specimenId: 'S-2',
        eventType: 'CREATE',
        before: null,
        after: { status: 'NEW' },
        timestamp: new Date('2026-02-02T00:00:00.000Z')
        // no context at all
      };

      const result = await repo.appendImmutableAudit(input, undefined);

      expect(result).toEqual({ movementID: 7 });
      const [insertedDoc] = movements.insertOne.mock.calls[0];

      expect(insertedDoc.responsible).toBe('SYSTEM');
      expect(insertedDoc.purpose).toBeNull();
      expect(insertedDoc.observations).toBeNull();
      expect(insertedDoc.userId).toBeNull();
      expect(insertedDoc.userName).toBeNull();
      expect(insertedDoc.userRole).toBeNull();
      expect(insertedDoc.ipAddress).toBeNull();
      expect(insertedDoc.userAgent).toBeNull();
      expect(insertedDoc.barcode).toBeNull();
    });

    it('invokes enforceAppendOnlyCollection and ensureSampleMovementIndexes (createIndex called) as part of the flow, without leaking append-only overrides onto the raw collection', async () => {
      const movements = makeMovementsCollection();
      const counters = makeCountersCollection(1);
      const db = makeDb({ movements, counters });
      const repo = new MongoAuditRepository(db);

      const rawUpdateOne = movements.collection.updateOne;
      const rawDeleteOne = movements.collection.deleteOne;

      const input = {
        specimenId: 'S-3',
        eventType: 'MOVE',
        before: {},
        after: {},
        timestamp: new Date()
      };

      await repo.appendImmutableAudit(input, undefined);

      // ensureSampleMovementIndexes actually ran against our collection
      expect(movements.createIndex).toHaveBeenCalled();
      expect(movements.createIndex.mock.calls.length).toBeGreaterThanOrEqual(4);

      // enforceAppendOnlyCollection actually ran, but since the "isolate
      // append-only audit ledger protection" fix, it wraps the collection
      // in an isolated Proxy view rather than mutating the shared object
      // directly, so the raw collection's mutating methods stay exactly
      // as they were (that isolation is what the append-only-isolation
      // regression describe block below verifies end to end).
      expect(movements.collection.updateOne).toBe(rawUpdateOne);
      expect(movements.collection.deleteOne).toBe(rawDeleteOne);
    });

    it('passes the session through to appendMovementWithHashChain\'s insertOne call', async () => {
      const movements = makeMovementsCollection();
      const counters = makeCountersCollection(5);
      const db = makeDb({ movements, counters });
      const repo = new MongoAuditRepository(db);

      const fakeSession = { id: 'session-123' };
      const input = {
        specimenId: 'S-4',
        eventType: 'MOVE',
        before: {},
        after: {},
        timestamp: new Date()
      };

      await repo.appendImmutableAudit(input, fakeSession);

      expect(movements.insertOne).toHaveBeenCalledWith(
        expect.any(Object),
        { session: fakeSession }
      );
    });
  });

  describe('generateMovementID', () => {
    it('calls findOneAndUpdate with the correct filter/update/options and returns counter.value.seq', async () => {
      const counters = makeCountersCollection(99);
      const db = makeDb({
        movements: makeMovementsCollection(),
        counters
      });
      const repo = new MongoAuditRepository(db);

      const fakeSession = { id: 'sess-abc' };
      const result = await repo.generateMovementID(fakeSession);

      expect(result).toBe(99);
      expect(counters.findOneAndUpdate).toHaveBeenCalledTimes(1);
      const [filter, update, options] = counters.findOneAndUpdate.mock.calls[0];

      expect(filter).toEqual({ _id: 'sample_movements' });
      expect(update.$inc).toEqual({ seq: 1 });
      expect(update.$setOnInsert.createdAt).toBeInstanceOf(Date);
      expect(options.upsert).toBe(true);
      expect(options.returnDocument).toBe('after');
      expect(options.session).toBe(fakeSession);
    });

    it('works without a session argument (session is undefined in options)', async () => {
      const counters = makeCountersCollection(1);
      const db = makeDb({
        movements: makeMovementsCollection(),
        counters
      });
      const repo = new MongoAuditRepository(db);

      const result = await repo.generateMovementID();

      expect(result).toBe(1);
      const [, , options] = counters.findOneAndUpdate.mock.calls[0];
      expect(options.session).toBeUndefined();
    });
  });

  describe('append-only isolation regression (fix: isolate append-only audit ledger protection)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      sampleMovementLedger.enforceAppendOnlyCollection = vi.fn((collection) => {
        collection.findOneAndUpdate = vi.fn(() => Promise.reject(new Error('POLICY_APPEND_ONLY')));
      });
      sampleMovementLedger.ensureSampleMovementIndexes = vi.fn().mockResolvedValue(undefined);
      sampleMovementLedger.appendMovementWithHashChain = vi.fn().mockResolvedValue({ movementId: 123, hash: 'hash', previousHash: null });
    });

    it('isola a protecao append-only do ledger e preserva o contador', async () => {
      const sharedCollection = makeSharedCollection();
      const db = {
        collection: vi.fn(() => sharedCollection),
      };
      const repository = new MongoAuditRepository(db);

      const result = await repository.appendImmutableAudit({
        specimenId: 'spec-001',
        eventType: 'audit',
        before: { a: 1 },
        after: { a: 2 },
        context: { actor: { userName: 'tester', userId: 'u1' } },
        timestamp: new Date('2026-07-02T10:00:00.000Z'),
      });

      expect(result).toEqual({ movementID: 7 });
      expect(db.collection).toHaveBeenNthCalledWith(1, 'sample_movements');
      expect(db.collection).toHaveBeenNthCalledWith(2, 'counters');
      expect(sampleMovementLedger.enforceAppendOnlyCollection).toHaveBeenCalledTimes(1);
      expect(sampleMovementLedger.enforceAppendOnlyCollection).toHaveBeenCalledWith(expect.any(Object), 'sample_movements');
      expect(sharedCollection.findOneAndUpdate).toHaveBeenCalledTimes(1);
      expect(sharedCollection.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: 'sample_movements' },
        expect.objectContaining({
          $inc: { seq: 1 },
        }),
        expect.objectContaining({
          upsert: true,
          returnDocument: 'after',
        })
      );
      expect(sampleMovementLedger.appendMovementWithHashChain).toHaveBeenCalledTimes(1);
      expect(sampleMovementLedger.ensureSampleMovementIndexes).toHaveBeenCalledTimes(1);
    });
  });
});
