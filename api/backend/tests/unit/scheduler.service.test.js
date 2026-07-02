import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// This project's services are plain CommonJS files loaded with require(). In this
// vitest setup, vi.mock() only reliably intercepts ESM import()/import specifiers —
// it does NOT intercept require() calls (including the ones scheduler.service.js
// itself makes internally to load node-cron/logger/backup.service/etc). So instead
// of vi.mock(), we require the REAL singleton modules here and use vi.spyOn to stub
// their methods in place. Because Node's CJS module cache is keyed by resolved path,
// both this test file and scheduler.service.js end up sharing the exact same object
// instances, so spying here is visible to the code under test.
const cron = require('node-cron');
const logger = require('../../src/utils/logger');
const env = require('../../src/config/env');
const backupService = require('../../src/services/backup.service');
const consentNeo4jSyncService = require('../../src/services/consentNeo4jSync.service');
const scheduler = require('../../src/services/scheduler.service');

function makeCollection(overrides = {}) {
  return {
    find: vi.fn(),
    findOne: vi.fn(),
    insertOne: vi.fn(),
    updateMany: vi.fn(),
    ...overrides
  };
}

function makeFindChain(result) {
  return {
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    next: vi.fn().mockResolvedValue(result)
  };
}

function makeDb({ sensors = [], lastReadingBySensor = {}, existingAlert = null }) {
  const sensorsCollection = makeCollection({
    find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(sensors) })
  });

  const temperaturesCollection = makeCollection({
    find: vi.fn((query) => {
      const sensorId = query.$or[0].sensorId;
      return makeFindChain(lastReadingBySensor[sensorId] ?? null);
    })
  });

  const alertsCollection = makeCollection({
    findOne: vi.fn().mockResolvedValue(existingAlert),
    insertOne: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({})
  });

  const collections = { sensors: sensorsCollection, temperatures: temperaturesCollection, alerts: alertsCollection };

  return {
    collection: vi.fn((name) => collections[name]),
    __collections: collections
  };
}

