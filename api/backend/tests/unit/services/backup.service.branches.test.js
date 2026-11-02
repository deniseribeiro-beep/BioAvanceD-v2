import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const path = require('path');
const fs = require('fs');
const os = require('os');
const cp = require('child_process');
const mongodb = require('mongodb');
const logger = require('../../../src/utils/logger');
const env = require('../../../src/config/env');
const backupStores = require('../../../src/services/backup-stores.service');
const backupOffsite = require('../../../src/services/backup-offsite.service');

// #1337: the branches backup.service.test.js leaves uncovered -- the
// encrypted mongodump restore paths, the EJSON wrapper classifier, and the
// failure arms whose error carries no message. Same fresh-require approach
// as that file: exec and MongoClient are destructured at module load, so
// they are spied on before backup.service.js is required again.
const backupServicePath = require.resolve('../../../src/services/backup.service');

function freshBackupService() {
  delete require.cache[backupServicePath];
  return require(backupServicePath);
}

const { BSON } = mongodb;

describe('backup.service branches (#1337)', () => {
  const saved = {};
  const created = [];

  beforeEach(() => {
    for (const key of ['MONGO_URI', 'MONGO_DB', 'BACKUP_DIR', 'BACKUP_RETENTION_DAYS', 'RESTORE_SCRATCH_DIR']) {
      saved[key] = env[key];
    }
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(backupStores, 'exportSecondaryStores').mockResolvedValue({
      neo4j: { status: 'skipped', reason: 'not_configured' },
      influxdb: { status: 'skipped', reason: 'not_configured' },
    });
    vi.spyOn(backupStores, 'verifySecondaryStores').mockResolvedValue({ stores: null, error: null });
    vi.spyOn(backupOffsite, 'uploadBackupRunOffsite').mockResolvedValue({ status: 'skipped', reason: 'not_configured' });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const key of Object.keys(saved)) env[key] = saved[key];
    for (const dir of created.splice(0)) {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
    delete require.cache[backupServicePath];
  });

  function tempDir(prefix) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    created.push(dir);
    return dir;
  }

  function policyDb(encryptionEnabled) {
    const findOne = vi.fn().mockResolvedValue({ encryptionEnabled });
    const insertOne = vi.fn().mockResolvedValue({ insertedId: 'h1' });
    return {
      collection: vi.fn((name) => (name === 'backup_policy' ? { findOne } : { insertOne })),
    };
  }

  function fakeMongo({ connectError, dropError } = {}) {
    const db = {
      listCollections: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([{ name: 'patients' }]) })),
      collection: vi.fn(() => ({ countDocuments: vi.fn().mockResolvedValue(1) })),
      dropDatabase: dropError === undefined ? vi.fn().mockResolvedValue() : vi.fn().mockRejectedValue(dropError),
    };
    const client = {
      connect: connectError === undefined ? vi.fn().mockResolvedValue() : vi.fn().mockRejectedValue(connectError),
      db: vi.fn(() => db),
      close: vi.fn().mockResolvedValue(),
    };
    vi.spyOn(mongodb, 'MongoClient').mockImplementation(function () { return client; });
    return { client, db };
  }

  // A real encrypted mongodump backup, written by runBackup itself with
  // mongodump replaced by a writer of one BSON payload file. `restoreSeen`
  // collects, per mongorestore call, the source directory it was handed and
  // the payload bytes found there.
  async function encryptedDump(baseDir, restoreSeen, { extraTree } = {}) {
    env.MONGO_URI = 'mongodb://localhost:27017/test';
    env.MONGO_DB = 'mydb';
    env.BACKUP_DIR = baseDir;
    vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => {
      if (command.startsWith('mongodump')) {
        const outDir = /--out="([^"]+)"/.exec(command)[1];
        fs.mkdirSync(path.join(outDir, 'mydb'), { recursive: true });
        fs.writeFileSync(path.join(outDir, 'mydb', 'patients.bson'), 'BSON-PAYLOAD');
        if (extraTree) extraTree(outDir);
        return cb(null, 'ok', '');
      }
      const source = /"([^"]+)"$/.exec(command)[1];
      restoreSeen.push({
        source,
        payload: fs.readFileSync(path.join(source, 'mydb', 'patients.bson'), 'utf8'),
        hasManifest: fs.existsSync(path.join(source, 'manifest.json')),
      });
      return cb(null, 'restored', '');
    });
    const backupService = freshBackupService();
    const result = await backupService.runBackup(policyDb(true));
    expect(result.success).toBe(true);
    return { backupService, backupPath: result.path };
  }

  describe('encrypted mongodump backups', () => {
    it('encrypts only regular dump files, skipping a stale top-level manifest.json and a link', async () => {
      const baseDir = tempDir('bioavanced-1337-enc-');
      const linkTarget = tempDir('bioavanced-1337-link-');
      const { backupPath } = await encryptedDump(baseDir, [], {
        extraTree: (outDir) => {
          fs.writeFileSync(path.join(outDir, 'manifest.json'), '{"stale":true}');
          fs.symlinkSync(linkTarget, path.join(outDir, 'linked'), 'junction');
        },
      });

      const manifest = JSON.parse(fs.readFileSync(path.join(backupPath, 'manifest.json'), 'utf8'));
      expect(manifest.encrypted).toBe(true);
      expect(manifest.encryptedFiles.map((entry) => entry.file)).toEqual(['mydb/patients.bson']);
      expect(fs.readFileSync(path.join(backupPath, 'mydb', 'patients.bson'), 'utf8')).not.toBe('BSON-PAYLOAD');
    });

    it('restoreBackup hands mongorestore a decrypted scratch copy without manifest.json, skips malformed entries, and removes the copy', async () => {
      const seen = [];
      const { backupService, backupPath } = await encryptedDump(tempDir('bioavanced-1337-rb-'), seen);
      const manifestPath = path.join(backupPath, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifest.encryptedFiles.push(null, { file: 5 });
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));

      const result = await backupService.restoreBackup(backupPath);

      expect(result.success).toBe(true);
      expect(seen).toHaveLength(1);
      expect(seen[0].source).not.toBe(backupPath);
      expect(seen[0].source.startsWith(backupService.getRestoreScratchBaseDir())).toBe(true);
      expect(seen[0].payload).toBe('BSON-PAYLOAD');
      expect(seen[0].hasManifest).toBe(false);
      expect(fs.existsSync(seen[0].source)).toBe(false);
      expect(fs.readFileSync(path.join(backupPath, 'mydb', 'patients.bson'), 'utf8')).not.toBe('BSON-PAYLOAD');
    });

    it.each([
      ['an Error', new Error('rm-failed'), 'rm-failed'],
      ['a non-Error value', 'rm-refused', 'rm-refused'],
    ])('restoreBackup keeps its result and logs when removing the scratch copy throws %s', async (_label, rmError, logged) => {
      const { backupService, backupPath } = await encryptedDump(tempDir('bioavanced-1337-rm-'), []);
      vi.spyOn(fs.promises, 'rm').mockRejectedValueOnce(rmError);

      const result = await backupService.restoreBackup(backupPath);

      expect(result.success).toBe(true);
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('cópia temporária descriptografada'), logged);
    });

    it('testRestoreBackup restores the decrypted scratch copy, verifies the checksum and removes the copy', async () => {
      const seen = [];
      fakeMongo();
      const { backupService, backupPath } = await encryptedDump(tempDir('bioavanced-1337-tr-'), seen);

      const result = await backupService.testRestoreBackup(backupPath);

      expect(result.success).toBe(true);
      expect(result.checksumVerified).toBe(true);
      expect(seen).toHaveLength(1);
      expect(seen[0].payload).toBe('BSON-PAYLOAD');
      expect(fs.existsSync(seen[0].source)).toBe(false);
    });

    it('testRestoreBackup reports a decryption failure as the test error, not as a missing mongorestore', async () => {
      const seen = [];
      fakeMongo();
      const { backupService, backupPath } = await encryptedDump(tempDir('bioavanced-1337-tag-'), seen);
      const manifestPath = path.join(backupPath, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifest.encryptedFiles[0].encryptionTag = Buffer.alloc(16).toString('base64');
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));

      const result = await backupService.testRestoreBackup(backupPath);

      expect(result.success).toBe(false);
      expect(result.mode).toBeUndefined();
      expect(result.error).toMatch(/authenticate/i);
      expect(seen).toHaveLength(0);
    });
  });

  describe('getLatestBackupPath', () => {
    it('returns null when the backup base directory does not exist', () => {
      env.BACKUP_DIR = path.join(tempDir('bioavanced-1337-nobase-'), 'absent');
      expect(freshBackupService().getLatestBackupPath()).toBeNull();
    });

    it('returns the backup directory with the newest birthtime', () => {
      const baseDir = tempDir('bioavanced-1337-latest-');
      env.BACKUP_DIR = baseDir;
      for (const name of ['2026-01-01', '2026-01-03', '2026-01-02']) fs.mkdirSync(path.join(baseDir, name));
      const birth = { '2026-01-01': 1000, '2026-01-02': 2000, '2026-01-03': 1500 };
      const realStat = fs.statSync;
      vi.spyOn(fs, 'statSync').mockImplementation((p, ...rest) => {
        const ms = birth[path.basename(String(p))];
        return ms === undefined ? realStat(p, ...rest) : { birthtime: new Date(ms) };
      });

      expect(freshBackupService().getLatestBackupPath()).toBe(path.join(baseDir, '2026-01-02'));
    });
  });

  describe('parseBackupDocs wrapper classification', () => {
    const OID = '507f1f77bcf86cd799439011';
    const WELL_FORMED = [
      ['$uuid', { $uuid: '00000000-0000-4000-8000-000000000000' }],
      ['$symbol', { $symbol: 'sym' }],
      ['$numberDouble special', { $numberDouble: 'Infinity' }],
      ['$minKey', { $minKey: 1 }],
      ['$maxKey', { $maxKey: 1 }],
      ['$regex with $options', { $regex: '^a', $options: 'i' }],
      ['$regularExpression', { $regularExpression: { pattern: '^a', options: 'i' } }],
      ['$timestamp', { $timestamp: { t: 1, i: 2 } }],
      ['$undefined', { $undefined: true }],
      ['$code with $scope', { $code: 'x', $scope: {} }],
      ['$dbPointer', { $dbPointer: { $ref: 'c', $id: { $oid: OID } } }],
    ];

    it.each(WELL_FORMED)('converts a well-formed %s wrapper exactly as EJSON.parse does, beside a legacy field', (_label, wrapper) => {
      const raw = JSON.stringify([{ v: wrapper, legacy: { $custom: 1 } }]);
      const docs = freshBackupService().parseBackupDocs(raw);
      const expected = BSON.EJSON.parse(JSON.stringify(wrapper), { relaxed: false });

      expect(docs[0].v).toEqual(expected);
      expect(docs[0].legacy).toEqual({ $custom: 1 });
    });

    const LEGACY = [
      ['a non-string $numberInt', { $numberInt: 5 }],
      ['a non-string $numberLong', { $numberLong: 5 }],
      ['a $date holding a number', { $date: 5 }],
      ['a $-name no wrapper uses', { $custom: 'x' }],
      ['a wrapper beside an unknown $-key', { $oid: OID, $extra: 1 }],
    ];

    it.each(LEGACY)('keeps %s as plain JSON', (_label, value) => {
      const docs = freshBackupService().parseBackupDocs(JSON.stringify([{ v: value }]));
      expect(docs[0].v).toEqual(value);
    });

    it('throws on input that is neither JSON nor EJSON', () => {
      expect(() => freshBackupService().parseBackupDocs('{not json')).toThrow();
    });
  });

  describe('runBackup failure arms', () => {
    function mongodumpOk(baseDir) {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = undefined;
      env.BACKUP_DIR = baseDir;
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => {
        fs.mkdirSync(/--out="([^"]+)"/.exec(command)[1], { recursive: true });
        cb(null, 'ok', '');
      });
    }

    it('reports a store export that rejects with a non-Error value', async () => {
      mongodumpOk(tempDir('bioavanced-1337-store-'));
      backupStores.exportSecondaryStores.mockRejectedValue('store-down');

      const result = await freshBackupService().runBackup(policyDb(false));

      expect(result).toEqual({ success: false, error: 'store-down' });
    });

    it('reports an off-site upload that rejects with a non-Error value, keeping path and checksum', async () => {
      mongodumpOk(tempDir('bioavanced-1337-off-'));
      backupOffsite.uploadBackupRunOffsite.mockRejectedValue('offsite-down');

      const result = await freshBackupService().runBackup(policyDb(false));

      expect(result.success).toBe(false);
      expect(result.error).toBe('offsite-down');
      expect(result.checksum).toMatch(/^[0-9a-f]{64}$/);
    });

    it('records the database name as bioavanced when the URI has no path and MONGO_DB is unset', async () => {
      mongodumpOk(tempDir('bioavanced-1337-dbname-'));
      env.MONGO_URI = 'mongodb://localhost:27017';

      const result = await freshBackupService().runBackup(policyDb(false));

      expect(result.success).toBe(true);
      const manifest = JSON.parse(fs.readFileSync(path.join(result.path, 'manifest.json'), 'utf8'));
      expect(manifest.dbName).toBe('bioavanced');
    });

    it('keeps every backup when the retention setting is not a number (mongodump path)', async () => {
      const baseDir = tempDir('bioavanced-1337-nan-');
      fs.mkdirSync(path.join(baseDir, '2000-01-01'));
      mongodumpOk(baseDir);
      env.BACKUP_RETENTION_DAYS = 'not-a-number';

      const result = await freshBackupService().runBackup(policyDb(false));

      expect(result.success).toBe(true);
      expect(fs.existsSync(path.join(baseDir, '2000-01-01'))).toBe(true);
    });

    it('keeps every backup when the retention setting is not a number (JSON-fallback path)', async () => {
      const baseDir = tempDir('bioavanced-1337-nanjson-');
      fs.mkdirSync(path.join(baseDir, '2000-01-01'));
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = 'mydb';
      env.BACKUP_DIR = baseDir;
      env.BACKUP_RETENTION_DAYS = 'not-a-number';
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => cb({ message: 'spawn mongodump ENOENT' }, '', ''));
      const { db } = fakeMongo();
      db.listCollections = vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) }));

      const result = await freshBackupService().runBackup(policyDb(false));

      expect(result.success).toBe(true);
      expect(result.mode).toBe('json-fallback');
      expect(fs.existsSync(path.join(baseDir, '2000-01-01'))).toBe(true);
    });

    it('reports a JSON fallback that fails with a non-Error value', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.BACKUP_DIR = tempDir('bioavanced-1337-fbstr-');
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => cb({ message: 'spawn mongodump ENOENT' }, '', ''));
      fakeMongo({ connectError: 'mongo-down' });

      const result = await freshBackupService().runBackup(policyDb(false));

      expect(result).toEqual({ success: false, error: 'mongo-down' });
    });

    it('returns the generic message when mongodump fails with no message', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.BACKUP_DIR = tempDir('bioavanced-1337-nomsg-');
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => cb({}, '', ''));

      const result = await freshBackupService().runBackup(policyDb(false));

      expect(result).toEqual({ success: false, error: 'Erro ao executar backup' });
      expect(logger.error).toHaveBeenCalledWith('Erro ao executar backup:', 'Erro desconhecido');
    });
  });

  describe('restoreBackup failure arms', () => {
    function plainBackup() {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = undefined;
      return tempDir('bioavanced-1337-plain-');
    }

    it('returns the generic message when mongorestore fails with no message', async () => {
      const backupPath = plainBackup();
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => cb({}, '', ''));

      const result = await freshBackupService().restoreBackup(backupPath);

      expect(result).toEqual({ success: false, error: 'Erro ao restaurar backup' });
    });

    it('reports a JSON restore fallback that fails with a non-Error value', async () => {
      const backupPath = plainBackup();
      fs.writeFileSync(path.join(backupPath, 'patients.json'), '[]');
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => cb({ message: 'spawn mongorestore ENOENT' }, '', ''));
      fakeMongo({ connectError: 'mongo-down' });

      const result = await freshBackupService().restoreBackup(backupPath);

      expect(result).toEqual({ success: false, error: 'mongo-down' });
    });
  });

  describe('testRestoreBackup failure arms', () => {
    function plainBackup() {
      env.MONGO_URI = 'mongodb://localhost:27017/test';
      env.MONGO_DB = undefined;
      return tempDir('bioavanced-1337-trplain-');
    }

    it('returns the generic message when mongorestore fails with no message', async () => {
      const backupPath = plainBackup();
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => cb({}, '', ''));
      fakeMongo();

      const result = await freshBackupService().testRestoreBackup(backupPath);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Erro ao testar restauração');
    });

    it('reports a store check that rejects with a non-Error value', async () => {
      const backupPath = plainBackup();
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => cb(null, 'restored', ''));
      backupStores.verifySecondaryStores.mockRejectedValue('stores-down');
      fakeMongo();

      const result = await freshBackupService().testRestoreBackup(backupPath);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Teste de restauração dos stores falhou: stores-down');
    });

    it('logs a scratch-db drop that rejects with a non-Error value', async () => {
      const backupPath = plainBackup();
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => cb(null, 'restored', ''));
      fakeMongo({ dropError: 'drop-refused' });

      await freshBackupService().testRestoreBackup(backupPath);

      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('_restoretest_'), 'drop-refused');
    });

    it('reports a JSON fallback that fails with a non-Error value', async () => {
      const backupPath = plainBackup();
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => cb({ message: 'spawn mongorestore ENOENT' }, '', ''));
      fakeMongo({ connectError: 'mongo-down' });

      const result = await freshBackupService().testRestoreBackup(backupPath);

      expect(result.success).toBe(false);
      expect(result.error).toBe('mongo-down');
    });

    it('names the scratch db after bioavanced for an unparseable URI and a manifest that does not parse', async () => {
      const backupPath = plainBackup();
      env.MONGO_URI = 'not a uri';
      fs.writeFileSync(path.join(backupPath, 'manifest.json'), '{broken');
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => cb(null, 'restored', ''));
      fakeMongo();

      const result = await freshBackupService().testRestoreBackup(backupPath);

      expect(result.scratchDb).toMatch(/^bioavanced_restoretest_\d+$/);
      expect(result.checksumVerified).toBe(false);
    });

    it('keeps the result when writing the restoreTestHistory row throws', async () => {
      const backupPath = plainBackup();
      vi.spyOn(cp, 'exec').mockImplementation((command, opts, cb) => cb(null, 'restored', ''));
      fakeMongo();
      const historyDb = { collection: vi.fn(() => ({ insertOne: vi.fn().mockRejectedValue(new Error('history-down')) })) };

      const result = await freshBackupService().testRestoreBackup(backupPath, historyDb);

      expect(result.mode).toBe('mongorestore');
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('teste de restauração'), 'history-down');
    });
  });
});
