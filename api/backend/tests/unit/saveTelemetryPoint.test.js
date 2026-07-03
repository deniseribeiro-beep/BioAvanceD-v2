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
function loadServiceWithMocks({ connectInfluxDB, getInfluxWriteApi, loggerError }) {
  delete require.cache[connectionPath];
  delete require.cache[servicePath];
  delete require.cache[loggerPath];

  const connectionModule = require(connectionPath);
  connectionModule.connectInfluxDB = connectInfluxDB;
  connectionModule.getInfluxWriteApi = getInfluxWriteApi;

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
});
