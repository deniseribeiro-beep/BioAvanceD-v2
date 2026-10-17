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
const retentionSweepService = require('../../src/services/retentionSweep.service');
const backupPolicyService = require('../../src/services/backup-policy.service');
const influxTelemetryReadRepository = require('../../src/infrastructure/persistence/influxdb/InfluxTelemetryReadRepository');
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

// RF009 AC1 (#1317): the last reading comes from InfluxDB, not from a Mongo
// `temperatures` copy, so `db` fakes only sensors and alerts. Each case's
// `lastReadingBySensor` feeds the repository spy in beforeEach below.
let currentLastReadingBySensor = {};

function makeDb({ sensors = [], lastReadingBySensor = {}, existingAlert = null }) {
  currentLastReadingBySensor = lastReadingBySensor;

  const sensorsCollection = makeCollection({
    find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(sensors) })
  });

  const alertsCollection = makeCollection({
    findOne: vi.fn().mockResolvedValue(existingAlert),
    insertOne: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({})
  });

  const collections = { sensors: sensorsCollection, alerts: alertsCollection };

  return {
    collection: vi.fn((name) => collections[name]),
    __collections: collections
  };
}

describe('scheduler.service - checkStaleTemperatureReadings', () => {
  let lastReadingAtBySensorSpy;

  beforeEach(() => {
    currentLastReadingBySensor = {};
    lastReadingAtBySensorSpy = vi
      .spyOn(influxTelemetryReadRepository, 'lastReadingAtBySensor')
      .mockImplementation(async () => new Map(
        Object.entries(currentLastReadingBySensor).map(([sensorId, reading]) => [sensorId, reading.timestamp])
      ));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  // #1062: an alert with no organizationId can never be org-scoped, and this
  // is the SECOND writer -- the one #1062's body does not name. Its
  // provenance differs from checkPolicyAndAlert's: this loop iterates full
  // sensor documents, so the organization comes from the sensor itself, an
  // admin-created record rather than per-request input.
  it('stamps the sensor organizationId onto both alert types', async () => {
    const db = makeDb({ sensors: [{ sensorId: 'S1', organizationId: 'org-a' }], lastReadingBySensor: {} });

    await scheduler.checkStaleTemperatureReadings(db);

    expect(db.__collections.alerts.insertOne.mock.calls[0][0].organizationId).toBe('org-a');
  });

  it('stamps organizationId null when the sensor carries none (no backfill)', async () => {
    const db = makeDb({ sensors: [{ sensorId: 'S1' }], lastReadingBySensor: {} });

    await scheduler.checkStaleTemperatureReadings(db);

    expect(db.__collections.alerts.insertOne.mock.calls[0][0]).toHaveProperty('organizationId', null);
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

  it('reads no Mongo temperatures collection', async () => {
    const db = makeDb({
      sensors: [{ sensorId: 'S1' }, { sensorID: 'S2' }],
      lastReadingBySensor: { S1: { timestamp: new Date() } }
    });

    await scheduler.checkStaleTemperatureReadings(db);

    expect(db.collection).not.toHaveBeenCalledWith('temperatures');
  });

  it('queries InfluxDB once per run, not per sensor', async () => {
    const db = makeDb({
      sensors: [{ sensorId: 'S1' }, { sensorId: 'S2' }, { sensorId: 'S3' }],
      lastReadingBySensor: { S1: { timestamp: new Date() } }
    });

    await scheduler.checkStaleTemperatureReadings(db);

    expect(lastReadingAtBySensorSpy).toHaveBeenCalledTimes(1);
  });

  // An InfluxDB outage must neither raise missing_reading for every sensor
  // nor resolve open episodes, so the failure propagates before any alert.
  it('an InfluxDB query failure rejects and writes or resolves no alert', async () => {
    lastReadingAtBySensorSpy.mockRejectedValue(new Error('influx down'));
    const db = makeDb({ sensors: [{ sensorId: 'S1' }, { sensorId: 'S2' }] });

    await expect(scheduler.checkStaleTemperatureReadings(db)).rejects.toThrow('influx down');

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
  let runSweepSpy;

  const originalEnv = {
    TEMP_MONITOR_CRON: env.TEMP_MONITOR_CRON,
    BACKUP_CRON: env.BACKUP_CRON,
    RETENTION_SWEEP_CRON: env.RETENTION_SWEEP_CRON,
    RESTORE_TEST_CRON: env.RESTORE_TEST_CRON
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
    runSweepSpy = vi.spyOn(retentionSweepService, 'runSweep').mockResolvedValue({ skipped: true, reason: 'no_active_policy' });

    env.TEMP_MONITOR_CRON = undefined;
    env.BACKUP_CRON = undefined;
    env.RETENTION_SWEEP_CRON = undefined;
    env.RESTORE_TEST_CRON = undefined;
  });

  afterEach(() => {
    scheduler.stopScheduler();
    vi.restoreAllMocks();
    env.TEMP_MONITOR_CRON = originalEnv.TEMP_MONITOR_CRON;
    env.BACKUP_CRON = originalEnv.BACKUP_CRON;
    env.RETENTION_SWEEP_CRON = originalEnv.RETENTION_SWEEP_CRON;
    env.RESTORE_TEST_CRON = originalEnv.RESTORE_TEST_CRON;
  });

  it('schedules the temperature monitor, backup, retention sweep and restore-test jobs; legacy consent sync is a no-op', () => {
    scheduler.initScheduler({ db: {}, neo4jDriver: {} });

    // temperature monitor + backup + retention sweep + restore test (#731);
    // startConsentSyncSchedule is a logged no-op stub.
    expect(cronScheduleSpy).toHaveBeenCalledTimes(4);
    expect(cronScheduleSpy.mock.calls[0][0]).toBe('*/10 * * * *');
    expect(cronScheduleSpy.mock.calls[1][0]).toBe('0 3 * * *');
    expect(cronScheduleSpy.mock.calls[2][0]).toBe('0 4 * * *');
    expect(cronScheduleSpy.mock.calls[3][0]).toBe('0 5 * * 0');
    expect(loggerInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('Sincronização legada de consentimento removida')
    );
  });

  it('uses cron expressions from env when provided', () => {
    env.TEMP_MONITOR_CRON = '*/5 * * * *';
    env.BACKUP_CRON = '0 1 * * *';
    env.RETENTION_SWEEP_CRON = '0 2 * * *';
    env.RESTORE_TEST_CRON = '30 6 * * 1';

    scheduler.initScheduler({ db: {}, neo4jDriver: {} });

    expect(cronScheduleSpy).toHaveBeenCalledTimes(4);
    expect(cronScheduleSpy.mock.calls[0][0]).toBe('*/5 * * * *');
    expect(cronScheduleSpy.mock.calls[1][0]).toBe('0 1 * * *');
    expect(cronScheduleSpy.mock.calls[2][0]).toBe('0 2 * * *');
    expect(cronScheduleSpy.mock.calls[3][0]).toBe('30 6 * * 1');
  });

  it('stopScheduler stops all previously scheduled tasks', () => {
    scheduler.initScheduler({ db: {}, neo4jDriver: {} });
    scheduler.stopScheduler();

    expect(scheduledTasks).toHaveLength(4);
    scheduledTasks.forEach((task) => expect(task.stop).toHaveBeenCalledTimes(1));
  });

  // #731 (RF013 AC#4 / RNF010 AC#5 "Testes de restauração são executados
  // periodicamente e validados por checksum"): #727 built testRestoreBackup
  // but left it admin-triggered only. These cover the schedule itself.
  describe('#731: restore-test schedule', () => {
    it('runs the most recent backup through testRestoreBackup and logs the checksum verdict', async () => {
      const latestSpy = vi
        .spyOn(backupService, 'getLatestBackupPath')
        .mockReturnValue('/backups/2026-08-25');
      const testRestoreSpy = vi
        .spyOn(backupService, 'testRestoreBackup')
        .mockResolvedValue({ success: true, checksumVerified: true, restoredCollections: 12 });

      const db = {};
      scheduler.initScheduler({ db, neo4jDriver: null });
      await scheduledTasks[3].fn();

      expect(latestSpy).toHaveBeenCalledTimes(1);
      expect(testRestoreSpy).toHaveBeenCalledWith('/backups/2026-08-25', db);
      expect(loggerInfoSpy).toHaveBeenCalledWith(expect.stringContaining('Teste de restauração'));
    });

    it('warns and does not call testRestoreBackup when no backup exists yet', async () => {
      vi.spyOn(backupService, 'getLatestBackupPath').mockReturnValue(null);
      const testRestoreSpy = vi.spyOn(backupService, 'testRestoreBackup').mockResolvedValue({});

      scheduler.initScheduler({ db: {}, neo4jDriver: null });
      await scheduledTasks[3].fn();

      expect(testRestoreSpy).not.toHaveBeenCalled();
      expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Nenhum backup'));
    });

    it('does nothing when db is missing', async () => {
      const latestSpy = vi.spyOn(backupService, 'getLatestBackupPath').mockReturnValue('/backups/x');
      const testRestoreSpy = vi.spyOn(backupService, 'testRestoreBackup').mockResolvedValue({});

      scheduler.initScheduler({ db: null, neo4jDriver: null });
      await scheduledTasks[3].fn();

      expect(latestSpy).not.toHaveBeenCalled();
      expect(testRestoreSpy).not.toHaveBeenCalled();
    });

    // A failed restore test is a reliability signal, not a crash: the cron
    // callback must swallow it the same way every sibling schedule does.
    it('logs and swallows an error thrown by testRestoreBackup', async () => {
      vi.spyOn(backupService, 'getLatestBackupPath').mockReturnValue('/backups/x');
      vi.spyOn(backupService, 'testRestoreBackup').mockRejectedValue(new Error('scratch db unreachable'));

      scheduler.initScheduler({ db: {}, neo4jDriver: null });
      await expect(scheduledTasks[3].fn()).resolves.toBeUndefined();

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Erro no teste de restauração'),
        'scratch db unreachable'
      );
    });

    // A restore test that completes but fails checksum verification is the
    // exact condition RNF010 AC#5 exists to detect -- it must not be logged
    // as a routine success.
    it('warns when the restore completed but the checksum did not verify', async () => {
      vi.spyOn(backupService, 'getLatestBackupPath').mockReturnValue('/backups/x');
      vi.spyOn(backupService, 'testRestoreBackup').mockResolvedValue({ success: true, checksumVerified: false });

      scheduler.initScheduler({ db: {}, neo4jDriver: null });
      await scheduledTasks[3].fn();

      expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('checksum'));
    });
  });

  it('retention sweep task callback runs the sweep and logs the result when db is present', async () => {
    scheduler.initScheduler({ db: {}, neo4jDriver: null });
    const sweepTask = scheduledTasks[2];

    await sweepTask.fn();

    expect(runSweepSpy).toHaveBeenCalledTimes(1);
    expect(loggerInfoSpy).toHaveBeenCalledWith(expect.stringContaining('Sweep de retenção executado'));
  });

  it('retention sweep task callback does nothing when db is missing', async () => {
    scheduler.initScheduler({ db: null, neo4jDriver: null });
    const sweepTask = scheduledTasks[2];

    await sweepTask.fn();

    expect(runSweepSpy).not.toHaveBeenCalled();
  });

  it('retention sweep task callback logs an error instead of throwing when the sweep rejects', async () => {
    runSweepSpy.mockRejectedValue(new Error('sweep failed'));

    scheduler.initScheduler({ db: {}, neo4jDriver: null });
    const sweepTask = scheduledTasks[2];

    await expect(sweepTask.fn()).resolves.not.toThrow();
    expect(loggerErrorSpy).toHaveBeenCalledWith('Erro no sweep de retenção:', 'sweep failed');
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

  it('startConsentSyncSchedule is a logged no-op (legacy Mongo→Neo4j consent sync removed)', () => {
    const result = scheduler.startConsentSyncSchedule({ db: {}, neo4jDriver: {} });

    expect(result).toBeNull();
    expect(loggerInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('Sincronização legada de consentimento removida')
    );
    expect(cronScheduleSpy).not.toHaveBeenCalled();
  });

  // #728 (RF013 AC#5/AC#6): the "no restart" half of the design call --
  // an admin's BackupPolicy edit must re-create the running cron task
  // against the new cronExpression without the process restarting.
  describe('reloadBackupSchedule (#728)', () => {
    it('stops the previously running backup task and re-schedules with the policy cronExpression', async () => {
      scheduler.initScheduler({ db: {}, neo4jDriver: null });
      const originalBackupTask = scheduledTasks[1];

      vi.spyOn(backupPolicyService, 'getPolicy').mockResolvedValue({ cronExpression: '0 5 * * *' });

      await scheduler.reloadBackupSchedule({});

      expect(originalBackupTask.stop).toHaveBeenCalledTimes(1);
      expect(cronScheduleSpy).toHaveBeenCalledTimes(5); // 4 from initScheduler + this reload
      expect(cronScheduleSpy.mock.calls[4][0]).toBe('0 5 * * *');
      expect(loggerInfoSpy).toHaveBeenCalledWith(expect.stringContaining('Backup diário reagendado (0 5 * * *)'));
    });

    it('falls back to env.BACKUP_CRON when the policy has no cronExpression', async () => {
      scheduler.initScheduler({ db: {}, neo4jDriver: null });
      vi.spyOn(backupPolicyService, 'getPolicy').mockResolvedValue({});

      await scheduler.reloadBackupSchedule({});

      expect(cronScheduleSpy.mock.calls[4][0]).toBe('0 3 * * *');
    });

    it('falls back to env.BACKUP_CRON and logs an error when the policy lookup rejects', async () => {
      scheduler.initScheduler({ db: {}, neo4jDriver: null });
      vi.spyOn(backupPolicyService, 'getPolicy').mockRejectedValue(new Error('policy lookup failed'));

      await scheduler.reloadBackupSchedule({});

      expect(cronScheduleSpy.mock.calls[4][0]).toBe('0 3 * * *');
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Erro ao recarregar política de backup, mantendo agendamento anterior:',
        'policy lookup failed'
      );
    });
  });
});