describe('scheduler.service - checkStaleTemperatureReadings', () => {
  it('returns zero counts when there are no sensors', async () => {
    const db = makeDb({ sensors: [] });

    const result = await scheduler.checkStaleTemperatureReadings(db);

    expect(result).toEqual({ sensors: 0, alerts: 0 });
    expect(db.__collections.alerts.insertOne).not.toHaveBeenCalled();
  });

  it('creates a missing_reading alert when a sensor has no readings at all', async () => {
    const db = makeDb({
      sensors: [{ sensorId: 'S1' }],
      lastReadingBySensor: {}
    });

    const result = await scheduler.checkStaleTemperatureReadings(db);

    expect(result).toEqual({ sensors: 1, alerts: 1 });
    expect(db.__collections.alerts.insertOne).toHaveBeenCalledTimes(1);
    const inserted = db.__collections.alerts.insertOne.mock.calls[0][0];
    expect(inserted.sensorId).toBe('S1');
    expect(inserted.type).toBe('missing_reading');
    expect(inserted.status).toBe('active');
  });

  it('does not duplicate a missing_reading alert if one is already active', async () => {
    const db = makeDb({
      sensors: [{ sensorId: 'S1' }],
      lastReadingBySensor: {},
      existingAlert: { sensorId: 'S1', type: 'missing_reading', status: 'active' }
    });

    const result = await scheduler.checkStaleTemperatureReadings(db);

    expect(result).toEqual({ sensors: 1, alerts: 0 });
    expect(db.__collections.alerts.insertOne).not.toHaveBeenCalled();
  });

  it('creates a stale_reading alert when the last reading is older than the configured threshold', async () => {
    const originalStaleMinutes = env.TEMP_STALE_MINUTES;
    env.TEMP_STALE_MINUTES = 5;
    try {
      const staleTimestamp = new Date(Date.now() - 25 * 60 * 1000);
      const db = makeDb({
        sensors: [{ sensorId: 'S1' }],
        lastReadingBySensor: { S1: { timestamp: staleTimestamp } }
      });

      const result = await scheduler.checkStaleTemperatureReadings(db);

      expect(result).toEqual({ sensors: 1, alerts: 1 });
      const inserted = db.__collections.alerts.insertOne.mock.calls[0][0];
      expect(inserted.type).toBe('stale_reading');
      expect(inserted.severity).toBe('warning');
      expect(inserted.lastReadingAt).toEqual(staleTimestamp);
      expect(inserted.message).toContain('5 minutos');
    } finally {
      env.TEMP_STALE_MINUTES = originalStaleMinutes;
    }
  });

  it('does not flag a reading as stale when it is within the configured threshold', async () => {
    const originalStaleMinutes = env.TEMP_STALE_MINUTES;
    env.TEMP_STALE_MINUTES = 30;
    try {
      const recentButOlderThanDefault = new Date(Date.now() - 25 * 60 * 1000);
      const db = makeDb({
        sensors: [{ sensorId: 'S1' }],
        lastReadingBySensor: { S1: { timestamp: recentButOlderThanDefault } }
      });

      const result = await scheduler.checkStaleTemperatureReadings(db);

      // 25 minutes old with a 30 minute threshold => not stale, resolves any prior alerts.
      expect(result).toEqual({ sensors: 1, alerts: 0 });
      expect(db.__collections.alerts.insertOne).not.toHaveBeenCalled();
      expect(db.__collections.alerts.updateMany).toHaveBeenCalledTimes(2);
    } finally {
      env.TEMP_STALE_MINUTES = originalStaleMinutes;
    }
  });

  it('resolves active stale/missing alerts when the last reading is fresh', async () => {
    const freshTimestamp = new Date(Date.now() - 1 * 60 * 1000);
    const db = makeDb({
      sensors: [{ sensorId: 'S1' }],
      lastReadingBySensor: { S1: { timestamp: freshTimestamp } }
    });

    const result = await scheduler.checkStaleTemperatureReadings(db);

    expect(result).toEqual({ sensors: 1, alerts: 0 });
    expect(db.__collections.alerts.insertOne).not.toHaveBeenCalled();
    expect(db.__collections.alerts.updateMany).toHaveBeenCalledTimes(2);
    expect(db.__collections.alerts.updateMany).toHaveBeenCalledWith(
      { sensorId: 'S1', type: 'stale_reading', status: 'active' },
      expect.objectContaining({ $set: expect.objectContaining({ status: 'resolved' }) })
    );
    expect(db.__collections.alerts.updateMany).toHaveBeenCalledWith(
      { sensorId: 'S1', type: 'missing_reading', status: 'active' },
      expect.objectContaining({ $set: expect.objectContaining({ status: 'resolved' }) })
    );
  });

  it('skips a sensor that has neither sensorId nor sensorID', async () => {
    const db = makeDb({
      sensors: [{ name: 'no-id-sensor' }],
      lastReadingBySensor: {}
    });

    const result = await scheduler.checkStaleTemperatureReadings(db);

    expect(result).toEqual({ sensors: 1, alerts: 0 });
    expect(db.__collections.alerts.insertOne).not.toHaveBeenCalled();
    expect(db.__collections.alerts.updateMany).not.toHaveBeenCalled();
  });

  it('falls back to sensorID field when sensorId is absent', async () => {
    const db = makeDb({
      sensors: [{ sensorID: 'S2' }],
      lastReadingBySensor: {}
    });

    const result = await scheduler.checkStaleTemperatureReadings(db);

    expect(result).toEqual({ sensors: 1, alerts: 1 });
    const inserted = db.__collections.alerts.insertOne.mock.calls[0][0];
    expect(inserted.sensorId).toBe('S2');
  });

  it('skips a sensor whose last reading has no usable timestamp', async () => {
    const db = makeDb({
      sensors: [{ sensorId: 'S1' }],
      lastReadingBySensor: { S1: { timestamp: 'not-a-date' } }
    });

    const result = await scheduler.checkStaleTemperatureReadings(db);

    expect(result).toEqual({ sensors: 1, alerts: 0 });
    expect(db.__collections.alerts.insertOne).not.toHaveBeenCalled();
    expect(db.__collections.alerts.updateMany).not.toHaveBeenCalled();
  });
});

