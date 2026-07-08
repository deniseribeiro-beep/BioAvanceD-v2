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

function makeLocationsCollection({ existingByLocationID = {}, lastLocationID = null } = {}) {
  const inserted = [];
  return {
    inserted,
    findOne: async (query = {}, options = {}) => {
      if (options.sort) {
        // generateUniqueLocationID's "find the max" lookup
        return lastLocationID !== null ? { locationID: lastLocationID } : null;
      }
      if (query.locationID !== undefined) {
        return existingByLocationID[query.locationID] || null;
      }
      return null;
    },
    insertOne: async (doc) => {
      inserted.push(doc);
      return { insertedId: `loc-${inserted.length}` };
    },
  };
}

describe('ImportService.importLocations (JSON)', () => {
  it('imports a valid single-object JSON payload and assigns success', async () => {
    const filePath = writeTmpFile('location.json', JSON.stringify({
      locationID: 10,
      equipmentType: 1,
      block: 2,
      rack: 3,
    }));
    const collection = makeLocationsCollection();
    const db = { collection: () => collection };

    const result = await importService.importLocations(db, { path: filePath, originalname: 'location.json' });

    expect(result).toEqual({ success: 1, errors: [], total: 1 });
    expect(collection.inserted).toHaveLength(1);
    expect(collection.inserted[0].locationID).toBe(10);
  });

  it('imports an array of JSON locations, counting successes independently', async () => {
    const filePath = writeTmpFile('locations-array.json', JSON.stringify([
      { locationID: 1, equipmentType: 1 },
      { locationID: 2, equipmentType: 2 },
    ]));
    const collection = makeLocationsCollection();
    const db = { collection: () => collection };

    const result = await importService.importLocations(db, { path: filePath, originalname: 'locations-array.json' });

    expect(result.success).toBe(2);
    expect(result.total).toBe(2);
    expect(collection.inserted).toHaveLength(2);
  });

  it('records a parse error without stopping the batch', async () => {
    const filePath = writeTmpFile('bad-number.json', JSON.stringify([
      { locationID: 'not-a-number', equipmentType: 1 },
      { locationID: 5, equipmentType: 1 },
    ]));
    const collection = makeLocationsCollection();
    const db = { collection: () => collection };

    const result = await importService.importLocations(db, { path: filePath, originalname: 'bad-number.json' });

    expect(result.total).toBe(2);
    expect(result.success).toBe(1);
    expect(result.errors).toEqual([
      expect.objectContaining({ row: 1, errors: ['locationID inválido'] }),
    ]);
  });

  it('records a model-validation error when equipmentType is missing', async () => {
    const filePath = writeTmpFile('missing-equipment.json', JSON.stringify({ locationID: 1 }));
    const collection = makeLocationsCollection();
    const db = { collection: () => collection };

    const result = await importService.importLocations(db, { path: filePath, originalname: 'missing-equipment.json' });

    expect(result.success).toBe(0);
    expect(result.errors).toEqual([
      expect.objectContaining({ errors: expect.arrayContaining(['equipmentType é obrigatório']) }),
    ]);
  });

  it('rejects a locationID that already exists', async () => {
    const filePath = writeTmpFile('duplicate.json', JSON.stringify({ locationID: 7, equipmentType: 1 }));
    const collection = makeLocationsCollection({ existingByLocationID: { 7: { locationID: 7 } } });
    const db = { collection: () => collection };

    const result = await importService.importLocations(db, { path: filePath, originalname: 'duplicate.json' });

    expect(result.success).toBe(0);
    expect(result.errors).toEqual([
      expect.objectContaining({ errors: ['locationID 7 já existe'] }),
    ]);
    expect(collection.inserted).toHaveLength(0);
  });

  it('auto-generates a locationID when none is provided', async () => {
    const filePath = writeTmpFile('no-id.json', JSON.stringify({ equipmentType: 1 }));
    const collection = makeLocationsCollection({ lastLocationID: 41 });
    const db = { collection: () => collection };

    const result = await importService.importLocations(db, { path: filePath, originalname: 'no-id.json' });

    expect(result.success).toBe(1);
    expect(collection.inserted[0].locationID).toBe(42);
  });
});

describe('ImportService.importLocations (CSV)', () => {
  it('imports a valid CSV row', async () => {
    const filePath = writeTmpFile('locations.csv', 'locationID,equipmentType,block,rack,drawer,box\n20,1,3,1,1,1\n');
    const collection = makeLocationsCollection();
    const db = { collection: () => collection };

    const result = await importService.importLocations(db, { path: filePath, originalname: 'locations.csv' });

    expect(result.success).toBe(1);
    expect(collection.inserted[0].locationID).toBe(20);
  });

  it('short-circuits with a structural error when required CSV columns are missing', async () => {
    const filePath = writeTmpFile('bad-structure.csv', 'foo,bar\n1,2\n');
    const collection = makeLocationsCollection();
    const db = { collection: () => collection };

    const result = await importService.importLocations(db, { path: filePath, originalname: 'bad-structure.csv' });

    expect(result.success).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].row).toBe(0);
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
});
