import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';
import fs from 'fs';

const require2 = createRequire(import.meta.url);
const importService = require2('../../src/services/import.service');
const influxTelemetryWriteRepository = require2('../../src/infrastructure/persistence/influxdb/InfluxTelemetryWriteRepository');

const PERSISTED_AT = new Date('2026-10-17T12:00:00.000Z');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const tmpFiles = [];

function writeTmpFile(name, content) {
  const filePath = path.join(os.tmpdir(), `import-service-${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
  fs.writeFileSync(filePath, content);
  tmpFiles.push(filePath);
  return filePath;
}

afterEach(() => {
  while (tmpFiles.length) {
    const f = tmpFiles.pop();
    try { fs.unlinkSync(f); } catch (_) { /* already gone */ }
  }
});

describe('ImportService.importLocations (disabled, #466)', () => {
  it('always rejects, since the legacy locations collection is read-only during the transition (#457)', async () => {
    await expect(importService.importLocations()).rejects.toThrow(/desativada/);
  });
});

describe('ImportService.importTemperature', () => {
  let write;

  beforeEach(() => {
    write = vi.spyOn(influxTelemetryWriteRepository, 'writeTemperatureReadingNow').mockResolvedValue(PERSISTED_AT);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // #1175: .pipe() does not forward the SOURCE stream's 'error', so a missing
  // file was an uncaught exception that crashed the process (or the
  // temperature worker) instead of this rejection.
  it('rejects when the CSV file does not exist (#1175)', async () => {
    const missingPath = path.join(os.tmpdir(), `import-service-missing-${Date.now()}-temps.csv`);
    const db = { collection: () => ({ insertOne: async () => ({ insertedId: 't1' }) }) };

    await expect(importService.importTemperature(db, { path: missingPath, originalname: 'temps.csv' }))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('imports a valid temperature CSV row', async () => {
    const filePath = writeTmpFile('temps.csv', 'sensorId,temperatureValue\nS1,-20\n');
    const inserted = [];
    const db = {
      collection: () => ({
        insertOne: async (doc) => { inserted.push(doc); return { insertedId: 't1' }; },
      }),
    };

    const result = await importService.importTemperature(db, { path: filePath, originalname: 'temps.csv' });

    expect(result).toEqual({ success: 1, errors: [], total: 1 });
    expect(inserted[0].sensorId).toBe('S1');
    expect(inserted[0].temperatureValue).toBe(-20);
  });

  it('records a validation error for a row missing sensorId and still counts it in total', async () => {
    const filePath = writeTmpFile('temps-missing-sensor.csv', 'sensorId,temperatureValue\n,-5\n');
    const inserted = [];
    const db = {
      collection: () => ({
        insertOne: async (doc) => { inserted.push(doc); return { insertedId: 't1' }; },
      }),
    };

    const result = await importService.importTemperature(db, { path: filePath, originalname: 'temps-missing-sensor.csv' });

    expect(result.success).toBe(0);
    expect(result.total).toBe(1);
    expect(result.errors).toEqual([
      expect.objectContaining({ errors: expect.arrayContaining(['sensorId é obrigatório']) }),
    ]);
    expect(inserted).toHaveLength(0);
    expect(write).not.toHaveBeenCalled();
  });

  it('rejects a garbage temperatureValue instead of silently inserting NaN (issue #77)', async () => {
    const filePath = writeTmpFile('temps-garbage-value.csv', 'sensorId,temperatureValue\nS1,not-a-number\n');
    const inserted = [];
    const db = {
      collection: () => ({
        insertOne: async (doc) => { inserted.push(doc); return { insertedId: 't1' }; },
      }),
    };

    const result = await importService.importTemperature(db, { path: filePath, originalname: 'temps-garbage-value.csv' });

    expect(result.success).toBe(0);
    expect(result.errors[0].errors).toEqual(
      expect.arrayContaining(['temperatureValue é obrigatório e deve ser number'])
    );
    expect(inserted).toHaveLength(0);
    expect(write).not.toHaveBeenCalled();
  });

  it('rejects an invalid temperatureUnit', async () => {
    const filePath = writeTmpFile('temps-bad-unit.csv', 'sensorId,temperatureValue,temperatureUnit\nS1,10,X\n');
    const db = { collection: () => ({ insertOne: async () => ({ insertedId: 't1' }) }) };

    const result = await importService.importTemperature(db, { path: filePath, originalname: 'temps-bad-unit.csv' });

    expect(result.success).toBe(0);
    expect(result.errors[0].errors).toEqual(expect.arrayContaining(['temperatureUnit deve ser °C, °F ou K']));
    expect(write).not.toHaveBeenCalled();
  });

  it('counts a success and a validation failure, both included in total', async () => {
    const filePath = writeTmpFile('temps-mixed.csv', 'sensorId,temperatureValue\nS1,10\n,20\n');
    const inserted = [];
    const db = {
      collection: () => ({
        insertOne: async (doc) => { inserted.push(doc); return { insertedId: 't1' }; },
      }),
    };

    const result = await importService.importTemperature(db, { path: filePath, originalname: 'temps-mixed.csv' });

    expect(result.total).toBe(2);
    expect(result.success).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(inserted).toHaveLength(1);
  });

  it('records a per-row error without aborting the batch when insertOne throws', async () => {
    const filePath = writeTmpFile('temps-insert-throws.csv', 'sensorId,temperatureValue\nS1,-20\n');
    const db = {
      collection: () => ({
        insertOne: async () => { throw new Error('insert de temperatura falhou'); },
      }),
    };

    const result = await importService.importTemperature(db, { path: filePath, originalname: 'temps-insert-throws.csv' });

    expect(result.success).toBe(0);
    expect(result.errors).toEqual([
      expect.objectContaining({ error: 'insert de temperatura falhou' }),
    ]);
  });

  // #1317 (RF009 AC1): an imported reading goes through the reading contract
  // and the confirmed InfluxDB write, so the stale check, the report and the
  // history, which read InfluxDB, see it.
  it('writes each imported reading to InfluxDB with the reading contract\'s identity, and stores the same reading as the Mongo copy', async () => {
    const observedAt = new Date().toISOString();
    const filePath = writeTmpFile('temps-influx.csv', `sensorId,temperatureValue,temperatureUnit,timestamp\nS1,-20,°C,${observedAt}\n`);
    const inserted = [];
    const db = {
      collection: () => ({
        insertOne: async (doc) => { inserted.push(doc); return { insertedId: 't1' }; },
      }),
    };

    const result = await importService.importTemperature(db, { path: filePath, originalname: 'temps-influx.csv' });

    expect(result).toEqual({ success: 1, errors: [], total: 1 });
    expect(write).toHaveBeenCalledTimes(1);
    const written = write.mock.calls[0][0];
    expect(written).toMatchObject({ sensorId: 'S1', temperatureValue: -20, ingestionService: 'temperature-import' });
    expect(written.telemetryReadingId).toMatch(UUID);
    expect(written.observedAt.toISOString()).toBe(observedAt);
    expect(inserted[0].telemetryReadingId).toBe(written.telemetryReadingId);
    expect(inserted[0].persistedAt).toBe(PERSISTED_AT);
  });

  it('writes InfluxDB before the Mongo copy', async () => {
    const filePath = writeTmpFile('temps-order.csv', 'sensorId,temperatureValue\nS1,-20\n');
    const order = [];
    write.mockImplementation(async () => { order.push('influx'); return PERSISTED_AT; });
    const db = {
      collection: () => ({
        insertOne: async () => { order.push('mongo'); return { insertedId: 't1' }; },
      }),
    };

    await importService.importTemperature(db, { path: filePath, originalname: 'temps-order.csv' });

    expect(order).toEqual(['influx', 'mongo']);
  });

  it('an InfluxDB write failure is a row error and stores no Mongo copy', async () => {
    const filePath = writeTmpFile('temps-influx-down.csv', 'sensorId,temperatureValue\nS1,-20\n');
    write.mockRejectedValue(new Error('influx down'));
    const inserted = [];
    const db = {
      collection: () => ({
        insertOne: async (doc) => { inserted.push(doc); return { insertedId: 't1' }; },
      }),
    };

    const result = await importService.importTemperature(db, { path: filePath, originalname: 'temps-influx-down.csv' });

    expect(result).toMatchObject({ success: 0, total: 1 });
    expect(result.errors[0].error).toContain('InfluxDB');
    expect(result.errors[0].error).toContain('influx down');
    expect(inserted).toHaveLength(0);
  });

  it('a reading the contract finds implausible is a row error and is written nowhere', async () => {
    const filePath = writeTmpFile('temps-implausible.csv', 'sensorId,temperatureValue\nS1,9999\n');
    const inserted = [];
    const db = {
      collection: () => ({
        insertOne: async (doc) => { inserted.push(doc); return { insertedId: 't1' }; },
        insertMany: async (docs) => ({ insertedCount: docs.length }),
      }),
    };

    const result = await importService.importTemperature(db, { path: filePath, originalname: 'temps-implausible.csv' });

    expect(result.success).toBe(0);
    expect(result.errors[0].error).toMatch(/plausível/);
    expect(write).not.toHaveBeenCalled();
    expect(inserted.filter((doc) => doc.temperatureValue !== undefined)).toHaveLength(0);
  });

  it('a historic timestamp keeps its observedAt and is recorded with clockStatus unknown, not drift', async () => {
    const filePath = writeTmpFile('temps-historic.csv', 'sensorId,temperatureValue,temperatureUnit,timestamp\nS1,-20,°C,2020-01-01T00:00:00Z\n');
    const inserted = [];
    const db = {
      collection: () => ({
        insertOne: async (doc) => { inserted.push(doc); return { insertedId: 't1' }; },
        insertMany: async (docs) => ({ insertedCount: docs.length }),
      }),
    };

    await importService.importTemperature(db, { path: filePath, originalname: 'temps-historic.csv' });

    const written = write.mock.calls[0][0];
    expect(written.clockStatus).toBe('unknown');
    expect(written.observedAt.toISOString()).toBe('2020-01-01T00:00:00.000Z');
    expect(inserted).toHaveLength(1);
  });
});
