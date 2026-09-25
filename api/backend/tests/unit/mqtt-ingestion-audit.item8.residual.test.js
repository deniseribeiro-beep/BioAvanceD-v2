import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const service = require('../../src/services/mqtt-ingestion-audit.service');
const logger = require('../../src/utils/logger');

function makeCollection({ previous = null, insertOne } = {}) {
  return {
    createIndex: vi.fn().mockResolvedValue('ok'),
    find: vi.fn(() => ({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      next: vi.fn().mockResolvedValue(previous),
      toArray: vi.fn().mockResolvedValue([]),
    })),
    insertOne: insertOne || vi.fn().mockResolvedValue({ insertedId: 'mqtt-audit-1' }),
  };
}

function makeDb(collection) {
  return { collection: vi.fn(() => collection) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mqtt-ingestion-audit.service item 8 residual branches', () => {
  it('ensureIndexes attempts every index and absorbs individual index failures', async () => {
    const collection = makeCollection();
    collection.createIndex
      .mockRejectedValueOnce(new Error('day index failed'))
      .mockResolvedValueOnce('payload')
      .mockRejectedValueOnce(new Error('chain index failed'));

    await expect(service.ensureIndexes(makeDb(collection))).resolves.toBeUndefined();

    expect(collection.createIndex).toHaveBeenCalledTimes(3);
  });

  it('persists explicit timestamp/status, numeric temperature and readingTimestamp without losing chain metadata', async () => {
    const previous = { chainHash: 'previous-mqtt-chain' };
    const collection = makeCollection({ previous });
    const db = makeDb(collection);
    const timestamp = '2026-09-19T20:00:00.000Z';
    const readingTimestamp = '2026-09-19T19:59:30.000Z';

    const result = await service.append(db, {
      topic: 'bioavanced/sensor/S-1',
      payloadHash: 'payload-hash',
      payloadSignature: 'signature',
      signatureVerified: true,
      signatureRequired: true,
      status: 'rejected',
      reason: 'synthetic-policy',
      sensorId: 'S-1',
      temperatureValue: '7.5',
      readingTimestamp,
      timestamp,
    });

    expect(result).toEqual(expect.objectContaining({
      _id: 'mqtt-audit-1',
      chainPrevHash: 'previous-mqtt-chain',
      chainHash: expect.any(String),
    }));

    const inserted = collection.insertOne.mock.calls[0][0];
    expect(inserted).toEqual(expect.objectContaining({
      topic: 'bioavanced/sensor/S-1',
      payloadHash: 'payload-hash',
      payloadSignature: 'signature',
      signatureVerified: true,
      signatureRequired: true,
      status: 'rejected',
      reason: 'synthetic-policy',
      sensorId: 'S-1',
      temperatureValue: 7.5,
      readingTimestamp: new Date(readingTimestamp),
      timestamp: new Date(timestamp),
      day: '2026-09-19',
      chainPrevHash: 'previous-mqtt-chain',
      immutable: true,
    }));
  });

  it('swallows primitive persistence failures and logs the primitive reason', async () => {
    const collection = makeCollection({
      insertOne: vi.fn().mockRejectedValue('primitive mqtt persistence failure'),
    });
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    const result = await service.append(makeDb(collection), {
      topic: 'synthetic/topic',
      payloadHash: 'hash',
    });

    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      '[ISO20387][MQTT][AUDIT] Falha ao registrar trilha de ingestão:',
      'primitive mqtt persistence failure'
    );
  });

  it('persists null chain/document fields when topic/status/timestamp inputs are omitted', async () => {
    const collection = makeCollection();
    const before = Date.now();

    const result = await service.append(makeDb(collection), {
      payloadHash: 'only-hash',
    });

    expect(result).toEqual(expect.objectContaining({
      _id: 'mqtt-audit-1',
      chainHash: expect.any(String),
    }));

    const inserted = collection.insertOne.mock.calls[0][0];
    expect(inserted.topic).toBeNull();
    expect(inserted.payloadHash).toBe('only-hash');
    expect(inserted.status).toBe('processed');
    expect(inserted.timestamp.getTime()).toBeGreaterThanOrEqual(before);
    expect(inserted.reason).toBeNull();
    expect(inserted.sensorId).toBeNull();
    expect(inserted.temperatureValue).toBeNull();
    expect(inserted.readingTimestamp).toBeNull();
  });
});
