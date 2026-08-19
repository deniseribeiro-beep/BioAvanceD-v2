import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const controller = require('../../src/controllers/sample-file.controller');
const SampleFileModel = require('../../src/models/SampleFile');
const hl7Service = require('../../src/services/hl7.service');
const auditLogger = require('../../src/utils/auditLogger');
const fs = require('fs');
const { ObjectId } = require('mongodb');

function createRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    send: vi.fn(),
    download: vi.fn(),
    headersSent: false
  };
}

function createDb(collections = {}) {
  const store = {};
  return {
    collection: vi.fn((name) => {
      if (!store[name]) {
        store[name] = collections[name] || {
          findOne: vi.fn().mockResolvedValue(null),
          insertOne: vi.fn().mockResolvedValue({ insertedId: 'new-id' }),
          deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
          find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) })
        };
      }
      return store[name];
    })
  };
}

describe('sample-file.controller', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('multer storage config', () => {
    it('destination creates directory when missing and calls cb with path', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
      const cb = vi.fn();
      const req = { params: { specimenId: '42' } };

      controller.storage.getDestination(req, {}, cb);

      expect(mkdirSpy).toHaveBeenCalled();
      expect(cb).toHaveBeenCalledWith(null, expect.stringContaining('42'));
    });

    it('destination skips mkdir when directory already exists', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
      const cb = vi.fn();
      const req = { params: { specimenId: '42' } };

      controller.storage.getDestination(req, {}, cb);

      expect(mkdirSpy).not.toHaveBeenCalled();
      expect(cb).toHaveBeenCalledWith(null, expect.any(String));
    });

    it('destination calls cb with error when specimenId is missing', () => {
      const cb = vi.fn();
      const req = { params: {} };

      controller.storage.getDestination(req, {}, cb);

      expect(cb).toHaveBeenCalledWith(expect.any(Error), null);
    });

    it('destination calls cb with error when fs throws', () => {
      vi.spyOn(fs, 'existsSync').mockImplementation(() => {
        throw new Error('fs boom');
      });
      const cb = vi.fn();
      const req = { params: { specimenId: '42' } };

      controller.storage.getDestination(req, {}, cb);

      expect(cb).toHaveBeenCalledWith(expect.any(Error), null);
    });

    it('filename sanitizes special characters and appends unique id', () => {
      const cb = vi.fn();

      controller.storage.getFilename({}, { originalname: 'my file!@#.csv' }, cb);

      expect(cb).toHaveBeenCalledWith(null, expect.stringMatching(/^my_file____[a-f0-9]{32}\.csv$/));
    });

    it('fileFilter accepts allowed extensions', () => {
      const cb = vi.fn();

      controller.fileFilter({}, { originalname: 'data.csv' }, cb);

      expect(cb).toHaveBeenCalledWith(null, true);
    });

    it('fileFilter rejects disallowed extensions', () => {
      const cb = vi.fn();

      controller.fileFilter({}, { originalname: 'data.exe' }, cb);

      expect(cb).toHaveBeenCalledWith(expect.any(Error), false);
    });
  });

  describe('uploadMiddleware', () => {
    it('returns a middleware function bound to the single file field', () => {
      const mw = controller.uploadMiddleware();
      expect(typeof mw).toBe('function');
    });
  });

  describe('uploadFile', () => {
    it('returns 503 when db is missing', async () => {
      const req = { app: { locals: {} }, params: { specimenId: '1' }, file: null };
      const res = createRes();

      await controller.uploadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('returns 400 when no file provided', async () => {
      const db = createDb();
      const req = { app: { locals: { db } }, params: { specimenId: '1' }, file: null };
      const res = createRes();

      await controller.uploadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    });

    it('returns 404 and cleans up file when sample not found', async () => {
      const specimenId = new ObjectId().toString();
      const db = createDb({
        samples: { findOne: vi.fn().mockResolvedValue(null) }
      });
      const req = {
        app: { locals: { db } },
        params: { specimenId },
        file: { path: '/tmp/file.csv', originalname: 'file.csv', size: 100 }
      };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

      await controller.uploadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(unlinkSpy).toHaveBeenCalledWith('/tmp/file.csv');
    });

    it('returns 404 and swallows unlink error when cleanup of a non-existent sample file fails', async () => {
      const specimenId = new ObjectId().toString();
      const db = createDb({
        samples: { findOne: vi.fn().mockResolvedValue(null) }
      });
      const req = {
        app: { locals: { db } },
        params: { specimenId },
        file: { path: '/tmp/file.csv', originalname: 'file.csv', size: 100 }
      };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {
        throw new Error('locked');
      });

      await controller.uploadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 400 and cleans up file when file type invalid', async () => {
      const specimenId = new ObjectId().toString();
      const sample = { _id: new ObjectId(specimenId) };
      const db = createDb({
        samples: { findOne: vi.fn().mockResolvedValue(sample) }
      });
      const req = {
        app: { locals: { db } },
        params: { specimenId },
        file: { path: '/tmp/file.xyz', originalname: 'file.xyz', size: 100 }
      };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
      vi.spyOn(SampleFileModel, 'getFileTypeFromExtension').mockReturnValue(null);

      await controller.uploadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(unlinkSpy).toHaveBeenCalledWith('/tmp/file.xyz');
    });

    // #625: an existing sample outside the caller's organization scope
    // 403s before the file is persisted, and cleans up the uploaded temp
    // file same as the other pre-persist rejection paths above.
    it('returns 403 and cleans up file when the sample belongs to a different organization', async () => {
      const specimenId = new ObjectId().toString();
      const sample = { _id: new ObjectId(specimenId), collectionSite: 'org-9' };
      const db = createDb({
        samples: { findOne: vi.fn().mockResolvedValue(sample) }
      });
      const req = {
        app: { locals: { db } },
        params: { specimenId },
        file: { path: '/tmp/file.csv', originalname: 'file.csv', size: 100 },
        organizationScope: { scope: 'organization', organizationIds: ['org-1'] }
      };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

      await controller.uploadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(unlinkSpy).toHaveBeenCalledWith('/tmp/file.csv');
    });

    it('returns 400 and cleans up file when validation fails', async () => {
      const specimenId = new ObjectId().toString();
      const sample = { _id: new ObjectId(specimenId) };
      const db = createDb({
        samples: { findOne: vi.fn().mockResolvedValue(sample) }
      });
      const req = {
        app: { locals: { db } },
        params: { specimenId },
        file: { path: '/tmp/file.csv', originalname: 'file.csv', size: 100 }
      };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
      vi.spyOn(SampleFileModel, 'getFileTypeFromExtension').mockReturnValue('CSV');
      vi.spyOn(SampleFileModel, 'validate').mockReturnValue({ isValid: false, errors: ['bad'] });

      await controller.uploadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(unlinkSpy).toHaveBeenCalledWith('/tmp/file.csv');
    });

    it('happy path: creates sample file record and returns sanitized data', async () => {
      const specimenId = new ObjectId().toString();
      const sample = { _id: new ObjectId(specimenId) };
      const insertedId = new ObjectId();
      const sampleFilesCollection = {
        insertOne: vi.fn().mockResolvedValue({ insertedId })
      };
      const db = createDb({
        samples: { findOne: vi.fn().mockResolvedValue(sample) },
        sample_files: sampleFilesCollection
      });
      const req = {
        app: { locals: { db } },
        params: { specimenId },
        file: { path: '/tmp/file.csv', originalname: 'file.csv', size: 100 },
        user: null
      };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('file content'));
      vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
      vi.spyOn(SampleFileModel, 'getFileTypeFromExtension').mockReturnValue('CSV');
      vi.spyOn(SampleFileModel, 'validate').mockReturnValue({ isValid: true, errors: [] });

      await controller.uploadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      const body = res.json.mock.calls[0][0];
      expect(body.success).toBe(true);
      expect(body.data.fileName).toBe('file.csv');
      expect(body.data.storagePath).toBeUndefined();
      expect(body.data.checksum).toMatch(/^[a-f0-9]{64}$/);
      expect(body.data.uri).toMatch(/^objstore:\/\/samples\//);
      expect(body.data.encryption).toEqual({ encrypted: true, algorithm: 'aes-256-gcm' });
      expect(sampleFilesCollection.insertOne).toHaveBeenCalled();
    });

    it('happy path with req.user: logs the upload audit entry', async () => {
      const specimenId = new ObjectId().toString();
      const sample = { _id: new ObjectId(specimenId) };
      const insertedId = new ObjectId();
      const sampleFilesCollection = {
        insertOne: vi.fn().mockResolvedValue({ insertedId })
      };
      const db = createDb({
        samples: { findOne: vi.fn().mockResolvedValue(sample) },
        sample_files: sampleFilesCollection
      });
      const req = {
        app: { locals: { db } },
        params: { specimenId },
        file: { path: '/tmp/file.csv', originalname: 'file.csv', size: 100 },
        user: { id: 'u1' }
      };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('file content'));
      vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
      vi.spyOn(SampleFileModel, 'getFileTypeFromExtension').mockReturnValue('CSV');
      vi.spyOn(SampleFileModel, 'validate').mockReturnValue({ isValid: true, errors: [] });
      const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});

      await controller.uploadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'file_upload', resourceId: insertedId.toString() })
      );
    });

    it('catches thrown error, cleans up req.file, and returns 400', async () => {
      const specimenId = new ObjectId().toString();
      const db = createDb({
        samples: { findOne: vi.fn().mockRejectedValue(new Error('nope')) }
      });
      const req = {
        app: { locals: { db } },
        params: { specimenId },
        file: { path: '/tmp/file.csv', originalname: 'file.csv', size: 100 }
      };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

      await controller.uploadFile(req, res);

      expect(unlinkSpy).toHaveBeenCalledWith('/tmp/file.csv');
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: 'nope' }));
    });

    it('swallows unlink error when catch-block cleanup of req.file fails', async () => {
      const specimenId = new ObjectId().toString();
      const db = createDb({
        samples: { findOne: vi.fn().mockRejectedValue(new Error('nope')) }
      });
      const req = {
        app: { locals: { db } },
        params: { specimenId },
        file: { path: '/tmp/file.csv', originalname: 'file.csv', size: 100 }
      };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {
        throw new Error('locked');
      });

      await controller.uploadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: 'nope' }));
    });
  });

  describe('listFiles', () => {
    it('returns 503 when db missing', async () => {
      const req = { app: { locals: {} }, params: { specimenId: '1' } };
      const res = createRes();

      await controller.listFiles(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('returns 404 when sample not found', async () => {
      const db = createDb({
        samples: { findOne: vi.fn().mockResolvedValue(null) }
      });
      const req = { app: { locals: { db } }, params: { specimenId: '999' } };
      const res = createRes();

      await controller.listFiles(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    // #625: an existing sample outside the caller's organization scope
    // 403s before files are listed.
    it('returns 403 when the sample belongs to a different organization', async () => {
      const specimenId = new ObjectId().toString();
      const sample = { _id: new ObjectId(specimenId), collectionSite: 'org-9' };
      const db = createDb({
        samples: { findOne: vi.fn().mockResolvedValue(sample) }
      });
      const req = {
        app: { locals: { db } },
        params: { specimenId },
        organizationScope: { scope: 'organization', organizationIds: ['org-1'] }
      };
      const res = createRes();

      await controller.listFiles(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('returns sanitized files without storagePath', async () => {
      const specimenId = new ObjectId().toString();
      const sample = { _id: new ObjectId(specimenId) };
      const rawFiles = [
        {
          _id: new ObjectId(),
          specimenId: sample._id.toString(),
          fileName: 'a.csv',
          fileType: 'CSV',
          fileSize: 10,
          uploaderAnonId: 'USR-ABC',
          uploadDate: new Date(),
          createdAt: new Date(),
          storagePath: '/secret/path/a.csv'
        }
      ];
      const sampleFilesCollection = {
        find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(rawFiles) })
      };
      const db = createDb({
        samples: { findOne: vi.fn().mockResolvedValue(sample) },
        sample_files: sampleFilesCollection
      });
      const req = { app: { locals: { db } }, params: { specimenId }, user: null };
      const res = createRes();

      await controller.listFiles(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.data).toHaveLength(1);
      expect(body.data[0].storagePath).toBeUndefined();
      expect(body.data[0].fileName).toBe('a.csv');
    });

    it('logs the query audit entry when req.user is present', async () => {
      const specimenId = new ObjectId().toString();
      const sample = { _id: new ObjectId(specimenId) };
      const sampleFilesCollection = {
        find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) })
      };
      const db = createDb({
        samples: { findOne: vi.fn().mockResolvedValue(sample) },
        sample_files: sampleFilesCollection
      });
      const req = { app: { locals: { db } }, params: { specimenId }, user: { id: 'u1' } };
      const res = createRes();
      const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});

      await controller.listFiles(req, res);

      expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ action: 'QUERY', resourceType: 'SampleFile' }));
    });

    it('returns 500 when an unexpected error is thrown', async () => {
      const db = createDb({
        samples: { findOne: vi.fn().mockRejectedValue(new Error('down')) }
      });
      const req = { app: { locals: { db } }, params: { specimenId: 'not-an-object-id' } };
      const res = createRes();

      await controller.listFiles(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: 'down' }));
    });
  });

  describe('downloadFile', () => {
    it('returns 503 when db missing', async () => {
      const req = { app: { locals: {} }, params: { specimenId: '1', fileID: '2' } };
      const res = createRes();

      await controller.downloadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('returns 400 when fileID is invalid ObjectId', async () => {
      const db = createDb();
      const req = { app: { locals: { db } }, params: { specimenId: '1', fileID: 'not-an-id' } };
      const res = createRes();

      await controller.downloadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 404 when file record not found', async () => {
      const fileID = new ObjectId().toString();
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(null) }
      });
      const req = { app: { locals: { db } }, params: { specimenId: '1', fileID } };
      const res = createRes();

      await controller.downloadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 403 when file does not belong to sample (ownership mismatch)', async () => {
      const fileID = new ObjectId().toString();
      const otherSampleID = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId: otherSampleID, storagePath: '/x/a.csv', fileName: 'a.csv' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) }
      });
      const wrongSampleID = new ObjectId().toString();
      const req = { app: { locals: { db } }, params: { specimenId: wrongSampleID, fileID } };
      const res = createRes();

      await controller.downloadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('returns 404 when file missing on disk', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, storagePath: '/x/a.csv', fileName: 'a.csv' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) }
      });
      const req = { app: { locals: { db } }, params: { specimenId, fileID } };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);

      await controller.downloadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    // #625: an existing sample outside the caller's organization scope
    // 403s before the file is served.
    it('returns 403 when the sample belongs to a different organization', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, storagePath: '/x/a.csv', fileName: 'a.csv' };
      const sample = { _id: new ObjectId(specimenId), collectionSite: 'org-9' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) },
        samples: { findOne: vi.fn().mockResolvedValue(sample) }
      });
      const req = {
        app: { locals: { db } },
        params: { specimenId, fileID },
        organizationScope: { scope: 'organization', organizationIds: ['org-1'] }
      };
      const res = createRes();

      await controller.downloadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    // #625: a lookup failure resolving the sample for the scope check
    // (e.g. it no longer exists) doesn't itself block the download —
    // only a confirmed out-of-scope match does.
    it('proceeds to serve the file when the sample lookup for the scope check returns nothing', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, storagePath: '/x/a.csv', fileName: 'a.csv' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) },
        samples: { findOne: vi.fn().mockResolvedValue(null) }
      });
      const req = {
        app: { locals: { db } },
        params: { specimenId, fileID },
        organizationScope: { scope: 'organization', organizationIds: ['org-1'] }
      };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('a.csv content'));

      await controller.downloadFile(req, res);

      expect(res.status).not.toHaveBeenCalledWith(403);
      expect(res.send).toHaveBeenCalled();
    });

    it('happy path (unencrypted record): reads the stored plaintext and sends it via res.send', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, storagePath: '/x/a.csv', fileName: 'a.csv' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) }
      });
      const req = { app: { locals: { db } }, params: { specimenId, fileID }, user: null };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const plaintext = Buffer.from('a.csv content');
      vi.spyOn(fs, 'readFileSync').mockReturnValue(plaintext);

      await controller.downloadFile(req, res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', expect.stringContaining('a.csv'));
      expect(res.send).toHaveBeenCalledWith(plaintext);
    });

    it('happy path (encrypted record, RNF029): decrypts the ciphertext on disk before sending it', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const plaintext = Buffer.from('RNF029 round-trip content');
      const key = require('../../src/config/keyRegistry').getActiveKey();
      const crypto = require('crypto');
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const tag = cipher.getAuthTag();
      const fileRecord = {
        _id: new ObjectId(fileID),
        specimenId,
        storagePath: '/x/a.csv',
        fileName: 'a.csv',
        encryptionAlgorithm: 'aes-256-gcm',
        encryptionKeyId: require('../../src/config/keyRegistry').getActiveKeyId(),
        encryptionIv: iv.toString('base64'),
        encryptionTag: tag.toString('base64')
      };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) }
      });
      const req = { app: { locals: { db } }, params: { specimenId, fileID }, user: { id: 'u1' } };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(ciphertext);
      const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});

      await controller.downloadFile(req, res);

      expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ action: 'file_download' }));
      expect(res.send).toHaveBeenCalledWith(plaintext);
    });

    it('returns 500 when decryption fails (tampered/corrupt ciphertext)', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = {
        _id: new ObjectId(fileID),
        specimenId,
        storagePath: '/x/a.csv',
        fileName: 'a.csv',
        encryptionAlgorithm: 'aes-256-gcm',
        encryptionKeyId: 'vitest-key-001',
        encryptionIv: Buffer.alloc(12).toString('base64'),
        encryptionTag: Buffer.alloc(16).toString('base64')
      };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) }
      });
      const req = { app: { locals: { db } }, params: { specimenId, fileID } };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('not really valid ciphertext bytes!!'));

      await controller.downloadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('returns 500 when an unexpected error is thrown', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, storagePath: '/x/a.csv', fileName: 'a.csv' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) }
      });
      const req = { app: { locals: { db } }, params: { specimenId, fileID } };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockImplementation(() => {
        throw new Error('down');
      });

      await controller.downloadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('deleteFile', () => {
    it('returns 503 when db missing', async () => {
      const req = { app: { locals: {} }, params: { specimenId: '1', fileID: '2' } };
      const res = createRes();

      await controller.deleteFile(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('returns 400 when fileID is invalid ObjectId', async () => {
      const db = createDb();
      const req = { app: { locals: { db } }, params: { specimenId: '1', fileID: 'not-an-id' } };
      const res = createRes();

      await controller.deleteFile(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 404 when file record not found', async () => {
      const fileID = new ObjectId().toString();
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(null) }
      });
      const req = { app: { locals: { db } }, params: { specimenId: '1', fileID } };
      const res = createRes();

      await controller.deleteFile(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('continues deletion when physical unlink fails, and logs when req.user present', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, storagePath: '/x/a.csv', fileName: 'a.csv' };
      const deleteOne = vi.fn().mockResolvedValue({ deletedCount: 1 });
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord), deleteOne }
      });
      const req = { app: { locals: { db } }, params: { specimenId, fileID }, user: { id: 'u1' } };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {
        throw new Error('locked');
      });
      const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});

      await controller.deleteFile(req, res);

      expect(deleteOne).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ action: 'file_delete', severity: 'critical' }));
    });

    it('returns 500 when an unexpected error is thrown', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, storagePath: '/x/a.csv', fileName: 'a.csv' };
      const db = createDb({
        sample_files: {
          findOne: vi.fn().mockResolvedValue(fileRecord),
          deleteOne: vi.fn().mockRejectedValue(new Error('db down'))
        }
      });
      const req = { app: { locals: { db } }, params: { specimenId, fileID }, user: null };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);

      await controller.deleteFile(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('returns 403 when file does not belong to sample', async () => {
      const fileID = new ObjectId().toString();
      const otherSampleID = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId: otherSampleID, storagePath: '/x/a.csv', fileName: 'a.csv' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) }
      });
      const wrongSampleID = new ObjectId().toString();
      const req = { app: { locals: { db } }, params: { specimenId: wrongSampleID, fileID } };
      const res = createRes();

      await controller.deleteFile(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    // #625: an existing sample outside the caller's organization scope
    // 403s before the file is deleted.
    it('returns 403 when the sample belongs to a different organization', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, storagePath: '/x/a.csv', fileName: 'a.csv' };
      const sample = { _id: new ObjectId(specimenId), collectionSite: 'org-9' };
      const deleteOne = vi.fn().mockResolvedValue({ deletedCount: 1 });
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord), deleteOne },
        samples: { findOne: vi.fn().mockResolvedValue(sample) }
      });
      const req = {
        app: { locals: { db } },
        params: { specimenId, fileID },
        organizationScope: { scope: 'organization', organizationIds: ['org-1'] }
      };
      const res = createRes();

      await controller.deleteFile(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(deleteOne).not.toHaveBeenCalled();
    });

    it('happy path: removes file from disk and db, returns 200', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, storagePath: '/x/a.csv', fileName: 'a.csv' };
      const deleteOne = vi.fn().mockResolvedValue({ deletedCount: 1 });
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord), deleteOne }
      });
      const req = { app: { locals: { db } }, params: { specimenId, fileID }, user: null };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

      await controller.deleteFile(req, res);

      expect(unlinkSpy).toHaveBeenCalledWith('/x/a.csv');
      expect(deleteOne).toHaveBeenCalledWith({ _id: fileRecord._id });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });

  // RF007 AC#7 (#334): "substituição" is the audited verb that was
  // missing alongside upload/access/logical-removal.
  describe('replaceFile', () => {
    it('returns 503 when db is missing', async () => {
      const req = { app: { locals: {} }, params: { specimenId: '1', fileID: '2' }, file: { path: '/tmp/new.csv' } };
      const res = createRes();

      await controller.replaceFile(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('returns 400 when no file is provided', async () => {
      const db = createDb();
      const req = { app: { locals: { db } }, params: { specimenId: '1', fileID: '2' }, file: null };
      const res = createRes();

      await controller.replaceFile(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 and cleans up the uploaded file when fileID is invalid ObjectId', async () => {
      const db = createDb();
      const req = {
        app: { locals: { db } },
        params: { specimenId: '1', fileID: 'not-an-id' },
        file: { path: '/tmp/new.csv', originalname: 'new.csv', size: 50 }
      };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

      await controller.replaceFile(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(unlinkSpy).toHaveBeenCalledWith('/tmp/new.csv');
    });

    it('returns 404 when file record not found', async () => {
      const fileID = new ObjectId().toString();
      const db = createDb({ sample_files: { findOne: vi.fn().mockResolvedValue(null) } });
      const req = {
        app: { locals: { db } },
        params: { specimenId: '1', fileID },
        file: { path: '/tmp/new.csv', originalname: 'new.csv', size: 50 }
      };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);

      await controller.replaceFile(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 403 when the file does not belong to the sample', async () => {
      const fileID = new ObjectId().toString();
      const otherSampleID = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId: otherSampleID, storagePath: '/x/a.csv', fileName: 'a.csv' };
      const db = createDb({ sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) } });
      const wrongSampleID = new ObjectId().toString();
      const req = {
        app: { locals: { db } },
        params: { specimenId: wrongSampleID, fileID },
        file: { path: '/tmp/new.csv', originalname: 'new.csv', size: 50 }
      };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);

      await controller.replaceFile(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('returns 403 when the sample belongs to a different organization', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, storagePath: '/x/a.csv', fileName: 'a.csv' };
      const sample = { _id: new ObjectId(specimenId), collectionSite: 'org-9' };
      const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord), updateOne },
        samples: { findOne: vi.fn().mockResolvedValue(sample) }
      });
      const req = {
        app: { locals: { db } },
        params: { specimenId, fileID },
        file: { path: '/tmp/new.csv', originalname: 'new.csv', size: 50 },
        organizationScope: { scope: 'organization', organizationIds: ['org-1'] }
      };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);

      await controller.replaceFile(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(updateOne).not.toHaveBeenCalled();
    });

    it('returns 400 and cleans up the uploaded file when the new file has an invalid type', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, fileName: 'old.csv', storagePath: '/x/old.csv' };
      const db = createDb({ sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) } });
      const req = {
        app: { locals: { db } },
        params: { specimenId, fileID },
        file: { path: '/tmp/new.bin', originalname: 'new.bin', size: 50 }
      };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
      vi.spyOn(SampleFileModel, 'getFileTypeFromExtension').mockReturnValue(null);

      await controller.replaceFile(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(unlinkSpy).toHaveBeenCalledWith('/tmp/new.bin');
    });

    it('happy path: writes new content, removes the previous physical file, updates the record, returns 200', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = {
        _id: new ObjectId(fileID),
        specimenId,
        fileName: 'old.csv',
        storagePath: '/x/old.csv',
        checksum: 'old-checksum',
        uploaderAnonId: 'anon-1',
        uploadDate: new Date('2026-01-01'),
        accessPolicy: { view: 'authenticated', manage: ['admin', 'coordinator'] }
      };
      const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord), updateOne }
      });
      const req = {
        app: { locals: { db } },
        params: { specimenId, fileID },
        file: { path: '/tmp/new.csv', originalname: 'new.csv', size: 200 },
        user: null
      };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('new file content'));
      vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
      vi.spyOn(SampleFileModel, 'getFileTypeFromExtension').mockReturnValue('CSV');
      vi.spyOn(SampleFileModel, 'validate').mockReturnValue({ isValid: true, errors: [] });

      await controller.replaceFile(req, res);

      expect(unlinkSpy).toHaveBeenCalledWith('/x/old.csv');
      expect(updateOne).toHaveBeenCalledWith(
        { _id: fileRecord._id },
        { $set: expect.objectContaining({ fileName: 'new.csv', fileSize: 200 }) }
      );
      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.success).toBe(true);
      expect(body.data.fileName).toBe('new.csv');
      expect(body.data.checksum).toMatch(/^[a-f0-9]{64}$/);
      expect(body.data.checksum).not.toBe('old-checksum');
      // Fields carried over from the original record, unaffected by replace.
      expect(body.data.uploaderAnonId).toBe('anon-1');
    });

    it('happy path with req.user: audits the replace with the previous file identity in the payload', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = {
        _id: new ObjectId(fileID),
        specimenId,
        fileName: 'old.csv',
        storagePath: '/x/old.csv',
        checksum: 'old-checksum'
      };
      const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord), updateOne }
      });
      const req = {
        app: { locals: { db } },
        params: { specimenId, fileID },
        file: { path: '/tmp/new.csv', originalname: 'new.csv', size: 200 },
        user: { id: 'u1' }
      };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('new file content'));
      vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
      vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
      vi.spyOn(SampleFileModel, 'getFileTypeFromExtension').mockReturnValue('CSV');
      vi.spyOn(SampleFileModel, 'validate').mockReturnValue({ isValid: true, errors: [] });
      const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});

      await controller.replaceFile(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'file_replace',
          resourceId: fileRecord._id.toString(),
          payload: expect.objectContaining({ previousFileName: 'old.csv', previousChecksum: 'old-checksum', fileName: 'new.csv' })
        })
      );
    });

    it('continues the replace when unlinking the previous physical file fails', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, fileName: 'old.csv', storagePath: '/x/old.csv', checksum: 'old-checksum' };
      const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord), updateOne }
      });
      const req = {
        app: { locals: { db } },
        params: { specimenId, fileID },
        file: { path: '/tmp/new.csv', originalname: 'new.csv', size: 200 },
        user: null
      };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('new file content'));
      vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
      vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {
        throw new Error('locked');
      });
      vi.spyOn(SampleFileModel, 'getFileTypeFromExtension').mockReturnValue('CSV');
      vi.spyOn(SampleFileModel, 'validate').mockReturnValue({ isValid: true, errors: [] });

      await controller.replaceFile(req, res);

      expect(updateOne).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('does not delete the previous file when its path matches the new upload path', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, fileName: 'old.csv', storagePath: '/tmp/new.csv', checksum: 'old-checksum' };
      const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord), updateOne }
      });
      const req = {
        app: { locals: { db } },
        params: { specimenId, fileID },
        file: { path: '/tmp/new.csv', originalname: 'new.csv', size: 200 },
        user: null
      };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('new file content'));
      vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
      vi.spyOn(SampleFileModel, 'getFileTypeFromExtension').mockReturnValue('CSV');
      vi.spyOn(SampleFileModel, 'validate').mockReturnValue({ isValid: true, errors: [] });

      await controller.replaceFile(req, res);

      expect(unlinkSpy).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 400 and cleans up the uploaded file when validation fails', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, fileName: 'old.csv', storagePath: '/x/old.csv' };
      const db = createDb({ sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) } });
      const req = {
        app: { locals: { db } },
        params: { specimenId, fileID },
        file: { path: '/tmp/new.csv', originalname: 'new.csv', size: 200 }
      };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('new file content'));
      vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
      vi.spyOn(SampleFileModel, 'getFileTypeFromExtension').mockReturnValue('CSV');
      vi.spyOn(SampleFileModel, 'validate').mockReturnValue({ isValid: false, errors: ['bad'] });

      await controller.replaceFile(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(unlinkSpy).toHaveBeenCalledWith('/tmp/new.csv');
    });

    it('returns 400 when an unexpected error is thrown, and swallows a failed cleanup unlink', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, fileName: 'old.csv', storagePath: '/x/old.csv' };
      const db = createDb({
        sample_files: {
          findOne: vi.fn().mockResolvedValue(fileRecord),
          updateOne: vi.fn().mockRejectedValue(new Error('db down'))
        }
      });
      const req = {
        app: { locals: { db } },
        params: { specimenId, fileID },
        file: { path: '/tmp/new.csv', originalname: 'new.csv', size: 200 }
      };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('new file content'));
      vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
      vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {
        throw new Error('locked');
      });
      vi.spyOn(SampleFileModel, 'getFileTypeFromExtension').mockReturnValue('CSV');
      vi.spyOn(SampleFileModel, 'validate').mockReturnValue({ isValid: true, errors: [] });

      await controller.replaceFile(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('exportHL7v2', () => {
    it('returns 503 when db is unavailable', async () => {
      const req = { app: { locals: { db: null } }, params: { specimenId: 's1', fileID: 'f1' } };
      const res = createRes();

      await controller.exportHL7v2(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('returns 404 when the file record is not found', async () => {
      const db = createDb({ sample_files: { findOne: vi.fn().mockResolvedValue(null) } });
      const req = { app: { locals: { db } }, params: { specimenId: 's1', fileID: new ObjectId().toString() } };
      const res = createRes();

      await controller.exportHL7v2(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 404 when the sample is not found', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, fileName: 'a.csv' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) },
        samples: { findOne: vi.fn().mockResolvedValue(null) }
      });
      const req = { app: { locals: { db } }, params: { specimenId, fileID } };
      const res = createRes();

      await controller.exportHL7v2(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    // #625: an existing sample outside the caller's organization scope
    // 403s before the export is generated.
    it('returns 403 when the sample belongs to a different organization', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, fileName: 'a.csv' };
      const sample = { _id: new ObjectId(specimenId), collectionSite: 'org-9' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) },
        samples: { findOne: vi.fn().mockResolvedValue(sample) }
      });
      const req = {
        app: { locals: { db } },
        params: { specimenId, fileID },
        organizationScope: { scope: 'organization', organizationIds: ['org-1'] }
      };
      const res = createRes();

      await controller.exportHL7v2(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('logs the export when req.user is present', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, fileName: 'a.csv', fileType: 'CSV' };
      const sample = { _id: new ObjectId(specimenId), participantId: '12345678' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) },
        samples: { findOne: vi.fn().mockResolvedValue(sample) }
      });
      const req = { app: { locals: { db } }, params: { specimenId, fileID }, user: { id: 'u1' } };
      const res = createRes();
      vi.spyOn(hl7Service, 'generateHL7v2Message').mockResolvedValue('MSH|^~\\&|...');
      const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});

      await controller.exportHL7v2(req, res);

      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'file_export_hl7', resourceId: fileID })
      );
    });

    it('returns 500 when the HL7 generator throws', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, fileName: 'a.csv' };
      const sample = { _id: new ObjectId(specimenId), participantId: '12345678' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) },
        samples: { findOne: vi.fn().mockResolvedValue(sample) }
      });
      const req = { app: { locals: { db } }, params: { specimenId, fileID }, user: null };
      const res = createRes();
      vi.spyOn(hl7Service, 'generateHL7v2Message').mockRejectedValue(new Error('boom'));

      await controller.exportHL7v2(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('returns 400 when file is not linked to the given sample', async () => {
      const fileID = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId: 'some-other-sample', fileName: 'a.csv' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) }
      });
      const req = { app: { locals: { db } }, params: { specimenId: 'sample-1', fileID } };
      const res = createRes();

      await controller.exportHL7v2(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('happy path: generates HL7 message and sets headers', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, fileName: 'a.csv', fileType: 'CSV' };
      const sample = { _id: new ObjectId(specimenId), participantId: '12345678' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) },
        samples: { findOne: vi.fn().mockResolvedValue(sample) }
      });
      const req = { app: { locals: { db } }, params: { specimenId, fileID }, user: null };
      const res = createRes();
      vi.spyOn(hl7Service, 'generateHL7v2Message').mockResolvedValue('MSH|^~\\&|...');

      await controller.exportHL7v2(req, res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/plain; charset=utf-8');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', `attachment; filename="hl7_${fileID}.hl7"`);
      expect(res.send).toHaveBeenCalledWith('MSH|^~\\&|...');
    });
  });

  describe('exportFHIR', () => {
    it('happy path: generates FHIR bundle and sets headers', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, fileName: 'a.csv', fileType: 'CSV' };
      const sample = { _id: new ObjectId(specimenId), participantId: '12345678' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) },
        samples: { findOne: vi.fn().mockResolvedValue(sample) }
      });
      const req = { app: { locals: { db } }, params: { specimenId, fileID }, user: null };
      const res = createRes();
      const bundle = { resourceType: 'Bundle' };
      vi.spyOn(hl7Service, 'generateFHIRResource').mockResolvedValue(bundle);

      await controller.exportFHIR(req, res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json; charset=utf-8');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', `attachment; filename="fhir_${fileID}.json"`);
      expect(res.json).toHaveBeenCalledWith(bundle);
    });

    it('returns 400 when file is not linked to the given sample', async () => {
      const fileID = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId: 'other-sample', fileName: 'a.csv' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) }
      });
      const req = { app: { locals: { db } }, params: { specimenId: 'sample-1', fileID } };
      const res = createRes();

      await controller.exportFHIR(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 503 when db is unavailable', async () => {
      const req = { app: { locals: { db: null } }, params: { specimenId: 's1', fileID: 'f1' } };
      const res = createRes();

      await controller.exportFHIR(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('returns 404 when the file record is not found', async () => {
      const db = createDb({ sample_files: { findOne: vi.fn().mockResolvedValue(null) } });
      const req = { app: { locals: { db } }, params: { specimenId: 's1', fileID: new ObjectId().toString() } };
      const res = createRes();

      await controller.exportFHIR(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 404 when the sample is not found', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, fileName: 'a.csv' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) },
        samples: { findOne: vi.fn().mockResolvedValue(null) }
      });
      const req = { app: { locals: { db } }, params: { specimenId, fileID } };
      const res = createRes();

      await controller.exportFHIR(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    // #625: an existing sample outside the caller's organization scope
    // 403s before the export is generated.
    it('returns 403 when the sample belongs to a different organization', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, fileName: 'a.csv' };
      const sample = { _id: new ObjectId(specimenId), collectionSite: 'org-9' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) },
        samples: { findOne: vi.fn().mockResolvedValue(sample) }
      });
      const req = {
        app: { locals: { db } },
        params: { specimenId, fileID },
        organizationScope: { scope: 'organization', organizationIds: ['org-1'] }
      };
      const res = createRes();

      await controller.exportFHIR(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('logs the export when req.user is present', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, fileName: 'a.csv', fileType: 'CSV' };
      const sample = { _id: new ObjectId(specimenId), participantId: '12345678' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) },
        samples: { findOne: vi.fn().mockResolvedValue(sample) }
      });
      const req = { app: { locals: { db } }, params: { specimenId, fileID }, user: { id: 'u1' } };
      const res = createRes();
      vi.spyOn(hl7Service, 'generateFHIRResource').mockResolvedValue({ resourceType: 'Bundle' });
      const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});

      await controller.exportFHIR(req, res);

      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'file_export_fhir', resourceId: fileID })
      );
    });

    it('returns 500 when the FHIR generator throws', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, fileName: 'a.csv' };
      const sample = { _id: new ObjectId(specimenId), participantId: '12345678' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) },
        samples: { findOne: vi.fn().mockResolvedValue(sample) }
      });
      const req = { app: { locals: { db } }, params: { specimenId, fileID }, user: null };
      const res = createRes();
      vi.spyOn(hl7Service, 'generateFHIRResource').mockRejectedValue(new Error('boom'));

      await controller.exportFHIR(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('exportCDA', () => {
    it('returns 503 when db is unavailable', async () => {
      const req = { app: { locals: { db: null } }, params: { specimenId: 's1', fileID: 'f1' } };
      const res = createRes();

      await controller.exportCDA(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('returns 404 when the file record is not found', async () => {
      const db = createDb({ sample_files: { findOne: vi.fn().mockResolvedValue(null) } });
      const req = { app: { locals: { db } }, params: { specimenId: 's1', fileID: new ObjectId().toString() } };
      const res = createRes();

      await controller.exportCDA(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 400 when file is not linked to the given sample', async () => {
      const fileID = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId: 'other-sample', fileName: 'a.csv' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) }
      });
      const req = { app: { locals: { db } }, params: { specimenId: 'sample-1', fileID } };
      const res = createRes();

      await controller.exportCDA(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 404 when the sample is not found', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, fileName: 'a.csv' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) },
        samples: { findOne: vi.fn().mockResolvedValue(null) }
      });
      const req = { app: { locals: { db } }, params: { specimenId, fileID } };
      const res = createRes();

      await controller.exportCDA(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    // #625: an existing sample outside the caller's organization scope
    // 403s before the export is generated.
    it('returns 403 when the sample belongs to a different organization', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, fileName: 'a.csv' };
      const sample = { _id: new ObjectId(specimenId), collectionSite: 'org-9' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) },
        samples: { findOne: vi.fn().mockResolvedValue(sample) }
      });
      const req = {
        app: { locals: { db } },
        params: { specimenId, fileID },
        organizationScope: { scope: 'organization', organizationIds: ['org-1'] }
      };
      const res = createRes();

      await controller.exportCDA(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('happy path: generates CDA document and sets headers', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, fileName: 'a.csv', fileType: 'CSV' };
      const sample = { _id: new ObjectId(specimenId), participantId: '12345678' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) },
        samples: { findOne: vi.fn().mockResolvedValue(sample) }
      });
      const req = { app: { locals: { db } }, params: { specimenId, fileID }, user: null };
      const res = createRes();
      vi.spyOn(hl7Service, 'generateCDA').mockResolvedValue('<ClinicalDocument/>');

      await controller.exportCDA(req, res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/xml; charset=utf-8');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', `attachment; filename="cda_${fileID}.xml"`);
      expect(res.send).toHaveBeenCalledWith('<ClinicalDocument/>');
    });

    it('logs the export when req.user is present', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, fileName: 'a.csv', fileType: 'CSV' };
      const sample = { _id: new ObjectId(specimenId), participantId: '12345678' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) },
        samples: { findOne: vi.fn().mockResolvedValue(sample) }
      });
      const req = { app: { locals: { db } }, params: { specimenId, fileID }, user: { id: 'u1' } };
      const res = createRes();
      vi.spyOn(hl7Service, 'generateCDA').mockResolvedValue('<ClinicalDocument/>');
      const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});

      await controller.exportCDA(req, res);

      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'file_export_cda', resourceId: fileID })
      );
    });

    it('returns 500 when the CDA generator throws', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, fileName: 'a.csv' };
      const sample = { _id: new ObjectId(specimenId), participantId: '12345678' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) },
        samples: { findOne: vi.fn().mockResolvedValue(sample) }
      });
      const req = { app: { locals: { db } }, params: { specimenId, fileID }, user: null };
      const res = createRes();
      vi.spyOn(hl7Service, 'generateCDA').mockRejectedValue(new Error('boom'));

      await controller.exportCDA(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('req.t translation branch (truthy req.t)', () => {
    const t = vi.fn((key) => key);

    afterEach(() => {
      t.mockClear();
    });

    it('uploadFile uses req.t across every response path', async () => {
      // 503 db missing
      let res = createRes();
      await controller.uploadFile({ app: { locals: {} }, params: {}, file: null, t }, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'errors.databaseUnavailable' }));

      // 400 no file
      res = createRes();
      const db1 = createDb();
      await controller.uploadFile({ app: { locals: { db: db1 } }, params: { specimenId: '1' }, file: null, t }, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'sampleFiles.fileRequired' }));

      vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('file content'));
      vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

      // 404 sample not found
      res = createRes();
      const specimenId = new ObjectId().toString();
      const db2 = createDb({ samples: { findOne: vi.fn().mockResolvedValue(null) } });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
      await controller.uploadFile(
        { app: { locals: { db: db2 } }, params: { specimenId }, file: { path: '/tmp/f.csv', originalname: 'f.csv', size: 1 }, t },
        res
      );
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'sampleFiles.sampleNotFound' }));

      // 400 invalid file type
      res = createRes();
      const sample = { _id: new ObjectId(specimenId) };
      const db3 = createDb({ samples: { findOne: vi.fn().mockResolvedValue(sample) } });
      vi.spyOn(SampleFileModel, 'getFileTypeFromExtension').mockReturnValue(null);
      await controller.uploadFile(
        { app: { locals: { db: db3 } }, params: { specimenId }, file: { path: '/tmp/f.csv', originalname: 'f.csv', size: 1 }, t },
        res
      );
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'sampleFiles.invalidFileType' }));

      // 400 validation error
      res = createRes();
      const db4 = createDb({ samples: { findOne: vi.fn().mockResolvedValue(sample) } });
      vi.spyOn(SampleFileModel, 'getFileTypeFromExtension').mockReturnValue('CSV');
      vi.spyOn(SampleFileModel, 'validate').mockReturnValue({ isValid: false, errors: ['bad'] });
      await controller.uploadFile(
        { app: { locals: { db: db4 } }, params: { specimenId }, file: { path: '/tmp/f.csv', originalname: 'f.csv', size: 1 }, t },
        res
      );
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'sampleFiles.validationError' }));

      // 201 success message
      res = createRes();
      const sampleFilesCollection = { insertOne: vi.fn().mockResolvedValue({ insertedId: new ObjectId() }) };
      const db5 = createDb({ samples: { findOne: vi.fn().mockResolvedValue(sample) }, sample_files: sampleFilesCollection });
      vi.spyOn(SampleFileModel, 'getFileTypeFromExtension').mockReturnValue('CSV');
      vi.spyOn(SampleFileModel, 'validate').mockReturnValue({ isValid: true, errors: [] });
      vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('file content'));
      vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
      await controller.uploadFile(
        { app: { locals: { db: db5 } }, params: { specimenId }, file: { path: '/tmp/f.csv', originalname: 'f.csv', size: 1 }, user: null, t },
        res
      );
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'sampleFiles.uploadSuccess' }));

      // 400 catch block
      res = createRes();
      const db6 = createDb({ samples: { findOne: vi.fn().mockRejectedValue(new Error('nope')) } });
      await controller.uploadFile(
        { app: { locals: { db: db6 } }, params: { specimenId }, file: { path: '/tmp/f.csv', originalname: 'f.csv', size: 1 }, t },
        res
      );
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'sampleFiles.uploadError' }));
    });

    it('listFiles uses req.t across every response path', async () => {
      let res = createRes();
      await controller.listFiles({ app: { locals: {} }, params: {}, t }, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'errors.databaseUnavailable' }));

      res = createRes();
      const db1 = createDb({ samples: { findOne: vi.fn().mockResolvedValue(null) } });
      await controller.listFiles({ app: { locals: { db: db1 } }, params: { specimenId: '1' }, t }, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'sampleFiles.sampleNotFound' }));

      res = createRes();
      const db2 = createDb({ samples: { findOne: vi.fn().mockRejectedValue(new Error('down')) } });
      await controller.listFiles({ app: { locals: { db: db2 } }, params: { specimenId: 'x' }, t }, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'sampleFiles.listError' }));
    });

    it('downloadFile uses req.t across every response path', async () => {
      let res = createRes();
      await controller.downloadFile({ app: { locals: {} }, params: {}, t }, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'errors.databaseUnavailable' }));

      res = createRes();
      const db1 = createDb();
      await controller.downloadFile({ app: { locals: { db: db1 } }, params: { specimenId: '1', fileID: 'bad' }, t }, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'sampleFiles.invalidFileID' }));

      res = createRes();
      const db2 = createDb({ sample_files: { findOne: vi.fn().mockResolvedValue(null) } });
      await controller.downloadFile({ app: { locals: { db: db2 } }, params: { specimenId: '1', fileID: new ObjectId().toString() }, t }, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'sampleFiles.fileNotFound' }));

      res = createRes();
      const fileID = new ObjectId().toString();
      const otherSpecimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId: otherSpecimenId, storagePath: '/x/a.csv', fileName: 'a.csv' };
      const db3 = createDb({ sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) } });
      await controller.downloadFile({ app: { locals: { db: db3 } }, params: { specimenId: new ObjectId().toString(), fileID }, t }, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'sampleFiles.fileNotBelongToSample' }));

      res = createRes();
      const specimenId = new ObjectId().toString();
      const fileRecord2 = { _id: new ObjectId(fileID), specimenId, storagePath: '/x/a.csv', fileName: 'a.csv' };
      const db4 = createDb({ sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord2) } });
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      await controller.downloadFile({ app: { locals: { db: db4 } }, params: { specimenId, fileID }, t }, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'sampleFiles.fileNotFoundOnDisk' }));

      res = createRes();
      const db5 = createDb({ sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord2) } });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
        throw new Error('read broke');
      });
      await controller.downloadFile({ app: { locals: { db: db5 } }, params: { specimenId, fileID }, user: null, t }, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'sampleFiles.downloadError' }));

      res = createRes();
      const db6 = createDb({ sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord2) } });
      vi.spyOn(fs, 'existsSync').mockImplementation(() => {
        throw new Error('down');
      });
      await controller.downloadFile({ app: { locals: { db: db6 } }, params: { specimenId, fileID }, t }, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'sampleFiles.downloadError' }));
    });

    it('deleteFile uses req.t across every response path', async () => {
      let res = createRes();
      await controller.deleteFile({ app: { locals: {} }, params: {}, t }, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'errors.databaseUnavailable' }));

      res = createRes();
      const db1 = createDb();
      await controller.deleteFile({ app: { locals: { db: db1 } }, params: { specimenId: '1', fileID: 'bad' }, t }, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'sampleFiles.invalidFileID' }));

      res = createRes();
      const db2 = createDb({ sample_files: { findOne: vi.fn().mockResolvedValue(null) } });
      await controller.deleteFile({ app: { locals: { db: db2 } }, params: { specimenId: '1', fileID: new ObjectId().toString() }, t }, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'sampleFiles.fileNotFound' }));

      res = createRes();
      const fileID = new ObjectId().toString();
      const otherSpecimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId: otherSpecimenId, storagePath: '/x/a.csv', fileName: 'a.csv' };
      const db3 = createDb({ sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) } });
      await controller.deleteFile({ app: { locals: { db: db3 } }, params: { specimenId: new ObjectId().toString(), fileID }, t }, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'sampleFiles.fileNotBelongToSample' }));

      res = createRes();
      const specimenId = new ObjectId().toString();
      const fileRecord2 = { _id: new ObjectId(fileID), specimenId, storagePath: '/x/a.csv', fileName: 'a.csv' };
      const deleteOne = vi.fn().mockResolvedValue({ deletedCount: 1 });
      const db4 = createDb({ sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord2), deleteOne } });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
      await controller.deleteFile({ app: { locals: { db: db4 } }, params: { specimenId, fileID }, user: null, t }, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'sampleFiles.deleteSuccess' }));

      res = createRes();
      const db5 = createDb({
        sample_files: {
          findOne: vi.fn().mockResolvedValue(fileRecord2),
          deleteOne: vi.fn().mockRejectedValue(new Error('down'))
        }
      });
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      await controller.deleteFile({ app: { locals: { db: db5 } }, params: { specimenId, fileID }, t }, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'sampleFiles.deleteError' }));
    });

    it('exportHL7v2/exportFHIR/exportCDA use req.t across every response path', async () => {
      const specimenId = new ObjectId().toString();
      const fileID = new ObjectId().toString();

      for (const method of ['exportHL7v2', 'exportFHIR', 'exportCDA']) {
        let res = createRes();
        await controller[method]({ app: { locals: {} }, params: {}, t }, res);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'errors.databaseUnavailable' }));

        res = createRes();
        const db1 = createDb({ sample_files: { findOne: vi.fn().mockResolvedValue(null) } });
        await controller[method]({ app: { locals: { db: db1 } }, params: { specimenId, fileID }, t }, res);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'sampleFiles.fileNotFound' }));

        res = createRes();
        const fileRecordMismatch = { _id: new ObjectId(fileID), specimenId: 'other-sample', fileName: 'a.csv' };
        const db2 = createDb({ sample_files: { findOne: vi.fn().mockResolvedValue(fileRecordMismatch) } });
        await controller[method]({ app: { locals: { db: db2 } }, params: { specimenId: 'sample-1', fileID }, t }, res);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'sampleFiles.sampleMismatch' }));

        res = createRes();
        const fileRecord = { _id: new ObjectId(fileID), specimenId, fileName: 'a.csv' };
        const db3 = createDb({
          sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) },
          samples: { findOne: vi.fn().mockResolvedValue(null) }
        });
        await controller[method]({ app: { locals: { db: db3 } }, params: { specimenId, fileID }, t }, res);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'samples.sampleNotFound' }));

        res = createRes();
        const sample = { _id: new ObjectId(specimenId), participantId: '12345678' };
        const db4 = createDb({
          sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) },
          samples: { findOne: vi.fn().mockResolvedValue(sample) }
        });
        const generatorByMethod = {
          exportHL7v2: ['generateHL7v2Message'],
          exportFHIR: ['generateFHIRResource'],
          exportCDA: ['generateCDA']
        };
        const [generatorFn] = generatorByMethod[method];
        vi.spyOn(hl7Service, generatorFn).mockRejectedValue(new Error('boom'));
        await controller[method]({ app: { locals: { db: db4 } }, params: { specimenId, fileID }, t }, res);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'sampleFiles.exportError' }));
      }
    });
  });

  describe('specimenIdString ternary branch (non-ObjectId specimenId)', () => {
    it('downloadFile falls back to String(specimenId) when specimenId is not a valid ObjectId', async () => {
      const fileID = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId: 'sample-42', storagePath: '/x/a.csv', fileName: 'a.csv' };
      const db = createDb({ sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) } });
      const req = { app: { locals: { db } }, params: { specimenId: 'sample-42', fileID }, user: null };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const plaintext = Buffer.from('a.csv content');
      vi.spyOn(fs, 'readFileSync').mockReturnValue(plaintext);

      await controller.downloadFile(req, res);

      expect(res.send).toHaveBeenCalledWith(plaintext);
    });

    it('deleteFile falls back to String(specimenId) when specimenId is not a valid ObjectId', async () => {
      const fileID = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId: 'sample-42', storagePath: '/x/a.csv', fileName: 'a.csv' };
      const deleteOne = vi.fn().mockResolvedValue({ deletedCount: 1 });
      const db = createDb({ sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord), deleteOne } });
      const req = { app: { locals: { db } }, params: { specimenId: 'sample-42', fileID }, user: null };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

      await controller.deleteFile(req, res);

      expect(deleteOne).toHaveBeenCalledWith({ _id: fileRecord._id });
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
