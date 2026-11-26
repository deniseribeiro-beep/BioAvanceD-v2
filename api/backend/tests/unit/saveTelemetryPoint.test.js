import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const connectionPath = require.resolve('../../src/infrastructure/database/influxdb/connection');
const servicePath = require.resolve('../../src/services/saveTelemetryPoint');
const loggerPath = require.resolve('../../src/utils/logger');

// The source file destructures `connectInfluxDB`/`getInfluxWriteApi` into local
// consts at require-time:
//   const { connectInfluxDB, getInfluxWriteApi } = require('../infrastructure/...');
// vi.spyOn() on the module's exported properties AFTER the service module has
// already been required (and cached) does not change those already-captured
// local bindings, so the spy is never invoked from inside saveTelemetryPoint.
// Workaround: clear the require cache for both the connection module and the
// service module, replace the connection module's exports with mocks, then
// require the service fresh so its destructuring picks up the mocked functions.
// #1518: by default no point is stored at the reading's time.
function loadServiceWithMocks({
  connectInfluxDB,
  getInfluxWriteApi,
  loggerError,
  collectRows = vi.fn().mockResolvedValue([]),
}) {
  delete require.cache[connectionPath];
  delete require.cache[servicePath];
  delete require.cache[loggerPath];

  const connectionModule = require(connectionPath);
  connectionModule.connectInfluxDB = connectInfluxDB;
  connectionModule.getInfluxWriteApi = getInfluxWriteApi;
  connectionModule.getInfluxQueryApi = vi.fn().mockReturnValue({ collectRows });
  connectionModule.getInfluxConfig = vi.fn().mockReturnValue({ bucket: 'telemetry' });

  const loggerModule = require(loggerPath);
  if (loggerError) {
    loggerModule.error = loggerError;
  }

  const { saveTelemetryPoint } = require(servicePath);
  return { saveTelemetryPoint, loggerModule };
}

