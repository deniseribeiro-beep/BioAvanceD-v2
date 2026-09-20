import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const mongodb = require('mongodb');
const logger = require('../../src/utils/logger');
const env = require('../../src/config/env');

const backupServicePath = require.resolve('../../src/services/backup.service');

function freshBackupService() {
  delete require.cache[backupServicePath];
  return require(backupServicePath);
}

function mockSuccessfulMongodump() {
  vi.spyOn(cp, 'exec').mockImplementation((_command, _opts, cb) => cb(null, 'ok', ''));
}

function mockMissingMongoTool(tool = 'mongodump') {
  vi.spyOn(cp, 'exec').mockImplementation((_command, _opts, cb) => {
    cb({ message: `${tool}: not found` }, '', 'not found');
  });
}

function mockJsonBackupClient() {
  const db = {
    listCollections: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
    collection: vi.fn(),
  };
  const client = {
    connect: vi.fn().mockResolvedValue(),
    db: vi.fn(() => db),
    close: vi.fn().mockResolvedValue(),
  };
  vi.spyOn(mongodb, 'MongoClient').mockImplementation(function () { return client; });
  return { client, db };
}

describe('backup.service item 8 executable residual branches', () => {
  const original = {
    MONGO_URI: env.MONGO_URI,
    MONGO_DB: env.MONGO_DB,
    BACKUP_DIR: env.BACKUP_DIR,
    BACKUP_RETENTION_DAYS: env.BACKUP_RETENTION_DAYS,
    RESTORE_SCRATCH_DIR: env.RESTORE_SCRATCH_DIR,
  };

  beforeEach(() => {
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.spyOn(logger, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    env.MONGO_URI = original.MONGO_URI;
    env.MONGO_DB = original.MONGO_DB;
    env.BACKUP_DIR = original.BACKUP_DIR;
    env.BACKUP_RETENTION_DAYS = original.BACKUP_RETENTION_DAYS;
    env.RESTORE_SCRATCH_DIR = original.RESTORE_SCRATCH_DIR;
    delete require.cache[backupServicePath];
  });

  it('uses the fallback retention expression when the resolved override is non-numeric on the mongodump path', async () => {
    env.MONGO_URI = 'mongodb://localhost:27017/test';
    env.MONGO_DB = undefined;
    env.BACKUP_DIR = '/tmp/item8-backup-retention-mongodump';
    env.BACKUP_RETENTION_DAYS = 'not-a-number';

    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
    vi.spyOn(fs.promises, 'readdir').mockResolvedValue([]);
    vi.spyOn(fs.promises, 'writeFile').mockResolvedValue();
    mockSuccessfulMongodump();

    const backupService = freshBackupService();
    const result = await backupService.runBackup();

    expect(result).toMatchObject({ success: true, mode: 'mongodump' });
  });

  it('uses the fallback retention expression after a JSON backup fallback as well', async () => {
    env.MONGO_URI = 'mongodb://localhost:27017/test';
    env.MONGO_DB = undefined;
    env.BACKUP_DIR = '/tmp/item8-backup-retention-json';
    env.BACKUP_RETENTION_DAYS = 'not-a-number';

    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
    vi.spyOn(fs.promises, 'readdir').mockResolvedValue([]);
    vi.spyOn(fs.promises, 'writeFile').mockResolvedValue();
    mockMissingMongoTool('mongodump');
    mockJsonBackupClient();

    const backupService = freshBackupService();
    const result = await backupService.runBackup();

    expect(result).toMatchObject({ success: true, mode: 'json-fallback' });
  });

  it('returns the documented generic backup error when mongodump fails without a message', async () => {
    env.MONGO_URI = 'mongodb://localhost:27017/test';
    env.MONGO_DB = undefined;
    env.BACKUP_DIR = '/tmp/item8-backup-generic-error';

    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
    vi.spyOn(cp, 'exec').mockImplementation((_command, _opts, cb) => cb({}, '', ''));

    const backupService = freshBackupService();
    const result = await backupService.runBackup();

    expect(result).toEqual({ success: false, error: 'Erro ao executar backup' });
    expect(logger.error).toHaveBeenCalledWith('Erro ao executar backup:', 'Erro desconhecido');
  });

  it('normalizes a non-Error value thrown by the JSON backup fallback', async () => {
    env.MONGO_URI = 'mongodb://localhost:27017/test';
    env.MONGO_DB = undefined;
    env.BACKUP_DIR = '/tmp/item8-backup-string-error';

    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
    mockMissingMongoTool('mongodump');
    vi.spyOn(mongodb, 'MongoClient').mockImplementation(function () {
      throw 'json-backup-constructor-failed';
    });

    const backupService = freshBackupService();
    const result = await backupService.runBackup();

    expect(result).toEqual({ success: false, error: 'json-backup-constructor-failed' });
    expect(logger.error).toHaveBeenCalledWith(
      'Erro no fallback de backup JSON:',
      'json-backup-constructor-failed'
    );
  });

  it('normalizes a non-Error value thrown by the live JSON restore fallback', async () => {
    env.MONGO_URI = 'mongodb://localhost:27017/test';
    env.MONGO_DB = undefined;
    const backupPath = '/tmp/item8-restore-string-error';

    vi.spyOn(fs, 'existsSync').mockImplementation((target) => String(target) === backupPath);
    mockMissingMongoTool('mongorestore');
    vi.spyOn(mongodb, 'MongoClient').mockImplementation(function () {
      throw 'json-restore-constructor-failed';
    });

    const backupService = freshBackupService();
    const result = await backupService.restoreBackup(backupPath);

    expect(result).toEqual({ success: false, error: 'json-restore-constructor-failed' });
    expect(logger.error).toHaveBeenCalledWith(
      'Erro no fallback de restore JSON:',
      'json-restore-constructor-failed'
    );
  });

  it('normalizes non-Error fallback and scratch-drop failures during the controlled restore test', async () => {
    env.MONGO_URI = 'mongodb://localhost:27017/test';
    env.MONGO_DB = undefined;
    const backupPath = '/tmp/item8-controlled-restore-string-error';

    vi.spyOn(fs, 'existsSync').mockImplementation((target) => String(target) === backupPath);
    vi.spyOn(fs.promises, 'readdir').mockResolvedValue([]);
    mockMissingMongoTool('mongorestore');
    vi.spyOn(mongodb, 'MongoClient').mockImplementation(function () {
      throw 'controlled-restore-mongo-constructor-failed';
    });

    const backupService = freshBackupService();
    const result = await backupService.testRestoreBackup(backupPath);

    expect(result).toMatchObject({
      success: false,
      error: 'controlled-restore-mongo-constructor-failed',
      checksumVerified: false,
    });
    expect(logger.error).toHaveBeenCalledWith(
      'Erro no fallback de teste de restauração JSON:',
      'controlled-restore-mongo-constructor-failed'
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('_restoretest_'),
      'controlled-restore-mongo-constructor-failed'
    );
  });

  it('uses the generic controlled-restore error when mongorestore supplies no message', async () => {
    env.MONGO_URI = 'mongodb://localhost:27017/test';
    env.MONGO_DB = 'mydb';
    const backupPath = '/tmp/item8-controlled-restore-generic-error';

    vi.spyOn(fs, 'existsSync').mockImplementation((target) => String(target) === backupPath);
    vi.spyOn(fs.promises, 'readdir').mockResolvedValue([]);
    vi.spyOn(cp, 'exec').mockImplementation((_command, _opts, cb) => cb({}, '', ''));

    const scratchDb = {
      dropDatabase: vi.fn().mockResolvedValue(),
    };
    const client = {
      connect: vi.fn().mockResolvedValue(),
      db: vi.fn(() => scratchDb),
      close: vi.fn().mockResolvedValue(),
    };
    vi.spyOn(mongodb, 'MongoClient').mockImplementation(function () { return client; });

    const backupService = freshBackupService();
    const result = await backupService.testRestoreBackup(backupPath);

    expect(result).toMatchObject({
      success: false,
      error: 'Erro ao testar restauração',
      checksumVerified: false,
    });
    expect(scratchDb.dropDatabase).toHaveBeenCalled();
  });

  it('skips malformed encrypted-file manifest entries and does not let decrypted-copy cleanup failure mask success', async () => {
    env.MONGO_URI = 'mongodb://localhost:27017/test';
    env.MONGO_DB = 'mydb';
    env.BACKUP_DIR = '/tmp/item8-backups';
    env.RESTORE_SCRATCH_DIR = '/tmp/item8-restore-scratch';
    const backupPath = '/tmp/item8-encrypted-backup';
    const scratchCopy = '/tmp/item8-restore-scratch/decrypted-copy';

    const manifest = {
      type: 'mongodump',
      dbName: 'mydb',
      encrypted: true,
      encryptedFiles: [null, {}, { file: 42 }],
    };

    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs.promises, 'readFile').mockImplementation(async (target) => {
      if (String(target).endsWith('manifest.json')) return JSON.stringify(manifest);
      throw new Error(`unexpected readFile: ${target}`);
    });
    vi.spyOn(fs.promises, 'readdir').mockResolvedValue([]);
    vi.spyOn(fs.promises, 'mkdtemp').mockResolvedValue(scratchCopy);
    vi.spyOn(fs.promises, 'cp').mockResolvedValue();
    vi.spyOn(fs.promises, 'rm').mockRejectedValue('scratch-cleanup-failed');
    mockSuccessfulMongodump();

    const scratchDb = {
      listCollections: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
      collection: vi.fn(),
      dropDatabase: vi.fn().mockResolvedValue(),
    };
    const client = {
      connect: vi.fn().mockResolvedValue(),
      db: vi.fn(() => scratchDb),
      close: vi.fn().mockResolvedValue(),
    };
    vi.spyOn(mongodb, 'MongoClient').mockImplementation(function () { return client; });

    const backupService = freshBackupService();
    const result = await backupService.testRestoreBackup(backupPath);

    expect(result).toMatchObject({
      success: true,
      mode: 'mongorestore',
      restoredCollections: 0,
      restoredDocuments: 0,
    });
    expect(fs.promises.cp).toHaveBeenCalledWith(
      backupPath,
      scratchCopy,
      expect.objectContaining({ recursive: true })
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(scratchCopy),
      'scratch-cleanup-failed'
    );
  });
});
