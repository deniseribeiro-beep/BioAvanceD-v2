import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const controller = require('../../src/controllers/sample-file.controller');
const SampleFileModel = require('../../src/models/SampleFile');
const hl7Service = require('../../src/services/hl7.service');
const auditLogger = require('../../src/utils/auditLogger');
const objectStorage = require('../../src/infrastructure/objectStorage');
const malwareScan = require('../../src/infrastructure/malwareScan');
const { decryptFileBuffer } = require('../../src/utils/fileCrypto');
const { verifyFileAccessToken } = require('../../src/services/dataFileAccessToken.service');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ObjectId } = require('mongodb');

function createRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    send: vi.fn(),
    download: vi.fn(),
    redirect: vi.fn(),
    headersSent: false
  };
}

// RNF029 C5 (#1321): a download that passes its checks redirects to a
// short-lived file access token URL for that one file, and sends no bytes.
const FILE_ACCESS_LOCATION = /^\/api\/file-access\?token=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
function expectFileAccessRedirect(res, fileID) {
  expect(res.send).not.toHaveBeenCalled();
  expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  expect(res.redirect).toHaveBeenCalledTimes(1);
  const [status, location] = res.redirect.mock.calls[0];
  expect(status).toBe(302);
  expect(location).toMatch(FILE_ACCESS_LOCATION);
  const verified = verifyFileAccessToken(location.slice(location.indexOf('=') + 1));
  expect(verified.ok).toBe(true);
  expect(verified.payload.c).toBe('sample_files');
  expect(verified.payload.f).toBe(fileID);
  return verified.payload;
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

// #1321: a replace versions the superseded binary, so a fixture that
// reaches the version write names its storageUri and SHA-256 checksum.
const OLD_CHECKSUM = 'a'.repeat(64);
const OLD_STORAGE_URI = 'objstore://samples/s/files/old.csv';

function createVersionsCollection() {
  return {
    findOne: vi.fn().mockResolvedValue(null),
    insertOne: vi.fn().mockResolvedValue({ acknowledged: true }),
    deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 })
  };
}

