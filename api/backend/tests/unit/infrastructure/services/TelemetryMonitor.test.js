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
  getInfluxQueryApi: vi.fn(() => ({ queryRows: vi.fn(), collectRows: vi.fn().mockResolvedValue([]) })),
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
    getInfluxQueryApiSpy = fakeInfluxConnection.getInfluxQueryApi.mockReturnValue({
      queryRows: vi.fn(),
      collectRows: vi.fn().mockResolvedValue([])
    });
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
    it('logs a warning and returns early without calling findCriticalFreezers when db is falsy', async () => {
      const monitor = new TelemetryMonitor({ db: null });
      monitor.findCriticalFreezers = vi.fn();

      await monitor.runCycle();

      expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Banco Mongo indisponível'));
      expect(monitor.findCriticalFreezers).not.toHaveBeenCalled();
    });

    // #1312: the cycle no longer needs a Neo4j connection; compromise reaches
    // the graph through the outbox.
    it('runs findCriticalFreezers with no Neo4j connection at all', async () => {
      const monitor = new TelemetryMonitor({ db: {} });
      monitor.checkMissingReadings = vi.fn().mockResolvedValue([]);
      monitor.findCriticalFreezers = vi.fn().mockResolvedValue([]);

      await monitor.runCycle();

      expect(monitor.findCriticalFreezers).toHaveBeenCalledTimes(1);
    });

    it('returns early (without calling propagateCompromise) when findCriticalFreezers returns an empty array', async () => {
      const monitor = new TelemetryMonitor({ db: {} });
      monitor.findCriticalFreezers = vi.fn().mockResolvedValue([]);
      monitor.propagateCompromise = vi.fn();

      await monitor.runCycle();

      expect(monitor.findCriticalFreezers).toHaveBeenCalledTimes(1);
      expect(monitor.propagateCompromise).not.toHaveBeenCalled();
    });

    it('calls propagateCompromise once per critical freezer entry with mapped fields, and no temperature', async () => {
      const monitor = new TelemetryMonitor({ db: {} });

      const entries = [
        { rootSampleId: 'sample-1', freezerKey: 'freezer-A', breachedSince: 'ts-1', maxObservedTemp: -50 },
        { rootSampleId: 'sample-2', freezerKey: 'freezer-B', breachedSince: 'ts-2', maxObservedTemp: -40 }
      ];
      monitor.findCriticalFreezers = vi.fn().mockResolvedValue(entries);
      monitor.propagateCompromise = vi.fn().mockResolvedValue(undefined);

      await monitor.runCycle();

      expect(monitor.propagateCompromise).toHaveBeenCalledTimes(2);
      expect(monitor.propagateCompromise).toHaveBeenNthCalledWith(1, {
        rootSampleId: 'sample-1',
        freezerKey: 'freezer-A',
        breachedSince: 'ts-1'
      });
      expect(monitor.propagateCompromise).toHaveBeenNthCalledWith(2, {
        rootSampleId: 'sample-2',
        freezerKey: 'freezer-B',
        breachedSince: 'ts-2'
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
    function rowAt(sensorId, isoTime, value) {
      return { sensorId, _time: isoTime, _value: value };
    }

    it('queries Influx via connectInfluxDB/getInfluxQueryApi/getInfluxConfig and returns [] when no rows breach', async () => {
      const monitor = new TelemetryMonitor({ lookbackHours: 6, criticalTemp: -80 });
      const result = await monitor.findCriticalFreezers();

      expect(connectInfluxDBSpy).toHaveBeenCalledTimes(1);
      expect(getInfluxQueryApiSpy).toHaveBeenCalledTimes(1);
      expect(getInfluxConfigSpy).toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('flags a sensor whose above-threshold streak through to now exceeds criticalDurationHours', async () => {
      vi.useFakeTimers();
      const now = new Date('2026-01-01T06:00:00Z');
      vi.setSystemTime(now);

      const monitor = new TelemetryMonitor({
        criticalTemp: -80,
        criticalDurationHours: 2,
        expectedReadingIntervalMinutes: 15
      });
      // findCriticalFreezers() delegates root-sample resolution to
      // resolveRootSamples(), which has its own dedicated tests below;
      // stub it here so this test only asserts the streak-detection logic.
      monitor.resolveRootSamples = vi.fn().mockResolvedValue(['sample-1']);

      getInfluxQueryApiSpy.mockReturnValue({
        collectRows: vi.fn().mockResolvedValue([
          rowAt('sensor-A', '2026-01-01T03:00:00Z', -70),
          rowAt('sensor-A', '2026-01-01T03:10:00Z', -65),
          rowAt('sensor-A', '2026-01-01T03:20:00Z', -60)
        ])
      });

      const result = await monitor.findCriticalFreezers();

      expect(result).toEqual([
        {
          freezerKey: 'sensor-A',
          rootSampleId: 'sample-1',
          breachedSince: new Date('2026-01-01T03:00:00Z'),
          maxObservedTemp: -60
        }
      ]);
    });

    it('does not flag a sensor whose streak has not yet lasted criticalDurationHours', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T04:00:00Z'));

      const monitor = new TelemetryMonitor({
        criticalTemp: -80,
        criticalDurationHours: 2,
        expectedReadingIntervalMinutes: 15
      });

      getInfluxQueryApiSpy.mockReturnValue({
        collectRows: vi.fn().mockResolvedValue([
          rowAt('sensor-B', '2026-01-01T03:00:00Z', -70),
          rowAt('sensor-B', '2026-01-01T03:10:00Z', -65)
        ])
      });

      const result = await monitor.findCriticalFreezers();

      expect(result).toEqual([]);
    });

    it('treats a gap larger than expectedReadingIntervalMinutes as the streak breaking, restarting breachedSince after the gap', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T06:00:00Z'));

      const monitor = new TelemetryMonitor({
        criticalTemp: -80,
        criticalDurationHours: 2,
        expectedReadingIntervalMinutes: 15
      });

      getInfluxQueryApiSpy.mockReturnValue({
        collectRows: vi.fn().mockResolvedValue([
          // Old streak, well over 15 min before the next row -> gap breaks it.
          rowAt('sensor-C', '2026-01-01T01:00:00Z', -70),
          // Current streak: only ~30 min long, short of the 2h threshold.
          rowAt('sensor-C', '2026-01-01T05:30:00Z', -65),
          rowAt('sensor-C', '2026-01-01T05:45:00Z', -60)
        ])
      });

      const result = await monitor.findCriticalFreezers();

      expect(result).toEqual([]);
    });

    it('ignores rows without a sensorId tag', async () => {
      const monitor = new TelemetryMonitor({ criticalTemp: -80, criticalDurationHours: 2 });

      getInfluxQueryApiSpy.mockReturnValue({
        collectRows: vi.fn().mockResolvedValue([{ _time: '2026-01-01T00:00:00Z', _value: -70 }])
      });

      const result = await monitor.findCriticalFreezers();

      expect(result).toEqual([]);
    });

    // RF009 AC1 (#1317): the temperature route, MQTT and the IoT queue write
    // `freezer_temperature`, POST /api/iot/telemetry writes `temperature`.
    it('queries both reading measurements (RF009 AC1, #1317)', async () => {
      const collectRows = vi.fn().mockResolvedValue([]);
      getInfluxQueryApiSpy.mockReturnValue({ collectRows });
      const monitor = new TelemetryMonitor({ criticalTemp: -80 });

      await monitor.findCriticalFreezers();

      const query = collectRows.mock.calls[0][0];
      expect(query).toContain('r._measurement == "freezer_temperature" and r._field == "temperatureValue"');
      expect(query).toContain('r._measurement == "temperature" and r._field == "value"');
    });

    it('converts each reading to Celsius before the critical threshold filter (RF009 AC1, #1317)', async () => {
      const collectRows = vi.fn().mockResolvedValue([]);
      getInfluxQueryApiSpy.mockReturnValue({ collectRows });
      const monitor = new TelemetryMonitor({ criticalTemp: -80 });

      await monitor.findCriticalFreezers();

      const query = collectRows.mock.calls[0][0];
      expect(query).toContain('r.temperatureUnit == "°F"');
      expect(query).toContain('r.temperatureUnit == "K"');
      expect(query.indexOf('map(')).toBeGreaterThan(-1);
      expect(query.indexOf('map(')).toBeLessThan(query.indexOf('r._value > -80'));
    });

    // #1518 (RNF025 C8): a corrected reading's original is no breach.
    it('keeps the current revision of each reading before the critical threshold filter (#1518, RNF025 C8)', async () => {
      const collectRows = vi.fn().mockResolvedValue([]);
      getInfluxQueryApiSpy.mockReturnValue({ collectRows });
      const monitor = new TelemetryMonitor({ criticalTemp: -80 });

      await monitor.findCriticalFreezers();

      const query = collectRows.mock.calls[0][0];
      const current = query.indexOf('max(column: "_revision")');
      expect(current).toBeGreaterThan(-1);
      expect(current).toBeLessThan(query.indexOf('r._value >'));
    });

    // #688: per-sensor TemperaturePolicy.minimumDuration (minutes) as the
    // excursion threshold, falling back to the global criticalDurationHours
    // (converted to minutes) when the policy is absent/unresolved/unusable.
    describe('per-sensor minimumDuration threshold (#688)', () => {
      function buildPolicyDb({ sensors = [], policies = [] } = {}) {
        const sensorMetadata = { find: vi.fn(() => ({ toArray: async () => sensors })) };
        const temperaturePolicies = { find: vi.fn(() => ({ toArray: async () => policies })) };
        return {
          collection: vi.fn((name) => {
            if (name === 'sensorMetadata') return sensorMetadata;
            if (name === 'temperaturePolicies') return temperaturePolicies;
            throw new Error(`unexpected collection: ${name}`);
          }),
          sensorMetadata,
          temperaturePolicies
        };
      }

      it('uses the bound policy\'s minimumDuration (minutes) as the threshold, flagging a streak the 2h global default would not', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T02:00:00Z'));

        const db = buildPolicyDb({
          sensors: [{ sensorId: 'sensor-P', temperaturePolicy: 'policy-1' }],
          policies: [{ _id: 'policy-1', minimumDuration: 30 }]
        });
        const monitor = new TelemetryMonitor({
          db,
          criticalTemp: -80,
          criticalDurationHours: 2,
          expectedReadingIntervalMinutes: 15
        });
        monitor.resolveRootSamples = vi.fn().mockResolvedValue([]);

        // Streak spans 01:00Z -> 02:00Z (60 min): over the policy's
        // 30-minute threshold, but under the global 2h (120 min) default.
        getInfluxQueryApiSpy.mockReturnValue({
          collectRows: vi.fn().mockResolvedValue([
            rowAt('sensor-P', '2026-01-01T01:00:00Z', -70),
            rowAt('sensor-P', '2026-01-01T01:05:00Z', -65)
          ])
        });

        const result = await monitor.findCriticalFreezers();

        expect(db.sensorMetadata.find).toHaveBeenCalledWith({ sensorId: { $in: ['sensor-P'] } });
        expect(db.temperaturePolicies.find).toHaveBeenCalledWith({ _id: { $in: ['policy-1'] } });
        expect(result).toHaveLength(1);
        expect(result[0].freezerKey).toBe('sensor-P');
      });

      it('falls back to the global default when the bound policy has minimumDuration: null (backward compatibility)', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T02:00:00Z'));

        const db = buildPolicyDb({
          sensors: [{ sensorId: 'sensor-N', temperaturePolicy: 'policy-2' }],
          policies: [{ _id: 'policy-2', minimumDuration: null }]
        });
        const monitor = new TelemetryMonitor({
          db,
          criticalTemp: -80,
          criticalDurationHours: 2,
          expectedReadingIntervalMinutes: 15
        });

        // Same 60-minute streak as above: under the 120-minute global
        // default, so a null minimumDuration must behave exactly as if no
        // policy value existed at all -- not flagged.
        getInfluxQueryApiSpy.mockReturnValue({
          collectRows: vi.fn().mockResolvedValue([
            rowAt('sensor-N', '2026-01-01T01:00:00Z', -70),
            rowAt('sensor-N', '2026-01-01T01:05:00Z', -65)
          ])
        });

        const result = await monitor.findCriticalFreezers();

        expect(result).toEqual([]);
      });

      it('falls back to the global default when the sensor has no bound policy at all', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T05:00:00Z'));

        const db = buildPolicyDb({ sensors: [], policies: [] });
        const monitor = new TelemetryMonitor({
          db,
          criticalTemp: -80,
          criticalDurationHours: 2,
          expectedReadingIntervalMinutes: 15
        });
        monitor.resolveRootSamples = vi.fn().mockResolvedValue([]);

        // Streak spans 150 minutes, over the 120-minute global default.
        getInfluxQueryApiSpy.mockReturnValue({
          collectRows: vi.fn().mockResolvedValue([
            rowAt('sensor-U', '2026-01-01T02:30:00Z', -70),
            rowAt('sensor-U', '2026-01-01T02:35:00Z', -65)
          ])
        });

        const result = await monitor.findCriticalFreezers();

        expect(result).toHaveLength(1);
        expect(result[0].freezerKey).toBe('sensor-U');
      });

      it('converts a 90-minute policy threshold correctly: flags a streak past 90 minutes that the 2h global default would not', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T02:00:00Z'));

        const db = buildPolicyDb({
          sensors: [{ sensorId: 'sensor-B1', temperaturePolicy: 'policy-90' }],
          policies: [{ _id: 'policy-90', minimumDuration: 90 }]
        });
        const monitor = new TelemetryMonitor({
          db,
          criticalTemp: -80,
          criticalDurationHours: 2,
          expectedReadingIntervalMinutes: 15
        });
        monitor.resolveRootSamples = vi.fn().mockResolvedValue([]);

        // Streak spans 95 minutes: past the 90-minute policy threshold,
        // still short of the 120-minute (2h) global default.
        getInfluxQueryApiSpy.mockReturnValue({
          collectRows: vi.fn().mockResolvedValue([
            rowAt('sensor-B1', '2026-01-01T00:25:00Z', -70),
            rowAt('sensor-B1', '2026-01-01T00:30:00Z', -65)
          ])
        });

        const result = await monitor.findCriticalFreezers();

        expect(result).toHaveLength(1);
        expect(result[0].freezerKey).toBe('sensor-B1');
      });

      it('converts a 90-minute policy threshold correctly: does not flag a streak short of 90 minutes, even past a 1h mark', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T02:00:00Z'));

        const db = buildPolicyDb({
          sensors: [{ sensorId: 'sensor-B2', temperaturePolicy: 'policy-90' }],
          policies: [{ _id: 'policy-90', minimumDuration: 90 }]
        });
        const monitor = new TelemetryMonitor({
          db,
          criticalTemp: -80,
          criticalDurationHours: 2,
          expectedReadingIntervalMinutes: 15
        });

        // Streak spans 75 minutes: past the 1h mark, but short of the
        // 90-minute policy threshold.
        getInfluxQueryApiSpy.mockReturnValue({
          collectRows: vi.fn().mockResolvedValue([
            rowAt('sensor-B2', '2026-01-01T00:45:00Z', -70),
            rowAt('sensor-B2', '2026-01-01T00:50:00Z', -65)
          ])
        });

        const result = await monitor.findCriticalFreezers();

        expect(result).toEqual([]);
      });

      // #1392: the temperature datastream valid now is read first.
      function datastreamFor(sensorId, thresholdProfileId) {
        return {
          sensorId,
          observedProperty: 'temperature',
          thresholdProfileId,
          storageLocationId: 'loc-1',
          validityPeriod: { start: new Date('2026-01-01T00:00:00Z'), end: null }
        };
      }

      function withDatastreams(streams) {
        getCollectionSpy.mockImplementation((db, key) => {
          if (key === 'telemetryDatastreams') return { find: vi.fn(() => ({ toArray: async () => streams })) };
          throw new Error(`unexpected getCollection key: ${key}`);
        });
      }

      it('takes minimumDuration from the policy of the datastream over the SensorMetadata policy (#1392)', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T02:00:00Z'));

        withDatastreams([datastreamFor('sensor-D', 'policy-ds')]);
        const db = buildPolicyDb({
          sensors: [{ sensorId: 'sensor-D', temperaturePolicy: 'policy-meta' }],
          policies: [{ _id: 'policy-ds', minimumDuration: 30 }, { _id: 'policy-meta', minimumDuration: 90 }]
        });
        const monitor = new TelemetryMonitor({ db, criticalTemp: -80, criticalDurationHours: 2, expectedReadingIntervalMinutes: 15 });
        monitor.resolveRootSamples = vi.fn().mockResolvedValue([]);

        expect((await monitor.resolveCriticalDurationMinutesBySensor(['sensor-D'])).get('sensor-D')).toBe(30);

        // A 60-minute streak: past the datastream's 30 minutes, short of
        // SensorMetadata's 90.
        getInfluxQueryApiSpy.mockReturnValue({
          collectRows: vi.fn().mockResolvedValue([
            rowAt('sensor-D', '2026-01-01T01:00:00Z', -70),
            rowAt('sensor-D', '2026-01-01T01:05:00Z', -65)
          ])
        });

        const result = await monitor.findCriticalFreezers();

        expect(result).toHaveLength(1);
        expect(result[0].freezerKey).toBe('sensor-D');
      });

      it('falls back to the SensorMetadata policy when the profile of the datastream names no policy (#1392)', async () => {
        withDatastreams([datastreamFor('sensor-F', 'policy-missing')]);
        const db = buildPolicyDb({
          sensors: [{ sensorId: 'sensor-F', temperaturePolicy: 'policy-meta' }],
          policies: [{ _id: 'policy-meta', minimumDuration: 90 }]
        });
        const monitor = new TelemetryMonitor({ db, criticalTemp: -80, criticalDurationHours: 2 });

        const minutes = await monitor.resolveCriticalDurationMinutesBySensor(['sensor-F']);

        expect(minutes.get('sensor-F')).toBe(90);
        expect(db.sensorMetadata.find).toHaveBeenCalledWith({ sensorId: { $in: ['sensor-F'] } });
      });
    });
  });

  // RF009 AC1 (#1317): a reading through either measurement counts as the
  // sensor reporting; last() runs per series, so the newest time wins in JS.
  describe('findSensorsWithMissingReadings()', () => {
    const now = new Date('2026-01-01T06:00:00Z');
    const minutesAgo = (minutes) => new Date(now.getTime() - minutes * 60 * 1000).toISOString();

    function buildDb(docs) {
      return { collection: (name) => ({ find: () => ({ toArray: async () => docs[name] || [] }) }) };
    }

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(now);
    });

    it('queries both reading measurements without grouping them by sensorId', async () => {
      const collectRows = vi.fn().mockResolvedValue([]);
      getInfluxQueryApiSpy.mockReturnValue({ collectRows });
      const monitor = new TelemetryMonitor({ db: buildDb({ sensorMetadata: [{ sensorId: 'S1' }], devices: [] }) });

      await monitor.findSensorsWithMissingReadings();

      const query = collectRows.mock.calls[0][0];
      expect(query).toContain('r._measurement == "freezer_temperature" and r._field == "temperatureValue"');
      expect(query).toContain('r._measurement == "temperature" and r._field == "value"');
      expect(query).not.toContain('group(columns: ["sensorId"])');
    });

    it('does not flag a sensor whose newest last() row comes after an older one', async () => {
      getInfluxQueryApiSpy.mockReturnValue({
        collectRows: vi.fn().mockResolvedValue([
          { sensorId: 'S1', _time: minutesAgo(60) },
          { sensorId: 'S1', _time: minutesAgo(1) }
        ])
      });
      const monitor = new TelemetryMonitor({ db: buildDb({ sensorMetadata: [{ sensorId: 'S1' }], devices: [] }) });

      expect(await monitor.findSensorsWithMissingReadings()).toEqual([]);
    });

    it('does not flag a sensor whose newest last() row comes before an older one (reversed order)', async () => {
      getInfluxQueryApiSpy.mockReturnValue({
        collectRows: vi.fn().mockResolvedValue([
          { sensorId: 'S1', _time: minutesAgo(1) },
          { sensorId: 'S1', _time: minutesAgo(60) }
        ])
      });
      const monitor = new TelemetryMonitor({ db: buildDb({ sensorMetadata: [{ sensorId: 'S1' }], devices: [] }) });

      expect(await monitor.findSensorsWithMissingReadings()).toEqual([]);
    });

    it('matches a numeric sensorId row to the sensorMetadata sensorId string', async () => {
      getInfluxQueryApiSpy.mockReturnValue({
        collectRows: vi.fn().mockResolvedValue([{ sensorId: 7, _time: minutesAgo(1) }])
      });
      const monitor = new TelemetryMonitor({ db: buildDb({ sensorMetadata: [{ sensorId: '7' }], devices: [] }) });

      expect(await monitor.findSensorsWithMissingReadings()).toEqual([]);
    });

    // #1392: the excursion key is the equipmentId of the sensor's temperature
    // datastream valid now, the SensorMetadata device's deviceId the fallback.
    function withDatastreams(streams) {
      getCollectionSpy.mockImplementation((db, key) => {
        if (key === 'telemetryDatastreams') return { find: vi.fn(() => ({ toArray: async () => streams })) };
        throw new Error(`unexpected getCollection key: ${key}`);
      });
    }

    function streamFor(sensorId, equipmentId) {
      return {
        sensorId,
        equipmentId,
        observedProperty: 'temperature',
        validityPeriod: { start: new Date('2026-01-01T00:00:00Z'), end: null }
      };
    }

    it('gives a missing bound sensor the equipmentId of its datastream as the key (#1392)', async () => {
      withDatastreams([streamFor('S1', 'equip-ds')]);
      const monitor = new TelemetryMonitor({
        db: buildDb({ sensorMetadata: [{ sensorId: 'S1', device: 'device-oid-1' }], devices: [{ _id: 'device-oid-1', deviceId: 'device-1' }] })
      });

      expect(await monitor.findSensorsWithMissingReadings()).toEqual([
        { sensorId: 'S1', deviceId: 'device-1', equipmentId: 'equip-ds', lastReadingAt: null }
      ]);
    });

    it('gives a missing unbound sensor the deviceId of its device as the key (#1392)', async () => {
      withDatastreams([]);
      const monitor = new TelemetryMonitor({
        db: buildDb({ sensorMetadata: [{ sensorId: 'S1', device: 'device-oid-1' }], devices: [{ _id: 'device-oid-1', deviceId: 'device-1' }] })
      });

      expect(await monitor.findSensorsWithMissingReadings()).toEqual([
        { sensorId: 'S1', deviceId: 'device-1', equipmentId: 'device-1', lastReadingAt: null }
      ]);
    });

    it('checkMissingReadings opens a bound sensor\'s excursion and skips a sensor with neither key (#1392)', async () => {
      withDatastreams([streamFor('S1', 'equip-ds')]);
      const monitor = new TelemetryMonitor({
        db: buildDb({ sensorMetadata: [{ sensorId: 'S1' }, { sensorId: 'S3' }], devices: [] })
      });
      monitor.upsertMissingReadingExcursion = vi.fn().mockResolvedValue(undefined);

      await monitor.checkMissingReadings();

      expect(monitor.upsertMissingReadingExcursion).toHaveBeenCalledTimes(1);
      expect(monitor.upsertMissingReadingExcursion).toHaveBeenCalledWith(
        { sensorId: 'S1', deviceId: null, equipmentId: 'equip-ds', lastReadingAt: null }
      );
    });
  });

  describe('resolveRootSamples()', () => {
    function fakeCollection(docsByFind) {
      return { find: vi.fn((query) => ({ toArray: async () => docsByFind(query) })) };
    }

    function buildDb({ sensor, freezers = [], shelves = [], racks = [], boxes = [] }) {
      const sensorMetadata = { findOne: vi.fn().mockResolvedValue(sensor) };
      const storageContainers = fakeCollection((query) => {
        if (query.containerType === 'FREEZER') return freezers;
        if (query.containerType === 'SHELF') return shelves;
        if (query.containerType === 'RACK') return racks;
        return [];
      });
      const storageBoxes = fakeCollection(() => boxes);

      return {
        collection: vi.fn((name) => {
          if (name === 'sensorMetadata') return sensorMetadata;
          if (name === 'storageContainers') return storageContainers;
          if (name === 'storageBoxes') return storageBoxes;
          throw new Error(`unexpected collection: ${name}`);
        }),
        sensorMetadata,
        storageContainers,
        storageBoxes
      };
    }

    it('returns [] when no sensorMetadata doc matches the freezerKey (sensorId)', async () => {
      const db = buildDb({ sensor: null });
      const monitor = new TelemetryMonitor({ db });

      const result = await monitor.resolveRootSamples('sensor-unknown');

      expect(db.sensorMetadata.findOne).toHaveBeenCalledWith({ sensorId: 'sensor-unknown' });
      expect(result).toEqual([]);
    });

    it('returns [] when the matched sensor has no storageContainer link', async () => {
      const db = buildDb({ sensor: { sensorId: 'sensor-A', storageContainer: null } });
      const monitor = new TelemetryMonitor({ db });

      const result = await monitor.resolveRootSamples('sensor-A');

      expect(result).toEqual([]);
    });

    it('returns [] when the freezer container has no shelves/racks/boxes under it', async () => {
      const db = buildDb({ sensor: { sensorId: 'sensor-A', storageContainer: 'freezer-1' }, shelves: [] });
      const monitor = new TelemetryMonitor({ db });

      const result = await monitor.resolveRootSamples('sensor-A');

      expect(result).toEqual([]);
    });

    it('walks FREEZER -> SHELF -> RACK -> StorageBox and returns samples whose storageLocation.boxId matches', async () => {
      const db = buildDb({
        sensor: { sensorId: 'sensor-A', storageContainer: 'freezer-1' },
        shelves: [{ _id: 'shelf-1' }],
        racks: [{ _id: 'rack-1' }],
        boxes: [{ _id: 'box-1' }, { _id: 'box-2' }]
      });
      getCollectionSpy.mockReturnValue({
        find: vi.fn(() => ({ toArray: async () => [{ _id: 'sample-1' }, { _id: 'sample-2' }] }))
      });

      const monitor = new TelemetryMonitor({ db });
      const result = await monitor.resolveRootSamples('sensor-A');

      expect(db.storageContainers.find).toHaveBeenCalledWith({ parent_id: 'freezer-1', containerType: 'SHELF' });
      expect(db.storageContainers.find).toHaveBeenCalledWith({ parent_id: { $in: ['shelf-1'] }, containerType: 'RACK' });
      expect(db.storageBoxes.find).toHaveBeenCalledWith({ parent_id: { $in: ['rack-1'] } });
      expect(getCollectionSpy).toHaveBeenCalledWith(db, 'samples');
      expect(result).toEqual(['sample-1', 'sample-2']);
    });

    // #1392: the datastream valid now names a mirrored freezer's location.
    function withChain({ streams = [], locations = [] } = {}) {
      getCollectionSpy.mockImplementation((db, key) => {
        if (key === 'telemetryDatastreams') return { find: vi.fn(() => ({ toArray: async () => streams })) };
        if (key === 'storageLocations') {
          return { findOne: vi.fn(async (query) => locations.find((loc) => loc.storageLocationId === query.storageLocationId) || null) };
        }
        if (key === 'samples') return { find: vi.fn(() => ({ toArray: async () => [{ _id: 'sample-1' }] })) };
        throw new Error(`unexpected getCollection key: ${key}`);
      });
    }

    const streamAt = (storageLocationId) => ({
      sensorId: 'sensor-A',
      observedProperty: 'temperature',
      storageLocationId,
      validityPeriod: { start: new Date(Date.now() - 60 * 60 * 1000), end: null }
    });

    it('walks the freezer that the location of the datastream mirrors, not SensorMetadata.storageContainer (#1392)', async () => {
      withChain({
        streams: [streamAt('loc-ds')],
        locations: [{ storageLocationId: 'loc-ds', code: 'legacy-storage-container:freezer-ds' }]
      });
      const db = buildDb({
        sensor: { sensorId: 'sensor-A', storageContainer: 'freezer-legacy' },
        freezers: [{ _id: 'freezer-ds', containerType: 'FREEZER' }],
        shelves: [{ _id: 'shelf-1' }],
        racks: [{ _id: 'rack-1' }],
        boxes: [{ _id: 'box-1' }]
      });

      const result = await new TelemetryMonitor({ db }).resolveRootSamples('sensor-A');

      expect(db.storageContainers.find).toHaveBeenCalledWith({ parent_id: 'freezer-ds', containerType: 'SHELF' });
      expect(db.storageContainers.find).not.toHaveBeenCalledWith({ parent_id: 'freezer-legacy', containerType: 'SHELF' });
      expect(result).toEqual(['sample-1']);
    });

    it('walks SensorMetadata.storageContainer when the sensor has no datastream (#1392)', async () => {
      withChain({ streams: [] });
      const db = buildDb({
        sensor: { sensorId: 'sensor-A', storageContainer: 'freezer-legacy' },
        shelves: [{ _id: 'shelf-1' }],
        racks: [{ _id: 'rack-1' }],
        boxes: [{ _id: 'box-1' }]
      });

      const result = await new TelemetryMonitor({ db }).resolveRootSamples('sensor-A');

      expect(db.storageContainers.find).toHaveBeenCalledWith({ parent_id: 'freezer-legacy', containerType: 'SHELF' });
      expect(result).toEqual(['sample-1']);
    });
  });

  // #1312: propagation is an outbox append; the projector does the graph
  // write (neo4jCanonicalProjection.service's SPECIMEN_COMPROMISED handler).
  describe('propagateCompromise()', () => {
    function fakeProjection() {
      return { appendSpecimenCompromiseEvent: vi.fn().mockResolvedValue({ eventId: 'evt-1' }) };
    }

    it('logs the expected message shape and returns undefined', async () => {
      const graphProjection = fakeProjection();
      const monitor = new TelemetryMonitor({ db: {}, graphProjection });

      await expect(monitor.propagateCompromise({
        rootSampleId: 'sample-1',
        freezerKey: 'freezer-A',
        breachedSince: '2026-01-01T00:00:00.000Z'
      })).resolves.toBeUndefined();
      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('Propagando comprometimento: freezer=freezer-A, sample=sample-1')
      );
    });

    it('appends SPECIMEN_COMPROMISED for the root sample with the excursion, and no temperature reading', async () => {
      const db = {};
      const graphProjection = fakeProjection();
      const monitor = new TelemetryMonitor({ db, graphProjection });

      await monitor.propagateCompromise({
        rootSampleId: 'sample-1',
        freezerKey: 'freezer-A',
        breachedSince: '2026-01-01T00:00:00.000Z',
        maxObservedTemp: -50
      });

      expect(graphProjection.appendSpecimenCompromiseEvent).toHaveBeenCalledTimes(1);
      const [calledDb, payload] = graphProjection.appendSpecimenCompromiseEvent.mock.calls[0];
      expect(calledDb).toBe(db);
      expect(payload).toEqual({
        specimenId: 'sample-1',
        freezerKey: 'freezer-A',
        breachedSince: '2026-01-01T00:00:00.000Z',
        sourceService: 'telemetry-monitor'
      });
    });

    // #1313 (RF023 AC3): the version counter and the event commit together.
    it('appends inside a transaction on a replica set, and with no session where none runs', async () => {
      const session = {
        withTransaction: vi.fn(async (fn) => fn()),
        endSession: vi.fn().mockResolvedValue(undefined),
      };
      const client = {
        db: () => ({ command: vi.fn().mockResolvedValue({ setName: 'rs0' }) }),
        startSession: vi.fn(() => session),
      };
      const replicaDb = { client };
      const graphProjection = fakeProjection();

      await new TelemetryMonitor({ db: replicaDb, graphProjection })
        .propagateCompromise({ rootSampleId: 'sample-1', freezerKey: 'freezer-A', breachedSince: null });

      expect(session.withTransaction).toHaveBeenCalledTimes(1);
      expect(graphProjection.appendSpecimenCompromiseEvent.mock.calls[0][2]).toEqual({ session });
      expect(session.endSession).toHaveBeenCalledTimes(1);

      const standalone = fakeProjection();
      await new TelemetryMonitor({ db: {}, graphProjection: standalone })
        .propagateCompromise({ rootSampleId: 'sample-1', freezerKey: 'freezer-A', breachedSince: null });
      expect(standalone.appendSpecimenCompromiseEvent.mock.calls[0][2]).toEqual({});
    });

    it('surfaces an append failure', async () => {
      const graphProjection = { appendSpecimenCompromiseEvent: vi.fn().mockRejectedValue(new Error('boom')) };
      const monitor = new TelemetryMonitor({ db: {}, graphProjection });

      await expect(
        monitor.propagateCompromise({ rootSampleId: 'sample-1', freezerKey: 'freezer-A', breachedSince: null })
      ).rejects.toThrow('boom');
    });

    it('appends nothing when rootSampleId is null (no root sample resolved for the freezer)', async () => {
      const graphProjection = fakeProjection();
      const monitor = new TelemetryMonitor({ db: {}, graphProjection });

      await expect(
        monitor.propagateCompromise({ rootSampleId: null, freezerKey: 'freezer-A', breachedSince: null })
      ).resolves.toBeUndefined();

      expect(graphProjection.appendSpecimenCompromiseEvent).not.toHaveBeenCalled();
    });
  });
});
