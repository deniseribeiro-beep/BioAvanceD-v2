import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const env = require('../../../src/config/env');
const servicePath = require.resolve('../../../src/services/drop-legacy-locations-collection.service');
const { dropLegacyLocationsCollection } = require(servicePath);

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
  const originalBackupDir = env.BACKUP_DIR;

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
    env.BACKUP_DIR = originalBackupDir;
    vi.restoreAllMocks();
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

  // #893: pins the backup-directory precedence order -- an explicit
  // `backupDir` argument beats env.BACKUP_DIR, which beats the
  // __dirname-relative fallback -- mirroring backup.service.js's
  // getBackupBaseDir resolution.
  describe('backup directory resolution precedence', () => {
    it('uses the explicit backupDir argument even when env.BACKUP_DIR is set', async () => {
      const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locations-backup-env-'));
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locations-backup-arg-'));
      env.BACKUP_DIR = envDir;
      const db = createFakeDb({ locations: [] });

      try {
        const result = await dropLegacyLocationsCollection(db, { backupDir: tmpDir });

        expect(path.dirname(result.backupPath)).toBe(tmpDir);
      } finally {
        fs.rmSync(envDir, { recursive: true, force: true });
      }
    });

    it('uses env.BACKUP_DIR when no explicit backupDir is passed', async () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locations-backup-env-'));
      env.BACKUP_DIR = tmpDir;
      const db = createFakeDb({ locations: [] });

      const result = await dropLegacyLocationsCollection(db);

      expect(path.dirname(result.backupPath)).toBe(tmpDir);
    });

    it('falls back to the __dirname-relative backups dir when neither backupDir nor env.BACKUP_DIR is set', async () => {
      env.BACKUP_DIR = undefined;
      const expectedDir = path.join(path.dirname(servicePath), '..', '..', 'backups');
      vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
      vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
      const db = createFakeDb({ locations: [] });

      const result = await dropLegacyLocationsCollection(db);

      expect(path.dirname(result.backupPath)).toBe(expectedDir);
      expect(fs.mkdirSync).toHaveBeenCalledWith(expectedDir, { recursive: true });
    });
  });
});
