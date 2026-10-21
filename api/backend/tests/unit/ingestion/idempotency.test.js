import { describe, it, expect, vi, afterEach } from 'vitest';
const {
  claimIdempotencyKey,
  recordIdempotentResult,
  findCompletedIdempotentResult,
  recordCompletedIdempotentResult,
  ensureIdempotencyKeyIndex,
} = require('../../../src/ingestion/idempotency');
const { createFakeDb, createFakeCollection } = require('./testHelpers');
const logger = require('../../../src/utils/logger');

afterEach(() => { vi.restoreAllMocks(); });

describe('ingestion/idempotency (RF029 AC 5)', () => {
  describe('claimIdempotencyKey', () => {
    it('wins the claim on a fresh key (upsertedCount signals the insert)', async () => {
      const db = createFakeDb({ ingestionIdempotencyKeys: [] });
      const result = await claimIdempotencyKey(db, { idempotencyKey: 'key-1', scope: 'Specimen' });
      expect(result).toEqual({ idempotent: false, existing: null });
      expect(db.collections.ingestionIdempotencyKeys.docs).toHaveLength(1);
      expect(db.collections.ingestionIdempotencyKeys.docs[0]).toMatchObject({
        idempotencyKey: 'key-1',
        scope: 'Specimen',
        status: 'claimed',
      });
    });

    it('reports a replay on an already-claimed key, without inserting a second row', async () => {
      const db = createFakeDb({
        ingestionIdempotencyKeys: [{ idempotencyKey: 'key-1', scope: 'Specimen', status: 'completed', resultRef: 'quarantine-1' }],
      });
      const result = await claimIdempotencyKey(db, { idempotencyKey: 'key-1', scope: 'Specimen' });
      expect(result.idempotent).toBe(true);
      expect(result.existing).toMatchObject({ resultRef: 'quarantine-1' });
      expect(db.collections.ingestionIdempotencyKeys.docs).toHaveLength(1);
    });

    it('scopes keys independently — the same idempotencyKey under a different scope claims fresh', async () => {
      const db = createFakeDb({
        ingestionIdempotencyKeys: [{ idempotencyKey: 'key-1', scope: 'Specimen', status: 'completed', resultRef: null }],
      });
      const result = await claimIdempotencyKey(db, { idempotencyKey: 'key-1', scope: 'Consent' });
      expect(result.idempotent).toBe(false);
    });

    it('requires idempotencyKey and scope', async () => {
      const db = createFakeDb({});
      await expect(claimIdempotencyKey(db, { scope: 'Specimen' })).rejects.toThrow(/idempotencyKey e scope/);
      await expect(claimIdempotencyKey(db, { idempotencyKey: 'key-1' })).rejects.toThrow(/idempotencyKey e scope/);
    });
  });

  describe('recordIdempotentResult', () => {
    it('marks a claimed key completed with its resultRef', async () => {
      const db = createFakeDb({
        ingestionIdempotencyKeys: [{ idempotencyKey: 'key-1', scope: 'Specimen', status: 'claimed', resultRef: null, completedAt: null }],
      });
      await recordIdempotentResult(db, { idempotencyKey: 'key-1', scope: 'Specimen', resultRef: 'quarantine-9' });

      const stored = db.collections.ingestionIdempotencyKeys.docs[0];
      expect(stored.status).toBe('completed');
      expect(stored.resultRef).toBe('quarantine-9');
      expect(stored.completedAt).toBeInstanceOf(Date);
    });

    it('requires idempotencyKey and scope', async () => {
      const db = createFakeDb({});
      await expect(recordIdempotentResult(db, { scope: 'Specimen' })).rejects.toThrow(/idempotencyKey e scope/);
    });
  });

  // RF009 AC7 (#1317): a key recorded only once its result exists, for a
  // caller that must not hold a claim across a write that can fail.
  describe('findCompletedIdempotentResult', () => {
    it('returns null for a missing key, or one only claimed', async () => {
      const db = createFakeDb({
        ingestionIdempotencyKeys: [{ idempotencyKey: 'key-claimed', scope: 'TelemetryReading:s1', status: 'claimed', resultRef: null }],
      });
      await expect(findCompletedIdempotentResult(db, { idempotencyKey: 'key-missing', scope: 'TelemetryReading:s1' })).resolves.toBeNull();
      await expect(findCompletedIdempotentResult(db, { idempotencyKey: 'key-claimed', scope: 'TelemetryReading:s1' })).resolves.toBeNull();
    });

    it('returns the resultRef of a completed key', async () => {
      const db = createFakeDb({
        ingestionIdempotencyKeys: [{ idempotencyKey: 'key-1', scope: 'TelemetryReading:s1', status: 'completed', resultRef: { telemetryReadingId: 'r-1' } }],
      });
      await expect(findCompletedIdempotentResult(db, { idempotencyKey: 'key-1', scope: 'TelemetryReading:s1' })).resolves.toEqual({ telemetryReadingId: 'r-1' });
    });

    it('requires idempotencyKey and scope', async () => {
      const db = createFakeDb({});
      await expect(findCompletedIdempotentResult(db, { scope: 'TelemetryReading:s1' })).rejects.toThrow(/findCompletedIdempotentResult: idempotencyKey e scope/);
      await expect(findCompletedIdempotentResult(db, { idempotencyKey: 'key-1' })).rejects.toThrow(/findCompletedIdempotentResult: idempotencyKey e scope/);
    });
  });

  describe('recordCompletedIdempotentResult', () => {
    it('inserts one completed row, and a second record with another resultRef keeps and returns the first', async () => {
      const db = createFakeDb({ ingestionIdempotencyKeys: [] });
      const first = await recordCompletedIdempotentResult(db, { idempotencyKey: 'key-1', scope: 'TelemetryReading:s1', resultRef: { telemetryReadingId: 'r-1' } });
      const second = await recordCompletedIdempotentResult(db, { idempotencyKey: 'key-1', scope: 'TelemetryReading:s1', resultRef: { telemetryReadingId: 'r-2' } });
      expect(first).toEqual({ telemetryReadingId: 'r-1' });
      expect(second).toEqual({ telemetryReadingId: 'r-1' });

      const { docs } = db.collections.ingestionIdempotencyKeys;
      expect(docs).toHaveLength(1);
      expect(docs[0]).toMatchObject({ idempotencyKey: 'key-1', scope: 'TelemetryReading:s1', status: 'completed', resultRef: { telemetryReadingId: 'r-1' } });
      expect(docs[0].completedAt).toBeInstanceOf(Date);
      await expect(findCompletedIdempotentResult(db, { idempotencyKey: 'key-1', scope: 'TelemetryReading:s1' })).resolves.toEqual({ telemetryReadingId: 'r-1' });
    });

    it('scopes keys independently', async () => {
      const db = createFakeDb({ ingestionIdempotencyKeys: [] });
      await recordCompletedIdempotentResult(db, { idempotencyKey: 'key-1', scope: 'TelemetryReading:s1', resultRef: { telemetryReadingId: 'r-1' } });

      await expect(findCompletedIdempotentResult(db, { idempotencyKey: 'key-1', scope: 'TelemetryReading:s2' })).resolves.toBeNull();
      await recordCompletedIdempotentResult(db, { idempotencyKey: 'key-1', scope: 'TelemetryReading:s2', resultRef: { telemetryReadingId: 'r-2' } });
      expect(db.collections.ingestionIdempotencyKeys.docs).toHaveLength(2);
      await expect(findCompletedIdempotentResult(db, { idempotencyKey: 'key-1', scope: 'TelemetryReading:s2' })).resolves.toEqual({ telemetryReadingId: 'r-2' });
    });

    // #1391: a concurrent upsert of the same key loses on the unique index;
    // it is not an error, and returns the winner's resultRef.
    it('a duplicate-key error from a concurrent upsert returns the stored resultRef', async () => {
      const keys = createFakeCollection([{ idempotencyKey: 'key-1', scope: 'TelemetryReading:s1', status: 'completed', resultRef: { telemetryReadingId: 'r-1' } }]);
      keys.updateOne = vi.fn().mockRejectedValue(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));
      const db = { collection: () => keys };
      await expect(recordCompletedIdempotentResult(db, { idempotencyKey: 'key-1', scope: 'TelemetryReading:s1', resultRef: { telemetryReadingId: 'r-2' } }))
        .resolves.toEqual({ telemetryReadingId: 'r-1' });
    });

    it('control: another write error is rethrown', async () => {
      const keys = createFakeCollection([]);
      keys.updateOne = vi.fn().mockRejectedValue(new Error('connection reset'));
      const db = { collection: () => keys };
      await expect(recordCompletedIdempotentResult(db, { idempotencyKey: 'key-1', scope: 'TelemetryReading:s1', resultRef: null }))
        .rejects.toThrow(/connection reset/);
    });

    it('requires idempotencyKey and scope', async () => {
      const db = createFakeDb({});
      await expect(recordCompletedIdempotentResult(db, { scope: 'TelemetryReading:s1' })).rejects.toThrow(/recordCompletedIdempotentResult: idempotencyKey e scope/);
      await expect(recordCompletedIdempotentResult(db, { idempotencyKey: 'key-1' })).rejects.toThrow(/recordCompletedIdempotentResult: idempotencyKey e scope/);
    });
  });

  // V2E-0554 (#1391): an idempotency key is unique in its ingestion scope.
  describe('ensureIdempotencyKeyIndex', () => {
    function indexedDb(collectionName, createIndex = vi.fn().mockResolvedValue('ok')) {
      const keys = { ...createFakeCollection([]), collectionName, createIndex };
      return { db: { collection: () => keys }, createIndex };
    }

    it('creates the unique (idempotencyKey, scope) index once per collection name', async () => {
      const { db, createIndex } = indexedDb('ingestionIdempotencyKeys_index_case');
      await ensureIdempotencyKeyIndex(db);
      await recordCompletedIdempotentResult(db, { idempotencyKey: 'key-1', scope: 'TelemetryReading:s1', resultRef: null });
      expect(createIndex).toHaveBeenCalledTimes(1);
      expect(createIndex).toHaveBeenCalledWith(
        { idempotencyKey: 1, scope: 1 },
        { unique: true, name: 'ingestion_idempotency_key_scope_unique_v1' },
      );
      const other = indexedDb('ingestionIdempotencyKeys_other_case');
      await ensureIdempotencyKeyIndex(other.db);
      expect(other.createIndex).toHaveBeenCalledTimes(1);
    });

    it('a failing createIndex is logged once and never thrown', async () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const { db, createIndex } = indexedDb('ingestionIdempotencyKeys_failing_case', vi.fn().mockRejectedValue(new Error('not primary')));
      await expect(ensureIdempotencyKeyIndex(db)).resolves.toBeUndefined();
      await expect(recordCompletedIdempotentResult(db, { idempotencyKey: 'key-1', scope: 'TelemetryReading:s1', resultRef: { telemetryReadingId: 'r-1' } }))
        .resolves.toEqual({ telemetryReadingId: 'r-1' });
      expect(createIndex).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });
});
