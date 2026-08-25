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
        collection: vi.fn((name) => (name === 'patients' ? fakeCollectionA : fakeCollectionB))
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
        expect.stringContaining('mongorestore --uri="mongodb://localhost:27017/test" --drop'),
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
      expect(fakeCollection.insertMany).toHaveBeenCalledWith(
        [{ _id: 1, name: 'restored-patient' }],
        { ordered: false }
      );
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
      const fakeScratchDb = { listCollections: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([{ name: 'patients' }]) })), dropDatabase };
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

    it('returns a generic failure result when mongorestore fails for a non-missing-binary reason (checksumVerified still reported)', async () => {
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

      const backupService = freshBackupService();
      const result = await backupService.testRestoreBackup(path.join('C:', 'tmp', 'backup'));

      expect(result.success).toBe(false);
      expect(result.error).toBe('permission denied');
      expect(result.checksumVerified).toBe(true);
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
});
