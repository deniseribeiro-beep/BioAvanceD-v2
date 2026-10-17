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

describe('InfluxTelemetryReadRepository - temperatureReport (RF009 AC1, #1317)', () => {
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

  const queryAt = (index) => String(collectRows.mock.calls[index][0]);

  it('temperatureReport queries both reading measurements of the configured bucket, newest first and limited', async () => {
    await repository.temperatureReport();

    expect(collectRows).toHaveBeenCalledTimes(2);
    const rowsQuery = queryAt(0);
    expect(rowsQuery).toContain('from(bucket: "test-bucket")');
    expect(rowsQuery).toContain('r._measurement == "freezer_temperature" or r._measurement == "temperature"');
    expect(rowsQuery).toContain('pivot(rowKey: ["_time"]');
    expect(rowsQuery).toContain('sort(columns: ["_time"], desc: true)');
    expect(rowsQuery).toContain('limit(n: 100, offset: 0)');
    expect(queryAt(1)).toContain('count(column: "celsius")');
  });

  // The temperature history pages through this method; the count is the
  // whole match, so it carries no limit.
  it('temperatureReport pages the rows by the given offset and leaves the count unlimited', async () => {
    await repository.temperatureReport({ limit: 5, offset: 10 });

    expect(queryAt(0)).toContain('limit(n: 5, offset: 10)');
    expect(queryAt(1)).not.toContain('limit(');
  });

  it('temperatureReport bounds the range by the given start and stop', async () => {
    await repository.temperatureReport({
      start: new Date('2026-01-01T00:00:00.000Z'),
      stop: new Date('2026-02-01T00:00:00.000Z'),
    });

    expect(queryAt(0)).toContain('range(start: 2026-01-01T00:00:00.000Z, stop: 2026-02-01T00:00:00.000Z)');
    expect(queryAt(1)).toContain('range(start: 2026-01-01T00:00:00.000Z, stop: 2026-02-01T00:00:00.000Z)');
  });

  // A reading whose device clock ran ahead (clockStatus drift) is stored at
  // its future observedAt; the Mongo read listed it, so the report must too.
  it('temperatureReport with no stop reads up to InfluxDB\'s far future, not now(), so a clock-ahead reading stays in the report', async () => {
    await repository.temperatureReport();

    for (const query of [queryAt(0), queryAt(1)]) {
      expect(query).toContain('range(start: 1970-01-01T00:00:00.000Z, stop: 2262-01-01T00:00:00.000Z)');
      expect(query).not.toContain('now()');
    }
  });

  it('temperatureReport with a given stop and no start keeps that stop', async () => {
    await repository.temperatureReport({ stop: new Date('2026-02-01T00:00:00.000Z') });

    expect(queryAt(0)).toContain('range(start: 1970-01-01T00:00:00.000Z, stop: 2026-02-01T00:00:00.000Z)');
    expect(queryAt(1)).toContain('range(start: 1970-01-01T00:00:00.000Z, stop: 2026-02-01T00:00:00.000Z)');
  });

  it('temperatureReport restricts the query to the given sensors', async () => {
    await repository.temperatureReport({ sensorIds: ['S1', 'S"2'] });

    expect(queryAt(0)).toContain('contains(value: r.sensorId, set: ["S1","S\\"2"])');
    expect(queryAt(1)).toContain('contains(value: r.sensorId, set: ["S1","S\\"2"])');

    collectRows.mockClear();
    await repository.temperatureReport({ sensorIds: null });

    expect(queryAt(0)).not.toContain('contains(value: r.sensorId');
    expect(queryAt(1)).not.toContain('contains(value: r.sensorId');
  });

  it('temperatureReport with an empty sensor set returns nothing and runs no query', async () => {
    const result = await repository.temperatureReport({ sensorIds: [] });

    expect(result).toEqual({ rows: [], total: 0 });
    expect(collectRows).not.toHaveBeenCalled();
  });

  it('temperatureReport with a start at or after its stop returns nothing and runs no query', async () => {
    const at = new Date('2026-01-01T00:00:00.000Z');

    expect(await repository.temperatureReport({ start: at, stop: at })).toEqual({ rows: [], total: 0 });
    expect(await repository.temperatureReport({ start: new Date('2026-02-01T00:00:00.000Z'), stop: at })).toEqual({ rows: [], total: 0 });
    expect(collectRows).not.toHaveBeenCalled();
  });

  it('temperatureReport converts each reading to Celsius from its temperatureUnit tag', async () => {
    collectRows
      .mockResolvedValueOnce([
        { _time: '2026-10-01T10:04:00Z', _measurement: 'freezer_temperature', sensorId: 'S1', temperatureUnit: '°F', reading: 41 },
        { _time: '2026-10-01T10:03:00Z', _measurement: 'freezer_temperature', sensorId: 'S1', temperatureUnit: 'K', reading: 278.15 },
        { _time: '2026-10-01T10:02:00Z', _measurement: 'freezer_temperature', sensorId: 'S1', temperatureUnit: '°C', reading: 5 },
        { _time: '2026-10-01T10:01:00Z', _measurement: 'temperature', sensorId: 'S2', reading: 5 },
      ])
      .mockResolvedValueOnce([{ celsius: 4 }]);

    const { rows } = await repository.temperatureReport();

    expect(rows.map((row) => row.temperatureValue)).toEqual([41, 278.15, 5, 5]);
    expect(rows.map((row) => row.temperatureUnit)).toEqual(['°F', 'K', '°C', '°C']);
    for (const row of rows) {
      expect(row.temperatureCelsius).toBeCloseTo(5, 6);
    }
    expect(rows[3].measurement).toBe('temperature');
  });

  it('temperatureReport returns rows newest first whatever their order, and the count as total', async () => {
    collectRows
      .mockResolvedValueOnce([
        { _time: '2026-10-01T10:00:00Z', _measurement: 'freezer_temperature', sensorId: 'S1', reading: 1, telemetryReadingId: 'R-old', zone: 'Z1' },
        { _time: '2026-10-01T12:00:00Z', _measurement: 'freezer_temperature', sensorId: 'S1', reading: 3, telemetryReadingId: 'R-new' },
        { _time: '2026-10-01T11:00:00Z', _measurement: 'temperature', sensorId: 'S2', reading: 2, telemetryReadingId: 'R-mid' },
      ])
      .mockResolvedValueOnce([{ celsius: 7 }]);

    const { rows, total } = await repository.temperatureReport();

    expect(total).toBe(7);
    expect(rows.map((row) => row.telemetryReadingId)).toEqual(['R-new', 'R-mid', 'R-old']);
    expect(rows.every((row) => row.logId === row.telemetryReadingId)).toBe(true);
    expect(rows[0].timestamp).toEqual(new Date('2026-10-01T12:00:00Z'));
    expect(rows[2].zone).toBe('Z1');
    expect(rows[0]).not.toHaveProperty('zone');
  });

  it('temperatureReport filters critical readings in Flux by each sensor\'s Celsius bounds and the flagged sensors', async () => {
    await repository.temperatureReport({
      critical: {
        boundsBySensor: new Map([['S1', { min: 2, max: 8 }], ['S2', { max: -70 }]]),
        flaggedSensorIds: ['S3'],
      },
    });

    for (const query of [queryAt(0), queryAt(1)]) {
      expect(query).toContain('(r.sensorId == "S1" and (r.celsius < 2.0 or r.celsius > 8.0))');
      expect(query).toContain('(r.sensorId == "S2" and (r.celsius > -70.0))');
      expect(query).toContain('contains(value: r.sensorId, set: ["S3"])');
      expect(query).toContain('r.temperatureUnit == "°F"');
    }
  });

  it('temperatureReport with a critical filter but no bounds or flagged sensors returns nothing and runs no query', async () => {
    const result = await repository.temperatureReport({
      critical: { boundsBySensor: new Map([['S1', {}]]), flaggedSensorIds: [] },
    });

    expect(result).toEqual({ rows: [], total: 0 });
    expect(collectRows).not.toHaveBeenCalled();
  });

  it('temperatureReport rejects when collectRows rejects', async () => {
    collectRows.mockRejectedValue(new Error('influx down'));

    await expect(repository.temperatureReport()).rejects.toThrow('influx down');
  });
});
