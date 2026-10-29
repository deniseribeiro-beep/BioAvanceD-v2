import { describe, it, expect, vi, afterEach } from 'vitest';
const crypto = require('crypto');

const mqttIngestionAuditService = require('../../src/services/mqtt-ingestion-audit.service');
const logger = require('../../src/utils/logger');
const { createFakeDb } = require('./foundation/helpers/fake-db');

function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

function makeCollection({ previous = null, insertOneImpl, findDocs = [] } = {}) {
  return {
    createIndex: vi.fn(async () => ({})),
    find: vi.fn(() => ({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      next: vi.fn(async () => previous),
      toArray: vi.fn(async () => findDocs)
    })),
    insertOne: vi.fn(insertOneImpl || (async () => ({ insertedId: 'new-id' })))
  };
}

function makeDb(collection) {
  return {
    collection: vi.fn(() => collection)
  };
}

describe('mqtt-ingestion-audit.service', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('append', () => {
    it('returns null immediately when db is falsy, without throwing', async () => {
      const result = await mqttIngestionAuditService.append(null, { topic: 'x' });
      expect(result).toBeNull();
    });

    it('builds and inserts a document with correct chainHash and null chainPrevHash when there is no previous doc', async () => {
      const collection = makeCollection({ previous: null });
      const db = makeDb(collection);

      const entry = {
        topic: 'sensors/temp',
        payloadHash: 'abc123',
        signatureVerified: true,
        status: 'processed',
        sensorId: 'sensor-1',
        temperatureValue: '21.5',
        timestamp: '2026-07-01T10:00:00.000Z'
      };

      const result = await mqttIngestionAuditService.append(db, entry);

      expect(collection.insertOne).toHaveBeenCalledTimes(1);
      const doc = collection.insertOne.mock.calls[0][0];

      expect(doc.chainPrevHash).toBeNull();
      expect(doc.day).toBe('2026-07-01');
      expect(doc.temperatureValue).toBe(21.5);
      expect(doc.status).toBe('processed');
      expect(doc.source).toBe('mqtt');
      expect(doc.immutable).toBe(true);

      const expectedPayload = JSON.stringify({
        topic: 'sensors/temp',
        payloadHash: 'abc123',
        signatureVerified: true,
        status: 'processed',
        reason: null,
        sensorId: 'sensor-1',
        timestamp: new Date('2026-07-01T10:00:00.000Z').toISOString(),
        previousHash: null
      });
      const expectedHash = sha256Hex(expectedPayload);

      expect(doc.chainHash).toBe(expectedHash);
      expect(result).toEqual({ _id: 'new-id', chainHash: expectedHash, chainPrevHash: null });
    });

    it('uses the previous document chainHash as chainPrevHash when a previous doc exists', async () => {
      const collection = makeCollection({ previous: { chainHash: 'prev-hash-value' } });
      const db = makeDb(collection);

      const entry = {
        topic: 'sensors/temp',
        payloadHash: 'def456',
        sensorId: 'sensor-2',
        timestamp: '2026-07-02T05:30:00.000Z'
      };

      const result = await mqttIngestionAuditService.append(db, entry);

      const doc = collection.insertOne.mock.calls[0][0];
      expect(doc.chainPrevHash).toBe('prev-hash-value');
      expect(result.chainPrevHash).toBe('prev-hash-value');

      const expectedPayload = JSON.stringify({
        topic: 'sensors/temp',
        payloadHash: 'def456',
        signatureVerified: false,
        status: 'processed',
        reason: null,
        sensorId: 'sensor-2',
        timestamp: new Date('2026-07-02T05:30:00.000Z').toISOString(),
        previousHash: 'prev-hash-value'
      });
      expect(doc.chainHash).toBe(sha256Hex(expectedPayload));
    });

    // #841: makeCollection's next() returns its one document whatever sort
    // it gets, so it cannot tell the newest entry from the first one stored.
    // This store sorts, and holds the entries out of order.
    it('chains off the newest entry by timestamp among entries stored out of order', async () => {
      const db = createFakeDb();
      const entries = db.collection('mqtt_ingestion_audit');
      for (const at of ['2026-07-02T05:00:00.000Z', '2026-07-02T05:20:00.000Z', '2026-07-02T04:00:00.000Z']) {
        await entries.insertOne({ timestamp: new Date(at), chainHash: `hash-${at}` });
      }

      const result = await mqttIngestionAuditService.append(db, { topic: 'sensors/temp', timestamp: '2026-07-02T05:30:00.000Z' });

      expect(result.chainPrevHash).toBe('hash-2026-07-02T05:20:00.000Z');
    });

    it('defaults status to "processed" and coerces a non-numeric temperatureValue to null', async () => {
      const collection = makeCollection({ previous: null });
      const db = makeDb(collection);

      const result = await mqttIngestionAuditService.append(db, {
        topic: 'sensors/x',
        temperatureValue: 'not-a-number'
      });

      const doc = collection.insertOne.mock.calls[0][0];
      expect(doc.status).toBe('processed');
      expect(doc.temperatureValue).toBeNull();
      expect(result).not.toBeNull();
    });

    it('swallows a thrown error from insertOne, logs a warning, and returns null instead of rejecting', async () => {
      const collection = makeCollection({
        previous: null,
        insertOneImpl: async () => {
          throw new Error('insert failed');
        }
      });
      const db = makeDb(collection);
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      const result = await mqttIngestionAuditService.append(db, { topic: 'sensors/y' });

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('[ISO20387][MQTT][AUDIT]');
    });
  });

  describe('getHashesForDate', () => {
    it('returns [] when db is falsy', async () => {
      const result = await mqttIngestionAuditService.getHashesForDate(null, '2026-07-01');
      expect(result).toEqual([]);
    });

    it('returns [] when date is falsy', async () => {
      const db = makeDb(makeCollection());
      const result = await mqttIngestionAuditService.getHashesForDate(db, null);
      expect(result).toEqual([]);
    });

    it('returns [] when date fails to parse into a valid Date range', async () => {
      const db = makeDb(makeCollection());
      const result = await mqttIngestionAuditService.getHashesForDate(db, 'not-a-date');
      expect(result).toEqual([]);
    });

    it('returns chainHash values, filtering out docs with a missing/falsy chainHash', async () => {
      const docs = [
        { chainHash: 'hash-1' },
        { chainHash: null },
        { chainHash: 'hash-2' },
        {},
        { chainHash: '' }
      ];
      const collection = makeCollection({ findDocs: docs });
      const db = makeDb(collection);

      const result = await mqttIngestionAuditService.getHashesForDate(db, '2026-07-01');

      expect(result).toEqual(['hash-1', 'hash-2']);
    });

    it('queries with an $or filter on day and timestamp range for the given date', async () => {
      const collection = makeCollection({ findDocs: [] });
      const db = makeDb(collection);

      await mqttIngestionAuditService.getHashesForDate(db, '2026-07-01');

      expect(collection.find).toHaveBeenCalledTimes(1);
      const filter = collection.find.mock.calls[0][0];
      expect(filter.$or[0]).toEqual({ day: '2026-07-01' });
      expect(filter.$or[1].timestamp.$gte.toISOString()).toBe('2026-07-01T00:00:00.000Z');
      expect(filter.$or[1].timestamp.$lte.toISOString()).toBe('2026-07-01T23:59:59.999Z');
    });
  });
});
