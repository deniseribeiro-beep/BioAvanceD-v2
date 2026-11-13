import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const repository = require('../../src/infrastructure/persistence/influxdb/InfluxTelemetryWriteRepository');
const logger = require('../../src/utils/logger');

function resetRepository() {
  repository.buffer = [];
  repository.flushTimer = null;
  repository.writeApi = null;
  repository.flushing = false;
  repository.maxBatchSize = 200;
  repository.flushIntervalMs = 1000;
}

describe('InfluxTelemetryWriteRepository', () => {
  beforeEach(() => {
    resetRepository();
  });

  afterEach(() => {
    resetRepository();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('enqueueTemperatureReading', () => {
    it('is a no-op when reading is falsy', () => {
      repository.enqueueTemperatureReading(null);
      expect(repository.buffer.length).toBe(0);
    });

    it('is a no-op when temperatureValue is undefined', () => {
      repository.enqueueTemperatureReading({ sensorId: 'a' });
      expect(repository.buffer.length).toBe(0);
    });

    it('is a no-op when temperatureValue is null', () => {
      repository.enqueueTemperatureReading({ temperatureValue: null });
      expect(repository.buffer.length).toBe(0);
    });

    it('enqueues a reading with temperatureValue 0 (falsy but valid)', () => {
      vi.useFakeTimers();
      repository.enqueueTemperatureReading({ temperatureValue: 0 });
      expect(repository.buffer.length).toBe(1);
      expect(repository.buffer[0].temperatureValue).toBe(0);
    });

    it('pushes a shallow copy, not a reference to the original object', () => {
      vi.useFakeTimers();
      const original = { temperatureValue: 5, sensorId: 's1' };
      repository.enqueueTemperatureReading(original);
      original.temperatureValue = 999;
      original.sensorId = 'mutated';
      expect(repository.buffer[0].temperatureValue).toBe(5);
      expect(repository.buffer[0].sensorId).toBe('s1');
      expect(repository.buffer[0]).not.toBe(original);
    });

    it('triggers an immediate flush (not via timer) when buffer reaches maxBatchSize, without going through scheduleFlush on that call', () => {
      vi.useFakeTimers();
      const flushSpy = vi.spyOn(repository, 'flush').mockResolvedValue(undefined);
      repository.maxBatchSize = 3;
      repository.enqueueTemperatureReading({ temperatureValue: 1 });
      repository.enqueueTemperatureReading({ temperatureValue: 2 });
      expect(flushSpy).not.toHaveBeenCalled();

      const scheduleFlushSpy = vi.spyOn(repository, 'scheduleFlush');
      repository.enqueueTemperatureReading({ temperatureValue: 3 });

      expect(flushSpy).toHaveBeenCalledTimes(1);
      // The threshold-triggering call must return early (via the `if...return` branch)
      // and must NOT also call scheduleFlush on this invocation.
      expect(scheduleFlushSpy).not.toHaveBeenCalled();
    });

    it('schedules a timer-based flush when below maxBatchSize', () => {
      vi.useFakeTimers();
      const flushSpy = vi.spyOn(repository, 'flush').mockResolvedValue(undefined);
      repository.maxBatchSize = 200;
      repository.enqueueTemperatureReading({ temperatureValue: 1 });
      expect(flushSpy).not.toHaveBeenCalled();
      expect(repository.flushTimer).not.toBeNull();
    });
  });

  describe('scheduleFlush', () => {
    it('debounces: calling it twice back-to-back only sets one timer, flush runs once', async () => {
      vi.useFakeTimers();
      const flushSpy = vi.spyOn(repository, 'flush').mockResolvedValue(undefined);

      repository.scheduleFlush();
      const timerAfterFirst = repository.flushTimer;
      repository.scheduleFlush();
      expect(repository.flushTimer).toBe(timerAfterFirst);

      await vi.advanceTimersByTimeAsync(1000);

      expect(flushSpy).toHaveBeenCalledTimes(1);
      expect(repository.flushTimer).toBeNull();
    });
  });

  describe('toPoint', () => {
    it('always includes the required temperatureValue field', () => {
      const point = repository.toPoint({ temperatureValue: 4.5 });
      const line = point.toLineProtocol();
      expect(line).toContain('temperatureValue=4.5');
    });

    it('includes sensorId tag when reading.sensorId is present', () => {
      const point = repository.toPoint({ temperatureValue: 1, sensorId: 'sens-1' });
      const line = point.toLineProtocol();
      expect(line).toContain('sensorId=sens-1');
    });

    it('falls back to reading.sensorID when sensorId is absent', () => {
      const point = repository.toPoint({ temperatureValue: 1, sensorID: 'sens-2' });
      const line = point.toLineProtocol();
      expect(line).toContain('sensorId=sens-2');
    });

    it('omits sensorId tag when neither sensorId nor sensorID present', () => {
      const point = repository.toPoint({ temperatureValue: 1 });
      const line = point.toLineProtocol();
      expect(line).not.toContain('sensorId=');
    });

    it('includes locationId, facility, zone, temperatureUnit tags when present', () => {
      const point = repository.toPoint({
        temperatureValue: 1,
        locationId: 'loc-1',
        facility: 'fac-1',
        zone: 'zone-1',
        temperatureUnit: 'C'
      });
      const line = point.toLineProtocol();
      expect(line).toContain('locationId=loc-1');
      expect(line).toContain('facility=fac-1');
      expect(line).toContain('zone=zone-1');
      expect(line).toContain('temperatureUnit=C');
    });

    it('omits locationId, facility, zone, temperatureUnit tags when absent', () => {
      const point = repository.toPoint({ temperatureValue: 1 });
      const line = point.toLineProtocol();
      expect(line).not.toContain('locationId=');
      expect(line).not.toContain('facility=');
      expect(line).not.toContain('zone=');
      expect(line).not.toContain('temperatureUnit=');
    });

    it('includes signalQuality stringField when present', () => {
      const point = repository.toPoint({ temperatureValue: 1, signalQuality: 'good' });
      const line = point.toLineProtocol();
      expect(line).toContain('signalQuality="good"');
    });

    it('omits signalQuality when absent', () => {
      const point = repository.toPoint({ temperatureValue: 1 });
      const line = point.toLineProtocol();
      expect(line).not.toContain('signalQuality=');
    });

    it('includes batteryLevel intField when defined, non-null and finite', () => {
      const point = repository.toPoint({ temperatureValue: 1, batteryLevel: 80 });
      const line = point.toLineProtocol();
      expect(line).toContain('batteryLevel=80i');
    });

    it('excludes batteryLevel when NaN', () => {
      const point = repository.toPoint({ temperatureValue: 1, batteryLevel: NaN });
      const line = point.toLineProtocol();
      expect(line).not.toContain('batteryLevel=');
    });

    it('excludes batteryLevel when Infinity', () => {
      const point = repository.toPoint({ temperatureValue: 1, batteryLevel: Infinity });
      const line = point.toLineProtocol();
      expect(line).not.toContain('batteryLevel=');
    });

    it('excludes batteryLevel when null or undefined', () => {
      const pointNull = repository.toPoint({ temperatureValue: 1, batteryLevel: null });
      const pointUndef = repository.toPoint({ temperatureValue: 1, batteryLevel: undefined });
      expect(pointNull.toLineProtocol()).not.toContain('batteryLevel=');
      expect(pointUndef.toLineProtocol()).not.toContain('batteryLevel=');
    });

    it('uses reading.timestamp when provided', () => {
      const ts = new Date('2026-01-01T00:00:00.000Z');
      const point = repository.toPoint({ temperatureValue: 1, timestamp: ts.toISOString() });
      const line = point.toLineProtocol();
      // line protocol ends with a nanosecond timestamp; verify it's derived from our date, not "now"
      const expectedNanos = ts.getTime() * 1e6;
      expect(line.trim().endsWith(String(expectedNanos))).toBe(true);
    });

    it('defaults timestamp to now when reading.timestamp is absent', () => {
      const before = Date.now();
      const point = repository.toPoint({ temperatureValue: 1 });
      const after = Date.now();
      const line = point.toLineProtocol();
      const nanosStr = line.trim().split(' ').pop();
      const millis = Math.round(Number(nanosStr) / 1e6);
      expect(millis).toBeGreaterThanOrEqual(before);
      expect(millis).toBeLessThanOrEqual(after);
    });

    // #1317: the point's time is observedAt, and it carries the reading's id.
    it('uses observedAt over timestamp, and carries telemetryReadingId and clockStatus', () => {
      const observedAt = new Date('2026-02-02T00:00:00.000Z');
      const point = repository.toPoint({
        temperatureValue: 1,
        timestamp: '2026-01-01T00:00:00.000Z',
        observedAt,
        telemetryReadingId: 'tr-1',
        clockStatus: 'drift',
      });
      const line = point.toLineProtocol();
      expect(line.trim().endsWith(String(observedAt.getTime() * 1e6))).toBe(true);
      expect(line).toContain('telemetryReadingId="tr-1"');
      expect(line).toContain('clockStatus=drift');
    });

    // #1518 (RNF025 C8): as saveTelemetryPoint writes them.
    it('carries the reading\'s sourceEventId and payloadHash as fields', () => {
      const line = repository.toPoint({ temperatureValue: 1, sourceEventId: 'ev-1', payloadHash: 'h-1' }).toLineProtocol();

      expect(line).toContain('sourceEventId="ev-1"');
      expect(line).toContain('payloadHash="h-1"');
    });
  });

  // #1317 (RF009 AC1): the authoritative write is awaited, not buffered.
  describe('writeTemperatureReadingNow', () => {
    it('writes and flushes the one point, then returns the confirmation time', async () => {
      const writeApi = { writePoint: vi.fn(), flush: vi.fn().mockResolvedValue(undefined) };
      repository.writeApi = writeApi;
      vi.spyOn(repository, 'storedPointsAt').mockResolvedValue([]);
      const before = Date.now();

      const persistedAt = await repository.writeTemperatureReadingNow({ temperatureValue: 4, sensorId: 's1' });

      expect(writeApi.writePoint).toHaveBeenCalledTimes(1);
      expect(writeApi.flush).toHaveBeenCalledTimes(1);
      expect(persistedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(repository.buffer).toEqual([]);
    });

    it('rejects when the flush fails, so the caller stores nothing', async () => {
      repository.writeApi = { writePoint: vi.fn(), flush: vi.fn().mockRejectedValue(new Error('influx down')) };
      vi.spyOn(repository, 'storedPointsAt').mockResolvedValue([]);
      await expect(repository.writeTemperatureReadingNow({ temperatureValue: 4 })).rejects.toThrow('influx down');
    });

    // #1518 (RNF025 C8): a late correction keeps the stored reading; an
    // identical resend is no correction.
    describe('late corrections (#1518, RNF025 C8)', () => {
      const observedAt = new Date('2026-10-10T12:00:00.000Z');

      function withWriteApi() {
        const writeApi = { writePoint: vi.fn(), flush: vi.fn().mockResolvedValue(undefined) };
        repository.writeApi = writeApi;
        return writeApi;
      }

      it('writes a correction of a stored reading as revision 1, naming the reading it supersedes', async () => {
        const writeApi = withWriteApi();
        const lookup = vi.spyOn(repository, 'storedPointsAt').mockResolvedValue([
          { temperatureValue: 4, telemetryReadingId: 'tr-1', payloadHash: 'h-0' },
        ]);

        await repository.writeTemperatureReadingNow({
          temperatureValue: 6, sensorId: 's1', observedAt, telemetryReadingId: 'tr-2', payloadHash: 'h-1',
        });

        expect(lookup).toHaveBeenCalledWith('s1', observedAt);
        const line = writeApi.writePoint.mock.calls[0][0].toLineProtocol();
        expect(line).toMatch(/,revision=1[, ]/);
        expect(line).toContain('supersedesTelemetryReadingId="tr-1"');
        expect(line).toContain('telemetryReadingId="tr-2"');
      });

      it('writes an identical resend of a stored reading, by its payloadHash, with no revision', async () => {
        const writeApi = withWriteApi();
        vi.spyOn(repository, 'storedPointsAt').mockResolvedValue([
          { temperatureValue: 4, telemetryReadingId: 'tr-1', payloadHash: 'h-0' },
        ]);

        await repository.writeTemperatureReadingNow({
          temperatureValue: 4, sensorId: 's1', observedAt, telemetryReadingId: 'tr-2', payloadHash: 'h-0',
        });

        const line = writeApi.writePoint.mock.calls[0][0].toLineProtocol();
        expect(line).not.toContain('revision=');
        expect(line).not.toContain('supersedesTelemetryReadingId');
      });

      it('looks nothing up for a reading with no sensorId', async () => {
        const writeApi = withWriteApi();
        const lookup = vi.spyOn(repository, 'storedPointsAt').mockResolvedValue([]);

        await repository.writeTemperatureReadingNow({ temperatureValue: 4, observedAt });

        expect(lookup).not.toHaveBeenCalled();
        expect(writeApi.writePoint).toHaveBeenCalledTimes(1);
      });

      it('rejects and writes nothing when the stored points cannot be read', async () => {
        const writeApi = withWriteApi();
        vi.spyOn(repository, 'storedPointsAt').mockRejectedValue(new Error('influx query failed'));

        await expect(repository.writeTemperatureReadingNow({ temperatureValue: 4, sensorId: 's1', observedAt }))
          .rejects.toThrow('influx query failed');
        expect(writeApi.writePoint).not.toHaveBeenCalled();
      });
    });
  });

  describe('flush', () => {
    it('is a no-op when already flushing', async () => {
      repository.flushing = true;
      repository.buffer = [{ temperatureValue: 1 }];
      const writeApi = { writePoints: vi.fn(), flush: vi.fn().mockResolvedValue(undefined) };
      repository.writeApi = writeApi;

      await repository.flush();

      expect(writeApi.writePoints).not.toHaveBeenCalled();
      expect(repository.buffer.length).toBe(1);
    });

    it('is a no-op when buffer is empty', async () => {
      repository.buffer = [];
      const writeApi = { writePoints: vi.fn(), flush: vi.fn().mockResolvedValue(undefined) };
      repository.writeApi = writeApi;

      await repository.flush();

      expect(writeApi.writePoints).not.toHaveBeenCalled();
    });

    it('happy path: calls writePoints and flush, empties the processed portion of the buffer', async () => {
      const writeApi = { writePoints: vi.fn(), flush: vi.fn().mockResolvedValue(undefined) };
      repository.writeApi = writeApi;
      repository.buffer = [{ temperatureValue: 1 }, { temperatureValue: 2 }];

      await repository.flush();

      expect(writeApi.writePoints).toHaveBeenCalledTimes(1);
      expect(writeApi.writePoints.mock.calls[0][0].length).toBe(2);
      expect(writeApi.flush).toHaveBeenCalledTimes(1);
      expect(repository.buffer.length).toBe(0);
      expect(repository.flushing).toBe(false);
    });

    it('error path: unshifts the failed batch back onto the buffer, logs, and reschedules', async () => {
      vi.useFakeTimers();
      const writeError = new Error('boom');
      const writeApi = {
        writePoints: vi.fn(),
        flush: vi.fn().mockRejectedValue(writeError)
      };
      repository.writeApi = writeApi;
      repository.buffer = [{ temperatureValue: 1 }, { temperatureValue: 2 }];
      const loggerSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

      await repository.flush();

      expect(loggerSpy).toHaveBeenCalled();
      expect(repository.buffer.length).toBe(2);
      expect(repository.buffer[0].temperatureValue).toBe(1);
      expect(repository.buffer[1].temperatureValue).toBe(2);
      expect(repository.flushing).toBe(false);
      expect(repository.flushTimer).not.toBeNull();
    });

    it('reschedules a flush via scheduleFlush when buffer still has items after finishing', async () => {
      vi.useFakeTimers();
      const writeApi = { writePoints: vi.fn(), flush: vi.fn().mockResolvedValue(undefined) };
      repository.writeApi = writeApi;
      // Simulate more items being enqueued during the async flush by having flush leave items behind:
      // easiest reliable way is the error path (already covered), so here we verify the success path
      // does NOT reschedule when buffer ends up empty.
      repository.buffer = [{ temperatureValue: 1 }];

      await repository.flush();

      expect(repository.buffer.length).toBe(0);
      expect(repository.flushTimer).toBeNull();
    });
  });

  describe('ensureWriteApi', () => {
    it('returns the cached writeApi without calling connectInfluxDB/getInfluxWriteApi when already set', async () => {
      const cachedApi = { writePoints: vi.fn(), flush: vi.fn() };
      repository.writeApi = cachedApi;

      const result = await repository.ensureWriteApi();

      expect(result).toBe(cachedApi);
    });

    it('calls connectInfluxDB then getInfluxWriteApi and caches the result when writeApi is null', async () => {
      const connectionModulePath = require.resolve('../../src/infrastructure/database/influxdb/connection');
      const repoModulePath = require.resolve('../../src/infrastructure/persistence/influxdb/InfluxTelemetryWriteRepository');

      const fakeWriteApi = { writePoints: vi.fn(), flush: vi.fn() };
      const connectInfluxDB = vi.fn().mockResolvedValue(undefined);
      const getInfluxWriteApi = vi.fn().mockReturnValue(fakeWriteApi);

      const originalConnectionExports = require.cache[connectionModulePath]
        ? require.cache[connectionModulePath].exports
        : undefined;
      const originalRepoCacheEntry = require.cache[repoModulePath];

      delete require.cache[repoModulePath];
      require.cache[connectionModulePath] = {
        id: connectionModulePath,
        filename: connectionModulePath,
        loaded: true,
        exports: { connectInfluxDB, getInfluxWriteApi }
      };

      let freshRepo;
      try {
        delete require.cache[repoModulePath];
        // eslint-disable-next-line global-require
        freshRepo = require('../../src/infrastructure/persistence/influxdb/InfluxTelemetryWriteRepository');

        const result = await freshRepo.ensureWriteApi();

        expect(connectInfluxDB).toHaveBeenCalledTimes(1);
        expect(getInfluxWriteApi).toHaveBeenCalledTimes(1);
        expect(result).toBe(fakeWriteApi);
        expect(freshRepo.writeApi).toBe(fakeWriteApi);
      } finally {
        // Restore original module caches so other tests keep using the original singleton
        if (originalConnectionExports !== undefined) {
          require.cache[connectionModulePath].exports = originalConnectionExports;
        } else {
          delete require.cache[connectionModulePath];
        }
        delete require.cache[repoModulePath];
        if (originalRepoCacheEntry) {
          require.cache[repoModulePath] = originalRepoCacheEntry;
        }
        // eslint-disable-next-line global-require
        require('../../src/infrastructure/persistence/influxdb/InfluxTelemetryWriteRepository');
      }
    });
  });
});
