import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const controller = require('../../src/controllers/sample-file.controller');
const auditLogger = require('../../src/utils/auditLogger');
const fs = require('fs');
const crypto = require('crypto');
const { ObjectId } = require('mongodb');

function createRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    send: vi.fn(),
  };
}

function createDb(collections = {}) {
  return {
    collection: vi.fn((name) => {
      if (collections[name]) return collections[name];
      return {
        findOne: vi.fn().mockResolvedValue(null),
        insertOne: vi.fn().mockResolvedValue({ insertedId: new ObjectId() }),
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
        deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
        find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      };
    }),
  };
}

describe('sample-file.controller item 8 residual branches', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('filename reports a crypto failure through the multer callback', () => {
    vi.spyOn(crypto, 'randomBytes').mockImplementation(() => {
      throw new Error('entropy unavailable');
    });
    const cb = vi.fn();

    controller.storage.getFilename({}, { originalname: 'analysis.csv' }, cb);

    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ message: 'entropy unavailable' }), null);
  });

  it('uploadMiddleware uses the translated fallback when multer supplies an error without a message', () => {
    vi.spyOn(controller.upload, 'single').mockReturnValue((_req, _res, cb) => cb({ message: '' }));
    const middleware = controller.uploadMiddleware();
    const req = { t: vi.fn((key) => `translated:${key}`) };
    const res = createRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'translated:sampleFiles.uploadError',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('uploadMiddleware uses the literal fallback without i18n and calls next on success', () => {
    const single = vi.spyOn(controller.upload, 'single');

    single.mockReturnValueOnce((_req, _res, cb) => cb({ message: '' }));
    const errorMiddleware = controller.uploadMiddleware();
    const errorRes = createRes();
    const errorNext = vi.fn();
    errorMiddleware({}, errorRes, errorNext);

    expect(errorRes.json).toHaveBeenCalledWith({
      success: false,
      error: 'Erro ao processar upload do arquivo',
    });
    expect(errorNext).not.toHaveBeenCalled();

    single.mockReturnValueOnce((_req, _res, cb) => cb());
    const successMiddleware = controller.uploadMiddleware();
    const successNext = vi.fn();
    successMiddleware({}, createRes(), successNext);

    expect(successNext).toHaveBeenCalledTimes(1);
  });

  it('uploadFile resolves a canonical non-ObjectId specimenId', async () => {
    const sample = { _id: new ObjectId(), specimenId: '42', collectionSite: 'org-1' };
    const sampleLookup = vi.fn().mockResolvedValue(sample);
    const db = createDb({ specimens: { findOne: sampleLookup } });
    const req = {
      app: { locals: { db } },
      params: { specimenId: '42' },
      file: { path: '/tmp/missing.xyz', originalname: 'missing.xyz', size: 10 },
    };
    const res = createRes();
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    await controller.uploadFile(req, res);

    expect(sampleLookup).toHaveBeenCalledWith({ specimenId: '42' });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'Tipo de arquivo inválido',
    }));
  });

  it('uploadFile tolerates an already-missing temporary file when the sample is absent', async () => {
    const sampleLookup = vi.fn().mockResolvedValue(null);
    const db = createDb({ specimens: { findOne: sampleLookup } });
    const req = {
      app: { locals: { db } },
      params: { specimenId: new ObjectId().toString() },
      file: { path: '/tmp/already-gone.csv', originalname: 'already-gone.csv', size: 10 },
    };
    const res = createRes();
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const unlink = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

    await controller.uploadFile(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(unlink).not.toHaveBeenCalled();
  });

  it('listFiles resolves a canonical non-ObjectId specimenId and sanitizes an unencrypted record', async () => {
    const sample = { _id: new ObjectId(), specimenId: '42', collectionSite: 'org-1' };
    const sampleLookup = vi.fn().mockResolvedValue(sample);
    const find = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{
        _id: new ObjectId(),
        specimenId: sample.specimenId,
        fileName: 'legacy.csv',
        fileType: 'CSV',
        fileRole: 'raw',
        fileFormat: 'text/csv',
        fileSize: 12,
        storagePath: '/private/path.csv',
        storageUri: 'objstore://legacy.csv',
        checksum: 'abc',
        checksumAlgorithm: 'sha256',
        encryptionAlgorithm: null,
        accessPolicy: { view: 'authenticated' },
      }]),
    });
    const db = createDb({
      specimens: { findOne: sampleLookup },
      sample_files: { find },
    });
    const res = createRes();

    await controller.listFiles({
      app: { locals: { db } },
      params: { specimenId: '42' },
      user: null,
    }, res);

    expect(sampleLookup).toHaveBeenCalledWith({ specimenId: '42' });
    expect(find).toHaveBeenCalledWith({ specimenId: sample.specimenId });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({
        fileName: 'legacy.csv',
        encryption: { encrypted: false, algorithm: null },
      })],
    }));
    const body = res.json.mock.calls.at(-1)[0];
    expect(body.data[0].storagePath).toBeUndefined();
  });

  it('downloadFile writes an audit event when an authenticated user downloads a plaintext file', async () => {
    const specimenId = new ObjectId().toString();
    const fileID = new ObjectId().toString();
    const fileRecord = {
      _id: new ObjectId(fileID),
      specimenId,
      fileName: 'audit.csv',
      fileType: 'CSV',
      fileSize: 4,
      storagePath: '/tmp/audit.csv',
      encryptionAlgorithm: null,
    };
    const db = createDb({
      sample_files: { findOne: vi.fn().mockResolvedValue(fileRecord) },
    });
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('data'));
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const log = vi.spyOn(auditLogger, 'log').mockResolvedValue();
    const res = createRes();

    await controller.downloadFile({
      app: { locals: { db } },
      params: { specimenId, fileID },
      user: { userID: 'user-1' },
    }, res);

    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'file_download',
      resourceType: 'SampleFile',
      resourceId: fileID,
      status: 'success',
    }));
    expect(res.send).toHaveBeenCalledWith(Buffer.from('data'));
  });

  it('deleteFile removes the database record even when the physical file is already absent', async () => {
    const specimenId = new ObjectId().toString();
    const fileID = new ObjectId().toString();
    const fileRecord = {
      _id: new ObjectId(fileID),
      specimenId,
      fileName: 'gone.csv',
      storagePath: '/tmp/gone.csv',
    };
    const deleteOne = vi.fn().mockResolvedValue({ deletedCount: 1 });
    const db = createDb({
      sample_files: {
        findOne: vi.fn().mockResolvedValue(fileRecord),
        deleteOne,
      },
    });
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const unlink = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
    const res = createRes();

    await controller.deleteFile({
      app: { locals: { db } },
      params: { specimenId, fileID },
      user: null,
    }, res);

    expect(unlink).not.toHaveBeenCalled();
    expect(deleteOne).toHaveBeenCalledWith({ _id: expect.any(ObjectId) });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('replaceFile uses i18n on pre-persistence rejection paths without requiring file-system cleanup', async () => {
    const t = vi.fn((key) => key);
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const file = { path: '/tmp/new.csv', originalname: 'new.csv', size: 10 };

    let res = createRes();
    await controller.replaceFile({
      app: { locals: {} },
      params: {},
      file,
      t,
    }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'errors.databaseUnavailable' }));

    res = createRes();
    await controller.replaceFile({
      app: { locals: { db: createDb() } },
      params: { specimenId: 'sample-1', fileID: 'bad-id' },
      file,
      t,
    }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'sampleFiles.invalidFileID' }));

    const missingFileId = new ObjectId().toString();
    res = createRes();
    await controller.replaceFile({
      app: { locals: { db: createDb({ sample_files: { findOne: vi.fn().mockResolvedValue(null) } }) } },
      params: { specimenId: 'sample-1', fileID: missingFileId },
      file,
      t,
    }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'sampleFiles.fileNotFound' }));

    const mismatchId = new ObjectId().toString();
    const mismatchedRecord = {
      _id: new ObjectId(mismatchId),
      specimenId: 'other-sample',
      fileName: 'old.csv',
    };
    res = createRes();
    await controller.replaceFile({
      app: {
        locals: {
          db: createDb({ sample_files: { findOne: vi.fn().mockResolvedValue(mismatchedRecord) } }),
        },
      },
      params: { specimenId: 'sample-1', fileID: mismatchId },
      file,
      t,
    }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'sampleFiles.fileNotBelongToSample' }));

    res = createRes();
    await controller.replaceFile({
      app: { locals: { db: createDb() } },
      params: { specimenId: 'sample-1', fileID: new ObjectId().toString() },
      file: null,
      t,
    }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'sampleFiles.fileRequired' }));
  });

  it('replaceFile translates the outer error contract and leaves a missing temporary file untouched', async () => {
    const t = vi.fn((key) => key);
    const db = {
      collection: vi.fn(() => {
        throw new Error('database handle failed');
      }),
    };
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const unlink = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
    const res = createRes();

    await controller.replaceFile({
      app: { locals: { db } },
      params: { specimenId: 'sample-1', fileID: new ObjectId().toString() },
      file: { path: '/tmp/already-gone.csv', originalname: 'new.csv', size: 10 },
      t,
    }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'sampleFiles.replaceError',
      message: 'database handle failed',
    }));
    expect(unlink).not.toHaveBeenCalled();
  });
});
