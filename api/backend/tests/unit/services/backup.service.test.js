import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cp = require('child_process');
const mongodb = require('mongodb');
const logger = require('../../../src/utils/logger');
const env = require('../../../src/config/env');
const backupStores = require('../../../src/services/backup-stores.service');
const backupOffsite = require('../../../src/services/backup-offsite.service');

// Note on `exec` and `MongoClient`: backup.service.js does
// `const { exec } = require('child_process')` and
// `const { MongoClient } = require('mongodb')` at module scope, so per this
// repo's testing conventions, vi.spyOn on the exporting module after that
// destructuring has already run would have no effect. We work around this by
// spying on the exporting module's export BEFORE requiring backup.service.js
// fresh (clearing the require cache), so the destructuring inside
// backup.service.js re-runs and picks up our mocked function/class.
const backupServicePath = require.resolve('../../../src/services/backup.service');

function freshBackupService() {
  delete require.cache[backupServicePath];
  return require(backupServicePath);
}

describe('backup.service', () => {
  const originalMongoUri = env.MONGO_URI;
  const originalMongoDb = env.MONGO_DB;
  const originalBackupDir = env.BACKUP_DIR;
  const originalRetentionDays = env.BACKUP_RETENTION_DAYS;

  beforeEach(() => {
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    // #1325: these cases mock fs, so the Neo4j/InfluxDB exports are replaced
    // by their not-configured result unless a case says otherwise.
    vi.spyOn(backupStores, 'exportSecondaryStores').mockResolvedValue({
      neo4j: { status: 'skipped', reason: 'not_configured' },
      influxdb: { status: 'skipped', reason: 'not_configured' },
    });
    // #1325 (RNF010 C1): the off-site upload is replaced by its
    // not-configured result unless a case says otherwise.
    vi.spyOn(backupOffsite, 'uploadBackupRunOffsite').mockResolvedValue({ status: 'skipped', reason: 'not_configured' });
  });

  // #1325: an exported-shaped stores result, distinct from the default above.
  const EXPORTED_STORES = {
    neo4j: { status: 'exported', database: 'neo4j', nodes: 3, relationships: 2, files: [{ file: 'neo4j/nodes.ndjson', encrypted: false }] },
    influxdb: { status: 'exported', bucket: 'bucket', org: 'org', points: 5, files: [{ file: 'influxdb/points.ndjson', encrypted: false }] },
  };

  afterEach(() => {
    vi.restoreAllMocks();
    env.MONGO_URI = originalMongoUri;
    env.MONGO_DB = originalMongoDb;
    env.BACKUP_DIR = originalBackupDir;
    env.BACKUP_RETENTION_DAYS = originalRetentionDays;
    delete require.cache[backupServicePath];
  });

  // #1325: runBackup aborts when its encryption policy cannot be read, so the
  // cases that exercise performBackup's own paths pass a db whose policy
  // explicitly turns encryption off.
  function plaintextPolicyDb() {
    const backupPolicyFindOne = vi.fn().mockResolvedValue({ encryptionEnabled: false });
    const insertOne = vi.fn().mockResolvedValue({ insertedId: 'history-1' });
    return {
      collection: vi.fn((name) => {
        if (name === 'backup_policy') return { findOne: backupPolicyFindOne };
        return { insertOne };
      }),
    };
  }

  describe('getBackupBaseDir', () => {
    it('returns env.BACKUP_DIR when set', () => {
      env.BACKUP_DIR = '/custom/backups';
      const backupService = freshBackupService();
      expect(backupService.getBackupBaseDir()).toBe('/custom/backups');
    });

    it('falls back to a backups dir relative to the service file when env.BACKUP_DIR is unset', () => {
      env.BACKUP_DIR = undefined;
      const backupService = freshBackupService();
      const expected = path.join(path.dirname(backupServicePath), '..', '..', 'backups');
      expect(backupService.getBackupBaseDir()).toBe(expected);
    });
  });

  describe('runBackup', () => {
    it('skips and returns a skipped result when MONGO_URI is not configured', async () => {
      env.MONGO_URI = undefined;
      const backupService = freshBackupService();

      const result = await backupService.runBackup(plaintextPolicyDb());

      expect(result).toEqual({ success: false, skipped: true, reason: 'missing_mongo_uri' });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('MONGO_URI'));
    });

    it('runs mongodump successfully, cleans up old backups, and returns success with the backup path', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = undefined;
      env.BACKUP_DIR = path.join('C:', 'tmp', 'backup-service-test-basedir-1');
      env.BACKUP_RETENTION_DAYS = undefined;

      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([]);
      vi.spyOn(fs.promises, 'writeFile').mockResolvedValue();

      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => {
        cb(null, 'ok stdout', '');
      });

      const backupService = freshBackupService();
      const result = await backupService.runBackup(plaintextPolicyDb());

      expect(result.success).toBe(true);
      expect(result.path).toContain(env.BACKUP_DIR);
      expect(result.mode).toBe('mongodump');
      // #723 (RF013 AC#3): fs.promises.readdir is mocked to [] above, so
      // this is the sha256 of zero files -- a deterministic 64-hex digest.
      expect(result.checksum).toMatch(/^[0-9a-f]{64}$/);
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('manifest.json'),
        expect.stringContaining('"type": "mongodump"'),
        'utf8'
      );
      expect(cp.exec).toHaveBeenCalledWith(
        expect.stringContaining('mongodump --uri="mongodb://localhost:27017/test"'),
        { windowsHide: true },
        expect.any(Function)
      );
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Backup concluído'));
    });

    it('includes --db arg in the mongodump command when env.MONGO_DB is set', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = 'mydb';
      env.BACKUP_DIR = path.join('C:', 'tmp', 'backup-service-test-basedir-2');
      env.BACKUP_RETENTION_DAYS = undefined;

      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([]);
      vi.spyOn(fs.promises, 'writeFile').mockResolvedValue();

      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => {
        cb(null, 'ok', '');
      });

      const backupService = freshBackupService();
      await backupService.runBackup(plaintextPolicyDb());

      expect(cp.exec).toHaveBeenCalledWith(
        expect.stringContaining('--db="mydb"'),
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('falls back to a JSON backup via MongoClient when mongodump binary is missing', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = undefined;
      env.BACKUP_DIR = path.join('C:', 'tmp', 'backup-service-test-basedir-3');
      env.BACKUP_RETENTION_DAYS = undefined;

      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([]);
      vi.spyOn(fs.promises, 'writeFile').mockResolvedValue();

      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => {
        cb({ message: "'mongodump' is not recognized as an internal or external command" }, '', 'is not recognized');
      });

      const fakeCollectionA = {
        find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([{ _id: 1, name: 'a' }]) }))
      };
      const fakeCollectionB = {
        find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) }))
      };
      const fakeDb = {
        listCollections: vi.fn(() => ({
          toArray: vi.fn().mockResolvedValue([{ name: 'patients' }, { name: 'samples' }])
        })),
        collection: vi.fn((name) => (name === 'patients' ? fakeCollectionA : fakeCollectionB))
      };
      const fakeClient = {
        connect: vi.fn().mockResolvedValue(),
        db: vi.fn(() => fakeDb),
        close: vi.fn().mockResolvedValue()
      };
      vi.spyOn(mongodb, 'MongoClient').mockImplementation(function () { return fakeClient; });

      const backupService = freshBackupService();
      const result = await backupService.runBackup(plaintextPolicyDb());

      expect(result.success).toBe(true);
      expect(result.mode).toBe('json-fallback');
      expect(result.collections).toBe(2);
      expect(fakeClient.connect).toHaveBeenCalled();
      expect(fakeClient.close).toHaveBeenCalled();
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('patients.json'),
        expect.stringContaining('"name": "a"'),
        'utf8'
      );
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('manifest.json'),
        expect.any(String),
        'utf8'
      );
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('fallback'));
    });

    it('returns a failure result when the JSON fallback itself throws', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = undefined;
      env.BACKUP_DIR = path.join('C:', 'tmp', 'backup-service-test-basedir-4');
      env.BACKUP_RETENTION_DAYS = undefined;

      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});

      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => {
        cb({ message: 'mongodump: not found' }, '', '');
      });

      const fakeClient = {
        connect: vi.fn().mockRejectedValue(new Error('connection refused')),
        db: vi.fn(),
        close: vi.fn().mockResolvedValue()
      };
      vi.spyOn(mongodb, 'MongoClient').mockImplementation(function () { return fakeClient; });

      const backupService = freshBackupService();
      const result = await backupService.runBackup(plaintextPolicyDb());

      expect(result.success).toBe(false);
      expect(result.error).toContain('connection refused');
      expect(logger.error).toHaveBeenCalledWith('Erro no fallback de backup JSON:', 'connection refused');
    });

    it('returns a generic failure result when mongodump fails for a non-missing-binary reason', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = undefined;
      env.BACKUP_DIR = path.join('C:', 'tmp', 'backup-service-test-basedir-5');
      env.BACKUP_RETENTION_DAYS = undefined;

      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});

      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => {
        cb({ message: 'authentication failed' }, '', 'auth error');
      });

      const backupService = freshBackupService();
      const result = await backupService.runBackup(plaintextPolicyDb());

      expect(result).toEqual({ success: false, error: 'authentication failed' });
      expect(logger.error).toHaveBeenCalledWith('Erro ao executar backup:', 'authentication failed');
    });

    it('records the Neo4j and InfluxDB exports in the mongodump manifest and the run result (#1325)', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = undefined;
      env.BACKUP_DIR = path.join('C:', 'tmp', 'backup-service-test-basedir-6');
      env.BACKUP_RETENTION_DAYS = undefined;

      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([]);
      vi.spyOn(fs.promises, 'writeFile').mockResolvedValue();
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => {
        cb(null, 'ok stdout', '');
      });
      backupStores.exportSecondaryStores.mockResolvedValue(EXPORTED_STORES);

      const backupService = freshBackupService();
      const result = await backupService.runBackup(plaintextPolicyDb());

      expect(result.success).toBe(true);
      expect(result.stores).toEqual(EXPORTED_STORES);
      expect(backupStores.exportSecondaryStores).toHaveBeenCalledWith(result.path, false);
      const manifestWrite = fs.promises.writeFile.mock.calls.find(([filePath]) => String(filePath).endsWith('manifest.json'));
      expect(JSON.parse(manifestWrite[1]).stores).toEqual(EXPORTED_STORES);
    });

    // #1325: the outer catch's dumpBinaryMissing test matched ENOENT before
    // #1437, so a store error carrying it was answered before that catch;
    // the inner catch also keeps the result shape.
    it('fails the run naming the store, with no manifest and no JSON fallback, when a store export rejects with ENOENT (#1325)', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = undefined;
      env.BACKUP_DIR = path.join('C:', 'tmp', 'backup-service-test-basedir-7');
      env.BACKUP_RETENTION_DAYS = undefined;

      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([]);
      vi.spyOn(fs.promises, 'writeFile').mockResolvedValue();
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => {
        cb(null, 'ok stdout', '');
      });
      const storeError = 'Backup de Neo4j falhou: connect ENOENT /run/neo4j.sock';
      backupStores.exportSecondaryStores.mockRejectedValue(new Error(storeError));
      const fakeClient = {
        connect: vi.fn().mockRejectedValue(new Error('the JSON fallback must not run')),
        db: vi.fn(),
        close: vi.fn().mockResolvedValue()
      };
      vi.spyOn(mongodb, 'MongoClient').mockImplementation(function () { return fakeClient; });
      const db = plaintextPolicyDb();

      const backupService = freshBackupService();
      const result = await backupService.runBackup(db);

      expect(result).toEqual({ success: false, error: storeError });
      expect(mongodb.MongoClient).not.toHaveBeenCalled();
      expect(fs.promises.writeFile.mock.calls.filter(([filePath]) => String(filePath).endsWith('manifest.json'))).toEqual([]);
      expect(db.collection('backupHistory').insertOne).toHaveBeenCalledWith(expect.objectContaining({ status: 'error', error: storeError }));
    });

    it('records the Neo4j and InfluxDB exports in the JSON-fallback manifest and result (#1325)', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = undefined;
      env.BACKUP_DIR = path.join('C:', 'tmp', 'backup-service-test-basedir-8');
      env.BACKUP_RETENTION_DAYS = undefined;

      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([]);
      vi.spyOn(fs.promises, 'writeFile').mockResolvedValue();
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => {
        cb({ message: "'mongodump' is not recognized as an internal or external command" }, '', 'is not recognized');
      });
      const fakeDb = {
        listCollections: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
        collection: vi.fn()
      };
      const fakeClient = {
        connect: vi.fn().mockResolvedValue(),
        db: vi.fn(() => fakeDb),
        close: vi.fn().mockResolvedValue()
      };
      vi.spyOn(mongodb, 'MongoClient').mockImplementation(function () { return fakeClient; });
      backupStores.exportSecondaryStores.mockResolvedValue(EXPORTED_STORES);

      const backupService = freshBackupService();
      const result = await backupService.runBackup(plaintextPolicyDb());

      expect(result.success).toBe(true);
      expect(result.mode).toBe('json-fallback');
      expect(result.stores).toEqual(EXPORTED_STORES);
      expect(backupStores.exportSecondaryStores).toHaveBeenCalledWith(result.path, false);
      const manifestWrite = fs.promises.writeFile.mock.calls.find(([filePath]) => String(filePath).endsWith('manifest.json'));
      expect(JSON.parse(manifestWrite[1]).stores).toEqual(EXPORTED_STORES);
    });

    it('uploads the run off-site after the manifest is written and returns its result (#1325)', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = undefined;
      env.BACKUP_DIR = path.join('C:', 'tmp', 'backup-service-test-basedir-9');
      env.BACKUP_RETENTION_DAYS = undefined;

      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([]);
      vi.spyOn(fs.promises, 'writeFile').mockResolvedValue();
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => cb(null, 'ok', ''));

      const backupService = freshBackupService();
      const result = await backupService.runBackup(plaintextPolicyDb());

      expect(result.success).toBe(true);
      expect(backupOffsite.uploadBackupRunOffsite).toHaveBeenCalledTimes(1);
      expect(backupOffsite.uploadBackupRunOffsite).toHaveBeenCalledWith(result.path, false);
      const manifestIndex = fs.promises.writeFile.mock.calls.findIndex(([filePath]) => String(filePath).endsWith('manifest.json'));
      expect(manifestIndex).toBeGreaterThanOrEqual(0);
      expect(backupOffsite.uploadBackupRunOffsite.mock.invocationCallOrder[0])
        .toBeGreaterThan(fs.promises.writeFile.mock.invocationCallOrder[manifestIndex]);
      expect(result.offsite).toEqual({ status: 'skipped', reason: 'not_configured' });
    });

    // #1325: the outer catch's dumpBinaryMissing test matched ENOENT before
    // #1437, so an off-site error carrying it was answered before that catch;
    // the inner catch also keeps the result shape.
    it('fails the run keeping path and checksum, with no retention and no JSON fallback, when the off-site upload rejects with ENOENT (#1325)', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = undefined;
      env.BACKUP_DIR = path.join('C:', 'tmp', 'backup-service-test-basedir-10');
      env.BACKUP_RETENTION_DAYS = undefined;

      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([]);
      vi.spyOn(fs.promises, 'writeFile').mockResolvedValue();
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => cb(null, 'ok', ''));
      const offsiteError = 'Cópia off-site falhou: PUT de x falhou (ENOENT).';
      backupOffsite.uploadBackupRunOffsite.mockRejectedValue(new Error(offsiteError));
      vi.spyOn(mongodb, 'MongoClient').mockImplementation(function () {
        throw new Error('the JSON fallback must not run');
      });
      const db = plaintextPolicyDb();

      const backupService = freshBackupService();
      const result = await backupService.runBackup(db);

      expect(result).toEqual({ success: false, error: offsiteError, path: expect.any(String), checksum: expect.stringMatching(/^[0-9a-f]{64}$/) });
      expect(result.path).toContain(env.BACKUP_DIR);
      expect(mongodb.MongoClient).not.toHaveBeenCalled();
      // ensureDirSync(baseDir) at the start; cleanupOldBackups would be the second.
      expect(fs.existsSync.mock.calls.filter(([dirPath]) => dirPath === env.BACKUP_DIR)).toHaveLength(1);
      expect(db.collection('backupHistory').insertOne).toHaveBeenCalledWith(expect.objectContaining({
        status: 'error', error: offsiteError, path: result.path, checksum: result.checksum
      }));
    });

    it('uploads the JSON-fallback run off-site and fails the run when that upload rejects (#1325)', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = undefined;
      env.BACKUP_DIR = path.join('C:', 'tmp', 'backup-service-test-basedir-11');
      env.BACKUP_RETENTION_DAYS = undefined;

      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([]);
      vi.spyOn(fs.promises, 'writeFile').mockResolvedValue();
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => {
        cb({ message: "'mongodump' is not recognized as an internal or external command" }, '', 'is not recognized');
      });
      const fakeDb = {
        listCollections: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
        collection: vi.fn()
      };
      const fakeClient = {
        connect: vi.fn().mockResolvedValue(),
        db: vi.fn(() => fakeDb),
        close: vi.fn().mockResolvedValue()
      };
      vi.spyOn(mongodb, 'MongoClient').mockImplementation(function () { return fakeClient; });
      const offsiteError = 'Cópia off-site falhou: PUT de manifest.json respondeu 500.';
      backupOffsite.uploadBackupRunOffsite.mockRejectedValue(new Error(offsiteError));

      const backupService = freshBackupService();
      const result = await backupService.runBackup(plaintextPolicyDb());

      expect(result).toEqual({ success: false, error: offsiteError });
      expect(backupOffsite.uploadBackupRunOffsite).toHaveBeenCalledTimes(1);
      expect(backupOffsite.uploadBackupRunOffsite.mock.calls[0][1]).toBe(false);
      // ensureDirSync(baseDir) at the start; cleanupOldBackups would be the second.
      expect(fs.existsSync.mock.calls.filter(([dirPath]) => dirPath === env.BACKUP_DIR)).toHaveLength(1);
    });
  });

  // #723 (RF013 AC#1): runBackup(db) persists one history entry per run,
  // regardless of which internal branch produced the result -- this is
  // the actual gap #723 named ("no persisted run-status/result history").
  describe('runBackup history persistence (#723, RF013 AC#1/AC#3)', () => {
    function fakeHistoryDb() {
      const insertOne = vi.fn().mockResolvedValue({ insertedId: 'history-1' });
      const backupPolicyFindOne = vi.fn().mockResolvedValue({ encryptionEnabled: false });
      return {
        db: {
          collection: vi.fn((name) => (name === 'backup_policy' ? { findOne: backupPolicyFindOne } : { insertOne })),
        },
        insertOne,
      };
    }

    // #1325: without a db the encryption policy cannot be read, so the run
    // fails rather than writing a plaintext backup.
    it('fails the run, writing nothing, when no db is passed', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = undefined;
      env.BACKUP_DIR = path.join('C:', 'tmp', 'backup-service-test-history-1');

      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([]);
      vi.spyOn(fs.promises, 'writeFile').mockResolvedValue();
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => cb(null, 'ok', ''));

      const backupService = freshBackupService();
      const result = await backupService.runBackup();

      expect(result.success).toBe(false);
      expect(result.error).toContain('texto plano');
      expect(cp.exec).not.toHaveBeenCalled();
    });

    it('fails the run, writing nothing, when the policy lookup throws', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = undefined;
      env.BACKUP_DIR = path.join('C:', 'tmp', 'backup-service-test-history-5');

      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([]);
      vi.spyOn(fs.promises, 'writeFile').mockResolvedValue();
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => cb(null, 'ok', ''));

      const backupService = freshBackupService();
      const insertOne = vi.fn().mockResolvedValue({ insertedId: 'history-1' });
      const backupPolicyFindOne = vi.fn().mockRejectedValue(new Error('db unavailable'));
      const db = {
        collection: vi.fn((name) => (name === 'backup_policy' ? { findOne: backupPolicyFindOne } : { insertOne })),
      };
      const result = await backupService.runBackup(db);

      expect(result.success).toBe(false);
      expect(result.error).toContain('texto plano');
      expect(cp.exec).not.toHaveBeenCalled();
      expect(db.collection).toHaveBeenCalledWith('backupHistory');
      expect(insertOne).toHaveBeenCalledWith(expect.objectContaining({ status: 'error', error: result.error }));
    });

    it('records a success history entry with the run checksum when db is passed', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = undefined;
      env.BACKUP_DIR = path.join('C:', 'tmp', 'backup-service-test-history-2');

      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([]);
      vi.spyOn(fs.promises, 'writeFile').mockResolvedValue();
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => cb(null, 'ok', ''));

      const backupService = freshBackupService();
      const { db, insertOne } = fakeHistoryDb();
      const result = await backupService.runBackup(db);

      expect(db.collection).toHaveBeenCalledWith('backupHistory');
      expect(insertOne).toHaveBeenCalledWith(expect.objectContaining({
        status: 'success',
        mode: 'mongodump',
        path: result.path,
        checksum: result.checksum,
      }));
    });

    it('records an error history entry (no checksum) when the backup fails', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = undefined;
      env.BACKUP_DIR = path.join('C:', 'tmp', 'backup-service-test-history-3');

      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => {
        cb({ message: 'authentication failed' }, '', 'auth error');
      });

      const backupService = freshBackupService();
      const { db, insertOne } = fakeHistoryDb();
      await backupService.runBackup(db);

      expect(insertOne).toHaveBeenCalledWith(expect.objectContaining({
        status: 'error',
        error: 'authentication failed',
        checksum: null,
      }));
    });

    it('records a skipped history entry when MONGO_URI is not configured', async () => {
      env.MONGO_URI = undefined;

      const backupService = freshBackupService();
      const { db, insertOne } = fakeHistoryDb();
      await backupService.runBackup(db);

      expect(insertOne).toHaveBeenCalledWith(expect.objectContaining({ status: 'skipped' }));
    });

    it('does not fail the backup when the history write itself throws', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = undefined;
      env.BACKUP_DIR = path.join('C:', 'tmp', 'backup-service-test-history-4');

      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([]);
      vi.spyOn(fs.promises, 'writeFile').mockResolvedValue();
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => cb(null, 'ok', ''));

      const backupService = freshBackupService();
      const insertOne = vi.fn().mockRejectedValue(new Error('history db down'));
      const backupPolicyFindOne = vi.fn().mockResolvedValue({ encryptionEnabled: false });
      const db = {
        collection: vi.fn((name) => (name === 'backup_policy' ? { findOne: backupPolicyFindOne } : { insertOne })),
      };

      const result = await backupService.runBackup(db);

      expect(result.success).toBe(true);
      expect(logger.error).toHaveBeenCalledWith('Erro ao registrar histórico de backup:', 'history db down');
    });

    it('records the off-site result in the backupHistory row (#1325)', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = undefined;
      env.BACKUP_DIR = path.join('C:', 'tmp', 'backup-service-test-history-6');

      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([]);
      vi.spyOn(fs.promises, 'writeFile').mockResolvedValue();
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => cb(null, 'ok', ''));
      const uploaded = { status: 'uploaded', bucket: 'biobank-backups', prefix: 'backups/x/', files: 3 };
      backupOffsite.uploadBackupRunOffsite.mockResolvedValue(uploaded);

      const backupService = freshBackupService();
      const { db, insertOne } = fakeHistoryDb();
      const result = await backupService.runBackup(db);

      expect(result.offsite).toEqual(uploaded);
      expect(insertOne).toHaveBeenCalledWith(expect.objectContaining({ status: 'success', offsite: uploaded }));
    });
  });

  // #728: retentionDays now prefers the admin-editable BackupPolicy
  // (backup-policy.service.js) over env.BACKUP_RETENTION_DAYS when a db is
  // passed -- cleanupOldBackups's maxAge is the observable proof, since
  // that's the only place retentionDays actually flows into behavior.
  describe('runBackup retention resolution (#728, RF013 AC#5/AC#6)', () => {
    // 45 days old: stale under a 5- or 30-day retention, not stale under 90.
    const STALE_UNDER_30_NOT_90 = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
    const staleFolderName = STALE_UNDER_30_NOT_90.toISOString().slice(0, 10);

    function mockBaseDirListing(baseDir) {
      vi.spyOn(fs.promises, 'readdir').mockImplementation((dirPath) => {
        if (String(dirPath) === baseDir) {
          return Promise.resolve([{ name: staleFolderName, isDirectory: () => true }]);
        }
        return Promise.resolve([]);
      });
    }

    function dbWithPolicy(policy) {
      const backupPolicyFindOne = vi.fn().mockResolvedValue(policy);
      const historyInsertOne = vi.fn().mockResolvedValue({ insertedId: 'history-1' });
      return {
        collection: vi.fn((name) => {
          if (name === 'backup_policy') return { findOne: backupPolicyFindOne };
          return { insertOne: historyInsertOne };
        }),
      };
    }

    it('uses the policy retentionDays (not the env var) when a db is passed', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = undefined;
      env.BACKUP_DIR = path.join('C:', 'tmp', 'backup-service-test-policy-retention-1');
      env.BACKUP_RETENTION_DAYS = '30';

      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
      mockBaseDirListing(env.BACKUP_DIR);
      vi.spyOn(fs.promises, 'writeFile').mockResolvedValue();
      vi.spyOn(fs.promises, 'rm').mockResolvedValue();
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => cb(null, 'ok', ''));

      const backupService = freshBackupService();
      const db = dbWithPolicy({ retentionDays: 90, encryptionEnabled: false });
      await backupService.runBackup(db);

      // A 45-day-old dated folder is stale under the env var's 30-day
      // retention but not under the policy's 90 -- proves 90 (the
      // policy's value), not 30 (the env var), is what actually governed
      // cleanup.
      expect(fs.promises.rm).not.toHaveBeenCalled();
    });

    it('falls back to the env var when the policy lookup fails', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = undefined;
      env.BACKUP_DIR = path.join('C:', 'tmp', 'backup-service-test-policy-retention-2');
      env.BACKUP_RETENTION_DAYS = '5';

      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
      mockBaseDirListing(env.BACKUP_DIR);
      vi.spyOn(fs.promises, 'writeFile').mockResolvedValue();
      vi.spyOn(fs.promises, 'rm').mockResolvedValue();
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => cb(null, 'ok', ''));

      const backupService = freshBackupService();
      // Retention is read first and fails; the encryption read then succeeds,
      // since a policy that cannot be read for encryption aborts the run (#1325).
      const backupPolicyFindOne = vi.fn()
        .mockRejectedValueOnce(new Error('db unavailable'))
        .mockResolvedValueOnce({ encryptionEnabled: false });
      const historyInsertOne = vi.fn().mockResolvedValue({ insertedId: 'history-1' });
      const db = {
        collection: vi.fn((name) => (name === 'backup_policy' ? { findOne: backupPolicyFindOne } : { insertOne: historyInsertOne })),
      };
      await backupService.runBackup(db);

      // 5-day env-var retention against a 45-day-old folder -- stale, gets removed.
      expect(fs.promises.rm).toHaveBeenCalled();
    });
  });

  describe('cleanupOldBackups', () => {
    it('does nothing when the base dir does not exist', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      const readdirSpy = vi.spyOn(fs.promises, 'readdir');

      const backupService = freshBackupService();
      await backupService.cleanupOldBackups('/nonexistent', 30);

      expect(readdirSpy).not.toHaveBeenCalled();
    });

    it('removes directories older than the retention window based on their date-folder name', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      const oldDirName = '2000-01-01';
      const recentDirName = new Date().toISOString().slice(0, 10);

      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([
        { name: oldDirName, isDirectory: () => true },
        { name: recentDirName, isDirectory: () => true },
        { name: 'not-a-dir.txt', isDirectory: () => false }
      ]);
      const rmSpy = vi.spyOn(fs.promises, 'rm').mockResolvedValue();

      const backupService = freshBackupService();
      await backupService.cleanupOldBackups('/backups', 30);

      expect(rmSpy).toHaveBeenCalledTimes(1);
      expect(rmSpy).toHaveBeenCalledWith(
        path.join('/backups', oldDirName),
        { recursive: true, force: true }
      );
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(oldDirName));
    });

    it('falls back to directory mtime when the folder name has no date prefix', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([
        { name: 'custom-folder', isDirectory: () => true }
      ]);
      const oldMtime = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 days old
      vi.spyOn(fs.promises, 'stat').mockResolvedValue({ mtime: oldMtime });
      const rmSpy = vi.spyOn(fs.promises, 'rm').mockResolvedValue();

      const backupService = freshBackupService();
      await backupService.cleanupOldBackups('/backups', 30);

      expect(rmSpy).toHaveBeenCalledWith(
        path.join('/backups', 'custom-folder'),
        { recursive: true, force: true }
      );
    });

    it('keeps directories within the retention window', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const recentDirName = new Date().toISOString().slice(0, 10);
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([
        { name: recentDirName, isDirectory: () => true }
      ]);
      const rmSpy = vi.spyOn(fs.promises, 'rm').mockResolvedValue();

      const backupService = freshBackupService();
      await backupService.cleanupOldBackups('/backups', 30);

      expect(rmSpy).not.toHaveBeenCalled();
    });

    it('swallows errors and logs them instead of throwing', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs.promises, 'readdir').mockRejectedValue(new Error('disk read error'));

      const backupService = freshBackupService();
      await expect(backupService.cleanupOldBackups('/backups', 30)).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith('Erro ao limpar backups antigos:', 'disk read error');
    });
  });

  describe('restoreBackup', () => {
    it('returns an error result when MONGO_URI is not configured', async () => {
      env.MONGO_URI = undefined;
      const backupService = freshBackupService();

      const result = await backupService.restoreBackup('/some/backup');

      expect(result).toEqual({ success: false, error: 'MONGO_URI não configurado' });
    });

    it('returns an error result when the backup path does not exist', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);

      const backupService = freshBackupService();
      const result = await backupService.restoreBackup('/missing/backup');

      expect(result).toEqual({ success: false, error: 'Backup não encontrado' });
    });

    it('runs mongorestore successfully and returns success with restoredFrom/mode', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = undefined;
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => {
        cb(null, 'restored', '');
      });

      const backupService = freshBackupService();
      const backupPath = path.join('C:', 'tmp', '2026-01-01');
      const result = await backupService.restoreBackup(backupPath);

      expect(result.success).toBe(true);
      expect(result.mode).toBe('mongorestore');
      expect(result.restoredFrom).toBe('2026-01-01');
      expect(cp.exec).toHaveBeenCalledWith(
        expect.stringContaining('mongorestore --uri="mongodb://localhost:27017/" --drop'),
        { windowsHide: true },
        expect.any(Function)
      );
    });

    it('includes --nsInclude arg in the mongorestore command when env.MONGO_DB is set', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = 'mydb';
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => {
        cb(null, 'restored', '');
      });

      const backupService = freshBackupService();
      await backupService.restoreBackup(path.join('C:', 'tmp', 'backup'));

      expect(cp.exec).toHaveBeenCalledWith(
        expect.stringContaining('--nsInclude="mydb.*"'),
        expect.any(Object),
        expect.any(Function)
      );
    });

    // #765: mongorestore reads a database path component in --uri as an
    // implicit --db, which switches it into the single-database use-case
    // where it expects .bson files directly in the directory it is given.
    // `mongodump --out` writes <dir>/<dbName>/*.bson, so mongorestore finds
    // a subdirectory where it wants BSON, skips it, and exits 0 having
    // restored nothing -- the caller's success path then reports success.
    // The URI handed to mongorestore must therefore carry no default db.
    it('hands mongorestore a URI with no default database, keeping the query string (#765)', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/bioavanced_test?replicaSet=rs0';
      env.MONGO_DB = 'bioavanced_test';
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => cb(null, 'restored', ''));

      const backupService = freshBackupService();
      await backupService.restoreBackup(path.join('C:', 'tmp', '2026-01-01'));

      const command = cp.exec.mock.calls[0][0];
      expect(command).toContain('mongorestore --uri="mongodb://localhost:27017/?replicaSet=rs0"');
      expect(command).not.toContain('27017/bioavanced_test');
      // --nsInclude is what actually scopes the restore; it must survive.
      expect(command).toContain('--nsInclude="bioavanced_test.*"');
    });

    it('falls back to JSON restore via manifest.json when mongorestore binary is missing', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = undefined;

      const backupPath = path.join('C:', 'tmp', 'backup-restore-1');

      vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
        // backupPath exists, and its manifest.json exists
        return true;
      });
      vi.spyOn(fs.promises, 'readFile').mockImplementation(async (p) => {
        if (String(p).endsWith('manifest.json')) {
          return JSON.stringify({
            dbName: 'mydb',
            collections: [{ file: 'patients.json' }]
          });
        }
        return JSON.stringify([{ _id: 1, name: 'restored-patient' }]);
      });

      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => {
        cb({ message: 'mongorestore: not found' }, '', 'not found');
      });

      const fakeCollection = {
        deleteMany: vi.fn().mockResolvedValue(),
        insertMany: vi.fn().mockResolvedValue()
      };
      const fakeDb = {
        collection: vi.fn(() => fakeCollection)
      };
      const fakeClient = {
        connect: vi.fn().mockResolvedValue(),
        db: vi.fn(() => fakeDb),
        close: vi.fn().mockResolvedValue()
      };
      vi.spyOn(mongodb, 'MongoClient').mockImplementation(function () { return fakeClient; });

      const backupService = freshBackupService();
      const result = await backupService.restoreBackup(backupPath);

      expect(result.success).toBe(true);
      expect(result.mode).toBe('json-fallback');
      expect(result.collections).toBe(1);
      expect(fakeDb.collection).toHaveBeenCalledWith('patients');
      expect(fakeCollection.deleteMany).toHaveBeenCalledWith({});
      // #858: the JSON fallback parses with BSON.EJSON.parse(raw, { relaxed: false })
      // (backup.service.js:182), deliberately, because plain JSON.parse does not
      // round-trip BSON -- ObjectId _ids came back as strings. Under relaxed:false a
      // bare `1` deserialises to a BSON Int32, not a JS number, so the previous
      // toHaveBeenCalledWith([{ _id: 1, ... }]) could not match. Assert the value
      // rather than the wrapper, so this stays true whichever numeric type the
      // driver hands back.
      expect(fakeCollection.insertMany).toHaveBeenCalledTimes(1);
      const [insertedDocs, insertOptions] = fakeCollection.insertMany.mock.calls[0];
      expect(insertOptions).toEqual({ ordered: false });
      expect(insertedDocs).toHaveLength(1);
      expect(Number(insertedDocs[0]._id)).toBe(1);
      expect(insertedDocs[0].name).toBe('restored-patient');
      expect(fakeClient.close).toHaveBeenCalled();
    });

    it('discovers JSON files by directory listing when the manifest has no collections entry', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = undefined;

      const backupPath = path.join('C:', 'tmp', 'backup-restore-2');

      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs.promises, 'readFile').mockImplementation(async (p) => {
        if (String(p).endsWith('manifest.json')) {
          return JSON.stringify({ dbName: 'mydb' });
        }
        return JSON.stringify([]);
      });
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue(['samples.json', 'manifest.json']);

      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => {
        cb({ message: 'mongorestore: not found' }, '', '');
      });

      const fakeCollection = {
        deleteMany: vi.fn().mockResolvedValue(),
        insertMany: vi.fn().mockResolvedValue()
      };
      const fakeDb = { collection: vi.fn(() => fakeCollection) };
      const fakeClient = {
        connect: vi.fn().mockResolvedValue(),
        db: vi.fn(() => fakeDb),
        close: vi.fn().mockResolvedValue()
      };
      vi.spyOn(mongodb, 'MongoClient').mockImplementation(function () { return fakeClient; });

      const backupService = freshBackupService();
      const result = await backupService.restoreBackup(backupPath);

      expect(result.success).toBe(true);
      expect(result.collections).toBe(1);
      expect(fakeDb.collection).toHaveBeenCalledWith('samples');
    });

    it('returns a failure result when the JSON restore fallback itself throws (no JSON files found)', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = undefined;

      const backupPath = path.join('C:', 'tmp', 'backup-restore-3');

      vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
        // backup path exists, but manifest.json does not
        return !String(p).endsWith('manifest.json');
      });
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([]);

      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => {
        cb({ message: 'mongorestore: not found' }, '', '');
      });

      const fakeClient = {
        connect: vi.fn().mockResolvedValue(),
        db: vi.fn(() => ({ collection: vi.fn() })),
        close: vi.fn().mockResolvedValue()
      };
      vi.spyOn(mongodb, 'MongoClient').mockImplementation(function () { return fakeClient; });

      const backupService = freshBackupService();
      const result = await backupService.restoreBackup(backupPath);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Nenhum arquivo JSON de backup encontrado');
      expect(logger.error).toHaveBeenCalledWith(
        'Erro no fallback de restore JSON:',
        expect.stringContaining('Nenhum arquivo JSON')
      );
    });

    it('returns a generic failure result when mongorestore fails for a non-missing-binary reason', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => {
        cb({ message: 'permission denied' }, '', '');
      });

      const backupService = freshBackupService();
      const result = await backupService.restoreBackup(path.join('C:', 'tmp', 'backup'));

      expect(result).toEqual({ success: false, error: 'permission denied' });
    });
  });

  // #727 (RF013 AC#4): "controlled restore testing" -- restoreBackup() is
  // the only restore path and it's live/destructive (--drop against the
  // configured db). testRestoreBackup() proves a backup is restorable by
  // restoring into a disposable scratch database (never the live one),
  // then tearing the scratch db down -- see backup.service.js's own header
  // comment for the design-call rationale.
  describe('testRestoreBackup', () => {
    // sha256 of zero files hashed -- computeDirChecksum's own deterministic
    // digest when fs.promises.readdir resolves to [] (mirrors the existing
    // runBackup checksum tests' approach above).
    const emptyDirChecksum = crypto.createHash('sha256').digest('hex');

    it('returns an error result when MONGO_URI is not configured', async () => {
      env.MONGO_URI = undefined;
      const backupService = freshBackupService();

      const result = await backupService.testRestoreBackup('/some/backup');

      expect(result).toEqual({ success: false, error: 'MONGO_URI não configurado' });
    });

    it('returns an error result when the backup path does not exist', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);

      const backupService = freshBackupService();
      const result = await backupService.testRestoreBackup('/missing/backup');

      expect(result).toEqual({ success: false, error: 'Backup não encontrado' });
    });

    it('restores into a disposable scratch db (nsFrom/nsTo, never the live db) and tears it down', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = 'mydb';
      const backupPath = path.join('C:', 'tmp', '2026-01-01');

      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs.promises, 'readFile').mockImplementation(async (p) => {
        if (String(p).endsWith('manifest.json')) {
          return JSON.stringify({ dbName: 'mydb', checksum: emptyDirChecksum });
        }
        throw new Error(`unexpected readFile: ${p}`);
      });
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([]);

      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => cb(null, 'restored', ''));

      const dropDatabase = vi.fn().mockResolvedValue();
      // #766: countScratchContents now also counts documents, so the scratch
      // db mock needs collection().countDocuments(). listCollections is
      // called with { type: 'collection' } to exclude views -- a view's
      // countDocuments would double-count its source collection's rows.
      const fakeScratchDb = {
        listCollections: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([{ name: 'patients' }]) })),
        collection: vi.fn(() => ({ countDocuments: vi.fn().mockResolvedValue(7) })),
        dropDatabase
      };
      const fakeClient = {
        connect: vi.fn().mockResolvedValue(),
        db: vi.fn(() => fakeScratchDb),
        close: vi.fn().mockResolvedValue()
      };
      vi.spyOn(mongodb, 'MongoClient').mockImplementation(function () { return fakeClient; });

      const backupService = freshBackupService();
      const result = await backupService.testRestoreBackup(backupPath);

      expect(result.success).toBe(true);
      expect(result.mode).toBe('mongorestore');
      expect(result.checksumVerified).toBe(true);
      expect(result.restoredCollections).toBe(1);
      // #766: the collection count alone is satisfied by a restore that
      // creates every collection and populates none -- one step milder than
      // the #765 no-op, and the same class of silent success. This is what
      // distinguishes them, and what #731's weekly unattended run needs in
      // its history record to be diagnostic rather than merely present.
      expect(result.restoredDocuments).toBe(7);
      expect(fakeScratchDb.listCollections).toHaveBeenCalledWith(
        { type: 'collection' },
        { nameOnly: true }
      );
      expect(result.scratchDb).toMatch(/^mydb_restoretest_\d+$/);

      expect(cp.exec).toHaveBeenCalledWith(
        expect.stringContaining(`--nsFrom="mydb.*" --nsTo="${result.scratchDb}.*"`),
        { windowsHide: true },
        expect.any(Function)
      );
      // never the live-restore command shape (no bare --drop against mydb)
      expect(cp.exec).not.toHaveBeenCalledWith(
        expect.stringContaining('--nsInclude="mydb.*"'),
        expect.any(Object),
        expect.any(Function)
      );
      expect(fakeClient.db).toHaveBeenCalledWith(result.scratchDb);
      expect(dropDatabase).toHaveBeenCalled();
    });

    // #765, restore-test half. Same root cause as the restoreBackup case
    // above: with a default db in the URI, --nsFrom/--nsTo never get a
    // chance to match because no namespaces are ever read, so the scratch
    // db stays empty and restoredCollections comes back 0 with success:true.
    it('hands mongorestore a URI with no default database, keeping the query string (#765)', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/mydb?replicaSet=rs0';
      env.MONGO_DB = 'mydb';
      const backupPath = path.join('C:', 'tmp', '2026-01-01');

      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs.promises, 'readFile').mockImplementation(async (fp) => {
        if (String(fp).endsWith('manifest.json')) {
          return JSON.stringify({ dbName: 'mydb', checksum: emptyDirChecksum });
        }
        throw new Error(`unexpected readFile: ${fp}`);
      });
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([]);
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => cb(null, 'restored', ''));

      const fakeScratchDb = {
        listCollections: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([{ name: 'patients' }]) })),
        dropDatabase: vi.fn().mockResolvedValue()
      };
      const fakeClient = {
        connect: vi.fn().mockResolvedValue(),
        db: vi.fn(() => fakeScratchDb),
        close: vi.fn().mockResolvedValue()
      };
      vi.spyOn(mongodb, 'MongoClient').mockImplementation(function () { return fakeClient; });

      const backupService = freshBackupService();
      const result = await backupService.testRestoreBackup(backupPath);

      const command = cp.exec.mock.calls[0][0];
      expect(command).toContain('mongorestore --uri="mongodb://localhost:27017/?replicaSet=rs0"');
      expect(command).not.toContain('27017/mydb');
      // the namespace remap is what keeps the live db untouched; it must survive.
      expect(command).toContain(`--nsFrom="mydb.*" --nsTo="${result.scratchDb}.*"`);
    });

    // #742: the neighbouring tests mock fs.promises.readdir to [] on both the
    // write and verify sides, which is exactly why they never saw the real
    // mismatch -- a genuine backup directory contains the manifest.json the
    // write side wrote *after* computing the checksum. Real temp directory,
    // no fs mocks: the manifest carries the digest over the data files only,
    // and the verify walk must reproduce it despite manifest.json now being
    // present alongside them.
    it('verifies the manifest checksum against a real backup directory that contains manifest.json itself (#742)', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = 'mydb';
      const os = require('os');
      const backupPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bioavanced-742-'));
      try {
        const samplesJson = JSON.stringify([{ specimenId: '1' }]);
        await fs.promises.writeFile(path.join(backupPath, 'samples.json'), samplesJson, 'utf8');
        // What performBackup/writeJsonBackup store: sha256 over the data
        // files (relative name + content, sorted), computed before the
        // manifest exists.
        const dataOnlyChecksum = crypto.createHash('sha256').update('samples.json').update(Buffer.from(samplesJson)).digest('hex');
        await fs.promises.writeFile(
          path.join(backupPath, 'manifest.json'),
          JSON.stringify({ dbName: 'mydb', type: 'json-fallback', checksum: dataOnlyChecksum }),
          'utf8'
        );

        vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => cb(null, 'restored', ''));
        const fakeScratchDb = { listCollections: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([{ name: 'samples' }]) })), dropDatabase: vi.fn().mockResolvedValue() };
        const fakeClient = { connect: vi.fn().mockResolvedValue(), db: vi.fn(() => fakeScratchDb), close: vi.fn().mockResolvedValue() };
        vi.spyOn(mongodb, 'MongoClient').mockImplementation(function () { return fakeClient; });

        const backupService = freshBackupService();
        const result = await backupService.testRestoreBackup(backupPath);

        expect(result.success).toBe(true);
        expect(result.checksumVerified).toBe(true);
      } finally {
        await fs.promises.rm(backupPath, { recursive: true, force: true });
      }
    });

    it('fails the restore test when the manifest checksum does not match the recomputed one', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = 'mydb';

      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs.promises, 'readFile').mockImplementation(async (p) => {
        if (String(p).endsWith('manifest.json')) {
          return JSON.stringify({ dbName: 'mydb', checksum: 'stale-checksum-from-a-tampered-backup' });
        }
        throw new Error(`unexpected readFile: ${p}`);
      });
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([]);
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => cb(null, 'restored', ''));

      const fakeDb = { listCollections: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })), dropDatabase: vi.fn().mockResolvedValue() };
      const fakeClient = { connect: vi.fn().mockResolvedValue(), db: vi.fn(() => fakeDb), close: vi.fn().mockResolvedValue() };
      vi.spyOn(mongodb, 'MongoClient').mockImplementation(function () { return fakeClient; });

      const backupService = freshBackupService();
      const result = await backupService.testRestoreBackup(path.join('C:', 'tmp', 'backup'));

      expect(result.success).toBe(false);
      expect(result.checksumVerified).toBe(false);
      expect(result.error).toContain('não confere');
    });

    it('fails the restore test when there is no manifest at all', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';

      vi.spyOn(fs, 'existsSync').mockImplementation((p) => !String(p).endsWith('manifest.json'));
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([]);
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => cb(null, 'restored', ''));

      const fakeDb = { listCollections: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })), dropDatabase: vi.fn().mockResolvedValue() };
      const fakeClient = { connect: vi.fn().mockResolvedValue(), db: vi.fn(() => fakeDb), close: vi.fn().mockResolvedValue() };
      vi.spyOn(mongodb, 'MongoClient').mockImplementation(function () { return fakeClient; });

      const backupService = freshBackupService();
      const result = await backupService.testRestoreBackup(path.join('C:', 'tmp', 'backup'));

      expect(result.success).toBe(false);
      expect(result.checksumVerified).toBe(false);
      expect(result.error).toContain('sem manifest');
    });

    it('falls back to a JSON restore into the scratch db when mongorestore binary is missing, and still drops the scratch db', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = undefined;
      const backupPath = path.join('C:', 'tmp', 'backup-restoretest-1');

      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs.promises, 'readFile').mockImplementation(async (p) => {
        if (String(p).endsWith('manifest.json')) {
          return JSON.stringify({ dbName: 'mydb', checksum: emptyDirChecksum, collections: [{ file: 'patients.json' }] });
        }
        return JSON.stringify([{ _id: 1, name: 'a' }]);
      });
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([]);
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => {
        cb({ message: 'mongorestore: not found' }, '', 'not found');
      });

      const fakeCollection = { deleteMany: vi.fn().mockResolvedValue(), insertMany: vi.fn().mockResolvedValue() };
      const dropDatabase = vi.fn().mockResolvedValue();
      const fakeDb = { collection: vi.fn(() => fakeCollection), dropDatabase };
      const fakeClient = {
        connect: vi.fn().mockResolvedValue(),
        db: vi.fn(() => fakeDb),
        close: vi.fn().mockResolvedValue()
      };
      vi.spyOn(mongodb, 'MongoClient').mockImplementation(function () { return fakeClient; });

      const backupService = freshBackupService();
      const result = await backupService.testRestoreBackup(backupPath);

      expect(result.success).toBe(true);
      expect(result.mode).toBe('json-fallback');
      expect(result.scratchDb).toMatch(/^mydb_restoretest_\d+$/);
      expect(fakeDb.collection).toHaveBeenCalledWith('patients');
      expect(dropDatabase).toHaveBeenCalled();
    });

    it('fails the JSON-fallback restore test when the manifest checksum does not match', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = undefined;
      const backupPath = path.join('C:', 'tmp', 'backup-restoretest-2');

      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs.promises, 'readFile').mockImplementation(async (p) => {
        if (String(p).endsWith('manifest.json')) {
          return JSON.stringify({ dbName: 'mydb', checksum: 'stale', collections: [{ file: 'patients.json' }] });
        }
        return JSON.stringify([{ _id: 1, name: 'a' }]);
      });
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([]);
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => {
        cb({ message: 'mongorestore: not found' }, '', 'not found');
      });

      const fakeCollection = { deleteMany: vi.fn().mockResolvedValue(), insertMany: vi.fn().mockResolvedValue() };
      const dropDatabase = vi.fn().mockResolvedValue();
      const fakeDb = { collection: vi.fn(() => fakeCollection), dropDatabase };
      const fakeClient = {
        connect: vi.fn().mockResolvedValue(),
        db: vi.fn(() => fakeDb),
        close: vi.fn().mockResolvedValue()
      };
      vi.spyOn(mongodb, 'MongoClient').mockImplementation(function () { return fakeClient; });

      const backupService = freshBackupService();
      const result = await backupService.testRestoreBackup(backupPath);

      expect(result.success).toBe(false);
      expect(result.mode).toBe('json-fallback');
      expect(result.checksumVerified).toBe(false);
      expect(result.error).toContain('não confere');
      expect(dropDatabase).toHaveBeenCalled();
    });

    it('returns a generic failure result when mongorestore fails for a non-missing-binary reason (checksumVerified still reported), and still drops the scratch db (#750)', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs.promises, 'readFile').mockImplementation(async (p) => {
        if (String(p).endsWith('manifest.json')) {
          return JSON.stringify({ dbName: 'mydb', checksum: emptyDirChecksum });
        }
        throw new Error(`unexpected readFile: ${p}`);
      });
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([]);
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => {
        cb({ message: 'permission denied' }, '', '');
      });

      const dropDatabase = vi.fn().mockResolvedValue();
      const fakeDb = { listCollections: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })), dropDatabase };
      const fakeClient = { connect: vi.fn().mockResolvedValue(), db: vi.fn(() => fakeDb), close: vi.fn().mockResolvedValue() };
      vi.spyOn(mongodb, 'MongoClient').mockImplementation(function () { return fakeClient; });

      const backupService = freshBackupService();
      const result = await backupService.testRestoreBackup(path.join('C:', 'tmp', 'backup'));

      expect(result.success).toBe(false);
      expect(result.error).toBe('permission denied');
      expect(result.checksumVerified).toBe(true);
      // #750: mongorestore restores collection by collection, so a run that
      // fails partway has already written into the scratch db. The teardown
      // used to run only on the two success paths, leaving one timestamped
      // orphan per failed run -- and #731 made those runs weekly, unattended.
      expect(dropDatabase).toHaveBeenCalled();
    });

    it('drops the scratch db when the JSON fallback itself throws after already writing into it (#750)', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = undefined;
      const backupPath = path.join('C:', 'tmp', 'backup-restoretest-fallback-fail');

      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs.promises, 'readFile').mockImplementation(async (p) => {
        if (String(p).endsWith('manifest.json')) {
          return JSON.stringify({
            dbName: 'mydb',
            checksum: emptyDirChecksum,
            collections: [{ file: 'patients.json' }, { file: 'samples.json' }]
          });
        }
        return JSON.stringify([{ _id: 1, name: 'a' }]);
      });
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([]);
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => {
        cb({ message: 'mongorestore: not found' }, '', 'not found');
      });

      // First collection lands, second blows up -- documents are already in
      // the scratch database by the time the fallback's catch runs.
      const insertMany = vi.fn()
        .mockResolvedValueOnce()
        .mockRejectedValueOnce(new Error('insertMany falhou no meio da restauracao'));
      const fakeCollection = { deleteMany: vi.fn().mockResolvedValue(), insertMany };
      const dropDatabase = vi.fn().mockResolvedValue();
      const fakeDb = { collection: vi.fn(() => fakeCollection), dropDatabase };
      const fakeClient = { connect: vi.fn().mockResolvedValue(), db: vi.fn(() => fakeDb), close: vi.fn().mockResolvedValue() };
      vi.spyOn(mongodb, 'MongoClient').mockImplementation(function () { return fakeClient; });

      const backupService = freshBackupService();
      const result = await backupService.testRestoreBackup(backupPath);

      expect(result.success).toBe(false);
      expect(result.error).toContain('insertMany falhou');
      expect(fakeDb.collection).toHaveBeenCalledWith('patients');
      expect(dropDatabase).toHaveBeenCalled();
    });

    it('does not let a failing scratch-db drop mask the real restore error (#750)', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs.promises, 'readFile').mockImplementation(async (p) => {
        if (String(p).endsWith('manifest.json')) {
          return JSON.stringify({ dbName: 'mydb', checksum: emptyDirChecksum });
        }
        throw new Error(`unexpected readFile: ${p}`);
      });
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([]);
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => {
        cb({ message: 'permission denied' }, '', '');
      });

      const dropDatabase = vi.fn().mockRejectedValue(new Error('dropDatabase indisponivel'));
      const fakeDb = { listCollections: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })), dropDatabase };
      const fakeClient = { connect: vi.fn().mockResolvedValue(), db: vi.fn(() => fakeDb), close: vi.fn().mockResolvedValue() };
      vi.spyOn(mongodb, 'MongoClient').mockImplementation(function () { return fakeClient; });

      const backupService = freshBackupService();
      const result = await backupService.testRestoreBackup(path.join('C:', 'tmp', 'backup'));

      // The teardown failure is logged (with the scratch name, so an operator
      // can clean up by hand) but never replaces the restore's own error.
      expect(result.success).toBe(false);
      expect(result.error).toBe('permission denied');
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('mydb_restoretest_'),
        expect.stringContaining('dropDatabase indisponivel')
      );
    });

    function fakeHistoryDb() {
      const insertOne = vi.fn().mockResolvedValue({ insertedId: 'restore-test-history-1' });
      return { db: { collection: vi.fn(() => ({ insertOne })) }, insertOne };
    }

    it('does not touch the db when none is passed', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs.promises, 'readFile').mockImplementation(async (p) => {
        if (String(p).endsWith('manifest.json')) return JSON.stringify({ dbName: 'mydb', checksum: emptyDirChecksum });
        throw new Error('unexpected');
      });
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([]);
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => cb(null, 'ok', ''));
      const fakeDb = { listCollections: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })), dropDatabase: vi.fn().mockResolvedValue() };
      vi.spyOn(mongodb, 'MongoClient').mockImplementation(function () { return { connect: vi.fn().mockResolvedValue(), db: vi.fn(() => fakeDb), close: vi.fn().mockResolvedValue() }; });

      const backupService = freshBackupService();
      await expect(backupService.testRestoreBackup(path.join('C:', 'tmp', 'backup'))).resolves.toMatchObject({ success: true });
    });

    it('records a success restoreTestHistory entry when db is passed', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs.promises, 'readFile').mockImplementation(async (p) => {
        if (String(p).endsWith('manifest.json')) return JSON.stringify({ dbName: 'mydb', checksum: emptyDirChecksum });
        throw new Error('unexpected');
      });
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([]);
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => cb(null, 'ok', ''));
      const fakeDb = { listCollections: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })), dropDatabase: vi.fn().mockResolvedValue() };
      vi.spyOn(mongodb, 'MongoClient').mockImplementation(function () { return { connect: vi.fn().mockResolvedValue(), db: vi.fn(() => fakeDb), close: vi.fn().mockResolvedValue() }; });

      const backupService = freshBackupService();
      const { db, insertOne } = fakeHistoryDb();
      const result = await backupService.testRestoreBackup(path.join('C:', 'tmp', 'backup'), db);

      expect(db.collection).toHaveBeenCalledWith('restoreTestHistory');
      expect(insertOne).toHaveBeenCalledWith(expect.objectContaining({
        status: 'success',
        mode: 'mongorestore',
        checksumVerified: true,
        scratchDb: result.scratchDb,
      }));
    });

    it('records an error restoreTestHistory entry when db is passed and the test restore fails', async () => {
      env.MONGO_URI = undefined;

      const backupService = freshBackupService();
      const { db, insertOne } = fakeHistoryDb();
      await backupService.testRestoreBackup('/some/backup', db);

      expect(insertOne).toHaveBeenCalledWith(expect.objectContaining({
        status: 'error',
        error: 'MONGO_URI não configurado',
      }));
    });

    // RNF010 C3 (#1484): each restore test's wall time against the policy's rtoHours.
    function rtoPolicyDb() {
      const insertOne = vi.fn().mockResolvedValue({ insertedId: 'restore-test-history-1' });
      const findOne = vi.fn().mockResolvedValue({ _id: 'main', rtoHours: 12 });
      return {
        db: { collection: vi.fn((name) => (name === 'backup_policy' ? { findOne } : { insertOne })) },
        insertOne,
      };
    }

    function mockSuccessfulRestore() {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs.promises, 'readFile').mockImplementation(async (p) => {
        if (String(p).endsWith('manifest.json')) return JSON.stringify({ dbName: 'mydb', checksum: emptyDirChecksum });
        throw new Error('unexpected');
      });
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([]);
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => cb(null, 'ok', ''));
      const fakeDb = { listCollections: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })), dropDatabase: vi.fn().mockResolvedValue() };
      vi.spyOn(mongodb, 'MongoClient').mockImplementation(function () { return { connect: vi.fn().mockResolvedValue(), db: vi.fn(() => fakeDb), close: vi.fn().mockResolvedValue() }; });
    }

    const T0 = Date.UTC(2026, 10, 1, 3, 0, 0);

    it('records the restore test wall time within rtoHours', async () => {
      mockSuccessfulRestore();
      const backupService = freshBackupService();
      const { db, insertOne } = rtoPolicyDb();
      vi.spyOn(Date, 'now').mockReturnValueOnce(T0).mockReturnValue(T0 + 60000);

      const result = await backupService.testRestoreBackup(path.join('C:', 'tmp', 'backup'), db);

      expect(result.success).toBe(true);
      expect(insertOne.mock.calls[0][0]).toEqual(expect.objectContaining({
        status: 'success', durationMs: 60000, rtoHours: 12, withinRto: true,
      }));
    });

    it('records withinRto false and logs an error past rtoHours', async () => {
      mockSuccessfulRestore();
      const backupService = freshBackupService();
      const { db, insertOne } = rtoPolicyDb();
      vi.spyOn(Date, 'now').mockReturnValueOnce(T0).mockReturnValue(T0 + 13 * 3600000);

      const result = await backupService.testRestoreBackup(path.join('C:', 'tmp', 'backup'), db);

      expect(result.success).toBe(true);
      expect(insertOne.mock.calls[0][0]).toEqual(expect.objectContaining({
        status: 'success', durationMs: 46800000, rtoHours: 12, withinRto: false,
      }));
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('excedeu o RTO'), 'backup');
    });

    it('records withinRto null when the restore test fails', async () => {
      env.MONGO_URI = undefined;
      const backupService = freshBackupService();
      const { db, insertOne } = rtoPolicyDb();

      await backupService.testRestoreBackup('/some/backup', db);

      const row = insertOne.mock.calls[0][0];
      expect(row).toEqual(expect.objectContaining({ status: 'error', rtoHours: 12, withinRto: null }));
      expect(typeof row.durationMs).toBe('number');
      expect(row.durationMs).toBeGreaterThanOrEqual(0);
    });

    // #1325 (RNF010 C5): the restore test also checks the Neo4j and InfluxDB
    // exports through backupStores.verifySecondaryStores.
    const NEO4J_FAILED = 'Teste de restauração de Neo4j falhou: neo4j/nodes.ndjson não pôde ser descriptografado';
    const FAILED_STORES = {
      stores: { neo4j: { status: 'failed', error: NEO4J_FAILED }, influxdb: { status: 'verified', points: 5 } },
      error: NEO4J_FAILED,
    };
    const VERIFIED_STORES = {
      stores: {
        neo4j: { status: 'verified', nodes: 3, relationships: 2, constraints: 0, indexes: 0 },
        influxdb: { status: 'verified', points: 5 },
      },
      error: null,
    };

    function mockStoresBackup({ restoreBinaryMissing = false } = {}) {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = undefined;
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs.promises, 'readFile').mockImplementation(async (p) => {
        if (String(p).endsWith('manifest.json')) {
          return JSON.stringify({ dbName: 'mydb', checksum: emptyDirChecksum, collections: [{ file: 'patients.json' }], stores: EXPORTED_STORES });
        }
        if (restoreBinaryMissing) return JSON.stringify([{ _id: 1, name: 'a' }]);
        throw new Error(`unexpected readFile: ${p}`);
      });
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([]);
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => {
        if (restoreBinaryMissing) cb({ message: 'mongorestore: not found' }, '', 'not found');
        else cb(null, 'restored', '');
      });
      const dropDatabase = vi.fn().mockResolvedValue();
      const fakeDb = {
        listCollections: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([{ name: 'patients' }]) })),
        collection: vi.fn(() => ({ countDocuments: vi.fn().mockResolvedValue(4), deleteMany: vi.fn().mockResolvedValue(), insertMany: vi.fn().mockResolvedValue() })),
        dropDatabase,
      };
      vi.spyOn(mongodb, 'MongoClient').mockImplementation(function () {
        return { connect: vi.fn().mockResolvedValue(), db: vi.fn(() => fakeDb), close: vi.fn().mockResolvedValue() };
      });
      return { dropDatabase };
    }

    it('fails the restore test when a store fails its check with a matching checksum, still restoring and dropping the scratch db', async () => {
      const { dropDatabase } = mockStoresBackup();
      const verify = vi.spyOn(backupStores, 'verifySecondaryStores').mockResolvedValue(FAILED_STORES);
      const backupPath = path.join('C:', 'tmp', 'backup-stores-1');

      const backupService = freshBackupService();
      const result = await backupService.testRestoreBackup(backupPath);

      expect(verify).toHaveBeenCalledWith(backupPath, EXPORTED_STORES, backupService.getRestoreScratchBaseDir());
      expect(result.success).toBe(false);
      expect(result.checksumVerified).toBe(true);
      expect(result.error).toBe(NEO4J_FAILED);
      expect(result.stores).toEqual(FAILED_STORES.stores);
      expect(result.mode).toBe('mongorestore');
      expect(cp.exec).toHaveBeenCalledTimes(1);
      expect(result.restoredDocuments).toBe(4);
      expect(dropDatabase).toHaveBeenCalled();
    });

    it('fails the JSON-fallback restore test when a store fails its check', async () => {
      const { dropDatabase } = mockStoresBackup({ restoreBinaryMissing: true });
      vi.spyOn(backupStores, 'verifySecondaryStores').mockResolvedValue(FAILED_STORES);

      const backupService = freshBackupService();
      const result = await backupService.testRestoreBackup(path.join('C:', 'tmp', 'backup-stores-2'));

      expect(result.mode).toBe('json-fallback');
      expect(result.success).toBe(false);
      expect(result.checksumVerified).toBe(true);
      expect(result.error).toBe(NEO4J_FAILED);
      expect(result.stores).toEqual(FAILED_STORES.stores);
      expect(dropDatabase).toHaveBeenCalled();
    });

    it('passes the restore test with verified stores, reporting them in the result and the restoreTestHistory row', async () => {
      mockStoresBackup();
      vi.spyOn(backupStores, 'verifySecondaryStores').mockResolvedValue(VERIFIED_STORES);

      const backupService = freshBackupService();
      const { db, insertOne } = fakeHistoryDb();
      const result = await backupService.testRestoreBackup(path.join('C:', 'tmp', 'backup-stores-3'), db);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.stores).toEqual(VERIFIED_STORES.stores);
      expect(insertOne).toHaveBeenCalledWith(expect.objectContaining({
        status: 'success',
        stores: VERIFIED_STORES.stores,
        error: null,
      }));
    });

    it('fails the restore test, without taking the JSON fallback, when the store check itself throws', async () => {
      mockStoresBackup();
      vi.spyOn(backupStores, 'verifySecondaryStores').mockRejectedValue(new Error('ENOENT: no such file or directory'));

      const backupService = freshBackupService();
      const result = await backupService.testRestoreBackup(path.join('C:', 'tmp', 'backup-stores-4'));

      expect(result.success).toBe(false);
      expect(result.mode).toBe('mongorestore');
      expect(result.error).toBe('Teste de restauração dos stores falhou: ENOENT: no such file or directory');
      expect(result.stores).toBeNull();
      expect(cp.exec).toHaveBeenCalledTimes(1);
      expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('fallback'));
    });
  });

  // #734: encryptionEnabled is read from the admin-editable BackupPolicy
  // (mirroring #728's retentionDays wiring) and threaded into the JSON
  // fallback writer. These run against real temp directories, not mocked
  // fs, the same way the #742 checksum test does above -- the property
  // under test is what actually lands on disk and whether it survives a
  // real decrypt/restore round trip, which a mocked fs would only hand
  // back to us unchanged.
  describe('#734: backup encryption at rest', () => {
    function makeAppDbWithPolicy(encryptionEnabled) {
      const policyDoc = {
        _id: 'main',
        cronExpression: '0 3 * * *',
        retentionDays: 30,
        encryptionEnabled,
        rpoHours: 24,
        rtoHours: 12,
        updatedBy: null,
        updatedAt: null,
      };
      const backupPolicyFindOne = vi.fn().mockResolvedValue(policyDoc);
      const historyInsertOne = vi.fn().mockResolvedValue({ insertedId: 'h1' });
      return {
        collection: vi.fn((name) => {
          if (name === 'backup_policy') return { findOne: backupPolicyFindOne };
          return { insertOne: historyInsertOne };
        }),
      };
    }

    // mongodump missing forces performBackup onto the JSON-fallback writer
    // (writeJsonBackup) -- the same trick the pre-existing "falls back to a
    // JSON backup" test above uses.
    function mockMongodumpAndMongorestoreMissing() {
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => {
        const binary = command.startsWith('mongorestore') ? 'mongorestore' : 'mongodump';
        cb({ message: `'${binary}' is not recognized as an internal or external command` }, '', 'is not recognized');
      });
    }

    it('encrypts JSON-fallback payload files in place (unreadable on disk, checksum still verifies) and restores the original data through testRestoreBackup', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = 'mydb';
      const os = require('os');
      const baseDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bioavanced-734-on-'));
      env.BACKUP_DIR = baseDir;

      try {
        mockMongodumpAndMongorestoreMissing();

        const plaintextMarker = 'PLAINTEXT-SSN-MARKER-42';
        const fakeCollection = {
          find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([{ _id: 1, ssn: plaintextMarker }]) })),
          deleteMany: vi.fn().mockResolvedValue({}),
          insertMany: vi.fn().mockResolvedValue({})
        };
        const fakeBackupDb = {
          listCollections: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([{ name: 'patients' }]) })),
          collection: vi.fn(() => fakeCollection)
        };
        const fakeClient = {
          connect: vi.fn().mockResolvedValue(),
          db: vi.fn(() => fakeBackupDb),
          close: vi.fn().mockResolvedValue()
        };
        vi.spyOn(mongodb, 'MongoClient').mockImplementation(function () { return fakeClient; });

        const backupService = freshBackupService();
        const appDb = makeAppDbWithPolicy(true);
        const result = await backupService.runBackup(appDb);

        expect(result.success).toBe(true);
        expect(result.mode).toBe('json-fallback');

        // Unreadable as plaintext: the marker isn't present and the bytes
        // on disk don't even parse as JSON any more.
        const patientsPath = path.join(result.path, 'patients.json');
        const onDiskBuffer = await fs.promises.readFile(patientsPath);
        expect(onDiskBuffer.toString('utf8')).not.toContain(plaintextMarker);
        expect(() => JSON.parse(onDiskBuffer.toString('utf8'))).toThrow();

        const manifest = JSON.parse(await fs.promises.readFile(path.join(result.path, 'manifest.json'), 'utf8'));
        const patientsEntry = manifest.collections.find((entry) => entry.file === 'patients.json');
        expect(patientsEntry.encrypted).toBe(true);
        expect(patientsEntry.encryptionAlgorithm).toBe('aes-256-gcm');
        expect(typeof patientsEntry.encryptionKeyId).toBe('string');
        expect(typeof patientsEntry.encryptionIv).toBe('string');
        expect(typeof patientsEntry.encryptionTag).toBe('string');

        // checksumVerified recomputes over the real on-disk ciphertext
        // bytes and compares to the manifest's stored digest -- proof the
        // checksum was taken over what's actually stored, not the
        // plaintext, and that the random per-file IV doesn't perturb it.
        const testResult = await backupService.testRestoreBackup(result.path);
        expect(testResult.success).toBe(true);
        expect(testResult.checksumVerified).toBe(true);
        expect(testResult.mode).toBe('json-fallback');

        // Round trip: the restore path decrypted the file and handed the
        // original plaintext document to insertMany.
        expect(fakeCollection.insertMany).toHaveBeenCalledTimes(1);
        const [insertedDocs] = fakeCollection.insertMany.mock.calls[0];
        expect(insertedDocs).toHaveLength(1);
        expect(Number(insertedDocs[0]._id)).toBe(1);
        expect(insertedDocs[0].ssn).toBe(plaintextMarker);
      } finally {
        await fs.promises.rm(baseDir, { recursive: true, force: true });
      }
    });

    it('does not encrypt when the policy has encryptionEnabled=false -- byte-for-byte the pre-#734 plaintext behaviour', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = 'mydb';
      const os = require('os');
      const baseDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bioavanced-734-off-'));
      env.BACKUP_DIR = baseDir;

      try {
        mockMongodumpAndMongorestoreMissing();

        const docs = [{ _id: 1, ssn: 'not-encrypted' }];
        const fakeCollection = {
          find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue(docs) }))
        };
        const fakeBackupDb = {
          listCollections: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([{ name: 'patients' }]) })),
          collection: vi.fn(() => fakeCollection)
        };
        const fakeClient = {
          connect: vi.fn().mockResolvedValue(),
          db: vi.fn(() => fakeBackupDb),
          close: vi.fn().mockResolvedValue()
        };
        vi.spyOn(mongodb, 'MongoClient').mockImplementation(function () { return fakeClient; });

        const backupService = freshBackupService();
        const appDb = makeAppDbWithPolicy(false);
        const result = await backupService.runBackup(appDb);

        expect(result.success).toBe(true);

        const patientsPath = path.join(result.path, 'patients.json');
        const onDiskContent = await fs.promises.readFile(patientsPath, 'utf8');
        // Exactly what writeJsonBackup wrote before #734 -- the serialized
        // JSON text, untouched.
        expect(onDiskContent).toBe(backupService.serializeBackupDocs(docs));

        const manifest = JSON.parse(await fs.promises.readFile(path.join(result.path, 'manifest.json'), 'utf8'));
        const patientsEntry = manifest.collections.find((entry) => entry.file === 'patients.json');
        // No encryption fields at all when encryption is off -- the
        // manifest shape is unchanged from before #734.
        expect(Object.keys(patientsEntry).sort()).toEqual(['count', 'file', 'name']);

        const expectedChecksum = crypto.createHash('sha256')
          .update('patients.json')
          .update(Buffer.from(onDiskContent))
          .digest('hex');
        expect(manifest.checksum).toBe(expectedChecksum);
      } finally {
        await fs.promises.rm(baseDir, { recursive: true, force: true });
      }
    });

    // #1325: the store exports run after the dump tree is encrypted (so the
    // dump encryption never touches their files) and before the checksum (so
    // it covers them).
    it('exports the Neo4j and InfluxDB stores after encrypting the mongodump tree and before its checksum (#1325)', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = 'mydb';
      const os = require('os');
      const baseDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bioavanced-1325-order-'));
      env.BACKUP_DIR = baseDir;

      try {
        vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => {
          const outDir = /--out="([^"]+)"/.exec(command)[1];
          fs.mkdirSync(path.join(outDir, 'mydb'), { recursive: true });
          fs.writeFileSync(path.join(outDir, 'mydb', 'patients.bson'), 'BSON-PAYLOAD');
          cb(null, 'ok stdout', '');
        });
        const storeLine = '{"id":"4:a:1"}\n';
        backupStores.exportSecondaryStores.mockImplementation(async (backupDir) => {
          await fs.promises.mkdir(path.join(backupDir, 'neo4j'), { recursive: true });
          await fs.promises.writeFile(path.join(backupDir, 'neo4j', 'x.ndjson'), storeLine);
          return EXPORTED_STORES;
        });

        const backupService = freshBackupService();
        const result = await backupService.runBackup(makeAppDbWithPolicy(true));

        expect(result.success).toBe(true);
        expect(result.mode).toBe('mongodump');
        expect(backupStores.exportSecondaryStores).toHaveBeenCalledWith(result.path, true);

        const manifest = JSON.parse(await fs.promises.readFile(path.join(result.path, 'manifest.json'), 'utf8'));
        expect(manifest.encryptedFiles.map((entry) => entry.file)).toEqual(['mydb/patients.bson']);
        expect(manifest.stores).toEqual(EXPORTED_STORES);

        const storeBytes = await fs.promises.readFile(path.join(result.path, 'neo4j', 'x.ndjson'));
        expect(storeBytes.toString('utf8')).toBe(storeLine);
        const dumpBytes = await fs.promises.readFile(path.join(result.path, 'mydb', 'patients.bson'));
        const expectedChecksum = crypto.createHash('sha256')
          .update('mydb/patients.bson').update(dumpBytes)
          .update('neo4j/x.ndjson').update(storeBytes)
          .digest('hex');
        expect(manifest.checksum).toBe(expectedChecksum);
        expect(result.checksum).toBe(expectedChecksum);
      } finally {
        await fs.promises.rm(baseDir, { recursive: true, force: true });
      }
    });

    // #1325: a store's files are encrypted once all are written, so a store
    // failing partway must not leave its plaintext in the backup folder.
    it('leaves no plaintext store file when the Neo4j export fails mid-stream with encryption on (#1325)', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = 'mydb';
      const os = require('os');
      const baseDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bioavanced-1325-midstream-'));
      env.BACKUP_DIR = baseDir;
      const storeEnv = { NEO4J_URI: env.NEO4J_URI, NEO4J_USERNAME: env.NEO4J_USERNAME, NEO4J_PASSWORD: env.NEO4J_PASSWORD };
      Object.assign(env, { NEO4J_URI: 'bolt://neo4j:7687', NEO4J_USERNAME: 'neo4j', NEO4J_PASSWORD: 'secret' });

      try {
        vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => {
          const outDir = /--out="([^"]+)"/.exec(command)[1];
          fs.mkdirSync(path.join(outDir, 'mydb'), { recursive: true });
          fs.writeFileSync(path.join(outDir, 'mydb', 'patients.bson'), 'BSON-PAYLOAD');
          cb(null, 'ok stdout', '');
        });
        backupStores.exportSecondaryStores.mockRestore();
        async function* nodeRows() {
          yield { get: (key) => ({ id: '4:a:1', labels: ['Patient'], props: { name: 'PLAINTEXT-PHI-MARKER' } })[key] };
        }
        async function* resetMidStream() {
          throw new Error('connection reset mid-stream');
        }
        const tx = { run: vi.fn((query) => (query.startsWith('MATCH (n)') ? nodeRows() : resetMidStream())), close: vi.fn().mockResolvedValue() };
        const session = { beginTransaction: vi.fn(() => tx), run: vi.fn(), close: vi.fn().mockResolvedValue() };
        vi.spyOn(backupStores.clients, 'neo4jDriver').mockReturnValue({ session: vi.fn(() => session), close: vi.fn().mockResolvedValue() });

        const backupService = freshBackupService();
        const result = await backupService.runBackup(makeAppDbWithPolicy(true));

        expect(result).toEqual({ success: false, error: 'Backup de Neo4j falhou: connection reset mid-stream' });
        const [folder] = await fs.promises.readdir(baseDir);
        const backupDir = path.join(baseDir, folder);
        expect(fs.existsSync(path.join(backupDir, 'neo4j'))).toBe(false);
        expect(fs.existsSync(path.join(backupDir, 'manifest.json'))).toBe(false);
      } finally {
        Object.assign(env, storeEnv);
        await fs.promises.rm(baseDir, { recursive: true, force: true });
      }
    });

    it('fails the backup loudly instead of writing plaintext when encryption is enabled but no key is configured', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = 'mydb';
      const os = require('os');
      const baseDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bioavanced-734-nokey-'));
      env.BACKUP_DIR = baseDir;

      const originalEncryptionKey = process.env.ENCRYPTION_KEY;
      delete process.env.ENCRYPTION_KEY;

      try {
        mockMongodumpAndMongorestoreMissing();

        const fakeCollection = {
          find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([{ _id: 1, ssn: 'x' }]) }))
        };
        const fakeBackupDb = {
          listCollections: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([{ name: 'patients' }]) })),
          collection: vi.fn(() => fakeCollection)
        };
        const fakeClient = {
          connect: vi.fn().mockResolvedValue(),
          db: vi.fn(() => fakeBackupDb),
          close: vi.fn().mockResolvedValue()
        };
        vi.spyOn(mongodb, 'MongoClient').mockImplementation(function () { return fakeClient; });

        const backupService = freshBackupService();
        const appDb = makeAppDbWithPolicy(true);
        const result = await backupService.runBackup(appDb);

        expect(result.success).toBe(false);
        expect(result.error).toContain('ENCRYPTION_KEY');

        // The failure happens before performBackup ever runs mongodump or
        // writeJsonBackup touches disk -- nothing (plaintext or otherwise)
        // was written under the backup base dir.
        const entries = await fs.promises.readdir(baseDir, { recursive: true });
        expect(entries.filter((entry) => String(entry).endsWith('patients.json'))).toHaveLength(0);
      } finally {
        if (originalEncryptionKey === undefined) {
          delete process.env.ENCRYPTION_KEY;
        } else {
          process.env.ENCRYPTION_KEY = originalEncryptionKey;
        }
        await fs.promises.rm(baseDir, { recursive: true, force: true });
      }
    });

    // #1325: only an explicit encryptionEnabled: false writes plaintext. With
    // no key configured, the no-key failure proves encryption was demanded.
    it('encrypts when the stored policy has no boolean encryptionEnabled', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = 'mydb';
      const os = require('os');
      const baseDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bioavanced-1325-nofield-'));
      env.BACKUP_DIR = baseDir;

      const originalEncryptionKey = process.env.ENCRYPTION_KEY;
      delete process.env.ENCRYPTION_KEY;

      try {
        mockMongodumpAndMongorestoreMissing();

        const fakeCollection = {
          find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([{ _id: 1, ssn: 'x' }]) }))
        };
        const fakeBackupDb = {
          listCollections: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([{ name: 'patients' }]) })),
          collection: vi.fn(() => fakeCollection)
        };
        const fakeClient = {
          connect: vi.fn().mockResolvedValue(),
          db: vi.fn(() => fakeBackupDb),
          close: vi.fn().mockResolvedValue()
        };
        vi.spyOn(mongodb, 'MongoClient').mockImplementation(function () { return fakeClient; });

        // A stored policy document with no encryptionEnabled field at all:
        // getPolicy strips _id and returns {}.
        const backupPolicyFindOne = vi.fn().mockResolvedValue({ _id: 'main' });
        const historyInsertOne = vi.fn().mockResolvedValue({ insertedId: 'h1' });
        const appDb = {
          collection: vi.fn((name) => (name === 'backup_policy' ? { findOne: backupPolicyFindOne } : { insertOne: historyInsertOne })),
        };

        const backupService = freshBackupService();
        const result = await backupService.runBackup(appDb);

        expect(result.success).toBe(false);
        expect(result.error).toContain('ENCRYPTION_KEY');

        const entries = await fs.promises.readdir(baseDir, { recursive: true });
        expect(entries.filter((entry) => String(entry).endsWith('patients.json'))).toHaveLength(0);
      } finally {
        if (originalEncryptionKey === undefined) {
          delete process.env.ENCRYPTION_KEY;
        } else {
          process.env.ENCRYPTION_KEY = originalEncryptionKey;
        }
        await fs.promises.rm(baseDir, { recursive: true, force: true });
      }
    });

    // #1325 (RNF010 C1): a missing mongodump leaves a plaintext dump file
    // behind, and the JSON fallback reuses the folder. The leftover dump file
    // is in no manifest entry, so the off-site copy sends nothing and the run
    // fails.
    it('sends no leftover plaintext dump file off-site when the JSON fallback reuses the folder (#1325)', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = 'mydb';
      const os = require('os');
      const http = require('http');
      const baseDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bioavanced-1325-offsite-'));
      env.BACKUP_DIR = baseDir;
      const offsiteNames = ['BACKUP_OFFSITE_S3_ENDPOINT', 'BACKUP_OFFSITE_S3_BUCKET', 'BACKUP_OFFSITE_S3_ACCESS_KEY_ID', 'BACKUP_OFFSITE_S3_SECRET_ACCESS_KEY'];
      const offsiteEnv = Object.fromEntries(offsiteNames.map((name) => [name, env[name]]));
      const requests = [];
      const server = http.createServer((req, res) => {
        req.resume();
        req.on('end', () => {
          requests.push(`${req.method} ${req.url}`);
          res.statusCode = 200;
          res.end();
        });
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

      try {
        env.BACKUP_OFFSITE_S3_ENDPOINT = `http://127.0.0.1:${server.address().port}`;
        env.BACKUP_OFFSITE_S3_BUCKET = 'biobank-backups';
        env.BACKUP_OFFSITE_S3_ACCESS_KEY_ID = 'TESTACCESSKEY';
        env.BACKUP_OFFSITE_S3_SECRET_ACCESS_KEY = 'test-secret-key-never-logged';
        backupOffsite.uploadBackupRunOffsite.mockRestore();

        vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => {
          const outDir = /--out="([^"]+)"/.exec(command)[1];
          fs.mkdirSync(path.join(outDir, 'biobank'), { recursive: true });
          fs.writeFileSync(path.join(outDir, 'biobank', 'patients.bson'), 'PLAINTEXT-PATIENT-RECORD');
          cb({ message: 'mongodump: not found' }, '', '');
        });
        const fakeCollection = {
          find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([{ _id: 1, name: 'x' }]) }))
        };
        const fakeBackupDb = {
          listCollections: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([{ name: 'patients' }]) })),
          collection: vi.fn(() => fakeCollection)
        };
        const fakeClient = {
          connect: vi.fn().mockResolvedValue(),
          db: vi.fn(() => fakeBackupDb),
          close: vi.fn().mockResolvedValue()
        };
        vi.spyOn(mongodb, 'MongoClient').mockImplementation(function () { return fakeClient; });

        const backupService = freshBackupService();
        const appDb = makeAppDbWithPolicy(true);
        const result = await backupService.runBackup(appDb);

        expect(mongodb.MongoClient).toHaveBeenCalled();
        expect(result.success).toBe(false);
        expect(result.error).toBe('Cópia off-site falhou: biobank/patients.bson não consta do manifest.json.');
        expect(requests).toEqual([]);
        expect(appDb.collection('backupHistory').insertOne).toHaveBeenCalledWith(expect.objectContaining({
          status: 'error', error: result.error
        }));
      } finally {
        Object.assign(env, offsiteEnv);
        await new Promise((resolve) => server.close(resolve));
        await fs.promises.rm(baseDir, { recursive: true, force: true });
      }
    });
  });
});
