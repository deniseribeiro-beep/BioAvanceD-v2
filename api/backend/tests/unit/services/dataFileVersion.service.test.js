import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { recordReplacement, discardVersion, resolveChangeReason } = require('../../../src/services/dataFileVersion.service');
const logger = require('../../../src/utils/logger');

const OLD_CHECKSUM = 'a'.repeat(64);
const NEW_CHECKSUM = 'b'.repeat(64);
const NOW = new Date('2026-10-22T12:00:00Z');

// #1321 (RF007 AC4, RNF029 C3).
function createDb(latest = null) {
  const coll = {
    findOne: vi.fn().mockResolvedValue(latest),
    insertOne: vi.fn().mockResolvedValue({ acknowledged: true }),
    deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 })
  };
  return { coll, db: { collection: vi.fn(() => coll) } };
}

const fileRecord = {
  _id: { toString: () => 'file-1' },
  storageUri: 'objstore://samples/s/files/old.csv',
  checksum: OLD_CHECKSUM,
  encryptionAlgorithm: 'aes-256-gcm',
  encryptionKeyId: 'key-old',
  encryptionIv: 'iv-old',
  encryptionTag: 'tag-old',
  uploadDate: new Date('2026-10-01T00:00:00Z')
};

const encryption = { algorithm: 'aes-256-gcm', keyId: 'key-new', iv: 'iv-new', tag: 'tag-new', ciphertext: Buffer.from('x') };

function replacement(over = {}) {
  return {
    fileRecord,
    storageUri: 'objstore://samples/s/files/new.csv',
    checksum: NEW_CHECKSUM,
    encryption,
    changeReason: 'replacement',
    now: NOW,
    ...over
  };
}

describe('dataFileVersion.service', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('recordReplacement', () => {
    it('no existing row inserts baseline v1 then v2', async () => {
      const { db, coll } = createDb(null);

      const { baseline, version } = await recordReplacement(db, replacement());

      expect(db.collection).toHaveBeenCalledWith('dataFileVersions');
      expect(coll.insertOne).toHaveBeenCalledTimes(2);
      expect(coll.insertOne.mock.calls[0][0]).toBe(baseline);
      expect(coll.insertOne.mock.calls[1][0]).toBe(version);
      expect(baseline).toMatchObject({
        fileId: 'file-1',
        versionNumber: 1,
        objectUri: fileRecord.storageUri,
        checksum: OLD_CHECKSUM,
        previousVersionId: null,
        changeReason: 'initial upload',
        createdAt: fileRecord.uploadDate,
        encryptionAlgorithm: 'aes-256-gcm',
        encryptionKeyId: 'key-old',
        encryptionIv: 'iv-old',
        encryptionTag: 'tag-old'
      });
      expect(version).toMatchObject({
        fileId: 'file-1',
        versionNumber: 2,
        objectUri: 'objstore://samples/s/files/new.csv',
        checksum: NEW_CHECKSUM,
        previousVersionId: baseline.dataFileVersionId,
        changeReason: 'replacement',
        createdAt: NOW,
        encryptionAlgorithm: 'aes-256-gcm',
        encryptionKeyId: 'key-new',
        encryptionIv: 'iv-new',
        encryptionTag: 'tag-new'
      });
      expect(version).not.toHaveProperty('ciphertext');
    });

    it('falls back to createdAt, then now, for the baseline date', async () => {
      const withCreatedAt = createDb(null);
      const createdAt = new Date('2026-09-01T00:00:00Z');
      const first = await recordReplacement(withCreatedAt.db, replacement({ fileRecord: { ...fileRecord, uploadDate: undefined, createdAt } }));
      expect(first.baseline.createdAt).toEqual(createdAt);

      const withNeither = createDb(null);
      const second = await recordReplacement(withNeither.db, replacement({ fileRecord: { ...fileRecord, uploadDate: undefined } }));
      expect(second.baseline.createdAt).toEqual(NOW);
    });

    it('existing v3 inserts only v4 linked to v3', async () => {
      const v3 = { dataFileVersionId: 'version-3', fileId: 'file-1', versionNumber: 3, previousVersionId: 'version-2' };
      const { db, coll } = createDb(v3);

      const { baseline, version } = await recordReplacement(db, replacement());

      expect(baseline).toBeNull();
      expect(coll.insertOne).toHaveBeenCalledTimes(1);
      expect(coll.insertOne).toHaveBeenCalledWith(version);
      expect(version).toMatchObject({ versionNumber: 4, previousVersionId: 'version-3', checksum: NEW_CHECKSUM });
    });

    it('reads the latest version of the file by descending versionNumber', async () => {
      const { db, coll } = createDb(null);

      await recordReplacement(db, replacement());

      expect(coll.findOne).toHaveBeenCalledWith({ fileId: 'file-1' }, { sort: { versionNumber: -1 } });
    });

    it('writes null envelope fields when the new binary is not encrypted', async () => {
      const { db } = createDb(null);

      const { version } = await recordReplacement(db, replacement({ encryption: null }));

      expect(version).toMatchObject({ encryptionAlgorithm: null, encryptionKeyId: null, encryptionIv: null, encryptionTag: null });
    });

    it('an invalid new row throws and inserts nothing for it', async () => {
      const v3 = { dataFileVersionId: 'version-3', fileId: 'file-1', versionNumber: 3 };
      const { db, coll } = createDb(v3);

      await expect(recordReplacement(db, replacement({ checksum: 'not-a-sha256' }))).rejects.toThrow('checksum');

      expect(coll.insertOne).not.toHaveBeenCalled();
    });

    it('an invalid baseline throws before any insert', async () => {
      const { db, coll } = createDb(null);

      await expect(recordReplacement(db, replacement({ fileRecord: { ...fileRecord, checksum: undefined } }))).rejects.toThrow('checksum');

      expect(coll.insertOne).not.toHaveBeenCalled();
    });
  });

  describe('discardVersion', () => {
    it('deletes the row by dataFileVersionId', async () => {
      const { db, coll } = createDb(null);

      await discardVersion(db, { dataFileVersionId: 'version-2' });

      expect(coll.deleteOne).toHaveBeenCalledWith({ dataFileVersionId: 'version-2' });
    });

    it('logs and swallows a delete error', async () => {
      const { db, coll } = createDb(null);
      coll.deleteOne.mockRejectedValue(new Error('db down'));
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

      await expect(discardVersion(db, { dataFileVersionId: 'version-2' })).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe('resolveChangeReason', () => {
    it.each([
      ['absent', {}],
      ['blank', { changeReason: '   ' }],
      ['non-string', { changeReason: 42 }]
    ])('defaults to replacement when %s', (_label, body) => {
      expect(resolveChangeReason(body)).toBe('replacement');
    });

    it('returns a given value trimmed', () => {
      expect(resolveChangeReason({ changeReason: '  corrected export  ' })).toBe('corrected export');
    });
  });
});