// #1321: a case that reaches the object-store write gets a stubbed store, so
// it exercises the controller without touching a disk.
function stubFileStore() {
  const hex = 'd'.repeat(64);
  const putObject = vi.fn().mockResolvedValue({
    uri: `objstore://samples/s/sha256/${hex}`,
    version: `sha256:${hex}`,
    path: `/store/samples/s/sha256/${hex}`
  });
  vi.spyOn(objectStorage, 'getFileObjectStore').mockReturnValue({ putObject });
  return putObject;
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

      controller.fileFilter({}, { originalname: 'data.csv', mimetype: 'text/csv' }, cb);

      expect(cb).toHaveBeenCalledWith(null, true);
    });

    it('fileFilter rejects an allowed extension whose mimetype is not allowed for it (#1321)', () => {
      const cb = vi.fn();

      controller.fileFilter({}, { originalname: 'data.csv', mimetype: 'application/pdf' }, cb);

      expect(cb).toHaveBeenCalledWith(expect.any(Error), false);
      expect(cb.mock.calls[0][0].message).toBe('Tipo MIME application/pdf não permitido para a extensão .csv');
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

    describe('multer rejection', () => {
      function runWithMulterError(err, req) {
        const fresh = new controller.constructor();
        fresh.upload = { single: () => (_req, _res, cb) => cb(err) };
        const res = createRes();
        const next = vi.fn();
        fresh.uploadMiddleware()(req, res, next);
        return { res, next };
      }

      it('answers 400 with the error text and does not call next', () => {
        const { res, next } = runWithMulterError(new Error('File too large'), {});

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ success: false, error: 'File too large' });
      });

      it('answers with the translated fallback when the error has no message and req.t exists', () => {
        const t = vi.fn((key) => `t:${key}`);
        const { res } = runWithMulterError(new Error(''), { t });

        expect(res.status).toHaveBeenCalledWith(400);
        expect(t).toHaveBeenCalledWith('sampleFiles.uploadError');
        expect(res.json).toHaveBeenCalledWith({ success: false, error: 't:sampleFiles.uploadError' });
      });

      it('answers with the Portuguese fallback when the error has no message and there is no req.t', () => {
        const { res } = runWithMulterError(new Error(''), {});

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Erro ao processar upload do arquivo' });
      });
    });

    // #1321 (RF007 AC1, RNF029 C1): the written file's leading bytes must
    // match its extension's format, or the upload is removed.
    describe('content signature (#1321)', () => {
      const written = [];

      function runWithUploadedFile(originalname, content) {
        const filePath = path.join(os.tmpdir(), `sample-file-${process.pid}-${written.length}-${Date.now()}-${originalname}`);
        fs.writeFileSync(filePath, content);
        written.push(filePath);
        const fresh = new controller.constructor();
        fresh.upload = {
          single: () => (req, res, cb) => {
            req.file = { originalname, path: filePath };
            cb();
          }
        };
        const req = {};
        const res = createRes();
        const next = vi.fn();
        fresh.uploadMiddleware()(req, res, next);
        return { filePath, res, next };
      }

      afterEach(() => {
        while (written.length) {
          const filePath = written.pop();
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
      });

      it('answers 400 and removes a .csv whose head is a PE executable', () => {
        const { filePath, res, next } = runWithUploadedFile('data.csv', Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]));

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          success: false,
          error: 'Conteúdo do arquivo não corresponde ao formato .csv'
        });
        expect(fs.existsSync(filePath)).toBe(false);
      });

      it('calls next for a real CSV', () => {
        const { filePath, res, next } = runWithUploadedFile('data.csv', 'a,b,c\n1,2,3\n');

        expect(next).toHaveBeenCalledWith();
        expect(res.status).not.toHaveBeenCalled();
        expect(fs.existsSync(filePath)).toBe(true);
      });
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

    // dict-02 ELM-0317 (#679): an explicit but unsupported fileRole 400s
    // and cleans up the temp file before the sample_files insert, same
    // shape as the invalid-fileType rejection above.
    it('returns 400 and cleans up file when fileRole is invalid', async () => {
      const specimenId = new ObjectId().toString();
      const sample = { _id: new ObjectId(specimenId) };
      const db = createDb({
        samples: { findOne: vi.fn().mockResolvedValue(sample) }
      });
      const req = {
        app: { locals: { db } },
        params: { specimenId },
        file: { path: '/tmp/file.csv', originalname: 'file.csv', size: 100 },
        body: { fileRole: 'bogus' }
      };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

      await controller.uploadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, details: expect.arrayContaining([expect.stringContaining('fileRole')]) })
      );
      expect(unlinkSpy).toHaveBeenCalledWith('/tmp/file.csv');
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

    it('returns 422 and cleans up file when validation fails', async () => {
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
      // #884: readFileSync/writeFileSync are load-bearing here, not padding.
      // Without them uploadFile threw ENOENT reading the plaintext at
      // sample-file.controller.js:219 -- BEFORE SampleFileModel.validate --
      // and landed in the function's outer catch-all, which also answered
      // 400. So this test asserted the right number via the wrong branch and
      // proved nothing about the validator. Invisible until the validator
      // branch moved to 422 and the two diverged. The replaceFile sibling
      // below already mocks both; this one did not.
      vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('file content'));
      vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
      stubFileStore();
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
      vi.spyOn(SampleFileModel, 'getFileTypeFromExtension').mockReturnValue('CSV');
      vi.spyOn(SampleFileModel, 'validate').mockReturnValue({ isValid: false, errors: ['bad'] });

      await controller.uploadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(422);
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
      stubFileStore();
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
      // dict-02 ELM-0317/ELM-0319 (#679): default fileRole and a fileType-
      // derived fileFormat, when the caller doesn't supply either.
      expect(body.data.fileRole).toBe('raw');
      expect(body.data.fileFormat).toBe('text/csv');
    });

    it('happy path with an explicit fileRole: stores and returns it instead of the default', async () => {
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
        file: { path: '/tmp/file.pdf', originalname: 'file.pdf', size: 100 },
        body: { fileRole: 'report' },
        user: null
      };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('file content'));
      vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
      stubFileStore();
      vi.spyOn(SampleFileModel, 'getFileTypeFromExtension').mockReturnValue('PDF');
      vi.spyOn(SampleFileModel, 'validate').mockReturnValue({ isValid: true, errors: [] });

      await controller.uploadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      const body = res.json.mock.calls[0][0];
      expect(body.data.fileRole).toBe('report');
      expect(body.data.fileFormat).toBe('application/pdf');
      expect(sampleFilesCollection.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({ fileRole: 'report', fileFormat: 'application/pdf' })
      );
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
      stubFileStore();
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

    it('answers the translated 403 and removes the staging file for a sample out of scope when req.t exists', async () => {
      const specimenId = new ObjectId().toString();
      const sample = { _id: new ObjectId(specimenId), collectionSite: 'org-9' };
      const db = createDb({
        samples: { findOne: vi.fn().mockResolvedValue(sample) }
      });
      const t = vi.fn((key) => `t:${key}`);
      const req = {
        app: { locals: { db } },
        params: { specimenId },
        file: { path: '/tmp/file.csv', originalname: 'file.csv', size: 100 },
        organizationScope: { scope: 'organization', organizationIds: ['org-1'] },
        t
      };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

      await controller.uploadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 't:samples.accessDenied',
        message: 'Esta amostra pertence a outra organização'
      });
      expect(unlinkSpy).toHaveBeenCalledWith('/tmp/file.csv');
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

    it('answers the translated 403 for a sample out of scope when req.t exists', async () => {
      const specimenId = new ObjectId().toString();
      const sample = { _id: new ObjectId(specimenId), collectionSite: 'org-9' };
      const db = createDb({
        samples: { findOne: vi.fn().mockResolvedValue(sample) }
      });
      const t = vi.fn((key) => `t:${key}`);
      const req = {
        app: { locals: { db } },
        params: { specimenId },
        organizationScope: { scope: 'organization', organizationIds: ['org-1'] },
        t
      };
      const res = createRes();

      await controller.listFiles(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 't:samples.accessDenied',
        message: 'Esta amostra pertence a outra organização'
      });
    });

    // RF007 AC6 (#1321): a logically deleted file is not listed.
    it('lists only files with no deletedAt', async () => {
      const specimenId = new ObjectId().toString();
      const sample = { _id: new ObjectId(specimenId), organizationId: 'org-1' };
      const find = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
      const db = createDb({
        samples: { findOne: vi.fn().mockResolvedValue(sample) },
        sample_files: { find }
      });
      const req = { app: { locals: { db } }, params: { specimenId } };
      const res = createRes();

      await controller.listFiles(req, res);

      expect(find).toHaveBeenCalledWith({ specimenId, deletedAt: null });
      expect(res.status).toHaveBeenCalledWith(200);
    });

    // #1192: the sample's tenancy key is organizationId, falling back to
    // collectionSite only while organizationId is unset.
    it('lists files when organizationId is in scope though collectionSite is not', async () => {
      const specimenId = new ObjectId().toString();
      const sample = { _id: new ObjectId(specimenId), organizationId: 'org-1', collectionSite: 'org-9' };
      const db = createDb({
        samples: { findOne: vi.fn().mockResolvedValue(sample) },
        sample_files: { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) }
      });
      const req = {
        app: { locals: { db } },
        params: { specimenId },
        organizationScope: { scope: 'organization', organizationIds: ['org-1'] }
      };
      const res = createRes();

      await controller.listFiles(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 403 when organizationId is out of scope though collectionSite is in scope', async () => {
      const specimenId = new ObjectId().toString();
      const sample = { _id: new ObjectId(specimenId), organizationId: 'org-9', collectionSite: 'org-1' };
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
          fileRole: 'processed',
          fileFormat: 'text/csv',
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
      // dict-02 ELM-0317/ELM-0319 (#679): surfaced in the listing, not just upload.
      expect(body.data[0].fileRole).toBe('processed');
      expect(body.data[0].fileFormat).toBe('text/csv');
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

    // RF007 AC6 (#1321): a logically deleted row reads as missing.
    it('returns 404 when the file is logically deleted', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, storagePath: '/x/a.csv', fileName: 'a.csv', deletedAt: new Date() };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) }
      });
      const req = { app: { locals: { db } }, params: { specimenId, fileID } };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const readSpy = vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('x'));

      await controller.downloadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Arquivo não encontrado' });
      expect(readSpy).not.toHaveBeenCalled();
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

    // RF007 AC2 (#1321): a row held only in the object store has no local
    // path, so the disk check is skipped; /api/file-access answers its absence.
    it('redirects a store-only row (storagePath null, uri and version set) without checking the disk', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const hex = 'e'.repeat(64);
      const fileRecord = {
        _id: new ObjectId(fileID), specimenId, storagePath: null, fileName: 'a.csv',
        storageUri: `objstore://samples/s/sha256/${hex}`, storageObjectVersion: `sha256:${hex}`
      };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) }
      });
      const req = { app: { locals: { db } }, params: { specimenId, fileID }, user: null };
      const res = createRes();
      const existsSpy = vi.spyOn(fs, 'existsSync');

      await controller.downloadFile(req, res);

      expect(existsSpy).not.toHaveBeenCalled();
      expectFileAccessRedirect(res, fileID);
    });

    it('returns 404 for a row with storagePath null and no object version', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = {
        _id: new ObjectId(fileID), specimenId, storagePath: null, fileName: 'a.csv',
        storageUri: `objstore://samples/s/sha256/${'e'.repeat(64)}`
      };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) }
      });
      const req = { app: { locals: { db } }, params: { specimenId, fileID }, user: null };
      const res = createRes();

      await controller.downloadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.redirect).not.toHaveBeenCalled();
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

      await controller.downloadFile(req, res);

      expect(res.status).not.toHaveBeenCalledWith(403);
      expectFileAccessRedirect(res, fileID);
    });

    it('happy path (unencrypted record): redirects to a file access token URL for this file without reading it', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, storagePath: '/x/a.csv', fileName: 'a.csv' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) }
      });
      const req = { app: { locals: { db } }, params: { specimenId, fileID }, user: null };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const readSpy = vi.spyOn(fs, 'readFileSync');

      await controller.downloadFile(req, res);

      expect(readSpy).not.toHaveBeenCalledWith('/x/a.csv');
      expectFileAccessRedirect(res, fileID);
    });

    it('happy path (encrypted record, RNF029): audits file_download with the token id and redirects to the token URL', async () => {
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
      const req = { app: { locals: { db } }, params: { specimenId, fileID }, user: { userID: 'u1' } };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});

      await controller.downloadFile(req, res);

      const tokenPayload = expectFileAccessRedirect(res, fileID);
      expect(tokenPayload.s).toBe('u1');
      expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
        action: 'file_download',
        resourceType: 'SampleFile',
        payload: expect.objectContaining({
          accessTokenId: tokenPayload.j,
          accessTokenExpiresAt: new Date(tokenPayload.exp * 1000).toISOString()
        })
      }));
      // The redirect carries the token; the audit row carries only its id.
      const [, location] = res.redirect.mock.calls[0];
      const { req: _req, ...recorded } = logSpy.mock.calls[0][0];
      expect(JSON.stringify(recorded)).not.toContain(location.slice(location.indexOf('=') + 1).split('.')[1]);
    });

    // The decrypt-failure case moved to fileAccess.controller.test.js: the
    // download handler no longer reads or decrypts bytes (RNF029 C5, #1321).

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

    describe('access-token subject by caller shape', () => {
      async function download(user) {
        const fileID = new ObjectId().toString();
        const specimenId = new ObjectId().toString();
        const fileRecord = { _id: new ObjectId(fileID), specimenId, storagePath: '/x/a.csv', fileName: 'a.csv' };
        const db = createDb({
          sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) }
        });
        const req = { app: { locals: { db } }, params: { specimenId, fileID }, user };
        const res = createRes();
        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
        vi.spyOn(auditLogger, 'init').mockImplementation(() => {});

        await controller.downloadFile(req, res);

        return expectFileAccessRedirect(res, fileID);
      }

      it('binds the token to the string form of the caller _id when there is no userID', async () => {
        const _id = new ObjectId();

        const payload = await download({ _id });

        expect(payload.s).toBe(String(_id));
      });

      it('binds the token to no subject when there is no caller', async () => {
        const payload = await download(undefined);

        expect(payload.s).toBeNull();
      });
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

    // RF007 AC6 (#1321): a delete is logical and the binary is kept.
    it('logically deletes: sets deletedAt and deletedByAnonId, never unlinks, audits file_delete critical with logicalDelete', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, storagePath: '/x/a.csv', fileName: 'a.csv' };
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
      const deleteOne = vi.fn().mockResolvedValue({ deletedCount: 1 });
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord), updateOne, deleteOne }
      });
      const req = { app: { locals: { db } }, params: { specimenId, fileID }, user: { id: 'u1', anonId: 'USR-ANON-1' } };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
      const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});

      await controller.deleteFile(req, res);

      expect(updateOne).toHaveBeenCalledTimes(1);
      const [filter, update] = updateOne.mock.calls[0];
      expect(filter).toEqual({ _id: fileRecord._id, deletedAt: null });
      expect(update.$set.deletedAt).toBeInstanceOf(Date);
      expect(update.$set.deletedByAnonId).toBe('USR-ANON-1');
      expect(unlinkSpy).not.toHaveBeenCalled();
      expect(deleteOne).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
        action: 'file_delete',
        severity: 'critical',
        message: 'Arquivo removido logicamente: a.csv',
        payload: expect.objectContaining({
          logicalDelete: true,
          deletedAt: update.$set.deletedAt.toISOString()
        })
      }));
    });

    it('returns 404 and writes no audit when the file is already logically deleted', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, storagePath: '/x/a.csv', fileName: 'a.csv', deletedAt: new Date() };
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord), updateOne }
      });
      const req = { app: { locals: { db } }, params: { specimenId, fileID }, user: { id: 'u1' } };
      const res = createRes();
      const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});

      await controller.deleteFile(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Arquivo não encontrado' });
      expect(updateOne).not.toHaveBeenCalled();
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('returns 404 when updateOne matches nothing', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, storagePath: '/x/a.csv', fileName: 'a.csv' };
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord), updateOne }
      });
      const req = { app: { locals: { db } }, params: { specimenId, fileID }, user: { id: 'u1' } };
      const res = createRes();
      const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});

      await controller.deleteFile(req, res);

      expect(updateOne).toHaveBeenCalledWith(
        { _id: fileRecord._id, deletedAt: null },
        expect.objectContaining({ $set: expect.any(Object) })
      );
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Arquivo não encontrado' });
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('returns 500 when an unexpected error is thrown', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, storagePath: '/x/a.csv', fileName: 'a.csv' };
      const db = createDb({
        sample_files: {
          findOne: vi.fn().mockResolvedValue(fileRecord),
          updateOne: vi.fn().mockRejectedValue(new Error('db down'))
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
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord), deleteOne, updateOne },
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
      expect(updateOne).not.toHaveBeenCalled();
    });

    it('happy path: marks the record deleted, keeps the binary, returns 200', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, storagePath: '/x/a.csv', fileName: 'a.csv' };
      const deleteOne = vi.fn().mockResolvedValue({ deletedCount: 1 });
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord), deleteOne, updateOne }
      });
      const req = { app: { locals: { db } }, params: { specimenId, fileID }, user: null };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

      await controller.deleteFile(req, res);

      expect(unlinkSpy).not.toHaveBeenCalled();
      expect(deleteOne).not.toHaveBeenCalled();
      expect(updateOne).toHaveBeenCalledWith(
        { _id: fileRecord._id, deletedAt: null },
        { $set: expect.objectContaining({ deletedAt: expect.any(Date), deletedByAnonId: 'USR-SYSTEM' }) }
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });

  // RF007 AC4/AC6 (#334): a substitution writes a DataFileVersion that keeps
  // the previous checksum, and the version it creates is audited alongside
  // upload, access and logical removal.
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

    // RF007 AC6 (#1321): a logically deleted row reads as missing, and the
    // upload is cleaned up as for a missing row.
    it('returns 404 and cleans up the upload when the file is logically deleted', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, storagePath: '/x/a.csv', fileName: 'a.csv', deletedAt: new Date() };
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      const db = createDb({ sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord), updateOne } });
      const req = {
        app: { locals: { db } },
        params: { specimenId, fileID },
        file: { path: '/tmp/new.csv', originalname: 'new.csv', size: 50 }
      };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

      await controller.replaceFile(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Arquivo não encontrado' });
      expect(unlinkSpy).toHaveBeenCalledWith('/tmp/new.csv');
      expect(updateOne).not.toHaveBeenCalled();
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

    it('happy path: writes new content, keeps the previous physical file, records a DataFileVersion, updates the record, returns 200', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = {
        _id: new ObjectId(fileID),
        specimenId,
        fileName: 'old.csv',
        fileRole: 'raw',
        storagePath: '/x/old.csv',
        storageUri: OLD_STORAGE_URI,
        checksum: OLD_CHECKSUM,
        uploaderAnonId: 'anon-1',
        uploadDate: new Date('2026-01-01'),
        accessPolicy: { view: 'authenticated', manage: ['admin', 'coordinator'] }
      };
      const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
      const versions = createVersionsCollection();
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord), updateOne },
        dataFileVersions: versions
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
      stubFileStore();
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
      vi.spyOn(SampleFileModel, 'getFileTypeFromExtension').mockReturnValue('CSV');
      vi.spyOn(SampleFileModel, 'validate').mockReturnValue({ isValid: true, errors: [] });

      await controller.replaceFile(req, res);

      // RNF029 C3 (#1321): the previous binary is evidence, never unlinked.
      expect(unlinkSpy).not.toHaveBeenCalledWith('/x/old.csv');
      expect(updateOne).toHaveBeenCalledWith(
        { _id: fileRecord._id },
        { $set: expect.objectContaining({ fileName: 'new.csv', fileSize: 200 }) }
      );
      // RF007 AC4: a baseline v1 for the superseded binary, then v2.
      expect(versions.insertOne).toHaveBeenCalledTimes(2);
      const [baseline] = versions.insertOne.mock.calls[0];
      const [version] = versions.insertOne.mock.calls[1];
      expect(baseline).toMatchObject({ fileId: fileID, versionNumber: 1, objectUri: OLD_STORAGE_URI, checksum: OLD_CHECKSUM, previousVersionId: null });
      expect(version).toMatchObject({ fileId: fileID, versionNumber: 2, previousVersionId: baseline.dataFileVersionId, changeReason: 'replacement' });
      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.success).toBe(true);
      expect(body.data.fileName).toBe('new.csv');
      expect(body.data.checksum).toMatch(/^[a-f0-9]{64}$/);
      expect(body.data.checksum).not.toBe(OLD_CHECKSUM);
      expect(version.checksum).toBe(body.data.checksum);
      expect(body.data.versionNumber).toBe(2);
      // Fields carried over from the original record, unaffected by replace.
      expect(body.data.uploaderAnonId).toBe('anon-1');
      // dict-02 ELM-0317/ELM-0319 (#679): fileRole preserved from the
      // existing record (no override supplied), fileFormat recomputed
      // from the new file's fileType.
      expect(body.data.fileRole).toBe('raw');
      expect(body.data.fileFormat).toBe('text/csv');
    });

    it('happy path with an explicit fileRole override: updates and returns the new value', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = {
        _id: new ObjectId(fileID),
        specimenId,
        fileName: 'old.csv',
        fileRole: 'raw',
        storagePath: '/x/old.csv',
        storageUri: OLD_STORAGE_URI,
        checksum: OLD_CHECKSUM,
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
        body: { fileRole: 'derived' },
        user: null
      };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('new file content'));
      vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
      stubFileStore();
      vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
      vi.spyOn(SampleFileModel, 'getFileTypeFromExtension').mockReturnValue('CSV');
      vi.spyOn(SampleFileModel, 'validate').mockReturnValue({ isValid: true, errors: [] });

      await controller.replaceFile(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.data.fileRole).toBe('derived');
      expect(updateOne).toHaveBeenCalledWith(
        { _id: fileRecord._id },
        { $set: expect.objectContaining({ fileRole: 'derived' }) }
      );
    });

    it('returns 400 and cleans up the uploaded file when the fileRole override is invalid', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, storagePath: '/x/old.csv', fileName: 'old.csv' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) }
      });
      const req = {
        app: { locals: { db } },
        params: { specimenId, fileID },
        file: { path: '/tmp/new.csv', originalname: 'new.csv', size: 200 },
        body: { fileRole: 'bogus' }
      };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

      await controller.replaceFile(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(unlinkSpy).toHaveBeenCalledWith('/tmp/new.csv');
    });

    it('happy path with req.user: audits the replace with the previous file identity in the payload', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = {
        _id: new ObjectId(fileID),
        specimenId,
        fileName: 'old.csv',
        storagePath: '/x/old.csv',
        storageUri: OLD_STORAGE_URI,
        checksum: OLD_CHECKSUM
      };
      const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
      const versions = createVersionsCollection();
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord), updateOne },
        dataFileVersions: versions
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
      stubFileStore();
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
          payload: expect.objectContaining({ previousFileName: 'old.csv', previousChecksum: OLD_CHECKSUM, fileName: 'new.csv' })
        })
      );
      // RF007 AC6 (#1321): the audit names the version the replace created.
      const [version] = versions.insertOne.mock.calls[1];
      expect(logSpy.mock.calls[0][0].payload).toMatchObject({ dataFileVersionId: version.dataFileVersionId, versionNumber: 2 });
    });

    it('does not delete the previous file when its path matches the new upload path', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, fileName: 'old.csv', storagePath: '/tmp/new.csv', storageUri: OLD_STORAGE_URI, checksum: OLD_CHECKSUM };
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
      stubFileStore();
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
      vi.spyOn(SampleFileModel, 'getFileTypeFromExtension').mockReturnValue('CSV');
      vi.spyOn(SampleFileModel, 'validate').mockReturnValue({ isValid: true, errors: [] });

      await controller.replaceFile(req, res);

      expect(unlinkSpy).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 422 and cleans up the uploaded file when validation fails', async () => {
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
      stubFileStore();
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
      vi.spyOn(SampleFileModel, 'getFileTypeFromExtension').mockReturnValue('CSV');
      vi.spyOn(SampleFileModel, 'validate').mockReturnValue({ isValid: false, errors: ['bad'] });

      await controller.replaceFile(req, res);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(unlinkSpy).toHaveBeenCalledWith('/tmp/new.csv');
    });

    it('returns 400 when an unexpected error is thrown, and swallows a failed cleanup unlink', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, fileName: 'old.csv', storagePath: '/x/old.csv', storageUri: OLD_STORAGE_URI, checksum: OLD_CHECKSUM };
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
      stubFileStore();
      vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {
        throw new Error('locked');
      });
      vi.spyOn(SampleFileModel, 'getFileTypeFromExtension').mockReturnValue('CSV');
      vi.spyOn(SampleFileModel, 'validate').mockReturnValue({ isValid: true, errors: [] });

      await controller.replaceFile(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('deletes the new DataFileVersion and cleans up the upload when the record update fails (#1321)', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, fileName: 'old.csv', storagePath: '/x/old.csv', storageUri: OLD_STORAGE_URI, checksum: OLD_CHECKSUM };
      const versions = createVersionsCollection();
      const db = createDb({
        sample_files: {
          findOne: vi.fn().mockResolvedValue(fileRecord),
          updateOne: vi.fn().mockRejectedValue(new Error('db down'))
        },
        dataFileVersions: versions
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
      stubFileStore();
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
      vi.spyOn(SampleFileModel, 'getFileTypeFromExtension').mockReturnValue('CSV');
      vi.spyOn(SampleFileModel, 'validate').mockReturnValue({ isValid: true, errors: [] });

      await controller.replaceFile(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      const [version] = versions.insertOne.mock.calls[1];
      expect(versions.deleteOne).toHaveBeenCalledTimes(1);
      expect(versions.deleteOne).toHaveBeenCalledWith({ dataFileVersionId: version.dataFileVersionId });
      expect(unlinkSpy).toHaveBeenCalledWith('/tmp/new.csv');
      expect(unlinkSpy).not.toHaveBeenCalledWith('/x/old.csv');
    });

    it('returns 400 without updating the record when the previous file has no checksum to version (#1321)', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, fileName: 'old.csv', storagePath: '/x/old.csv', storageUri: OLD_STORAGE_URI };
      const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
      const versions = createVersionsCollection();
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord), updateOne },
        dataFileVersions: versions
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
      stubFileStore();
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
      vi.spyOn(SampleFileModel, 'getFileTypeFromExtension').mockReturnValue('CSV');
      vi.spyOn(SampleFileModel, 'validate').mockReturnValue({ isValid: true, errors: [] });

      await controller.replaceFile(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(versions.insertOne).not.toHaveBeenCalled();
      expect(updateOne).not.toHaveBeenCalled();
      expect(unlinkSpy).toHaveBeenCalledWith('/tmp/new.csv');
      expect(unlinkSpy).not.toHaveBeenCalledWith('/x/old.csv');
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

    // RF007 AC6 (#1321): a logically deleted row reads as missing.
    it('404s on a row with deletedAt (#1321)', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, fileName: 'a.csv', fileType: 'CSV', deletedAt: new Date() };
      const sample = { _id: new ObjectId(specimenId), participantId: '12345678' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) },
        samples: { findOne: vi.fn().mockResolvedValue(sample) }
      });
      const req = { app: { locals: { db } }, params: { specimenId, fileID }, user: null };
      const res = createRes();
      const genSpy = vi.spyOn(hl7Service, 'generateHL7v2Message').mockResolvedValue('MSH|^~\\&|...');

      await controller.exportHL7v2(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Arquivo não encontrado' });
      expect(genSpy).not.toHaveBeenCalled();
      expect(res.send).not.toHaveBeenCalled();
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

    // RF007 AC6 (#1321): a logically deleted row reads as missing.
    it('404s on a row with deletedAt (#1321)', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, fileName: 'a.csv', fileType: 'CSV', deletedAt: new Date() };
      const sample = { _id: new ObjectId(specimenId), participantId: '12345678' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) },
        samples: { findOne: vi.fn().mockResolvedValue(sample) }
      });
      const req = { app: { locals: { db } }, params: { specimenId, fileID }, user: null };
      const res = createRes();
      const genSpy = vi.spyOn(hl7Service, 'generateFHIRResource').mockResolvedValue({ resourceType: 'Bundle' });

      await controller.exportFHIR(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Arquivo não encontrado' });
      expect(genSpy).not.toHaveBeenCalled();
      expect(res.send).not.toHaveBeenCalled();
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

    // RF007 AC6 (#1321): a logically deleted row reads as missing.
    it('404s on a row with deletedAt (#1321)', async () => {
      const fileID = new ObjectId().toString();
      const specimenId = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId, fileName: 'a.csv', fileType: 'CSV', deletedAt: new Date() };
      const sample = { _id: new ObjectId(specimenId), participantId: '12345678' };
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) },
        samples: { findOne: vi.fn().mockResolvedValue(sample) }
      });
      const req = { app: { locals: { db } }, params: { specimenId, fileID }, user: null };
      const res = createRes();
      const genSpy = vi.spyOn(hl7Service, 'generateCDA').mockResolvedValue('<ClinicalDocument/>');

      await controller.exportCDA(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Arquivo não encontrado' });
      expect(genSpy).not.toHaveBeenCalled();
      expect(res.send).not.toHaveBeenCalled();
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

  // RF007 AC2 / RNF016 C4 (#1321): on a real filesystem object store and a
  // real staging file, with no fs mocks.
  describe('object storage (#1321)', () => {
    let storeRoot;
    let stagingDir;
    beforeEach(() => {
      storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sample-objstore-'));
      stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sample-staging-'));
      vi.spyOn(objectStorage, 'getFileObjectStore').mockReturnValue(
        objectStorage.createFilesystemObjectStore({ root: storeRoot })
      );
    });
    afterEach(() => {
      fs.rmSync(storeRoot, { recursive: true, force: true });
      fs.rmSync(stagingDir, { recursive: true, force: true });
    });

    function stage(name, content) {
      const stagingPath = path.join(stagingDir, name);
      fs.writeFileSync(stagingPath, content);
      return stagingPath;
    }

    it('uploadFile stores the ciphertext as a content-addressed object and removes the plaintext staging file', async () => {
      const sample = { _id: new ObjectId() };
      const owner = sample._id.toString();
      const insertOne = vi.fn().mockResolvedValue({ insertedId: new ObjectId() });
      const db = createDb({
        samples: { findOne: vi.fn().mockResolvedValue(sample) },
        sample_files: { insertOne }
      });
      const plaintext = Buffer.from('a,b\n1,2\n');
      const stagingPath = stage('upload.csv', plaintext);
      const req = {
        app: { locals: { db } },
        params: { specimenId: owner },
        file: { path: stagingPath, originalname: 'upload.csv', size: plaintext.length },
        user: null
      };
      const res = createRes();

      await controller.uploadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      const record = insertOne.mock.calls[0][0];
      expect(record.storageUri).toMatch(new RegExp(`^objstore://samples/${owner}/sha256/[0-9a-f]{64}$`));
      expect(record.storageObjectVersion).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(fs.existsSync(record.storagePath)).toBe(true);
      expect(decryptFileBuffer(fs.readFileSync(record.storagePath), record).equals(plaintext)).toBe(true);
      expect(fs.existsSync(stagingPath)).toBe(false);
      const body = res.json.mock.calls[0][0];
      expect(body.data.uri).toBe(record.storageUri);
      expect(body.data.storageObjectVersion).toBe(record.storageObjectVersion);
    });

    it('replaceFile stores the new object, keeps the previous object unchanged and removes the staging file', async () => {
      const specimenId = new ObjectId().toString();
      const previousBytes = Buffer.from('previous ciphertext');
      const previous = await objectStorage.createFilesystemObjectStore({ root: storeRoot })
        .putObject({ area: 'samples', ownerKey: specimenId, body: previousBytes });
      const fileRecord = {
        _id: new ObjectId(),
        specimenId,
        fileName: 'old.csv',
        fileType: 'CSV',
        fileSize: previousBytes.length,
        storagePath: previous.path,
        storageUri: previous.uri,
        checksum: OLD_CHECKSUM
      };
      const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord), updateOne },
        dataFileVersions: createVersionsCollection()
      });
      const plaintext = Buffer.from('c,d\n3,4\n');
      const stagingPath = stage('new.csv', plaintext);
      const req = {
        app: { locals: { db } },
        params: { specimenId, fileID: fileRecord._id.toString() },
        file: { path: stagingPath, originalname: 'new.csv', size: plaintext.length },
        user: null
      };
      const res = createRes();

      await controller.replaceFile(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const updated = updateOne.mock.calls[0][1].$set;
      expect(updated.storageUri).toMatch(new RegExp(`^objstore://samples/${specimenId}/sha256/[0-9a-f]{64}$`));
      expect(updated.storageObjectVersion).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(decryptFileBuffer(fs.readFileSync(updated.storagePath), updated).equals(plaintext)).toBe(true);
      expect(fs.existsSync(stagingPath)).toBe(false);
      expect(fs.readFileSync(previous.path).equals(previousBytes)).toBe(true);
      const body = res.json.mock.calls[0][0];
      expect(body.data.uri).toBe(updated.storageUri);
      expect(body.data.storageObjectVersion).toBe(updated.storageObjectVersion);
    });

    // RNF029 C4 (#1321): the plaintext passes the malware scanner before the
    // object store sees it, and a refused file leaves no object and no row.
    function storedFiles(dir) {
      return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? storedFiles(full) : [full];
      });
    }

    function uploadCase() {
      const sample = { _id: new ObjectId() };
      const insertOne = vi.fn().mockResolvedValue({ insertedId: new ObjectId() });
      const db = createDb({
        samples: { findOne: vi.fn().mockResolvedValue(sample) },
        sample_files: { insertOne }
      });
      const plaintext = Buffer.from('a,b\n1,2\n');
      const stagingPath = stage('upload.csv', plaintext);
      const req = {
        app: { locals: { db } },
        params: { specimenId: sample._id.toString() },
        file: { path: stagingPath, originalname: 'upload.csv', size: plaintext.length },
        user: null
      };
      return { req, insertOne, stagingPath };
    }

    it('uploadFile refuses an infected file with 422, writing no object and no row and removing the staging file', async () => {
      const scan = vi.fn().mockResolvedValue({ status: 'infected', signature: 'EICAR-Test-File' });
      vi.spyOn(malwareScan, 'getFileScanner').mockReturnValue({ name: 'test', scan });
      const { req, insertOne, stagingPath } = uploadCase();
      const res = createRes();

      await controller.uploadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(scan).toHaveBeenCalledWith(Buffer.from('a,b\n1,2\n'), { fileName: 'upload.csv' });
      expect(insertOne).not.toHaveBeenCalled();
      expect(storedFiles(storeRoot)).toEqual([]);
      expect(fs.existsSync(stagingPath)).toBe(false);
    });

    it('uploadFile answers 503 when the scan rejects, writing no object and no row and removing the staging file', async () => {
      const scan = vi.fn().mockRejectedValue(new Error('scanner down'));
      vi.spyOn(malwareScan, 'getFileScanner').mockReturnValue({ name: 'test', scan });
      const { req, insertOne, stagingPath } = uploadCase();
      const res = createRes();

      await controller.uploadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(insertOne).not.toHaveBeenCalled();
      expect(storedFiles(storeRoot)).toEqual([]);
      expect(fs.existsSync(stagingPath)).toBe(false);
    });

    it('uploadFile with the default driver records a not-available verdict from the "none" scanner on the row', async () => {
      const { req, insertOne } = uploadCase();
      const res = createRes();

      await controller.uploadFile(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(insertOne.mock.calls[0][0].malwareScan).toEqual({
        status: 'not-available', scanner: 'none', scannedAt: expect.any(Date)
      });
    });

    it('replaceFile refuses an infected file with 422, with no update, no DataFileVersion and the previous object unchanged', async () => {
      const scan = vi.fn().mockResolvedValue({ status: 'infected', signature: 'EICAR-Test-File' });
      vi.spyOn(malwareScan, 'getFileScanner').mockReturnValue({ name: 'test', scan });
      const specimenId = new ObjectId().toString();
      const previousBytes = Buffer.from('previous ciphertext');
      const previous = await objectStorage.createFilesystemObjectStore({ root: storeRoot })
        .putObject({ area: 'samples', ownerKey: specimenId, body: previousBytes });
      const fileRecord = {
        _id: new ObjectId(),
        specimenId,
        fileName: 'old.csv',
        fileType: 'CSV',
        fileSize: previousBytes.length,
        storagePath: previous.path,
        storageUri: previous.uri,
        checksum: OLD_CHECKSUM
      };
      const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
      const versions = createVersionsCollection();
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord), updateOne },
        dataFileVersions: versions
      });
      const plaintext = Buffer.from('c,d\n3,4\n');
      const stagingPath = stage('new.csv', plaintext);
      const req = {
        app: { locals: { db } },
        params: { specimenId, fileID: fileRecord._id.toString() },
        file: { path: stagingPath, originalname: 'new.csv', size: plaintext.length },
        user: null
      };
      const res = createRes();

      await controller.replaceFile(req, res);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(updateOne).not.toHaveBeenCalled();
      expect(versions.insertOne).not.toHaveBeenCalled();
      expect(storedFiles(storeRoot)).toEqual([previous.path]);
      expect(fs.readFileSync(previous.path).equals(previousBytes)).toBe(true);
      expect(fs.existsSync(stagingPath)).toBe(false);
    });
  });

  // RF007 AC3/AC5, V2E-0471/V2E-0474/V2E-0476 (#1321): a DataFile records its
  // canonical MIME, its owner and every entity it is linked to.
  describe('DataFile links and Core companions (#1321)', () => {
    function linkDb({ consents = null, approvals = null, studies = null } = {}) {
      const sample = { _id: new ObjectId() };
      const insertOne = vi.fn().mockResolvedValue({ insertedId: new ObjectId() });
      const lookups = {
        patientConsents: { findOne: vi.fn().mockResolvedValue(consents) },
        collectionGovernanceApprovals: { findOne: vi.fn().mockResolvedValue(approvals) },
        studies: { findOne: vi.fn().mockResolvedValue(studies) }
      };
      const db = createDb({
        samples: { findOne: vi.fn().mockResolvedValue(sample) },
        sample_files: { insertOne },
        ...lookups
      });
      return { db, sample, insertOne, lookups };
    }

    function linkReq(db, sample, body) {
      return {
        app: { locals: { db } },
        params: { specimenId: sample._id.toString() },
        file: { path: '/tmp/file.csv', originalname: 'file.csv', size: 100 },
        body,
        user: null
      };
    }

    beforeEach(() => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('a,b\n1,2\n'));
      vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
      vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
    });

    it('uploadFile with no link fields records the specimen as the only linked entity, the canonical mimeType and the uploader as owner', async () => {
      const { db, sample, insertOne } = linkDb();
      stubFileStore();
      const res = createRes();

      await controller.uploadFile(linkReq(db, sample, {}), res);

      expect(res.status).toHaveBeenCalledWith(201);
      const record = insertOne.mock.calls[0][0];
      const specimenRef = { entityType: 'Specimen', entityId: sample._id.toString() };
      expect(record.linkedEntityRefs).toEqual([specimenRef]);
      expect(record.mimeType).toBe('text/csv');
      expect(record.ownerId).toBe('USR-SYSTEM');
      expect(record.ownerId).toBe(record.uploaderAnonId);
      const body = res.json.mock.calls[0][0];
      expect(body.data.linkedEntityRefs).toEqual([specimenRef]);
      expect(body.data.mimeType).toBe('text/csv');
      expect(body.data.ownerId).toBe('USR-SYSTEM');
    });

    // RF007 AC2 / RNF016 C4 (#1321): an S3 store returns no local path.
    it('uploadFile through a store that returns path null answers 201 and inserts storagePath null', async () => {
      const { db, sample, insertOne } = linkDb();
      const hex = 'e'.repeat(64);
      const stored = { uri: `objstore://samples/s/sha256/${hex}`, version: `sha256:${hex}`, path: null };
      vi.spyOn(objectStorage, 'getFileObjectStore').mockReturnValue({ putObject: vi.fn().mockResolvedValue(stored) });
      const res = createRes();

      await controller.uploadFile(linkReq(db, sample, {}), res);

      expect(res.status).toHaveBeenCalledWith(201);
      const record = insertOne.mock.calls[0][0];
      expect(record.storagePath).toBeNull();
      expect(record.storageUri).toBe(stored.uri);
      expect(record.storageObjectVersion).toBe(stored.version);
    });

    it('uploadFile with a found studyId records the specimen, then the study', async () => {
      const { db, sample, insertOne, lookups } = linkDb({ studies: { studyId: 'ST-1' } });
      stubFileStore();
      const res = createRes();

      await controller.uploadFile(linkReq(db, sample, { studyId: 'ST-1' }), res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(lookups.studies.findOne).toHaveBeenCalledWith({ studyId: 'ST-1' });
      expect(insertOne.mock.calls[0][0].linkedEntityRefs).toEqual([
        { entityType: 'Specimen', entityId: sample._id.toString() },
        { entityType: 'Study', entityId: 'ST-1' }
      ]);
    });

    it('uploadFile with a consent, an approval and a study, all found, records them in that order', async () => {
      const { db, sample, insertOne, lookups } = linkDb({
        consents: { consentId: 'C-1' },
        approvals: { approvalId: 'A-1' },
        studies: { studyId: 'ST-1' }
      });
      stubFileStore();
      const res = createRes();

      await controller.uploadFile(linkReq(db, sample, { studyId: 'ST-1', approvalId: 'A-1', consentId: 'C-1' }), res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(lookups.patientConsents.findOne).toHaveBeenCalledWith({ consentId: 'C-1' });
      expect(lookups.collectionGovernanceApprovals.findOne).toHaveBeenCalledWith({ approvalId: 'A-1' });
      expect(insertOne.mock.calls[0][0].linkedEntityRefs).toEqual([
        { entityType: 'Specimen', entityId: sample._id.toString() },
        { entityType: 'Consent', entityId: 'C-1' },
        { entityType: 'CollectionGovernanceApproval', entityId: 'A-1' },
        { entityType: 'Study', entityId: 'ST-1' }
      ]);
    });

    it('uploadFile with an unknown studyId answers 422, inserts no row, writes no object and removes the staging file', async () => {
      const { db, sample, insertOne } = linkDb();
      const putObject = stubFileStore();
      const res = createRes();

      await controller.uploadFile(linkReq(db, sample, { studyId: 'ST-404' }), res);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Vínculo inválido', details: ['studyId ST-404 não encontrado'] });
      expect(insertOne).not.toHaveBeenCalled();
      expect(putObject).not.toHaveBeenCalled();
      expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/file.csv');
    });

    it('uploadFile with a repeated consentId field (an array) answers 422 without a lookup', async () => {
      const { db, sample, insertOne, lookups } = linkDb({ consents: { consentId: 'C-1' } });
      const putObject = stubFileStore();
      const res = createRes();

      await controller.uploadFile(linkReq(db, sample, { consentId: ['C-1', 'C-2'] }), res);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json.mock.calls[0][0].details).toEqual(['consentId deve ser string não vazia']);
      expect(lookups.patientConsents.findOne).not.toHaveBeenCalled();
      expect(insertOne).not.toHaveBeenCalled();
      expect(putObject).not.toHaveBeenCalled();
    });

    it('replaceFile recomputes mimeType and leaves linkedEntityRefs and ownerId as they are', async () => {
      const specimenId = new ObjectId().toString();
      const fileRecord = {
        _id: new ObjectId(),
        specimenId,
        fileName: 'old.csv',
        fileType: 'CSV',
        fileSize: 10,
        mimeType: 'text/csv',
        ownerId: 'anon-owner',
        linkedEntityRefs: [{ entityType: 'Specimen', entityId: specimenId }],
        storagePath: '/x/old.csv',
        storageUri: OLD_STORAGE_URI,
        checksum: OLD_CHECKSUM
      };
      const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord), updateOne },
        dataFileVersions: createVersionsCollection()
      });
      stubFileStore();
      const req = {
        app: { locals: { db } },
        params: { specimenId, fileID: fileRecord._id.toString() },
        file: { path: '/tmp/new.pdf', originalname: 'new.pdf', size: 20 },
        user: null
      };
      const res = createRes();

      await controller.replaceFile(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const updated = updateOne.mock.calls[0][1].$set;
      expect(updated.mimeType).toBe('application/pdf');
      expect(updated).not.toHaveProperty('linkedEntityRefs');
      expect(updated).not.toHaveProperty('ownerId');
      expect(res.json.mock.calls[0][0].data.mimeType).toBe('application/pdf');
    });
  });

  // RF007 AC3, V2E-0475 (#1321): the server records the active DataFile
  // RetentionPolicy on the row; the client never picks it.
  describe('DataFile retentionPolicyId (#1321)', () => {
    const POLICY_ID = '64b7f0c2a1b2c3d4e5f60718';

    function policyDb(policy) {
      const sample = { _id: new ObjectId() };
      const insertOne = vi.fn().mockResolvedValue({ insertedId: new ObjectId() });
      const retentionPolicies = { findOne: vi.fn().mockResolvedValue(policy) };
      const db = createDb({
        samples: { findOne: vi.fn().mockResolvedValue(sample) },
        sample_files: { insertOne },
        retentionPolicies
      });
      return { db, sample, insertOne, retentionPolicies };
    }

    function policyReq(db, sample, body = {}) {
      return {
        app: { locals: { db } },
        params: { specimenId: sample._id.toString() },
        file: { path: '/tmp/file.csv', originalname: 'file.csv', size: 100 },
        body,
        user: { id: 'u1' }
      };
    }

    beforeEach(() => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('a,b\n1,2\n'));
      vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
      vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    });

    it('uploadFile with an active DataFile policy records its id on the row, the 201 data and the audit payload', async () => {
      const { db, sample, insertOne, retentionPolicies } = policyDb({ _id: new ObjectId(POLICY_ID) });
      stubFileStore();
      const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
      const res = createRes();

      await controller.uploadFile(policyReq(db, sample), res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(retentionPolicies.findOne).toHaveBeenCalledWith(
        { active: true, applicableEntityTypes: { $in: ['DataFile'] } },
        { sort: { createdAt: -1 } }
      );
      expect(insertOne.mock.calls[0][0].retentionPolicyId).toBe(POLICY_ID);
      expect(res.json.mock.calls[0][0].data.retentionPolicyId).toBe(POLICY_ID);
      expect(logSpy.mock.calls[0][0].payload.retentionPolicyId).toBe(POLICY_ID);
    });

    it('uploadFile with no active DataFile policy records null and still answers 201', async () => {
      const { db, sample, insertOne } = policyDb(null);
      stubFileStore();
      vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
      const res = createRes();

      await controller.uploadFile(policyReq(db, sample), res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(insertOne.mock.calls[0][0].retentionPolicyId).toBeNull();
      expect(res.json.mock.calls[0][0].data.retentionPolicyId).toBeNull();
    });

    it('uploadFile ignores a retentionPolicyId the request names', async () => {
      const { db, sample, insertOne } = policyDb(null);
      stubFileStore();
      vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
      const res = createRes();

      await controller.uploadFile(policyReq(db, sample, { retentionPolicyId: 'forged' }), res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(insertOne.mock.calls[0][0].retentionPolicyId).toBeNull();
    });

    it('listFiles returns each row\'s retentionPolicyId', async () => {
      const sample = { _id: new ObjectId() };
      const rows = [
        { _id: new ObjectId(), specimenId: sample._id.toString(), fileName: 'a.csv', retentionPolicyId: POLICY_ID },
        { _id: new ObjectId(), specimenId: sample._id.toString(), fileName: 'b.csv', retentionPolicyId: null }
      ];
      const db = createDb({
        samples: { findOne: vi.fn().mockResolvedValue(sample) },
        sample_files: { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(rows) }) }
      });
      const res = createRes();

      await controller.listFiles({ app: { locals: { db } }, params: { specimenId: sample._id.toString() }, user: null }, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json.mock.calls[0][0].data.map((f) => f.retentionPolicyId)).toEqual([POLICY_ID, null]);
    });

    it('replaceFile leaves the row\'s retentionPolicyId as it is', async () => {
      const specimenId = new ObjectId().toString();
      const fileRecord = {
        _id: new ObjectId(),
        specimenId,
        fileName: 'old.csv',
        fileType: 'CSV',
        fileSize: 10,
        retentionPolicyId: POLICY_ID,
        storagePath: '/x/old.csv',
        storageUri: OLD_STORAGE_URI,
        checksum: OLD_CHECKSUM
      };
      const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
      const db = createDb({
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord), updateOne },
        dataFileVersions: createVersionsCollection()
      });
      stubFileStore();
      const req = {
        app: { locals: { db } },
        params: { specimenId, fileID: fileRecord._id.toString() },
        file: { path: '/tmp/new.csv', originalname: 'new.csv', size: 20 },
        body: { retentionPolicyId: 'forged' },
        user: null
      };
      const res = createRes();

      await controller.replaceFile(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(updateOne.mock.calls[0][1].$set).not.toHaveProperty('retentionPolicyId');
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
      stubFileStore();

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

      // 400 invalid fileRole (dict-02 ELM-0317, #679)
      res = createRes();
      vi.spyOn(SampleFileModel, 'getFileTypeFromExtension').mockReturnValue('CSV');
      await controller.uploadFile(
        {
          app: { locals: { db: db3 } },
          params: { specimenId },
          file: { path: '/tmp/f.csv', originalname: 'f.csv', size: 1 },
          body: { fileRole: 'bogus' },
          t
        },
        res
      );
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'sampleFiles.invalidFileRole' }));

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
      stubFileStore();
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

      // RNF029 C5 (#1321): past the on-disk check the handler reads no
      // bytes, so a broken read can no longer fail it; it redirects.
      res = createRes();
      const db5 = createDb({ sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord2) } });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      await controller.downloadFile({ app: { locals: { db: db5 } }, params: { specimenId, fileID }, user: null, t }, res);
      expect(res.json).not.toHaveBeenCalled();
      expectFileAccessRedirect(res, fileID);

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
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      const db4 = createDb({ sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord2), updateOne } });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
      await controller.deleteFile({ app: { locals: { db: db4 } }, params: { specimenId, fileID }, user: null, t }, res);
      expect(updateOne).toHaveBeenCalledWith({ _id: fileRecord2._id, deletedAt: null }, expect.any(Object));
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'sampleFiles.deleteSuccess' }));

      res = createRes();
      const db5 = createDb({
        sample_files: {
          findOne: vi.fn().mockResolvedValue(fileRecord2),
          updateOne: vi.fn().mockRejectedValue(new Error('down'))
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

      await controller.downloadFile(req, res);

      expectFileAccessRedirect(res, fileID);
    });

    it('deleteFile falls back to String(specimenId) when specimenId is not a valid ObjectId', async () => {
      const fileID = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId: 'sample-42', storagePath: '/x/a.csv', fileName: 'a.csv' };
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      const db = createDb({ sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord), updateOne } });
      const req = { app: { locals: { db } }, params: { specimenId: 'sample-42', fileID }, user: null };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

      await controller.deleteFile(req, res);

      expect(updateOne).toHaveBeenCalledWith({ _id: fileRecord._id, deletedAt: null }, expect.any(Object));
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
  // #1216: the create response names a specimen by its canonical specimenId,
  // and a file is keyed by the sample's _id string. The samples doubles
  // honour their filter, so an unresolved specimenId misses instead of
  // matching by accident. The old fallback looked it up as a Number.
  describe('#1216: a specimenId in the URL', () => {
    const SPECIMEN_ID = '3116768';
    function samplesBySpecimenId(sample) {
      return {
        findOne: vi.fn(async (filter = {}) => {
          if (filter.specimenId === SPECIMEN_ID) return sample;
          if (filter._id && String(filter._id) === String(sample._id)) return sample;
          return null;
        })
      };
    }

    it('listFiles resolves it and lists the files keyed by the sample _id', async () => {
      const sample = { _id: new ObjectId(), specimenId: SPECIMEN_ID };
      const find = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
      const db = createDb({ samples: samplesBySpecimenId(sample), sample_files: { find } });
      const req = { app: { locals: { db } }, params: { specimenId: SPECIMEN_ID }, user: null };
      const res = createRes();

      await controller.listFiles(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(find).toHaveBeenCalledWith({ specimenId: sample._id.toString(), deletedAt: null });
    });

    it('downloadFile accepts it for a file keyed by the sample _id', async () => {
      const sample = { _id: new ObjectId(), specimenId: SPECIMEN_ID };
      const fileID = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId: sample._id.toString(), storagePath: '/x/a.csv', fileName: 'a.csv' };
      const db = createDb({
        samples: samplesBySpecimenId(sample),
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) }
      });
      const req = { app: { locals: { db } }, params: { specimenId: SPECIMEN_ID, fileID }, user: null };
      const res = createRes();
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      await controller.downloadFile(req, res);

      expect(res.status).not.toHaveBeenCalledWith(403);
      expectFileAccessRedirect(res, fileID);
    });

    it('exportHL7v2 resolves it before the link check, so scope still decides', async () => {
      const sample = { _id: new ObjectId(), specimenId: SPECIMEN_ID, collectionSite: 'org-9' };
      const fileID = new ObjectId().toString();
      const fileRecord = { _id: new ObjectId(fileID), specimenId: sample._id.toString(), fileName: 'a.csv' };
      const db = createDb({
        samples: samplesBySpecimenId(sample),
        sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) }
      });
      const req = {
        app: { locals: { db } },
        params: { specimenId: SPECIMEN_ID, fileID },
        organizationScope: { scope: 'organization', organizationIds: ['org-1'] }
      };
      const res = createRes();

      await controller.exportHL7v2(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Esta amostra pertence a outra organização' }));
    });
  });
});
