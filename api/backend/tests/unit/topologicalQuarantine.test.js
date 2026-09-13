import { describe, expect, it, vi } from 'vitest';

const TopologicalQuarantine = require('../../src/infrastructure/queue/TopologicalQuarantine');

describe('TopologicalQuarantine - recuperação da fila', () => {
  it('reprocessa com sucesso quando Neo4j volta e remove item da fila', async () => {
    const payload = {
      sampleId: '507f1f77bcf86cd799439011',
      eventType: 'register',
      barcode: 'BR-TEST-0001',
    };

    const queueItem = JSON.stringify({
      payload,
      attempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const redisMock = {
      lpop: vi
        .fn()
        .mockResolvedValueOnce(queueItem)
        .mockResolvedValueOnce(null),
      rpush: vi.fn().mockResolvedValue(1),
    };

    const lineageRepository = {
      validateBeforePersistence: vi.fn().mockResolvedValue(true),
      recordCustodyEvent: vi.fn().mockResolvedValue({ eventId: 'evt-ok' }),
    };

    const quarantine = new TopologicalQuarantine({
      redisClient: redisMock,
      queueKey: 'neo4j_retry_queue_test',
      maxBatchSize: 5,
      maxAttempts: 3,
      getLineageRepository: vi.fn().mockResolvedValue(lineageRepository),
    });

    quarantine.running = true;
    await quarantine.processQueue();

    expect(lineageRepository.validateBeforePersistence).toHaveBeenCalledTimes(1);
    expect(lineageRepository.recordCustodyEvent).toHaveBeenCalledTimes(1);
    expect(redisMock.rpush).not.toHaveBeenCalled();
  });

  it('mantém item em fila com attempts incrementado quando Neo4j segue indisponível', async () => {
    const payload = {
      sampleId: '507f1f77bcf86cd799439012',
      eventType: 'register',
      barcode: 'BR-TEST-0002',
    };

    const queueItem = JSON.stringify({
      payload,
      attempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const redisMock = {
      lpop: vi
        .fn()
        .mockResolvedValueOnce(queueItem)
        .mockResolvedValueOnce(null),
      rpush: vi.fn().mockResolvedValue(1),
    };

    const quarantine = new TopologicalQuarantine({
      redisClient: redisMock,
      queueKey: 'neo4j_retry_queue_test',
      maxBatchSize: 5,
      maxAttempts: 3,
      getLineageRepository: vi.fn().mockResolvedValue(null),
    });

    quarantine.running = true;
    await quarantine.processQueue();

    expect(redisMock.rpush).toHaveBeenCalledTimes(1);

    const [queueKey, serializedItem] = redisMock.rpush.mock.calls[0];
    const requeuedItem = JSON.parse(serializedItem);

    expect(queueKey).toBe('neo4j_retry_queue_test');
    expect(requeuedItem.payload.sampleId).toBe(payload.sampleId);
    expect(requeuedItem.attempts).toBe(1);
  });

  it('descarta item quando atinge maxAttempts sem sucesso no retry', async () => {
    const payload = {
      sampleId: '507f1f77bcf86cd799439013',
      eventType: 'register',
      barcode: 'BR-TEST-0003',
    };

    const queueItem = JSON.stringify({
      payload,
      attempts: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const redisMock = {
      lpop: vi
        .fn()
        .mockResolvedValueOnce(queueItem)
        .mockResolvedValueOnce(null),
      rpush: vi.fn().mockResolvedValue(1),
    };

    const quarantine = new TopologicalQuarantine({
      redisClient: redisMock,
      queueKey: 'neo4j_retry_queue_test',
      maxBatchSize: 5,
      maxAttempts: 3,
      getLineageRepository: vi.fn().mockResolvedValue(null),
    });

    quarantine.running = true;
    await quarantine.processQueue();

    expect(redisMock.rpush).not.toHaveBeenCalled();
  });
});
