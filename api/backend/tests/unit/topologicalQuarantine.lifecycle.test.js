import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const TopologicalQuarantine = require('../../src/infrastructure/queue/TopologicalQuarantine');

describe('TopologicalQuarantine - enqueue', () => {
  it('ignora payload inválido (sem specimenId/eventType) e retorna false', async () => {
    const redisMock = { rpush: vi.fn() };
    const quarantine = new TopologicalQuarantine({ redisClient: redisMock });

    expect(await quarantine.enqueue(null)).toBe(false);
    expect(await quarantine.enqueue({ specimenId: 'x' })).toBe(false);
    expect(await quarantine.enqueue({ eventType: 'register' })).toBe(false);
    expect(redisMock.rpush).not.toHaveBeenCalled();
  });

  it('enfileira payload válido e incrementa enqueuedTotal', async () => {
    const redisMock = { rpush: vi.fn().mockResolvedValue(1) };
    const quarantine = new TopologicalQuarantine({ redisClient: redisMock, queueKey: 'q1' });

    const ok = await quarantine.enqueue(
      { specimenId: 's1', eventType: 'register' },
      { reason: 'custom_reason', neo4jError: 'boom', attempts: 2 }
    );

    expect(ok).toBe(true);
    expect(quarantine.metrics.enqueuedTotal).toBe(1);
    expect(redisMock.rpush).toHaveBeenCalledTimes(1);
    const [key, serialized] = redisMock.rpush.mock.calls[0];
    expect(key).toBe('q1');
    const item = JSON.parse(serialized);
    expect(item.reason).toBe('custom_reason');
    expect(item.neo4jError).toBe('boom');
    expect(item.attempts).toBe(2);
  });

  it('retorna false quando redis.rpush falha', async () => {
    const redisMock = { rpush: vi.fn().mockRejectedValue(new Error('redis down')) };
    const quarantine = new TopologicalQuarantine({ redisClient: redisMock });

    const ok = await quarantine.enqueue({ specimenId: 's1', eventType: 'register' });

    expect(ok).toBe(false);
  });
});

describe('TopologicalQuarantine - worker lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('startWorker agenda processamento periódico e dispara processQueue imediatamente', async () => {
    const redisMock = { lpop: vi.fn().mockResolvedValue(null) };
    const quarantine = new TopologicalQuarantine({ redisClient: redisMock, retryIntervalMs: 1000 });
    const processSpy = vi.spyOn(quarantine, 'processQueue').mockResolvedValue();

    await quarantine.startWorker();

    expect(quarantine.running).toBe(true);
    expect(processSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(processSpy).toHaveBeenCalledTimes(2);

    quarantine.stopWorker();
  });

  it('startWorker é no-op se já estiver rodando', async () => {
    const redisMock = { lpop: vi.fn().mockResolvedValue(null) };
    const quarantine = new TopologicalQuarantine({ redisClient: redisMock });
    const processSpy = vi.spyOn(quarantine, 'processQueue').mockResolvedValue();

    await quarantine.startWorker();
    const firstTimer = quarantine.timer;
    await quarantine.startWorker();

    expect(quarantine.timer).toBe(firstTimer);
    quarantine.stopWorker();
  });

  it('stopWorker limpa o timer e marca running como false', async () => {
    const redisMock = { lpop: vi.fn().mockResolvedValue(null) };
    const quarantine = new TopologicalQuarantine({ redisClient: redisMock });
    vi.spyOn(quarantine, 'processQueue').mockResolvedValue();

    await quarantine.startWorker();
    quarantine.stopWorker();

    expect(quarantine.running).toBe(false);
    expect(quarantine.timer).toBeNull();
  });
});

describe('TopologicalQuarantine - processQueue guard clauses', () => {
  it('não processa quando running é false', async () => {
    const redisMock = { lpop: vi.fn() };
    const quarantine = new TopologicalQuarantine({ redisClient: redisMock });
    quarantine.running = false;

    await quarantine.processQueue();

    expect(redisMock.lpop).not.toHaveBeenCalled();
  });

  it('não processa quando já está em processamento (reentrância)', async () => {
    const redisMock = { lpop: vi.fn() };
    const quarantine = new TopologicalQuarantine({ redisClient: redisMock });
    quarantine.running = true;
    quarantine.processing = true;

    await quarantine.processQueue();

    expect(redisMock.lpop).not.toHaveBeenCalled();
  });

  it('descarta item corrompido (JSON inválido) e continua o loop', async () => {
    const redisMock = {
      lpop: vi
        .fn()
        .mockResolvedValueOnce('{invalid-json')
        .mockResolvedValueOnce(null),
      rpush: vi.fn(),
    };
    const quarantine = new TopologicalQuarantine({ redisClient: redisMock, maxBatchSize: 5 });
    quarantine.running = true;

    await quarantine.processQueue();

    expect(redisMock.rpush).not.toHaveBeenCalled();
  });

  it('captura erro inesperado durante o loop e libera processing', async () => {
    const redisMock = {
      lpop: vi.fn().mockRejectedValue(new Error('redis unreachable')),
    };
    const quarantine = new TopologicalQuarantine({ redisClient: redisMock });
    quarantine.running = true;

    await expect(quarantine.processQueue()).resolves.toBeUndefined();
    expect(quarantine.processing).toBe(false);
  });
});

describe('TopologicalQuarantine - reprocessItem factory failures', () => {
  it('falha quando getLineageRepository não está configurada', async () => {
    const quarantine = new TopologicalQuarantine({ redisClient: {} });

    const ok = await quarantine.reprocessItem({ payload: { specimenId: 's1', eventType: 'register' } });

    expect(ok).toBe(false);
    expect(quarantine.metrics.replayFailureTotal).toBe(1);
  });

  it('falha quando getLineageRepository resolve para null', async () => {
    const quarantine = new TopologicalQuarantine({
      redisClient: {},
      getLineageRepository: vi.fn().mockResolvedValue(null),
    });

    const ok = await quarantine.reprocessItem({ payload: { specimenId: 's1', eventType: 'register' } });

    expect(ok).toBe(false);
  });

  it('propaga requireEthicalConsent=false quando explicitamente definido no payload', async () => {
    const lineageRepository = {
      validateBeforePersistence: vi.fn().mockResolvedValue(true),
      recordCustodyEvent: vi.fn().mockResolvedValue({}),
    };
    const quarantine = new TopologicalQuarantine({
      redisClient: {},
      getLineageRepository: vi.fn().mockResolvedValue(lineageRepository),
    });

    const ok = await quarantine.reprocessItem({
      payload: { specimenId: 's1', eventType: 'register', requireEthicalConsent: false },
    });

    expect(ok).toBe(true);
    expect(lineageRepository.validateBeforePersistence).toHaveBeenCalledWith(
      expect.objectContaining({ requireEthicalConsent: false })
    );
  });
});

describe('TopologicalQuarantine - getObservabilityMetrics edge cases', () => {
  it('retorna depth null quando redis não implementa llen', async () => {
    const quarantine = new TopologicalQuarantine({ redisClient: {} });

    const metrics = await quarantine.getObservabilityMetrics();

    expect(metrics.queue.depth).toBeNull();
  });

  it('retorna depth null quando llen lança erro', async () => {
    const redisMock = { llen: vi.fn().mockRejectedValue(new Error('boom')) };
    const quarantine = new TopologicalQuarantine({ redisClient: redisMock });

    const metrics = await quarantine.getObservabilityMetrics();

    expect(metrics.queue.depth).toBeNull();
  });
});
