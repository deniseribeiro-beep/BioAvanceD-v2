import { afterEach, describe, expect, it, vi } from 'vitest';

const fs = require('fs');
const path = require('path');
const os = require('os');
const backup = require('../../src/services/backup.service');
const backupPolicyService = require('../../src/services/backup-policy.service');

const h = backup._test;
const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe('backup.service helper residual branches', () => {
  it('resolves retention with no db, policy value, invalid policy and lookup failure', async () => {
    await expect(h.resolveRetentionDays(null)).resolves.toBeGreaterThan(0);

    const getPolicy = vi.spyOn(backupPolicyService, 'getPolicy');
    getPolicy.mockResolvedValueOnce({ retentionDays: '45' });
    await expect(h.resolveRetentionDays({})).resolves.toBe(45);

    getPolicy.mockResolvedValueOnce({ retentionDays: 'not-a-number' });
    await expect(h.resolveRetentionDays({})).resolves.toBeGreaterThan(0);

    getPolicy.mockRejectedValueOnce(new Error('policy down'));
    await expect(h.resolveRetentionDays({})).resolves.toBeGreaterThan(0);
  });

  it('resolves encryption only from an explicit boolean policy and fails open otherwise', async () => {
    await expect(h.resolveEncryptionEnabled(null)).resolves.toBe(false);

    const getPolicy = vi.spyOn(backupPolicyService, 'getPolicy');
    getPolicy.mockResolvedValueOnce({ encryptionEnabled: true });
    await expect(h.resolveEncryptionEnabled({})).resolves.toBe(true);

    getPolicy.mockResolvedValueOnce({ encryptionEnabled: false });
    await expect(h.resolveEncryptionEnabled({})).resolves.toBe(false);

    getPolicy.mockResolvedValueOnce({ encryptionEnabled: 'true' });
    await expect(h.resolveEncryptionEnabled({})).resolves.toBe(false);

    getPolicy.mockRejectedValueOnce(new Error('policy down'));
    await expect(h.resolveEncryptionEnabled({})).resolves.toBe(false);
  });

  it('recognizes only complete encrypted mongodump manifests', () => {
    expect(h.isEncryptedMongodumpManifest(null)).toBe(false);
    expect(h.isEncryptedMongodumpManifest({ type: 'json-fallback', encrypted: true, encryptedFiles: [] })).toBe(false);
    expect(h.isEncryptedMongodumpManifest({ type: 'mongodump', encrypted: false, encryptedFiles: [] })).toBe(false);
    expect(h.isEncryptedMongodumpManifest({ type: 'mongodump', encrypted: true, encryptedFiles: 'x' })).toBe(false);
    expect(h.isEncryptedMongodumpManifest({ type: 'mongodump', encrypted: true, encryptedFiles: [] })).toBe(true);
  });

  it('formats date folders and creates timestamp suffix only when date folder already exists', () => {
    const date = new Date(2026, 0, 2, 3, 4, 5);
    expect(h.formatDateFolder(date)).toBe('2026-01-02');

    const exists = vi.spyOn(fs, 'existsSync');
    exists.mockReturnValueOnce(false);
    expect(h.getBackupDirPath('/backups', date)).toBe(path.join('/backups', '2026-01-02'));

    exists.mockReturnValueOnce(true);
    expect(h.getBackupDirPath('/backups', date)).toBe(path.join('/backups', '2026-01-02_3-4-5'));
  });

  it('classifies plain objects separately from arrays/null and validates integer/number/date shapes', () => {
    expect(h.isPlainObject({})).toBe(true);
    expect(h.isPlainObject([])).toBe(false);
    expect(h.isPlainObject(null)).toBe(false);
    expect(h.isPlainObject('x')).toBe(false);

    expect(h.isNumberIntShape('0')).toBe(true);
    expect(h.isNumberIntShape('2147483647')).toBe(true);
    expect(h.isNumberIntShape('2147483648')).toBe(false);
    expect(h.isNumberIntShape('1.2')).toBe(false);
    expect(h.isNumberIntShape(1)).toBe(false);

    expect(h.isNumberLongShape('9223372036854775807')).toBe(true);
    expect(h.isNumberLongShape('-9223372036854775808')).toBe(true);
    expect(h.isNumberLongShape('9223372036854775808')).toBe(false);
    expect(h.isNumberLongShape('123456789012345678901')).toBe(false);
    expect(h.isNumberLongShape('bad')).toBe(false);
    expect(h.isNumberLongShape(1)).toBe(false);

    expect(h.isNumericStringShape('1.5e2')).toBe(true);
    expect(h.isNumericStringShape('-Infinity')).toBe(true);
    expect(h.isNumericStringShape('NaN')).toBe(true);
    expect(h.isNumericStringShape('bad')).toBe(false);
    expect(h.isNumericStringShape(1)).toBe(false);

    expect(h.isDateWrapperShape('2026-01-01T00:00:00Z')).toBe(true);
    expect(h.isDateWrapperShape('not-a-date')).toBe(false);
    expect(h.isDateWrapperShape({ $numberLong: '0' })).toBe(true);
    expect(h.isDateWrapperShape({ $numberLong: '0', extra: 1 })).toBe(false);
    expect(h.isDateWrapperShape(0)).toBe(false);
  });

  it('recognizes well-formed EJSON wrapper variants and rejects sibling/shape collisions', () => {
    const check = (node) => h.isWellFormedWrapper(
      node,
      Object.keys(node),
      Object.keys(node).filter((k) => k.startsWith('$'))
    );

    expect(check({ $ref: 'collection', $id: 'id' })).toBe(true);
    expect(check({ $ref: 1, $id: 'id' })).toBe(false);
    expect(check({ $oid: '507f1f77bcf86cd799439011' })).toBe(true);
    expect(check({ $oid: 'bad' })).toBe(false);
    expect(check({ $oid: '507f1f77bcf86cd799439011', sibling: 1 })).toBe(false);
    expect(check({ $numberInt: '42' })).toBe(true);
    expect(check({ $numberLong: '42' })).toBe(true);
    expect(check({ $numberDouble: 'NaN' })).toBe(true);
    expect(check({ $numberDecimal: '10.5' })).toBe(true);
    expect(check({ $minKey: 1 })).toBe(true);
    expect(check({ $maxKey: 1 })).toBe(true);
    expect(check({ $undefined: true })).toBe(true);
    expect(check({ $date: '2026-01-01T00:00:00Z' })).toBe(true);
    expect(check({ $regex: '^x$', $options: 'im' })).toBe(true);
    expect(check({ $regex: '^x$', $options: 'q' })).toBe(false);
    expect(check({ $regularExpression: { pattern: '^x$', options: 'i' } })).toBe(true);
    expect(check({ $timestamp: { t: 1, i: 2 } })).toBe(true);
    expect(check({ $code: 'return 1', $scope: {} })).toBe(true);
    expect(check({ $binary: { base64: 'YQ==', subType: '00' } })).toBe(true);
    expect(check({ $uuid: '550e8400-e29b-41d4-a716-446655440000' })).toBe(true);
    expect(check({ $symbol: 'x' })).toBe(true);
    expect(check({ $dbPointer: { $ref: 'c', $id: 'id' } })).toBe(true);
    expect(check({ $unknown: 1 })).toBe(false);
  });

  it('detects legacy dollar-key collisions recursively without descending into genuine wrappers', () => {
    expect(h.hasLegacyDollarObject(null)).toBe(false);
    expect(h.hasLegacyDollarObject('x')).toBe(false);
    expect(h.hasLegacyDollarObject([{ a: 1 }, { $oid: 'bad' }])).toBe(true);
    expect(h.hasLegacyDollarObject({ nested: { $oid: 'bad', sibling: 1 } })).toBe(true);
    expect(h.hasLegacyDollarObject({ nested: { $oid: '507f1f77bcf86cd799439011' } })).toBe(false);
    expect(h.hasLegacyDollarObject({ ordinary: { nested: 1 } })).toBe(false);
  });

  it('converts canonical wrappers but preserves malformed legacy dollar objects', () => {
    const converted = h.convertLegacyAwareTree({
      id: { $oid: '507f1f77bcf86cd799439011' },
      legacy: { $oid: 'bad', sibling: 1 },
      array: [{ $numberInt: '7' }, 'x'],
    });

    expect(String(converted.id)).toBe('507f1f77bcf86cd799439011');
    expect(converted.legacy).toEqual({ $oid: 'bad', sibling: 1 });
    expect(converted.array[1]).toBe('x');
    expect(Number(converted.array[0])).toBe(7);

    expect(h.convertLegacyAwareTree(null)).toBeNull();
    expect(h.convertLegacyAwareTree('x')).toBe('x');
  });

  it('resolves database names from env/URI/default and strips only the URI database path', () => {
    const envModule = require('../../src/config/env');
    const originalMongoDb = envModule.MONGO_DB;

    try {
      envModule.MONGO_DB = 'explicit_db';
      expect(h.resolveDatabaseName('mongodb://host/from_uri')).toBe('explicit_db');

      envModule.MONGO_DB = '';
      expect(h.resolveDatabaseName('mongodb://host/from_uri')).toBe('from_uri');
      expect(h.resolveDatabaseName('mongodb://host/')).toBe('bioavanced');
      expect(h.resolveDatabaseName('not-a-url')).toBe('bioavanced');
    } finally {
      envModule.MONGO_DB = originalMongoDb;
    }

    expect(h.stripDefaultDatabase(null)).toBeNull();
    expect(h.stripDefaultDatabase('mongodb://host/db?replicaSet=rs0'))
      .toBe('mongodb://host/?replicaSet=rs0');
    expect(h.stripDefaultDatabase('mongodb+srv://user:pass@host/db?tls=true'))
      .toBe('mongodb+srv://user:pass@host/?tls=true');
    expect(h.stripDefaultDatabase('mongodb://host')).toBe('mongodb://host/');
  });

  it('records backup/restore history only when db is present and swallows persistence failures', async () => {
    await expect(h.recordBackupHistory(null, {})).resolves.toBeUndefined();
    await expect(h.recordRestoreTestHistory(null, {})).resolves.toBeUndefined();

    const backupInsert = vi.fn().mockResolvedValue({ insertedId: 1 });
    const restoreInsert = vi.fn().mockResolvedValue({ insertedId: 2 });
    const db = {
      collection: vi.fn((name) => ({
        insertOne: name === 'backupHistory' ? backupInsert : restoreInsert,
      })),
    };

    await h.recordBackupHistory(db, { status: 'success' });
    await h.recordRestoreTestHistory(db, { status: 'success' });
    expect(backupInsert).toHaveBeenCalled();
    expect(restoreInsert).toHaveBeenCalled();

    backupInsert.mockRejectedValueOnce(new Error('write failed'));
    restoreInsert.mockRejectedValueOnce(new Error('write failed'));
    await expect(h.recordBackupHistory(db, {})).resolves.toBeUndefined();
    await expect(h.recordRestoreTestHistory(db, {})).resolves.toBeUndefined();
  });

  it('cleans decrypted restore scratch only when a path exists and swallows rm failures', async () => {
    await expect(h.cleanupDecryptedRestoreCopy(null)).resolves.toBeUndefined();

    const rm = vi.spyOn(fs.promises, 'rm').mockResolvedValueOnce(undefined);
    await expect(h.cleanupDecryptedRestoreCopy('/tmp/scratch')).resolves.toBeUndefined();
    expect(rm).toHaveBeenCalledWith('/tmp/scratch', { recursive: true, force: true });

    rm.mockRejectedValueOnce(new Error('rm failed'));
    await expect(h.cleanupDecryptedRestoreCopy('/tmp/scratch')).resolves.toBeUndefined();
  });

  it('parseBackupDocs round-trips canonical EJSON and preserves legacy dollar collisions', () => {
    const canonicalRaw = '[{"_id":{"$oid":"507f1f77bcf86cd799439011"},"n":{"$numberInt":"7"}}]';
    const canonical = backup.parseBackupDocs(canonicalRaw);
    expect(String(canonical[0]._id)).toBe('507f1f77bcf86cd799439011');
    expect(Number(canonical[0].n)).toBe(7);

    const legacyRaw = '[{"legacy":{"$oid":"bad","sibling":1}}]';
    expect(backup.parseBackupDocs(legacyRaw)).toEqual([
      { legacy: { $oid: 'bad', sibling: 1 } },
    ]);
  });

  it('getLatestBackupPath returns null for missing/empty dirs and ignores dot-prefixed scratch dirs', () => {
    const exists = vi.spyOn(fs, 'existsSync');
    const readdir = vi.spyOn(fs, 'readdirSync');
    const stat = vi.spyOn(fs, 'statSync');

    exists.mockReturnValueOnce(false);
    expect(backup.getLatestBackupPath()).toBeNull();

    exists.mockReturnValue(true);
    readdir.mockReturnValueOnce([]);
    expect(backup.getLatestBackupPath()).toBeNull();

    readdir.mockReturnValueOnce([
      { name: '.restore-scratch', isDirectory: () => true },
      { name: 'file.txt', isDirectory: () => false },
      { name: '2026-01-01', isDirectory: () => true },
      { name: '2026-02-01', isDirectory: () => true },
    ]);
    stat.mockImplementation((p) => ({
      birthtime: new Date(String(p).includes('2026-02-01') ? '2026-02-01' : '2026-01-01'),
    }));

    expect(backup.getLatestBackupPath()).toMatch(/2026-02-01$/);
  });
});
