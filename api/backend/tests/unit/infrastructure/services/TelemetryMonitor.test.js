import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Note: vi.mock() factories for these CJS deps do NOT reliably intercept
// TelemetryMonitor.js's own require() calls in this repo's vitest setup
// (confirmed empirically with a minimal repro: cron.schedule/logger.warn/
// getCollection/connectInfluxDB all resolved to the real implementations
// even with a matching vi.mock(path, factory) registered before requiring
// the module under test). TelemetryMonitor.js accesses `cron` and `logger`
// via property access on the required module object (e.g. `logger.warn(...)`,
// `cron.schedule(...)`), never via destructuring at call time, so
// vi.spyOn() on the real, already-loaded module objects works reliably
// for those two.
//
// `getCollection` and `connectInfluxDB`/`getInfluxQueryApi`/`getInfluxConfig`,
// however, ARE destructured by TelemetryMonitor.js at require-time
// (`const { getCollection } = require(...)`, `const { connectInfluxDB, ... } =
// require(...)`), so a post-hoc vi.spyOn() on the module object does not
// intercept those local bindings either (the repo's documented
// destructured-require trap). Since vi.mock() itself is also not
// intercepting nested require() calls in this file, we fall back to
// pre-populating Node's own require.cache for those two modules BEFORE
// TelemetryMonitor.js is first required, so its destructuring picks up
// our fakes directly from the module cache.

const cron = require('node-cron');
const logger = require('../../../../src/utils/logger');

const collectionResolverPath = require.resolve('../../../../src/utils/collectionResolver');
const fakeCollectionResolver = {
  getCollection: vi.fn(),
  resolveCollectionName: vi.fn(),
  resolveSourceCollectionName: vi.fn()
};
require.cache[collectionResolverPath] = {
  id: collectionResolverPath,
  filename: collectionResolverPath,
  loaded: true,
  exports: fakeCollectionResolver
};

const influxConnectionPath = require.resolve('../../../../src/infrastructure/database/influxdb/connection');
const fakeInfluxConnection = {
  connectInfluxDB: vi.fn().mockResolvedValue(undefined),
  getInfluxClient: vi.fn(),
  getInfluxQueryApi: vi.fn(() => ({ queryRows: vi.fn() })),
  getInfluxWriteApi: vi.fn(),
  closeInfluxDBConnection: vi.fn(),
  getInfluxConfig: vi.fn(() => ({ bucket: 'test-bucket' }))
};
require.cache[influxConnectionPath] = {
  id: influxConnectionPath,
  filename: influxConnectionPath,
  loaded: true,
  exports: fakeInfluxConnection
};

const TelemetryMonitor = require('../../../../src/infrastructure/services/TelemetryMonitor');

