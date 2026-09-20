import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ObjectId } = require('mongodb');
const fs = require('fs');
const fileCrypto = require('../../src/utils/fileCrypto');
const controllerPath = require.resolve('../../src/controllers/sample-file.controller');
const controller = require(controllerPath);

function createRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    send: vi.fn().mockReturnThis(),
  };
}

function createDb({ sample = null, fileRecord = null } = {}) {
  const samples = {
    findOne: vi.fn().mockResolvedValue(sample),
  };
  const sampleFiles = {
    findOne: vi.fn().mockResolvedValue(fileRecord),
    find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
  };

  return {
    db: {
      collection: vi.fn((name) => {
        if (name === 'samples') return samples;
        if (name === 'sample_files') return sampleFiles;
        throw new Error(`unexpected collection: ${name}`);
      }),
    },
    samples,
    sampleFiles,
  };
}

describe('sample-file.controller item 8 executable residual branches', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete require.cache[controllerPath];
  });

  it('translates the out-of-scope upload error and removes the staged file', async () => {
    const specimenId = new ObjectId().toString();
    const { db } = createDb({
      sample: { _id: new ObjectId(specimenId), collectionSite: 'org-2' },
    });
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const unlink = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
    const t = vi.fn((key) => `i18n:${key}`);
    const res = createRes();

    await controller.uploadFile({
      app: { locals: { db } },
      params: { specimenId },
      file: { path: '/tmp/out-of-scope.csv', originalname: 'out-of-scope.csv', size: 10 },
      organizationScope: { scope: 'organization', organizationIds: ['org-1'] },
      t,
    }, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'i18n:samples.accessDenied',
    }));
    expect(t).toHaveBeenCalledWith('samples.accessDenied');
    expect(unlink).toHaveBeenCalledWith('/tmp/out-of-scope.csv');
  });

  it('translates the out-of-scope list error before reading file metadata', async () => {
    const specimenId = new ObjectId().toString();
    const { db, sampleFiles } = createDb({
      sample: { _id: new ObjectId(specimenId), collectionSite: 'org-2' },
    });
    const t = vi.fn((key) => `i18n:${key}`);
    const res = createRes();

    await controller.listFiles({
      app: { locals: { db } },
      params: { specimenId },
      organizationScope: { scope: 'organization', organizationIds: ['org-1'] },
      user: null,
      t,
    }, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'i18n:samples.accessDenied',
    }));
    expect(t).toHaveBeenCalledWith('samples.accessDenied');
    expect(sampleFiles.find).not.toHaveBeenCalled();
  });

  it('translates the out-of-scope download error before touching the physical file', async () => {
    const specimenId = new ObjectId().toString();
    const fileID = new ObjectId().toString();
    const { db } = createDb({
      sample: { _id: new ObjectId(specimenId), collectionSite: 'org-2' },
      fileRecord: {
        _id: new ObjectId(fileID),
        specimenId,
        fileName: 'private.csv',
        storagePath: '/tmp/private.csv',
      },
    });
    const readFile = vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('private'));
    const t = vi.fn((key) => `i18n:${key}`);
    const res = createRes();

    await controller.downloadFile({
      app: { locals: { db } },
      params: { specimenId, fileID },
      organizationScope: { scope: 'organization', organizationIds: ['org-1'] },
      t,
    }, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'i18n:samples.accessDenied',
    }));
    expect(t).toHaveBeenCalledWith('samples.accessDenied');
    expect(readFile).not.toHaveBeenCalled();
  });

  it('translates a decryption failure without exposing the crypto error', async () => {
    const specimenId = new ObjectId().toString();
    const fileID = new ObjectId().toString();
    const fileRecord = {
      _id: new ObjectId(fileID),
      specimenId,
      fileName: 'encrypted.csv',
      storagePath: '/tmp/encrypted.csv',
      encryptionAlgorithm: 'aes-256-gcm',
    };
    const { db } = createDb({ fileRecord });
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('ciphertext'));
    vi.spyOn(fileCrypto, 'decryptFileBuffer').mockImplementation(() => {
      throw new Error('authentication tag mismatch');
    });

    delete require.cache[controllerPath];
    const freshController = require(controllerPath);
    const t = vi.fn((key) => `i18n:${key}`);
    const res = createRes();

    await freshController.downloadFile({
      app: { locals: { db } },
      params: { specimenId, fileID },
      t,
    }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'i18n:sampleFiles.downloadError',
    });
    expect(t).toHaveBeenCalledWith('sampleFiles.downloadError');
    expect(res.send).not.toHaveBeenCalled();
  });
});