describe('saveTelemetryPoint', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete require.cache[connectionPath];
    delete require.cache[servicePath];
    delete require.cache[loggerPath];
  });

  it('writes a point and returns true on valid input', async () => {
    const writePoint = vi.fn();
    const flush = vi.fn().mockResolvedValue(undefined);
    const connectInfluxDB = vi.fn().mockResolvedValue(undefined);
    const getInfluxWriteApi = vi.fn().mockReturnValue({ writePoint, flush });

    const { saveTelemetryPoint } = loadServiceWithMocks({ connectInfluxDB, getInfluxWriteApi });

    const result = await saveTelemetryPoint('sensor-1', 23.5, undefined);

    expect(result).toBe(true);
    expect(connectInfluxDB).toHaveBeenCalledTimes(1);
    expect(getInfluxWriteApi).toHaveBeenCalledTimes(1);
    expect(writePoint).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  // #1317: the point carries the reading contract's id, clock status,
  // datastream (V2E-0546) and location (V2E-0547).
  it('writes the reading id as a field and clockStatus, datastreamId and storageLocationId as tags when given an identity', async () => {
    const writePoint = vi.fn();
    const flush = vi.fn().mockResolvedValue(undefined);
    const { saveTelemetryPoint } = loadServiceWithMocks({
      connectInfluxDB: vi.fn().mockResolvedValue(undefined),
      getInfluxWriteApi: vi.fn().mockReturnValue({ writePoint, flush }),
    });

    await saveTelemetryPoint('sensor-1', 4, new Date('2026-10-10T12:00:00.000Z'), {
      telemetryReadingId: 'tr-9', clockStatus: 'drift', datastreamId: 'ds-1', storageLocationId: 'loc-1',
    });
    const line = writePoint.mock.calls[0][0].toLineProtocol();
    expect(line).toContain('clockStatus=drift');
    expect(line).toContain('telemetryReadingId="tr-9"');
    expect(line).toContain('datastreamId=ds-1');
    expect(line).toContain('storageLocationId=loc-1');
    expect(line).not.toContain('telemetryDatastreamId');

    await saveTelemetryPoint('sensor-1', 4, new Date('2026-10-10T12:00:00.000Z'));
    expect(writePoint.mock.calls[1][0].toLineProtocol()).not.toContain('telemetryReadingId');
  });

  // #1518 (RNF025 C7, RNF004 C1): the point keeps the contract's order and
  // provenance fields, sequenceNumber (V2E-0553), receivedAt (V2E-0549),
  // sourceEventId (V2E-0551) and payloadHash (V2E-0555), each only when given.
  it('writes sequenceNumber, receivedAt, sourceEventId and payloadHash as fields when the identity has them (#1518)', async () => {
    const writePoint = vi.fn();
    const flush = vi.fn().mockResolvedValue(undefined);
    const { saveTelemetryPoint } = loadServiceWithMocks({
      connectInfluxDB: vi.fn().mockResolvedValue(undefined),
      getInfluxWriteApi: vi.fn().mockReturnValue({ writePoint, flush }),
    });

    await saveTelemetryPoint('sensor-1', 4, new Date('2026-10-10T12:00:00.000Z'), {
      telemetryReadingId: 'tr-9',
      sequenceNumber: 2,
      receivedAt: new Date('2026-10-10T12:20:00.000Z'),
      sourceEventId: 'se-1',
      payloadHash: 'ab',
    });
    const line = writePoint.mock.calls[0][0].toLineProtocol();
    expect(line).toContain('sequenceNumber=2i');
    expect(line).toContain('receivedAt="2026-10-10T12:20:00.000Z"');
    expect(line).toContain('sourceEventId="se-1"');
    expect(line).toContain('payloadHash="ab"');

    await saveTelemetryPoint('sensor-1', 4, new Date('2026-10-10T12:00:00.000Z'), {
      telemetryReadingId: 'tr-10',
      sequenceNumber: null,
    });
    const bare = writePoint.mock.calls[1][0].toLineProtocol();
    for (const field of ['sequenceNumber', 'receivedAt', 'sourceEventId', 'payloadHash']) {
      expect(bare).not.toContain(field);
    }
  });

  // #1518: the contract accepts any non-negative integer sequenceNumber, but
  // an InfluxDB integer field stops at 2^63; the reading is still stored.
  it('still writes the point, without a sequenceNumber field, when the sequenceNumber is past the integer field range (#1518)', async () => {
    const writePoint = vi.fn();
    const flush = vi.fn().mockResolvedValue(undefined);
    const { saveTelemetryPoint } = loadServiceWithMocks({
      connectInfluxDB: vi.fn().mockResolvedValue(undefined),
      getInfluxWriteApi: vi.fn().mockReturnValue({ writePoint, flush }),
    });

    const result = await saveTelemetryPoint('sensor-1', 4, new Date('2026-10-10T12:00:00.000Z'), {
      telemetryReadingId: 'tr-11',
      sequenceNumber: 2 ** 63,
    });
    expect(result).toBe(true);
    expect(writePoint).toHaveBeenCalledTimes(1);
    const line = writePoint.mock.calls[0][0].toLineProtocol();
    expect(line).toContain('telemetryReadingId="tr-11"');
    expect(line).not.toContain('sequenceNumber');
  });

  it('rejects when sensorId is undefined without touching influx', async () => {
    const writePoint = vi.fn();
    const flush = vi.fn().mockResolvedValue(undefined);
    const connectInfluxDB = vi.fn().mockResolvedValue(undefined);
    const getInfluxWriteApi = vi.fn().mockReturnValue({ writePoint, flush });
    const { saveTelemetryPoint } = loadServiceWithMocks({ connectInfluxDB, getInfluxWriteApi });

    await expect(saveTelemetryPoint(undefined, 23.5)).rejects.toThrow('sensorId é obrigatório');
    expect(connectInfluxDB).not.toHaveBeenCalled();
  });

  it('rejects when sensorId is null', async () => {
    const connectInfluxDB = vi.fn();
    const getInfluxWriteApi = vi.fn();
    const { saveTelemetryPoint } = loadServiceWithMocks({ connectInfluxDB, getInfluxWriteApi });

    await expect(saveTelemetryPoint(null, 23.5)).rejects.toThrow('sensorId é obrigatório');
  });

  it('rejects when sensorId is an empty string', async () => {
    const connectInfluxDB = vi.fn();
    const getInfluxWriteApi = vi.fn();
    const { saveTelemetryPoint } = loadServiceWithMocks({ connectInfluxDB, getInfluxWriteApi });

    await expect(saveTelemetryPoint('', 23.5)).rejects.toThrow('sensorId é obrigatório');
  });

  it('rejects when temperature is a non-numeric string', async () => {
    const connectInfluxDB = vi.fn();
    const getInfluxWriteApi = vi.fn();
    const { saveTelemetryPoint } = loadServiceWithMocks({ connectInfluxDB, getInfluxWriteApi });

    await expect(saveTelemetryPoint('sensor-1', 'abc')).rejects.toThrow('temperature deve ser numérica');
    expect(connectInfluxDB).not.toHaveBeenCalled();
  });

  it('rejects when temperature is NaN', async () => {
    const connectInfluxDB = vi.fn();
    const getInfluxWriteApi = vi.fn();
    const { saveTelemetryPoint } = loadServiceWithMocks({ connectInfluxDB, getInfluxWriteApi });

    await expect(saveTelemetryPoint('sensor-1', NaN)).rejects.toThrow('temperature deve ser numérica');
  });

  it('rejects when temperature is undefined', async () => {
    const connectInfluxDB = vi.fn();
    const getInfluxWriteApi = vi.fn();
    const { saveTelemetryPoint } = loadServiceWithMocks({ connectInfluxDB, getInfluxWriteApi });

    await expect(saveTelemetryPoint('sensor-1', undefined)).rejects.toThrow('temperature deve ser numérica');
  });

  it('coerces a numeric string temperature and succeeds', async () => {
    const writePoint = vi.fn();
    const flush = vi.fn().mockResolvedValue(undefined);
    const connectInfluxDB = vi.fn().mockResolvedValue(undefined);
    const getInfluxWriteApi = vi.fn().mockReturnValue({ writePoint, flush });
    const { saveTelemetryPoint } = loadServiceWithMocks({ connectInfluxDB, getInfluxWriteApi });

    const result = await saveTelemetryPoint('sensor-2', '23.5');

    expect(result).toBe(true);
    expect(writePoint).toHaveBeenCalledTimes(1);
  });

  it('succeeds and calls writePoint when timestamp is provided', async () => {
    const writePoint = vi.fn();
    const flush = vi.fn().mockResolvedValue(undefined);
    const connectInfluxDB = vi.fn().mockResolvedValue(undefined);
    const getInfluxWriteApi = vi.fn().mockReturnValue({ writePoint, flush });
    const { saveTelemetryPoint } = loadServiceWithMocks({ connectInfluxDB, getInfluxWriteApi });

    const result = await saveTelemetryPoint('sensor-3', 10, '2024-01-01T00:00:00.000Z');

    expect(result).toBe(true);
    expect(writePoint).toHaveBeenCalledTimes(1);
  });

  it('succeeds and calls writePoint when timestamp is omitted (defaults to now)', async () => {
    const writePoint = vi.fn();
    const flush = vi.fn().mockResolvedValue(undefined);
    const connectInfluxDB = vi.fn().mockResolvedValue(undefined);
    const getInfluxWriteApi = vi.fn().mockReturnValue({ writePoint, flush });
    const { saveTelemetryPoint } = loadServiceWithMocks({ connectInfluxDB, getInfluxWriteApi });

    const result = await saveTelemetryPoint('sensor-4', 10);

    expect(result).toBe(true);
    expect(writePoint).toHaveBeenCalledTimes(1);
  });

  it('rethrows the original error and logs it when flush() rejects', async () => {
    const writePoint = vi.fn();
    const flushError = new Error('influx write failed');
    const flush = vi.fn().mockRejectedValue(flushError);
    const connectInfluxDB = vi.fn().mockResolvedValue(undefined);
    const getInfluxWriteApi = vi.fn().mockReturnValue({ writePoint, flush });
    const loggerError = vi.fn();

    const { saveTelemetryPoint } = loadServiceWithMocks({ connectInfluxDB, getInfluxWriteApi, loggerError });

    await expect(saveTelemetryPoint('sensor-5', 10)).rejects.toBe(flushError);
    expect(loggerError).toHaveBeenCalledTimes(1);
    expect(loggerError.mock.calls[0][0]).toContain('influx write failed');
  });

  // #1518 (RNF025 C8): a late correction of a stored reading keeps the
  // original; InfluxDB would overwrite a point of the same series and time.
  describe('late corrections (#1518, RNF025 C8)', () => {
    const observedAt = new Date('2026-10-10T12:00:00.000Z');

    function loadWith(collectRows) {
      const writePoint = vi.fn();
      const flush = vi.fn().mockResolvedValue(undefined);
      const { saveTelemetryPoint } = loadServiceWithMocks({
        connectInfluxDB: vi.fn().mockResolvedValue(undefined),
        getInfluxWriteApi: vi.fn().mockReturnValue({ writePoint, flush }),
        collectRows,
      });
      return { saveTelemetryPoint, writePoint };
    }

    it('looks up the points stored for the sensor at the reading time, and writes a first reading without a revision', async () => {
      const collectRows = vi.fn().mockResolvedValue([]);
      const { saveTelemetryPoint, writePoint } = loadWith(collectRows);

      await saveTelemetryPoint('sensor-1', 4, observedAt, { telemetryReadingId: 'tr-1' });

      const query = String(collectRows.mock.calls[0][0]);
      expect(query).toContain('range(start: 2026-10-10T12:00:00.000Z, stop: 2026-10-10T12:00:00.001Z)');
      expect(query).toContain('r.sensorId == "sensor-1"');
      expect(query).toContain('r._measurement == "temperature"');
      const line = writePoint.mock.calls[0][0].toLineProtocol();
      expect(line).not.toContain('revision=');
      expect(line).not.toContain('supersedesTelemetryReadingId');
    });

    it('writes a correction of a stored reading as revision 1, naming the reading it supersedes', async () => {
      const { saveTelemetryPoint, writePoint } = loadWith(vi.fn().mockResolvedValue([
        { _time: observedAt.toISOString(), value: 4, telemetryReadingId: 'tr-1' },
      ]));

      await saveTelemetryPoint('sensor-1', 6, observedAt, { telemetryReadingId: 'tr-2' });

      const line = writePoint.mock.calls[0][0].toLineProtocol();
      expect(line).toMatch(/,revision=1[, ]/);
      expect(line).toContain('supersedesTelemetryReadingId="tr-1"');
      expect(line).toContain('telemetryReadingId="tr-2"');
      expect(line).toContain('value=6');
    });

    it('writes a second correction one past the highest stored revision, superseding that one', async () => {
      const { saveTelemetryPoint, writePoint } = loadWith(vi.fn().mockResolvedValue([
        { value: 6, telemetryReadingId: 'tr-2', revision: '1' },
        { value: 4, telemetryReadingId: 'tr-1' },
      ]));

      await saveTelemetryPoint('sensor-1', 7, observedAt, { telemetryReadingId: 'tr-3' });

      const line = writePoint.mock.calls[0][0].toLineProtocol();
      expect(line).toMatch(/,revision=2[, ]/);
      expect(line).toContain('supersedesTelemetryReadingId="tr-2"');
    });

    it('writes nothing and rejects when the stored points cannot be read', async () => {
      const lookupError = new Error('influx query failed');
      const { saveTelemetryPoint, writePoint } = loadWith(vi.fn().mockRejectedValue(lookupError));

      await expect(saveTelemetryPoint('sensor-1', 6, observedAt, { telemetryReadingId: 'tr-2' })).rejects.toBe(lookupError);
      expect(writePoint).not.toHaveBeenCalled();
    });

    it('writes a retry of a stored reading, by its sourceEventId, into that reading\'s series and not as a correction', async () => {
      const { saveTelemetryPoint, writePoint } = loadWith(vi.fn().mockResolvedValue([
        { value: 4, telemetryReadingId: 'tr-1', sourceEventId: 'ev-1' },
        { value: 6, telemetryReadingId: 'tr-2', sourceEventId: 'ev-2', revision: '1' },
      ]));

      await saveTelemetryPoint('sensor-1', 6, observedAt, { telemetryReadingId: 'tr-2', sourceEventId: 'ev-2' });
      await saveTelemetryPoint('sensor-1', 4, observedAt, { telemetryReadingId: 'tr-1', sourceEventId: 'ev-1' });

      const [retryOfCorrection, retryOfOriginal] = writePoint.mock.calls.map(([point]) => point.toLineProtocol());
      expect(retryOfCorrection).toMatch(/,revision=1[, ]/);
      expect(retryOfOriginal).not.toContain('revision=');
      expect(retryOfCorrection).not.toContain('supersedesTelemetryReadingId');
      expect(retryOfOriginal).not.toContain('supersedesTelemetryReadingId');
    });

    it('writes an identical resend with no client sourceEventId, by its payloadHash, into the stored reading\'s series and not as a correction', async () => {
      const { saveTelemetryPoint, writePoint } = loadWith(vi.fn().mockResolvedValue([
        { value: 4, telemetryReadingId: 'tr-1', sourceEventId: 'tr-1', payloadHash: 'h-1' },
      ]));

      await saveTelemetryPoint('sensor-1', 4, observedAt, { telemetryReadingId: 'tr-2', sourceEventId: 'tr-2', payloadHash: 'h-1' });

      const line = writePoint.mock.calls[0][0].toLineProtocol();
      expect(line).not.toContain('revision=');
      expect(line).not.toContain('supersedesTelemetryReadingId');
    });
  });
});
