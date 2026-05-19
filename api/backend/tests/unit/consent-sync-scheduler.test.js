import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('scheduler consent sync', () => {
  let cronSchedule;
  let logger;
  let consentSyncService;

  async function loadScheduler({ enabled = false, cron = '*/5 * * * *' } = {}) {
    process.env.ENABLE_CONSENT_SYNC = enabled ? 'true' : 'false';
    process.env.CONSENT_SYNC_CRON = cron;
    process.env.NODE_ENV = 'test';

    cronSchedule = vi.fn(() => ({ stop: vi.fn() }));
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    };
    consentSyncService = {
      sync: vi.fn().mockResolvedValue({ processed: 3, updated: 2 })
    };

    const schedulerPath = require.resolve('../../src/services/scheduler.service');
    const envPath = require.resolve('../../src/config/env');
    const cronPath = require.resolve('node-cron');
    const loggerPath = require.resolve('../../src/utils/logger');
    const consentSyncPath = require.resolve('../../src/services/consentNeo4jSync.service');

    delete require.cache[schedulerPath];
    delete require.cache[envPath];
    delete require.cache[cronPath];
    delete require.cache[loggerPath];
    delete require.cache[consentSyncPath];

    require.cache[cronPath] = {
      id: cronPath,
      filename: cronPath,
      loaded: true,
      exports: { schedule: cronSchedule }
    };
    require.cache[loggerPath] = {
      id: loggerPath,
      filename: loggerPath,
      loaded: true,
      exports: logger
    };
    require.cache[consentSyncPath] = {
      id: consentSyncPath,
      filename: consentSyncPath,
      loaded: true,
      exports: consentSyncService
    };

    return require('../../src/services/scheduler.service');
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('nao agenda nem chama service quando sync esta desativada', async () => {
    const scheduler = await loadScheduler({ enabled: false });

    scheduler.startConsentSyncSchedule({ db: {}, neo4jDriver: { session: vi.fn() } });

    expect(cronSchedule).not.toHaveBeenCalled();
    expect(consentSyncService.sync).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('ENABLE_CONSENT_SYNC=false'));
  });

  it('agenda com CONSENT_SYNC_CRON e chama service quando sync esta habilitada', async () => {
    const scheduler = await loadScheduler({ enabled: true, cron: '*/7 * * * *' });
    const db = { collection: vi.fn() };
    const neo4jDriver = { session: vi.fn() };

    scheduler.startConsentSyncSchedule({ db, neo4jDriver });
    const job = cronSchedule.mock.calls[0][1];
    await job();

    expect(cronSchedule).toHaveBeenCalledWith('*/7 * * * *', expect.any(Function), expect.any(Object));
    expect(consentSyncService.sync).toHaveBeenCalledWith({ db, neo4jDriver });
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('processadas=3, atualizadas=2'));
  });

  it('dependencia ausente gera warning e nao derruba o job', async () => {
    const scheduler = await loadScheduler({ enabled: true });

    scheduler.startConsentSyncSchedule({ db: null, neo4jDriver: null });
    const job = cronSchedule.mock.calls[0][1];
    await expect(job()).resolves.toBeUndefined();

    expect(consentSyncService.sync).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('dependências indisponíveis'));
  });

  it('falha do Neo4j no job gera erro controlado sem derrubar', async () => {
    const scheduler = await loadScheduler({ enabled: true });
    consentSyncService.sync.mockRejectedValueOnce(new Error('neo4j offline'));

    scheduler.startConsentSyncSchedule({ db: {}, neo4jDriver: { session: vi.fn() } });
    const job = cronSchedule.mock.calls[0][1];
    await expect(job()).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Erro no job agendado'),
      'neo4j offline'
    );
  });
});