describe('TelemetryMonitor', () => {
  let cronScheduleSpy;
  let loggerInfoSpy;
  let loggerWarnSpy;
  let loggerErrorSpy;
  let getCollectionSpy;
  let connectInfluxDBSpy;
  let getInfluxQueryApiSpy;
  let getInfluxConfigSpy;

  beforeEach(() => {
    cronScheduleSpy = vi.spyOn(cron, 'schedule').mockImplementation(() => ({ stop: vi.fn() }));
    loggerInfoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});
    loggerWarnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    loggerErrorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    // fakeCollectionResolver/fakeInfluxConnection are plain vi.fn() objects
    // injected via require.cache (see top of file), not vi.spyOn() spies, so
    // vi.restoreAllMocks() in afterEach resets (not restores) them -- we
    // must reapply default implementations here every time.
    getCollectionSpy = fakeCollectionResolver.getCollection;
    connectInfluxDBSpy = fakeInfluxConnection.connectInfluxDB.mockResolvedValue(undefined);
    getInfluxQueryApiSpy = fakeInfluxConnection.getInfluxQueryApi.mockReturnValue({ queryRows: vi.fn() });
    getInfluxConfigSpy = fakeInfluxConnection.getInfluxConfig.mockReturnValue({ bucket: 'test-bucket' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('applies hardcoded defaults when no options or env vars are given', () => {
      delete process.env.TELEMETRY_MONITOR_CRON;
      delete process.env.TELEMETRY_CRITICAL_TEMP;
      delete process.env.TELEMETRY_CRITICAL_DURATION_HOURS;
      delete process.env.TELEMETRY_LOOKBACK_HOURS;
      delete process.env.TELEMETRY_TRIGGER_COOLDOWN_MINUTES;

      const monitor = new TelemetryMonitor({});

      expect(monitor.cronExpression).toBe('*/5 * * * *');
      expect(monitor.criticalTemp).toBe(-80);
      expect(monitor.criticalDurationHours).toBe(2);
      expect(monitor.triggerCooldownMinutes).toBe(30);
    });

    it('derives lookbackHours from criticalDurationHours when not explicitly given (Math.max(3, duration+1))', () => {
      const monitor = new TelemetryMonitor({ criticalDurationHours: 5 });
      expect(monitor.lookbackHours).toBe(6);

      const monitorSmallDuration = new TelemetryMonitor({ criticalDurationHours: 1 });
      // Math.max(3, 1+1) = 3
      expect(monitorSmallDuration.lookbackHours).toBe(3);
    });

    it('lets explicit constructor options override env/defaults', () => {
      process.env.TELEMETRY_MONITOR_CRON = '*/10 * * * *';
      process.env.TELEMETRY_CRITICAL_TEMP = '-60';

      const monitor = new TelemetryMonitor({
        cronExpression: '0 * * * *',
        criticalTemp: -70,
        criticalDurationHours: 4,
        lookbackHours: 99,
        triggerCooldownMinutes: 15
      });

      expect(monitor.cronExpression).toBe('0 * * * *');
      expect(monitor.criticalTemp).toBe(-70);
      expect(monitor.criticalDurationHours).toBe(4);
      expect(monitor.lookbackHours).toBe(99);
      expect(monitor.triggerCooldownMinutes).toBe(15);

      delete process.env.TELEMETRY_MONITOR_CRON;
      delete process.env.TELEMETRY_CRITICAL_TEMP;
    });
  });

  describe('start()', () => {
    it('schedules a cron task with the configured expression', () => {
      const monitor = new TelemetryMonitor({ cronExpression: '*/1 * * * *' });
      monitor.start();

      expect(cronScheduleSpy).toHaveBeenCalledTimes(1);
      expect(cronScheduleSpy).toHaveBeenCalledWith(
        '*/1 * * * *',
        expect.any(Function),
        expect.objectContaining({ timezone: expect.any(String) })
      );
      expect(monitor.task).toBeTruthy();
    });

    it('is idempotent: calling start twice only schedules once', () => {
      const monitor = new TelemetryMonitor({});
      monitor.start();
      monitor.start();

      expect(cronScheduleSpy).toHaveBeenCalledTimes(1);
    });

    it('scheduled callback calls runCycle and swallows/logs errors without throwing', async () => {
      const monitor = new TelemetryMonitor({});
      const runCycleError = new Error('boom');
      monitor.runCycle = vi.fn().mockRejectedValue(runCycleError);

      monitor.start();
      const scheduledCallback = cronScheduleSpy.mock.calls[0][1];

      await expect(scheduledCallback()).resolves.toBeUndefined();
      expect(monitor.runCycle).toHaveBeenCalledTimes(1);
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Erro no ciclo do monitor'),
        'boom'
      );
    });
  });

  describe('stop()', () => {
    it('stops and nulls the task when present', () => {
      const monitor = new TelemetryMonitor({});
      monitor.start();
      const taskStopSpy = monitor.task.stop;

      monitor.stop();

      expect(taskStopSpy).toHaveBeenCalledTimes(1);
      expect(monitor.task).toBeNull();
    });

    it('is a no-op when no task exists (does not throw)', () => {
      const monitor = new TelemetryMonitor({});
      expect(monitor.task).toBeNull();
      expect(() => monitor.stop()).not.toThrow();
      expect(monitor.task).toBeNull();
    });
  });

  describe('runCycle()', () => {
    it('logs a warning and returns early without calling getNeo4jDriver when db is falsy', async () => {
      const getNeo4jDriver = vi.fn();
      const monitor = new TelemetryMonitor({ db: null, getNeo4jDriver });

      await monitor.runCycle();

      expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Banco Mongo indisponível'));
      expect(getNeo4jDriver).not.toHaveBeenCalled();
    });

    it('logs a warning and returns early without calling findCriticalFreezers when neo4j driver is falsy', async () => {
      const getNeo4jDriver = vi.fn().mockResolvedValue(null);
      const monitor = new TelemetryMonitor({ db: {}, getNeo4jDriver });
      monitor.findCriticalFreezers = vi.fn();

      await monitor.runCycle();

      expect(getNeo4jDriver).toHaveBeenCalledTimes(1);
      expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Neo4j indisponível'));
      expect(monitor.findCriticalFreezers).not.toHaveBeenCalled();
    });

    it('returns early (without calling propagateCompromise) when findCriticalFreezers returns an empty array', async () => {
      const neo4jDriver = { session: vi.fn() };
      const getNeo4jDriver = vi.fn().mockResolvedValue(neo4jDriver);
      const monitor = new TelemetryMonitor({ db: {}, getNeo4jDriver });
      monitor.findCriticalFreezers = vi.fn().mockResolvedValue([]);
      monitor.propagateCompromise = vi.fn();

      await monitor.runCycle();

      expect(monitor.findCriticalFreezers).toHaveBeenCalledTimes(1);
      expect(monitor.propagateCompromise).not.toHaveBeenCalled();
    });

    it('calls propagateCompromise once per critical freezer entry with mapped fields', async () => {
      const neo4jDriver = { session: vi.fn() };
      const getNeo4jDriver = vi.fn().mockResolvedValue(neo4jDriver);
      const monitor = new TelemetryMonitor({ db: {}, getNeo4jDriver });

      const entries = [
        { rootSampleId: 'sample-1', freezerKey: 'freezer-A', breachedSince: 'ts-1', maxObservedTemp: -50 },
        { rootSampleId: 'sample-2', freezerKey: 'freezer-B', breachedSince: 'ts-2', maxObservedTemp: -40 }
      ];
      monitor.findCriticalFreezers = vi.fn().mockResolvedValue(entries);
      monitor.propagateCompromise = vi.fn().mockResolvedValue(undefined);

      await monitor.runCycle();

      expect(monitor.propagateCompromise).toHaveBeenCalledTimes(2);
      expect(monitor.propagateCompromise).toHaveBeenNthCalledWith(1, {
        neo4jDriver,
        rootSampleId: 'sample-1',
        freezerKey: 'freezer-A',
        breachedSince: 'ts-1',
        maxObservedTemp: -50
      });
      expect(monitor.propagateCompromise).toHaveBeenNthCalledWith(2, {
        neo4jDriver,
        rootSampleId: 'sample-2',
        freezerKey: 'freezer-B',
        breachedSince: 'ts-2',
        maxObservedTemp: -40
      });
    });
  });

  describe('shouldTrigger()', () => {
    it('returns true on first call for a key and records the timestamp', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

      const monitor = new TelemetryMonitor({ triggerCooldownMinutes: 30 });
      expect(monitor.shouldTrigger('freezer-A')).toBe(true);
      expect(monitor.lastTriggeredAt.get('freezer-A')).toBe(Date.now());
    });

    it('returns false on a second call within the cooldown window', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

      const monitor = new TelemetryMonitor({ triggerCooldownMinutes: 30 });
      expect(monitor.shouldTrigger('freezer-A')).toBe(true);

      vi.setSystemTime(new Date('2026-01-01T00:10:00Z')); // 10 min later, within 30-min cooldown
      expect(monitor.shouldTrigger('freezer-A')).toBe(false);
    });

    it('returns true again once the cooldown window has fully elapsed', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

      const monitor = new TelemetryMonitor({ triggerCooldownMinutes: 30 });
      expect(monitor.shouldTrigger('freezer-A')).toBe(true);

      vi.setSystemTime(new Date('2026-01-01T00:31:00Z')); // 31 min later, past 30-min cooldown
      expect(monitor.shouldTrigger('freezer-A')).toBe(true);
    });
  });

  describe('findCriticalFreezers()', () => {
    it('queries Influx via connectInfluxDB/getInfluxQueryApi/getInfluxConfig and currently always returns [] (stub)', async () => {
      const monitor = new TelemetryMonitor({ lookbackHours: 6, criticalTemp: -80 });
      const result = await monitor.findCriticalFreezers();

      expect(connectInfluxDBSpy).toHaveBeenCalledTimes(1);
      expect(getInfluxQueryApiSpy).toHaveBeenCalledTimes(1);
      expect(getInfluxConfigSpy).toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });

  describe('resolveRootSamples()', () => {
    it('queries the samples collection with freezerKey/isRoot filter and maps to _id', async () => {
      const toArray = vi.fn().mockResolvedValue([{ _id: 'id-1' }, { _id: 'id-2' }]);
      const find = vi.fn(() => ({ toArray }));
      getCollectionSpy.mockReturnValue({ find });

      const db = { name: 'fake-db' };
      const monitor = new TelemetryMonitor({ db });

      const result = await monitor.resolveRootSamples('freezer-X');

      expect(getCollectionSpy).toHaveBeenCalledWith(db, 'samples');
      expect(find).toHaveBeenCalledWith({ freezerKey: 'freezer-X', isRoot: true });
      expect(result).toEqual(['id-1', 'id-2']);
    });
  });

  describe('propagateCompromise()', () => {
    it('does not throw and logs the expected message shape (stub implementation)', async () => {
      const monitor = new TelemetryMonitor({});
      const args = {
        neo4jDriver: { session: vi.fn() },
        rootSampleId: 'sample-1',
        freezerKey: 'freezer-A',
        breachedSince: 'ts-1',
        maxObservedTemp: -50
      };

      await expect(monitor.propagateCompromise(args)).resolves.toBeUndefined();
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('Propagando comprometimento: freezer=freezer-A, sample=sample-1')
      );
    });
  });
});
