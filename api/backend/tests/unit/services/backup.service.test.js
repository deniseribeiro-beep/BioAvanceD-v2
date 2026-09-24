import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cp = require('child_process');
const mongodb = require('mongodb');
const logger = require('../../../src/utils/logger');
const env = require('../../../src/config/env');

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
  });

  afterEach(() => {
    vi.restoreAllMocks();
    env.MONGO_URI = originalMongoUri;
    env.MONGO_DB = originalMongoDb;
    env.BACKUP_DIR = originalBackupDir;
    env.BACKUP_RETENTION_DAYS = originalRetentionDays;
    delete require.cache[backupServicePath];
  });

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

      const result = await backupService.runBackup();

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
      const result = await backupService.runBackup();

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
      await backupService.runBackup();

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
        collection: vi.fn((name) => (name === 'participants' ? fakeCollectionA : fakeCollectionB))
      };
      const fakeClient = {
        connect: vi.fn().mockResolvedValue(),
        db: vi.fn(() => fakeDb),
        close: vi.fn().mockResolvedValue()
      };
      vi.spyOn(mongodb, 'MongoClient').mockImplementation(function () { return fakeClient; });

      const backupService = freshBackupService();
      const result = await backupService.runBackup();

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
        cb({ message: 'ENOENT' }, '', '');
      });

      const fakeClient = {
        connect: vi.fn().mockRejectedValue(new Error('connection refused')),
        db: vi.fn(),
        close: vi.fn().mockResolvedValue()
      };
      vi.spyOn(mongodb, 'MongoClient').mockImplementation(function () { return fakeClient; });

      const backupService = freshBackupService();
      const result = await backupService.runBackup();

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
      const result = await backupService.runBackup();

      expect(result).toEqual({ success: false, error: 'authentication failed' });
      expect(logger.error).toHaveBeenCalledWith('Erro ao executar backup:', 'authentication failed');
    });
  });

  // #723 (RF013 AC#1): runBackup(db) persists one history entry per run,
  // regardless of which internal branch produced the result -- this is
  // the actual gap #723 named ("no persisted run-status/result history").
  describe('runBackup history persistence (#723, RF013 AC#1/AC#3)', () => {
    function fakeHistoryDb() {
      const insertOne = vi.fn().mockResolvedValue({ insertedId: 'history-1' });
      return { db: { collection: vi.fn(() => ({ insertOne })) }, insertOne };
    }

    it('does not touch the db when none is passed (backward-compatible default)', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = undefined;
      env.BACKUP_DIR = path.join('C:', 'tmp', 'backup-service-test-history-1');

      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([]);
      vi.spyOn(fs.promises, 'writeFile').mockResolvedValue();
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => cb(null, 'ok', ''));

      const backupService = freshBackupService();
      await expect(backupService.runBackup()).resolves.toMatchObject({ success: true });
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
      const db = { collection: vi.fn(() => ({ insertOne: vi.fn().mockRejectedValue(new Error('history db down')) })) };

      const result = await backupService.runBackup(db);

      expect(result.success).toBe(true);
      expect(logger.error).toHaveBeenCalledWith('Erro ao registrar histórico de backup:', 'history db down');
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
      const db = dbWithPolicy({ retentionDays: 90 });
      await backupService.runBackup(db);

      // A 45-day-old dated folder is stale under the env var's 30-day
      // retention but not under the policy's 90 -- proves 90 (the
      // policy's value), not 30 (the env var), is what actually governed
      // cleanup.
      expect(fs.promises.rm).not.toHaveBeenCalled();
    });

    it('falls back to the env retention when the policy returns a non-numeric retentionDays', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = undefined;
      env.BACKUP_DIR = path.join('C:', 'tmp', 'backup-service-test-policy-retention-invalid');
      env.BACKUP_RETENTION_DAYS = '5';

      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
      mockBaseDirListing(env.BACKUP_DIR);
      vi.spyOn(fs.promises, 'writeFile').mockResolvedValue();
      vi.spyOn(fs.promises, 'rm').mockResolvedValue();
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => cb(null, 'ok', ''));

      const backupService = freshBackupService();
      const db = dbWithPolicy({ retentionDays: 'not-a-number', encryptionEnabled: false });
      await backupService.runBackup(db);

      // Invalid policy data must not disable retention. The configured
      // five-day fallback still removes this 45-day-old backup directory.
      expect(fs.promises.rm).toHaveBeenCalled();
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
      const db = { collection: vi.fn(() => { throw new Error('db unavailable'); }) };
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
        cb({ message: 'ENOENT' }, '', '');
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

    it('reports checksumVerified=false when the manifest checksum does not match the recomputed one', async () => {
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

      expect(result.success).toBe(true);
      expect(result.checksumVerified).toBe(false);
    });

    it('reports checksumVerified=false when there is no manifest at all', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';

      vi.spyOn(fs, 'existsSync').mockImplementation((p) => !String(p).endsWith('manifest.json'));
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([]);
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => cb(null, 'restored', ''));

      const fakeDb = { listCollections: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })), dropDatabase: vi.fn().mockResolvedValue() };
      const fakeClient = { connect: vi.fn().mockResolvedValue(), db: vi.fn(() => fakeDb), close: vi.fn().mockResolvedValue() };
      vi.spyOn(mongodb, 'MongoClient').mockImplementation(function () { return fakeClient; });

      const backupService = freshBackupService();
      const result = await backupService.testRestoreBackup(path.join('C:', 'tmp', 'backup'));

      expect(result.success).toBe(true);
      expect(result.checksumVerified).toBe(false);
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
  });


    it('does not let a restoreTestHistory write failure replace a successful controlled restore result', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = 'mydb';
      const backupPath = path.join('C:', 'tmp', 'backup-history-write-failure');

      vi.spyOn(fs, 'existsSync').mockImplementation((p) => !String(p).endsWith('manifest.json'));
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([]);
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => cb(null, 'restored', ''));

      const scratchDb = {
        listCollections: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
        dropDatabase: vi.fn().mockResolvedValue(),
      };
      vi.spyOn(mongodb, 'MongoClient').mockImplementation(function () {
        return {
          connect: vi.fn().mockResolvedValue(),
          db: vi.fn(() => scratchDb),
          close: vi.fn().mockResolvedValue(),
        };
      });

      const historyInsert = vi.fn().mockRejectedValue(new Error('restore history unavailable'));
      const appDb = {
        collection: vi.fn((name) => {
          expect(name).toBe('restoreTestHistory');
          return { insertOne: historyInsert };
        }),
      };

      const backupService = freshBackupService();
      const result = await backupService.testRestoreBackup(backupPath, appDb);

      expect(result).toMatchObject({
        success: true,
        mode: 'mongorestore',
        checksumVerified: false,
        restoredCollections: 0,
        restoredDocuments: 0,
      });
      expect(historyInsert).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        'Erro ao registrar histórico de teste de restauração:',
        'restore history unavailable'
      );
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
        cb({ message: "'mongodump' is not recognized as an internal or external command" }, '', 'is not recognized');
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

    it('encrypts a real nested mongodump tree and decrypts it only in the disposable restore copy', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/mydb';
      env.MONGO_DB = 'mydb';
      const os = require('os');
      const baseDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bioavanced-item8-mongodump-'));
      env.BACKUP_DIR = baseDir;

      const originalEncryptionKey = process.env.ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

      const plaintext = Buffer.from('SYNTHETIC-BSON-PAYLOAD-ITEM8');
      let restoredBytes = null;
      let restoreSourcePath = null;

      try {
        vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => {
          if (command.startsWith('mongodump ')) {
            const outMatch = command.match(/--out="([^"]+)"/);
            if (!outMatch) return cb(new Error('missing mongodump output path'), '', '');
            const dumpDbDir = path.join(outMatch[1], 'mydb');
            fs.mkdirSync(dumpDbDir, { recursive: true });
            fs.writeFileSync(path.join(dumpDbDir, 'patients.bson'), plaintext);
            fs.writeFileSync(path.join(dumpDbDir, 'patients.metadata.json'), '{"indexes":[]}');
            return cb(null, 'dumped', '');
          }

          if (command.startsWith('mongorestore ')) {
            const sourceMatch = command.match(/"([^"]+)"\s*$/);
            if (!sourceMatch) return cb(new Error('missing restore source path'), '', '');
            restoreSourcePath = sourceMatch[1];
            restoredBytes = fs.readFileSync(path.join(restoreSourcePath, 'mydb', 'patients.bson'));
            return cb(null, 'restored', '');
          }

          return cb(new Error(`unexpected command: ${command}`), '', '');
        });

        const backupService = freshBackupService();
        const backupResult = await backupService.runBackup(makeAppDbWithPolicy(true));

        expect(backupResult.success).toBe(true);
        expect(backupResult.mode).toBe('mongodump');

        const manifest = JSON.parse(
          await fs.promises.readFile(path.join(backupResult.path, 'manifest.json'), 'utf8')
        );
        expect(manifest.encrypted).toBe(true);
        expect(manifest.encryptedFiles).toHaveLength(2);
        expect(manifest.encryptedFiles.map((entry) => entry.file).sort()).toEqual([
          'mydb/patients.bson',
          'mydb/patients.metadata.json',
        ]);

        const encryptedBson = await fs.promises.readFile(
          path.join(backupResult.path, 'mydb', 'patients.bson')
        );
        expect(encryptedBson.equals(plaintext)).toBe(false);

        const restoreResult = await backupService.restoreBackup(backupResult.path);
        expect(restoreResult).toMatchObject({ success: true, mode: 'mongorestore' });
        expect(restoredBytes).not.toBeNull();
        expect(restoredBytes.equals(plaintext)).toBe(true);
        expect(restoreSourcePath).toContain('.restore-scratch');
        expect(restoreSourcePath).not.toBe(backupResult.path);

        const originalStillEncrypted = await fs.promises.readFile(
          path.join(backupResult.path, 'mydb', 'patients.bson')
        );
        expect(originalStillEncrypted.equals(plaintext)).toBe(false);
        expect(fs.existsSync(restoreSourcePath)).toBe(false);
      } finally {
        if (originalEncryptionKey === undefined) delete process.env.ENCRYPTION_KEY;
        else process.env.ENCRYPTION_KEY = originalEncryptionKey;
        await fs.promises.rm(baseDir, { recursive: true, force: true });
      }
    });

  });

  describe('item 8 backup fallback and manifest guards', () => {
    it('falls back to the canonical default database name when a valid Mongo URI omits its database path', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017';
      env.MONGO_DB = undefined;
      env.BACKUP_DIR = path.join('C:', 'tmp', 'backup-item8-root-uri');

      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([]);
      const writeFile = vi.spyOn(fs.promises, 'writeFile').mockResolvedValue();
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => cb(null, 'ok', ''));

      const backupService = freshBackupService();
      const result = await backupService.runBackup();

      expect(result.success).toBe(true);
      const manifestCall = writeFile.mock.calls.find(([file]) => String(file).endsWith('manifest.json'));
      expect(manifestCall).toBeTruthy();
      expect(JSON.parse(manifestCall[1]).dbName).toBe('bioavanced');
    });

    it('falls back to the canonical default database name when MONGO_URI has no parseable URL shape', async () => {
      env.MONGO_URI = 'not-a-valid-mongodb-url';
      env.MONGO_DB = undefined;
      env.BACKUP_DIR = path.join('C:', 'tmp', 'backup-item8-invalid-uri');

      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([]);
      const writeFile = vi.spyOn(fs.promises, 'writeFile').mockResolvedValue();
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => cb(null, 'ok', ''));

      const backupService = freshBackupService();
      const result = await backupService.runBackup();

      expect(result.success).toBe(true);
      const manifestCall = writeFile.mock.calls.find(([file]) => String(file).endsWith('manifest.json'));
      expect(manifestCall).toBeTruthy();
      expect(JSON.parse(manifestCall[1]).dbName).toBe('bioavanced');
    });

    it('ignores an unreadable restore manifest and still restores an unencrypted mongodump', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = undefined;
      const backupPath = path.join('C:', 'tmp', 'backup-item8-bad-manifest');

      vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
        const value = String(p);
        return value === backupPath || value.endsWith('manifest.json');
      });
      vi.spyOn(fs.promises, 'readFile').mockRejectedValueOnce(new Error('manifest unreadable'));
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => cb(null, 'restored', ''));

      const backupService = freshBackupService();
      const result = await backupService.restoreBackup(backupPath);

      expect(result).toMatchObject({ success: true, mode: 'mongorestore' });
      expect(cp.exec).toHaveBeenCalledWith(
        expect.stringContaining(`"${backupPath}"`),
        { windowsHide: true },
        expect.any(Function)
      );
    });

    it('returns the generic restore failure when the command error has no usable message', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs.promises, 'readFile').mockResolvedValue('{}');
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => cb({}, '', ''));

      const backupService = freshBackupService();
      const result = await backupService.restoreBackup(path.join('C:', 'tmp', 'backup-item8-generic-error'));

      expect(result).toEqual({ success: false, error: 'Erro ao restaurar backup' });
    });

    it('keeps cleanupOldBackups as a no-op when the base directory is absent', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      const readdir = vi.spyOn(fs.promises, 'readdir');

      const backupService = freshBackupService();
      await expect(backupService.cleanupOldBackups('/missing-backup-root', 30)).resolves.toBeUndefined();

      expect(readdir).not.toHaveBeenCalled();
    });
  });


  describe('item 8 backup path selection branches', () => {
    it('resolves restore scratch from env and then from the backup-root default', () => {
      const original = env.RESTORE_SCRATCH_DIR;
      try {
        env.BACKUP_DIR = path.join('C:', 'tmp', 'backup-item8-root');
        env.RESTORE_SCRATCH_DIR = path.join('C:', 'tmp', 'explicit-restore-scratch');
        let backupService = freshBackupService();
        expect(backupService.getRestoreScratchBaseDir()).toBe(env.RESTORE_SCRATCH_DIR);

        env.RESTORE_SCRATCH_DIR = undefined;
        backupService = freshBackupService();
        expect(backupService.getRestoreScratchBaseDir()).toBe(
          path.join(env.BACKUP_DIR, '.restore-scratch')
        );
      } finally {
        env.RESTORE_SCRATCH_DIR = original;
      }
    });

    it('returns null when no backup root exists and never attempts directory enumeration', () => {
      env.BACKUP_DIR = path.join('C:', 'tmp', 'backup-item8-missing-root');
      const exists = vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      const readdir = vi.spyOn(fs, 'readdirSync');

      const backupService = freshBackupService();
      expect(backupService.getLatestBackupPath()).toBeNull();

      expect(exists).toHaveBeenCalledWith(env.BACKUP_DIR);
      expect(readdir).not.toHaveBeenCalled();
    });

    it('ignores dot-prefixed restore scratch directories and chooses the newest real backup', () => {
      env.BACKUP_DIR = path.join('C:', 'tmp', 'backup-item8-latest');
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readdirSync').mockReturnValue([
        { name: '.restore-scratch', isDirectory: () => true },
        { name: '2026-09-18_1-0-0', isDirectory: () => true },
        { name: '2026-09-19_1-0-0', isDirectory: () => true },
        { name: 'README.txt', isDirectory: () => false },
      ]);
      vi.spyOn(fs, 'statSync').mockImplementation((fullPath) => ({
        birthtime: new Date(String(fullPath).includes('2026-09-19') ? '2026-09-19T01:00:00Z' : '2026-09-18T01:00:00Z'),
      }));

      const backupService = freshBackupService();
      expect(backupService.getLatestBackupPath()).toBe(
        path.join(env.BACKUP_DIR, '2026-09-19_1-0-0')
      );
      expect(fs.statSync).not.toHaveBeenCalledWith(
        path.join(env.BACKUP_DIR, '.restore-scratch')
      );
    });

    it('returns null when the backup root contains only non-backup entries', () => {
      env.BACKUP_DIR = path.join('C:', 'tmp', 'backup-item8-empty-latest');
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readdirSync').mockReturnValue([
        { name: '.restore-scratch', isDirectory: () => true },
        { name: 'README.txt', isDirectory: () => false },
      ]);

      const backupService = freshBackupService();
      expect(backupService.getLatestBackupPath()).toBeNull();
    });
  });

});
