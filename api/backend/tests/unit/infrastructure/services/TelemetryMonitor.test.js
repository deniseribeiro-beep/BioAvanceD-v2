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
    it('logs a warning and returns early when db is unavailable', async () => {
      const monitor = new TelemetryMonitor({ db: null });
      await expect(monitor.runCycle()).resolves.toEqual({ processed: 0 });
      expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Banco Mongo indisponível'));
    });

    it('does not propagate when no critical freezer is found', async () => {
      const monitor = new TelemetryMonitor({ db: {} });
      monitor.checkMissingReadings = vi.fn().mockResolvedValue([]);
      monitor.findCriticalFreezers = vi.fn().mockResolvedValue([]);
      monitor.propagateCompromise = vi.fn();
      await expect(monitor.runCycle()).resolves.toEqual({ processed: 0, criticalFreezers: 0 });
      expect(monitor.propagateCompromise).not.toHaveBeenCalled();
    });

    it('propagates each canonical root specimen from a critical freezer', async () => {
      const monitor = new TelemetryMonitor({ db: {} });
      monitor.checkMissingReadings = vi.fn().mockResolvedValue([]);
      monitor.findCriticalFreezers = vi.fn().mockResolvedValue([{ freezerKey: 'sensor-A', rootSampleIds: ['SPEC-1', 'SPEC-2'], breachedSince: new Date('2026-01-01T00:00:00Z'), maxObservedTemp: -50 }]);
      monitor.propagateCompromise = vi.fn().mockResolvedValue({ summarized: 1 });
      const result = await monitor.runCycle();
      expect(result).toEqual({ processed: 2, criticalFreezers: 1 });
      expect(monitor.propagateCompromise).toHaveBeenCalledTimes(2);
      expect(monitor.propagateCompromise).toHaveBeenNthCalledWith(1, expect.objectContaining({ freezerKey: 'sensor-A', rootSampleId: 'SPEC-1' }));
      expect(monitor.propagateCompromise).toHaveBeenNthCalledWith(2, expect.objectContaining({ freezerKey: 'sensor-A', rootSampleId: 'SPEC-2' }));
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

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(expect.objectContaining({
        freezerKey: 'sensor-A',
        rootSampleId: 'sample-1',
        rootSampleIds: ['sample-1'],
        breachedSince: new Date('2026-01-01T03:00:00Z'),
        maxObservedTemp: -60,
        observationCount: 3,
        sourceQueryHash: expect.stringMatching(/^sha256:/),
        sourceReadingSetHash: expect.stringMatching(/^sha256:/)
      }));
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
    });
  });

  describe('resolveRootSamples()', () => {
    function cursor(rows) { return { toArray: vi.fn().mockResolvedValue(rows) }; }
    function buildDb({ sensor = null, rackAssignments = [], positions = [], positionAssignments = [], specimenAssignments = [] } = {}) {
      const collections = {
        sensorMetadata: { findOne: vi.fn().mockResolvedValue(sensor) },
        rackLocationAssignments: { find: vi.fn(() => cursor(rackAssignments)) },
        storagePositions: { find: vi.fn(() => cursor(positions)) },
        containerPositionAssignments: { find: vi.fn(() => cursor(positionAssignments)) },
        specimenContainerAssignments: { find: vi.fn(() => cursor(specimenAssignments)) },
      };
      return { collections, collection: vi.fn((name) => {
        if (!collections[name]) throw new Error(`unexpected collection: ${name}`);
        return collections[name];
      }) };
    }

    it('returns [] when sensor metadata is absent', async () => {
      const db = buildDb();
      const monitor = new TelemetryMonitor({ db });
      await expect(monitor.resolveRootSamples('sensor-unknown')).resolves.toEqual([]);
    });

    it('returns [] when sensor metadata has no storageContainer link', async () => {
      const db = buildDb({ sensor: { sensorId: 'sensor-A', storageContainer: null } });
      const monitor = new TelemetryMonitor({ db });
      await expect(monitor.resolveRootSamples('sensor-A')).resolves.toEqual([]);
    });

    it('walks RackLocationAssignment -> StoragePosition -> ContainerPositionAssignment -> SpecimenContainerAssignment', async () => {
      const db = buildDb({
        sensor: { sensorId: 'sensor-A', storageContainer: 'LOC-1' },
        rackAssignments: [{ storageRackId: 'RACK-1', storageLocationId: 'LOC-1', removedAt: null }],
        positions: [{ storagePositionId: 'RACK-1:A1', storageRackId: 'RACK-1' }],
        positionAssignments: [{ containerId: 'CONT-1', storagePositionId: 'RACK-1:A1', removedAt: null }],
        specimenAssignments: [
          { specimenId: 'SPEC-1', containerId: 'CONT-1', releasedAt: null },
          { specimenId: 'SPEC-1', containerId: 'CONT-1', releasedAt: null },
        ],
      });
      const monitor = new TelemetryMonitor({ db });
      await expect(monitor.resolveRootSamples('sensor-A')).resolves.toEqual(['SPEC-1']);
      expect(db.collection).toHaveBeenCalledWith('rackLocationAssignments');
      expect(db.collection).toHaveBeenCalledWith('specimenContainerAssignments');
    });
  });

  describe('propagateCompromise()', () => {
    function transactionalDb(telemetryCollection) {
      const session = {
        withTransaction: vi.fn(async (handler) => handler()),
        endSession: vi.fn().mockResolvedValue(undefined),
      };
      const client = {
        db: vi.fn(() => ({ command: vi.fn().mockResolvedValue({ setName: 'rs0', isWritablePrimary: true }) })),
        startSession: vi.fn(() => session),
      };
      return {
        client,
        session,
        collection: vi.fn((name) => {
          if (name === 'telemetryExposureSummaries') return telemetryCollection;
          throw new Error(`unexpected collection ${name}`);
        }),
      };
    }

    it('returns summarized=0 when no root specimen was resolved', async () => {
      const monitor = new TelemetryMonitor({ db: {} });
      await expect(monitor.propagateCompromise({ rootSampleId: null, freezerKey: 'sensor-A' })).resolves.toEqual({ summarized: 0 });
    });

    it('persists the exposure summary and enqueues the graph projection in one Mongo transaction', async () => {
      const telemetryCollection = { updateOne: vi.fn().mockResolvedValue({ upsertedCount: 1 }) };
      const db = transactionalDb(telemetryCollection);
      const root = { _id: 'mongo-1', specimenId: 'SPEC-1', parentSpecimenIds: [] };
      const samples = {
        findOne: vi.fn().mockResolvedValue(root),
        find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
      };
      getCollectionSpy.mockResolvedValue(samples);
      const physicalStore = { findCurrentBySpecimen: vi.fn().mockResolvedValue({ specimenContainerAssignmentId: 'SCA-1', containerPositionAssignmentId: 'CPA-1', rackLocationAssignmentId: 'RLA-1' }) };
      const graphProjectionService = { appendTelemetryExposureSummaryEvent: vi.fn().mockResolvedValue({ eventId: 'evt-1' }) };
      const monitor = new TelemetryMonitor({ db, physicalStore, graphProjectionService });

      const result = await monitor.propagateCompromise({
        rootSampleId: 'SPEC-1', freezerKey: 'sensor-A',
        breachedSince: new Date('2026-01-01T00:00:00Z'), windowEnd: new Date('2026-01-01T01:00:00Z'),
        minimumValue: -70, maxObservedTemp: -60, meanValue: -65,
        observationCount: 5, timeOutsideThresholdSeconds: 3600, coverageRatio: 1,
        sourceQueryHash: 'sha256:q', sourceReadingSetHash: 'sha256:r'
      });

      expect(result).toEqual({ summarized: 1 });
      expect(db.client.startSession).toHaveBeenCalledTimes(1);
      expect(db.session.withTransaction).toHaveBeenCalledTimes(1);
      expect(telemetryCollection.updateOne).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ $setOnInsert: expect.objectContaining({ specimenId: 'SPEC-1' }) }),
        expect.objectContaining({ upsert: true, session: db.session })
      );
      expect(graphProjectionService.appendTelemetryExposureSummaryEvent).toHaveBeenCalledWith(
        db,
        expect.objectContaining({ specimenId: 'SPEC-1', sourceService: 'telemetry-monitor-v2' }),
        { session: db.session }
      );
    });
  });


  describe('item 8 residual canonical telemetry branches', () => {
    it('logs a raw scheduled-cycle rejection without stopping the cron task', async () => {
      const monitor = new TelemetryMonitor({ db: {} });
      monitor.runCycle = vi.fn().mockRejectedValue('raw scheduled failure');
      monitor.start();

      const scheduled = cronScheduleSpy.mock.calls[0][1];
      await scheduled();

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Erro no ciclo do monitor'),
        'raw scheduled failure'
      );
    });

    it('continues after raw missing-reading failure, skips cooldown-blocked freezers and uses rootSampleId fallback', async () => {
      const monitor = new TelemetryMonitor({ db: {} });
      monitor.checkMissingReadings = vi.fn().mockRejectedValue('raw missing failure');
      monitor.findCriticalFreezers = vi.fn().mockResolvedValue([
        { freezerKey: 'skip', rootSampleIds: ['SPEC-SKIP'] },
        { freezerKey: 'single', rootSampleId: 'SPEC-ONE' },
      ]);
      monitor.shouldTrigger = vi.fn((key) => key === 'single');
      monitor.propagateCompromise = vi.fn().mockResolvedValue({ summarized: 1 });

      const result = await monitor.runCycle();

      expect(result.processed).toBe(1);
      expect(monitor.propagateCompromise).toHaveBeenCalledWith(expect.objectContaining({ rootSampleId: 'SPEC-ONE' }));
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Falha ao verificar leituras ausentes'),
        'raw missing failure'
      );
    });

    it('uses default duration values when db is unavailable and when sensor metadata has no bound policy', async () => {
      const noDb = new TelemetryMonitor({ db: null, criticalDurationHours: 3 });
      await expect(noDb.resolveCriticalDurationMinutesBySensor(['S1'])).resolves.toEqual(new Map([['S1', 180]]));

      const sensorMetadata = { find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([{ sensorId: 'S2' }]) })) };
      const db = {
        collection: vi.fn((name) => {
          if (name === 'sensorMetadata') return sensorMetadata;
          if (name === 'temperaturePolicies') return { find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })) };
          throw new Error(`unexpected collection ${name}`);
        }),
      };
      const monitor = new TelemetryMonitor({ db, criticalDurationHours: 4 });
      await expect(monitor.resolveCriticalDurationMinutesBySensor(['S2'])).resolves.toEqual(new Map([['S2', 240]]));
    });

    it('returns [] at every incomplete normalized physical-lineage hop', async () => {
      const cursor = (rows) => ({ toArray: vi.fn().mockResolvedValue(rows) });
      const cases = [
        { racks: [], positions: [], placements: [] },
        { racks: [{ storageRackId: 'R1' }], positions: [], placements: [] },
        { racks: [{ storageRackId: 'R1' }], positions: [{ storagePositionId: 'P1' }], placements: [] },
      ];
      for (const item of cases) {
        const collections = {
          sensorMetadata: { findOne: vi.fn().mockResolvedValue({ sensorId: 'S', storageContainer: 'LOC' }) },
          rackLocationAssignments: { find: vi.fn(() => cursor(item.racks)) },
          storagePositions: { find: vi.fn(() => cursor(item.positions)) },
          containerPositionAssignments: { find: vi.fn(() => cursor(item.placements)) },
          specimenContainerAssignments: { find: vi.fn(() => cursor([])) },
        };
        const db = { collection: vi.fn((name) => collections[name]) };
        const monitor = new TelemetryMonitor({ db });
        await expect(monitor.resolveRootSamples('S')).resolves.toEqual([]);
      }
    });

    it('returns [] from missing-reading discovery when there are no configured sensors', async () => {
      const db = { collection: vi.fn(() => ({ find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })) })) };
      const monitor = new TelemetryMonitor({ db });
      await expect(monitor.findSensorsWithMissingReadings()).resolves.toEqual([]);
      expect(connectInfluxDBSpy).not.toHaveBeenCalled();
    });

    it('detects missing readings with no linked device, an old reading and a recent reading', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-19T20:00:00.000Z'));
      const sensors = [
        { sensorId: 'no-device' },
        { sensorId: 'old', device: 'D1' },
        { sensorId: 'recent', device: 'D2' },
      ];
      const collections = {
        sensorMetadata: { find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue(sensors) })) },
        devices: { find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([{ _id: 'D1', deviceId: 'DEVICE-1' }, { _id: 'D2', deviceId: 'DEVICE-2' }]) })) },
      };
      const db = { collection: vi.fn((name) => collections[name]) };
      const monitor = new TelemetryMonitor({ db, expectedReadingIntervalMinutes: 15 });
      getInfluxQueryApiSpy.mockReturnValue({
        collectRows: vi.fn().mockResolvedValue([
          { sensorId: 'old', _time: '2026-09-19T19:00:00.000Z' },
          { sensorId: 'recent', _time: '2026-09-19T19:55:00.000Z' },
        ]),
      });

      const missing = await monitor.findSensorsWithMissingReadings();
      expect(missing).toEqual([
        { sensorId: 'no-device', deviceId: null, lastReadingAt: null },
        { sensorId: 'old', deviceId: 'DEVICE-1', lastReadingAt: new Date('2026-09-19T19:00:00.000Z') },
      ]);
    });

    it('does not query devices when configured sensors have no device links', async () => {
      const sensorMetadata = { find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([{ sensorId: 'S1' }]) })) };
      const db = { collection: vi.fn((name) => {
        if (name === 'sensorMetadata') return sensorMetadata;
        throw new Error('devices should not be queried');
      }) };
      const monitor = new TelemetryMonitor({ db });
      getInfluxQueryApiSpy.mockReturnValue({ collectRows: vi.fn().mockResolvedValue([]) });

      await expect(monitor.findSensorsWithMissingReadings()).resolves.toEqual([
        { sensorId: 'S1', deviceId: null, lastReadingAt: null },
      ]);
    });

    it('updates an existing missing-reading excursion and inserts a new one', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-19T20:00:00.000Z'));
      const excursions = {
        findOne: vi.fn()
          .mockResolvedValueOnce({ _id: 'EX-1' })
          .mockResolvedValueOnce(null),
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'EX-2' }),
      };
      const empty = { find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })) };
      const db = { collection: vi.fn((name) => {
        if (name === 'environmentalExcursions') return excursions;
        if (name === 'sensors' || name === 'sensorMetadata') return empty;
        if (name === 'storageContainers' || name === 'storageBoxes') return empty;
        if (name === 'equipment') return { findOne: vi.fn().mockResolvedValue(null) };
        throw new Error(`unexpected collection ${name}`);
      }) };
      const monitor = new TelemetryMonitor({ db, expectedReadingIntervalMinutes: 15 });

      await monitor.upsertMissingReadingExcursion({ sensorId: 'S1', deviceId: 'D1', lastReadingAt: new Date('2026-09-19T19:00:00.000Z') });
      expect(excursions.updateOne).toHaveBeenCalled();

      await monitor.upsertMissingReadingExcursion({ sensorId: 'S2', deviceId: 'D2', lastReadingAt: null });
      expect(excursions.insertOne).toHaveBeenCalledWith(expect.objectContaining({
        equipmentId: 'D2',
        excursionType: 'missing_reading',
        excursionStatus: 'open',
      }));
    });

    it('skips missing-reading excursion creation for sensors without deviceId', async () => {
      const monitor = new TelemetryMonitor({ db: {} });
      monitor.findSensorsWithMissingReadings = vi.fn().mockResolvedValue([
        { sensorId: 'S1', deviceId: null },
        { sensorId: 'S2', deviceId: 'D2' },
      ]);
      monitor.upsertMissingReadingExcursion = vi.fn().mockResolvedValue();

      const result = await monitor.checkMissingReadings();
      expect(result).toHaveLength(2);
      expect(monitor.upsertMissingReadingExcursion).toHaveBeenCalledOnce();
      expect(monitor.upsertMissingReadingExcursion).toHaveBeenCalledWith(expect.objectContaining({ sensorId: 'S2' }));
    });

    it('normalizes ObjectId, ObjectId string, arbitrary string and numeric specimen identifiers', () => {
      const { ObjectId } = require('mongodb');
      const monitor = new TelemetryMonitor({});
      const objectId = new ObjectId();
      const hex = new ObjectId().toHexString();

      expect(monitor.normalizeSpecimenLookupId(objectId)).toBe(objectId);
      expect(monitor.normalizeSpecimenLookupId(hex)).toBeInstanceOf(ObjectId);
      expect(monitor.normalizeSpecimenLookupId('SPEC-1')).toBe('SPEC-1');
      expect(monitor.normalizeSpecimenLookupId(42)).toBe(42);
    });

    it('deduplicates descendant traversal and supports roots without specimenId', async () => {
      const root = { _id: 'ROOT' };
      const samples = {
        findOne: vi.fn().mockResolvedValue(root),
        find: vi.fn(({ parentSpecimenIds }) => ({
          toArray: vi.fn(async () => parentSpecimenIds.$in.includes('ROOT')
            ? [{ _id: 'CHILD' }, { _id: 'CHILD' }]
            : []),
        })),
      };
      getCollectionSpy.mockResolvedValue(samples);
      const monitor = new TelemetryMonitor({ db: {} });

      const result = await monitor.resolveDescendantSpecimens('ROOT', null);
      expect(result.map((item) => item._id)).toEqual(['ROOT', 'CHILD']);
    });

    it('builds an unassigned exposure summary using all optional metric defaults', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-19T20:00:00.000Z'));
      const monitor = new TelemetryMonitor({});
      const summary = monitor.buildExposureSummary({
        specimen: { _id: 'SPEC-MONGO' },
        assignment: null,
        freezerKey: 'SENSOR',
        breachedSince: '2026-09-19T18:00:00.000Z',
      });

      expect(summary).toMatchObject({
        specimenId: 'SPEC-MONGO',
        specimenContainerAssignmentId: null,
        containerPositionAssignmentId: null,
        rackLocationAssignmentId: null,
        observationCount: 0,
        minimumValue: null,
        maximumValue: null,
        meanValue: null,
        timeOutsideThresholdSeconds: 0,
        coverageRatio: null,
        sourceQueryHash: null,
        sourceReadingSetHash: null,
      });
      expect(summary.windowEnd).toEqual(new Date('2026-09-19T20:00:00.000Z'));
    });

    it('persists exposure summaries without a physicalStore using the unassigned path', async () => {
      const telemetryCollection = { updateOne: vi.fn().mockResolvedValue({ upsertedCount: 1 }) };
      const session = {
        withTransaction: vi.fn(async (handler) => handler()),
        endSession: vi.fn().mockResolvedValue(),
      };
      const db = {
        client: {
          db: vi.fn(() => ({ command: vi.fn().mockResolvedValue({ setName: 'rs0', isWritablePrimary: true }) })),
          startSession: vi.fn(() => session),
        },
        collection: vi.fn((name) => {
          if (name === 'telemetryExposureSummaries') return telemetryCollection;
          throw new Error(`unexpected collection ${name}`);
        }),
      };
      const samples = {
        findOne: vi.fn().mockResolvedValue({ _id: 'ROOT', specimenId: 'SPEC-ROOT' }),
        find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
      };
      getCollectionSpy.mockResolvedValue(samples);
      const graphProjectionService = { appendTelemetryExposureSummaryEvent: vi.fn().mockResolvedValue({ eventId: 'E1' }) };
      const monitor = new TelemetryMonitor({ db, graphProjectionService });
      monitor.physicalStore = null;

      await expect(monitor.propagateCompromise({
        rootSampleId: 'SPEC-ROOT',
        freezerKey: 'SENSOR',
        breachedSince: new Date('2026-09-19T18:00:00.000Z'),
      })).resolves.toEqual({ summarized: 1 });

      expect(telemetryCollection.updateOne).toHaveBeenCalledWith(
        expect.anything(),
        { $setOnInsert: expect.objectContaining({ containerPositionAssignmentId: null }) },
        expect.objectContaining({ upsert: true, session })
      );
    });
  });

});