describe('scheduler.service - initScheduler / stopScheduler', () => {
  let scheduledTasks;
  let cronScheduleSpy;
  let loggerInfoSpy;
  let loggerWarnSpy;
  let loggerErrorSpy;
  let runBackupSpy;
  let consentSyncSpy;

  const originalEnv = {
    TEMP_MONITOR_CRON: env.TEMP_MONITOR_CRON,
    BACKUP_CRON: env.BACKUP_CRON,
    ENABLE_CONSENT_SYNC: env.ENABLE_CONSENT_SYNC,
    CONSENT_SYNC_CRON: env.CONSENT_SYNC_CRON
  };

  beforeEach(() => {
    scheduledTasks = [];
    cronScheduleSpy = vi.spyOn(cron, 'schedule').mockImplementation((expr, fn, opts) => {
      const task = { stop: vi.fn(), expr, fn, opts };
      scheduledTasks.push(task);
      return task;
    });
    loggerInfoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});
    loggerWarnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    loggerErrorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    runBackupSpy = vi.spyOn(backupService, 'runBackup').mockResolvedValue(undefined);
    consentSyncSpy = vi.spyOn(consentNeo4jSyncService, 'sync').mockResolvedValue({ processed: 0, updated: 0 });

    env.TEMP_MONITOR_CRON = undefined;
    env.BACKUP_CRON = undefined;
    env.ENABLE_CONSENT_SYNC = false;
    env.CONSENT_SYNC_CRON = undefined;
  });

  afterEach(() => {
    scheduler.stopScheduler();
    vi.restoreAllMocks();
    env.TEMP_MONITOR_CRON = originalEnv.TEMP_MONITOR_CRON;
    env.BACKUP_CRON = originalEnv.BACKUP_CRON;
    env.ENABLE_CONSENT_SYNC = originalEnv.ENABLE_CONSENT_SYNC;
    env.CONSENT_SYNC_CRON = originalEnv.CONSENT_SYNC_CRON;
  });

  it('schedules the temperature monitor and backup jobs, but not consent sync when disabled', () => {
    env.ENABLE_CONSENT_SYNC = false;

    scheduler.initScheduler({ db: {}, neo4jDriver: {} });

    // temperature monitor + backup only (consent sync disabled)
    expect(cronScheduleSpy).toHaveBeenCalledTimes(2);
    expect(cronScheduleSpy.mock.calls[0][0]).toBe('*/10 * * * *');
    expect(cronScheduleSpy.mock.calls[1][0]).toBe('0 3 * * *');
  });

  it('uses cron expressions from env when provided', () => {
    env.TEMP_MONITOR_CRON = '*/5 * * * *';
    env.BACKUP_CRON = '0 1 * * *';
    env.ENABLE_CONSENT_SYNC = true;
    env.CONSENT_SYNC_CRON = '*/15 * * * *';

    scheduler.initScheduler({ db: {}, neo4jDriver: {} });

    expect(cronScheduleSpy).toHaveBeenCalledTimes(3);
    expect(cronScheduleSpy.mock.calls[0][0]).toBe('*/5 * * * *');
    expect(cronScheduleSpy.mock.calls[1][0]).toBe('0 1 * * *');
    expect(cronScheduleSpy.mock.calls[2][0]).toBe('*/15 * * * *');
  });

  it('stopScheduler stops all previously scheduled tasks', () => {
    env.ENABLE_CONSENT_SYNC = true;

    scheduler.initScheduler({ db: {}, neo4jDriver: {} });
    scheduler.stopScheduler();

    expect(scheduledTasks).toHaveLength(3);
    scheduledTasks.forEach((task) => expect(task.stop).toHaveBeenCalledTimes(1));
  });

  it('temperature monitor task callback does nothing (and does not log success) when db is missing', async () => {
    scheduler.initScheduler({ db: null, neo4jDriver: null });
    const tempTask = scheduledTasks[0];

    await tempTask.fn();

    expect(loggerInfoSpy).not.toHaveBeenCalledWith(expect.stringContaining('Monitoramento de temperatura executado'));
  });

  it('temperature monitor task callback runs the check and logs results when db is present', async () => {
    const db = makeDb({ sensors: [] });

    scheduler.initScheduler({ db, neo4jDriver: null });
    const tempTask = scheduledTasks[0];

    await tempTask.fn();

    expect(loggerInfoSpy).toHaveBeenCalledWith(expect.stringContaining('Monitoramento de temperatura executado'));
  });

  it('temperature monitor task callback logs an error instead of throwing when the check rejects', async () => {
    const db = {
      collection: () => {
        throw new Error('boom');
      }
    };

    scheduler.initScheduler({ db, neo4jDriver: null });
    const tempTask = scheduledTasks[0];

    await expect(tempTask.fn()).resolves.not.toThrow();
    expect(loggerErrorSpy).toHaveBeenCalledWith('Erro no monitoramento de temperatura:', 'boom');
  });

  it('backup task callback calls backupService.runBackup', async () => {
    scheduler.initScheduler({ db: {}, neo4jDriver: null });
    const backupTask = scheduledTasks[1];

    await backupTask.fn();

    expect(runBackupSpy).toHaveBeenCalledTimes(1);
  });

  it('backup task callback logs an error instead of throwing when runBackup rejects', async () => {
    runBackupSpy.mockRejectedValue(new Error('backup failed'));

    scheduler.initScheduler({ db: {}, neo4jDriver: null });
    const backupTask = scheduledTasks[1];

    await expect(backupTask.fn()).resolves.not.toThrow();
    expect(loggerErrorSpy).toHaveBeenCalledWith('Erro ao executar backup agendado:', 'backup failed');
  });

  it('consent sync task callback warns and skips when db or neo4jDriver are missing', async () => {
    env.ENABLE_CONSENT_SYNC = true;

    scheduler.initScheduler({ db: null, neo4jDriver: null });
    const consentTask = scheduledTasks[2];

    await consentTask.fn();

    expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Skip sincronização de consentimento'));
    expect(consentSyncSpy).not.toHaveBeenCalled();
  });

  it('consent sync task callback calls sync and logs results when dependencies are present', async () => {
    env.ENABLE_CONSENT_SYNC = true;
    consentSyncSpy.mockResolvedValue({ processed: 5, updated: 2 });

    const db = {};
    const neo4jDriver = {};
    scheduler.initScheduler({ db, neo4jDriver });
    const consentTask = scheduledTasks[2];

    await consentTask.fn();

    expect(consentSyncSpy).toHaveBeenCalledWith({ db, neo4jDriver });
    expect(loggerInfoSpy).toHaveBeenCalledWith(expect.stringContaining('processadas=5, atualizadas=2'));
  });

  it('consent sync task callback logs an error instead of throwing when sync rejects', async () => {
    env.ENABLE_CONSENT_SYNC = true;
    consentSyncSpy.mockRejectedValue(new Error('sync failed'));

    scheduler.initScheduler({ db: {}, neo4jDriver: {} });
    const consentTask = scheduledTasks[2];

    await expect(consentTask.fn()).resolves.not.toThrow();
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      '[ISO20387][SYNC] Erro no job agendado de sincronização de consentimento:',
      'sync failed'
    );
  });

  it('consent sync scheduling is skipped entirely when ENABLE_CONSENT_SYNC is disabled', () => {
    env.ENABLE_CONSENT_SYNC = false;

    scheduler.initScheduler({ db: {}, neo4jDriver: {} });

    expect(loggerInfoSpy).toHaveBeenCalledWith(expect.stringContaining('Sincronização Mongo→Neo4j de consentimento desativada'));
    expect(scheduledTasks).toHaveLength(2);
  });
});
