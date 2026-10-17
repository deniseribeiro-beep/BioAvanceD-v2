import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The repository reads the connection through property access, so spying on
// the real, already-loaded connection module reaches the code under test.
const influxConnection = require('../../src/infrastructure/database/influxdb/connection');
const repository = require('../../src/infrastructure/persistence/influxdb/InfluxTelemetryReadRepository');

describe('InfluxTelemetryReadRepository - lastReadingAtBySensor (RF009 AC1, #1317)', () => {
  let collectRows;

  beforeEach(() => {
    collectRows = vi.fn().mockResolvedValue([]);
    vi.spyOn(influxConnection, 'connectInfluxDB').mockResolvedValue(undefined);
    vi.spyOn(influxConnection, 'getInfluxConfig').mockReturnValue({ bucket: 'test-bucket' });
    vi.spyOn(influxConnection, 'getInfluxQueryApi').mockReturnValue({ collectRows });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('queries both reading measurements of the configured bucket with no time window', async () => {
    await repository.lastReadingAtBySensor();

    expect(collectRows).toHaveBeenCalledTimes(1);
    const flux = collectRows.mock.calls[0][0];
    expect(flux).toContain('from(bucket: "test-bucket")');
    expect(flux).toContain('range(start: 0)');
    expect(flux).toContain('r._measurement == "freezer_temperature" and r._field == "temperatureValue"');
    expect(flux).toContain('r._measurement == "temperature" and r._field == "value"');
  });

  it('keeps the later _time of one sensor across measurements, later row last', async () => {
    collectRows.mockResolvedValue([
      { sensorId: 'S1', _time: '2026-10-01T10:00:00Z' },
      { sensorId: 'S1', _time: '2026-10-01T12:00:00Z' }
    ]);

    const result = await repository.lastReadingAtBySensor();

    expect(result.get('S1')).toEqual(new Date('2026-10-01T12:00:00Z'));
  });

  it('keeps the later _time of one sensor across measurements, later row first', async () => {
    collectRows.mockResolvedValue([
      { sensorId: 'S1', _time: '2026-10-01T12:00:00Z' },
      { sensorId: 'S1', _time: '2026-10-01T10:00:00Z' }
    ]);

    const result = await repository.lastReadingAtBySensor();

    expect(result.get('S1')).toEqual(new Date('2026-10-01T12:00:00Z'));
  });

  it('skips a row with no sensorId or an unparseable _time', async () => {
    collectRows.mockResolvedValue([
      { _time: '2026-10-01T12:00:00Z' },
      { sensorId: 'S2', _time: 'not-a-time' },
      { sensorId: 'S3', _time: '2026-10-01T12:00:00Z' }
    ]);

    const result = await repository.lastReadingAtBySensor();

    expect([...result.keys()]).toEqual(['S3']);
  });

  it('keys a numeric sensorId as its string', async () => {
    collectRows.mockResolvedValue([{ sensorId: 42, _time: '2026-10-01T12:00:00Z' }]);

    const result = await repository.lastReadingAtBySensor();

    expect(result.has('42')).toBe(true);
    expect(result.has(42)).toBe(false);
  });

  it('rejects when the query rejects', async () => {
    collectRows.mockRejectedValue(new Error('influx down'));

    await expect(repository.lastReadingAtBySensor()).rejects.toThrow('influx down');
  });
});
