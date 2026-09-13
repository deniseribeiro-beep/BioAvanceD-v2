import { describe, expect, it, vi } from 'vitest';

const TopologicalQuarantine = require('../../src/infrastructure/queue/TopologicalQuarantine');

describe('TopologicalQuarantine - observabilidade', () => {
  it('expõe métricas de fila e tempo médio de replay após sucesso', async () => {
    const payload = {
      sampleId: '507f1f77bcf86cd799439101',
      eventType: 'register',
      barcode: 'BR-OBS-0001',
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
      llen: vi.fn().mockResolvedValue(0),
    };

    const lineageRepository = {
      validateBeforePersistence: vi.fn().mockResolvedValue(true),
      recordCustodyEvent: vi.fn().mockResolvedValue({ eventId: 'evt-ok' }),
    };

    const quarantine = new TopologicalQuarantine({
      redisClient: redisMock,
      queueKey: 'neo4j_retry_queue_obs_test',
      maxBatchSize: 5,
      maxAttempts: 3,
      getLineageRepository: vi.fn().mockResolvedValue(lineageRepository),
    });

    quarantine.running = true;
    await quarantine.processQueue();

    const metrics = await quarantine.getObservabilityMetrics();

    expect(metrics.queue.depth).toBe(0);
    expect(metrics.replay.attemptsTotal).toBe(1);
    expect(metrics.replay.successTotal).toBe(1);
    expect(metrics.replay.averageReplayTimeMs).toBeGreaterThanOrEqual(0);
    expect(metrics.discard.total).toBe(0);
    expect(metrics.discard.ratePercent).toBe(0);
  });

  it('calcula taxa de descarte quando item atinge maxAttempts', async () => {
    const payload = {
      sampleId: '507f1f77bcf86cd799439102',
      eventType: 'register',
      barcode: 'BR-OBS-0002',
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
      llen: vi.fn().mockResolvedValue(0),
    };

    const quarantine = new TopologicalQuarantine({
      redisClient: redisMock,
      queueKey: 'neo4j_retry_queue_obs_test',
      maxBatchSize: 5,
      maxAttempts: 3,
      getLineageRepository: vi.fn().mockResolvedValue(null),
    });

    quarantine.running = true;
    await quarantine.processQueue();

    const metrics = await quarantine.getObservabilityMetrics();

    expect(metrics.replay.attemptsTotal).toBe(1);
    expect(metrics.replay.failureTotal).toBe(1);
    expect(metrics.discard.total).toBe(1);
    expect(metrics.discard.ratePercent).toBe(100);
    expect(redisMock.rpush).not.toHaveBeenCalled();
  });
});
