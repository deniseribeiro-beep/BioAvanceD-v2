import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const { dropLegacyLocationsCollection } = require('../../../src/services/drop-legacy-locations-collection.service');

function createFakeDb({ locations = [], collectionExists = true } = {}) {
  let dropped = false;
  const locationsCollection = {
    find() {
      return { toArray: async () => locations };
    },
    async drop() {
      dropped = true;
    },
  };
  return {
    collection(name) {
      if (name !== 'locations') throw new Error(`unexpected collection: ${name}`);
      return locationsCollection;
    },
    listCollections() {
      return { toArray: async () => (collectionExists ? [{ name: 'locations' }] : []) };
    },
    get dropped() {
      return dropped;
    },
  };
}

describe('drop-legacy-locations-collection.service', () => {
  let tmpDir;

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  it('backs up every document to a JSON file before dropping the collection', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locations-backup-'));
    const docs = [
      { locationID: 101, equipmentID: 5, block: 1, rack: 2, box: 3, wellPosition: 'A1' },
      { locationID: 102, equipmentID: 5, block: 1, rack: 2, box: 4, wellPosition: 'B1' },
    ];
    const db = createFakeDb({ locations: docs });

    const result = await dropLegacyLocationsCollection(db, { backupDir: tmpDir });

    expect(result.backedUpCount).toBe(2);
    expect(result.dropped).toBe(true);
    expect(db.dropped).toBe(true);
    expect(fs.existsSync(result.backupPath)).toBe(true);
    const backedUp = JSON.parse(fs.readFileSync(result.backupPath, 'utf-8'));
    expect(backedUp).toEqual(docs);
  });

  it('is a no-op drop (but still backs up) when the collection does not exist', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locations-backup-'));
    const db = createFakeDb({ locations: [], collectionExists: false });

    const result = await dropLegacyLocationsCollection(db, { backupDir: tmpDir });

    expect(result.backedUpCount).toBe(0);
    expect(result.dropped).toBe(false);
    expect(db.dropped).toBe(false);
    expect(fs.existsSync(result.backupPath)).toBe(true);
  });
});
