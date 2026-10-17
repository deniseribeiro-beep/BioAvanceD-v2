import { describe, it, expect } from 'vitest';
const {
  claimIdempotencyKey,
  recordIdempotentResult,
  findCompletedIdempotentResult,
  recordCompletedIdempotentResult,
} = require('../../../src/ingestion/idempotency');
const { createFakeDb } = require('./testHelpers');

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
    it('inserts one completed row, and a second record with another resultRef keeps the first', async () => {
      const db = createFakeDb({ ingestionIdempotencyKeys: [] });
      await recordCompletedIdempotentResult(db, { idempotencyKey: 'key-1', scope: 'TelemetryReading:s1', resultRef: { telemetryReadingId: 'r-1' } });
      await recordCompletedIdempotentResult(db, { idempotencyKey: 'key-1', scope: 'TelemetryReading:s1', resultRef: { telemetryReadingId: 'r-2' } });

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

    it('requires idempotencyKey and scope', async () => {
      const db = createFakeDb({});
      await expect(recordCompletedIdempotentResult(db, { scope: 'TelemetryReading:s1' })).rejects.toThrow(/recordCompletedIdempotentResult: idempotencyKey e scope/);
      await expect(recordCompletedIdempotentResult(db, { idempotencyKey: 'key-1' })).rejects.toThrow(/recordCompletedIdempotentResult: idempotencyKey e scope/);
    });
  });
});
