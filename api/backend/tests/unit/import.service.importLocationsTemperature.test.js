import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';
import fs from 'fs';

const require2 = createRequire(import.meta.url);
const importService = require2('../../src/services/import.service');

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
  });

  it('rejects an invalid temperatureUnit', async () => {
    const filePath = writeTmpFile('temps-bad-unit.csv', 'sensorId,temperatureValue,temperatureUnit\nS1,10,X\n');
    const db = { collection: () => ({ insertOne: async () => ({ insertedId: 't1' }) }) };

    const result = await importService.importTemperature(db, { path: filePath, originalname: 'temps-bad-unit.csv' });

    expect(result.success).toBe(0);
    expect(result.errors[0].errors).toEqual(expect.arrayContaining(['temperatureUnit deve ser °C, °F ou K']));
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
});
