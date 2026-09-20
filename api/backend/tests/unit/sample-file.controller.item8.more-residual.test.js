import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ObjectId } = require('mongodb');
const controller = require('../../src/controllers/sample-file.controller');
const auditLogger = require('../../src/utils/auditLogger');
const fs = require('fs');

function createRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    send: vi.fn().mockReturnThis(),
    download: vi.fn().mockReturnThis(),
  };
}

function buildDb({
  sample = null,
  fileRecord = null,
  files = [],
  deleteResult = { deletedCount: 1 },
} = {}) {
  const sampleFiles = {
    findOne: vi.fn().mockResolvedValue(fileRecord),
    find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(files) }),
    deleteOne: vi.fn().mockResolvedValue(deleteResult),
  };
  const samples = {
    findOne: vi.fn().mockResolvedValue(sample),
  };

  return {
    db: {
      collection: vi.fn((name) => {
        if (name === 'sample_files') return sampleFiles;
        if (name === 'samples') return samples;
        throw new Error(`unexpected collection: ${name}`);
      }),
    },
    sampleFiles,
    samples,
  };
}

describe('sample-file.controller item 8 more residual canonical branches', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('listFiles returns 503 when the database is unavailable', async () => {
    const res = createRes();
    await controller.listFiles({ app: { locals: {} }, params: { specimenId: '42' } }, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('listFiles returns 404 when the specimen cannot be resolved', async () => {
    const specimenId = new ObjectId().toString();
    const { db } = buildDb();
    const res = createRes();

    await controller.listFiles({ app: { locals: { db } }, params: { specimenId }, user: null }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Amostra não encontrada' }));
  });

  it('listFiles refuses an out-of-scope specimen before reading file metadata', async () => {
    const specimenId = new ObjectId().toString();
    const { db, sampleFiles } = buildDb({
      sample: { _id: new ObjectId(specimenId), collectionSite: 'org-2' },
    });
    const res = createRes();

    await controller.listFiles({
      app: { locals: { db } },
      params: { specimenId },
      organizationScope: { scope: 'organization', organizationIds: ['org-1'] },
      user: null,
    }, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(sampleFiles.find).not.toHaveBeenCalled();
  });

  it('listFiles audits an authenticated in-scope query', async () => {
    const specimenId = new ObjectId().toString();
    const sample = { _id: new ObjectId(specimenId), collectionSite: 'org-1' };
    const { db } = buildDb({ sample, files: [] });
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const log = vi.spyOn(auditLogger, 'log').mockResolvedValue();
    const res = createRes();

    await controller.listFiles({
      app: { locals: { db } },
      params: { specimenId },
      organizationScope: { scope: 'organization', organizationIds: ['org-1'] },
      user: { userID: 'u-1' },
    }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'QUERY',
      resourceType: 'SampleFile',
      status: 'success',
    }));
  });

  it('downloadFile returns 503 when the database is unavailable', async () => {
    const res = createRes();
    await controller.downloadFile({
      app: { locals: {} },
      params: { specimenId: new ObjectId().toString(), fileID: new ObjectId().toString() },
    }, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('downloadFile returns 404 for a valid but unknown file id', async () => {
    const specimenId = new ObjectId().toString();
    const fileID = new ObjectId().toString();
    const { db } = buildDb();
    const res = createRes();

    await controller.downloadFile({ app: { locals: { db } }, params: { specimenId, fileID } }, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('downloadFile refuses an out-of-scope sample before reading the physical file', async () => {
    const specimenId = new ObjectId().toString();
    const fileID = new ObjectId().toString();
    const { db } = buildDb({
      fileRecord: {
        _id: new ObjectId(fileID),
        specimenId,
        fileName: 'private.csv',
        storagePath: '/tmp/private.csv',
      },
      sample: { _id: new ObjectId(specimenId), collectionSite: 'org-2' },
    });
    const exists = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const read = vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('secret'));
    const res = createRes();

    await controller.downloadFile({
      app: { locals: { db } },
      params: { specimenId, fileID },
      organizationScope: { scope: 'organization', organizationIds: ['org-1'] },
    }, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(read).not.toHaveBeenCalled();
    expect(exists).not.toHaveBeenCalledWith('/tmp/private.csv');
  });

  it('deleteFile returns 503 when the database is unavailable', async () => {
    const res = createRes();
    await controller.deleteFile({
      app: { locals: {} },
      params: { specimenId: new ObjectId().toString(), fileID: new ObjectId().toString() },
    }, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('deleteFile returns 404 for a valid but unknown file id', async () => {
    const specimenId = new ObjectId().toString();
    const fileID = new ObjectId().toString();
    const { db } = buildDb();
    const res = createRes();

    await controller.deleteFile({ app: { locals: { db } }, params: { specimenId, fileID } }, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('deleteFile refuses an out-of-scope sample before filesystem/database deletion', async () => {
    const specimenId = new ObjectId().toString();
    const fileID = new ObjectId().toString();
    const { db, sampleFiles } = buildDb({
      fileRecord: {
        _id: new ObjectId(fileID),
        specimenId,
        fileName: 'private.csv',
        storagePath: '/tmp/private.csv',
      },
      sample: { _id: new ObjectId(specimenId), collectionSite: 'org-2' },
    });
    const unlink = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
    const res = createRes();

    await controller.deleteFile({
      app: { locals: { db } },
      params: { specimenId, fileID },
      organizationScope: { scope: 'organization', organizationIds: ['org-1'] },
    }, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(unlink).not.toHaveBeenCalled();
    expect(sampleFiles.deleteOne).not.toHaveBeenCalled();
  });

  it('deleteFile audits a successful authenticated deletion', async () => {
    const specimenId = new ObjectId().toString();
    const fileID = new ObjectId().toString();
    const { db, sampleFiles } = buildDb({
      fileRecord: {
        _id: new ObjectId(fileID),
        specimenId,
        fileName: 'gone.csv',
        fileType: 'CSV',
        fileSize: 10,
        storagePath: '/tmp/gone.csv',
      },
    });
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const log = vi.spyOn(auditLogger, 'log').mockResolvedValue();
    const res = createRes();

    await controller.deleteFile({
      app: { locals: { db } },
      params: { specimenId, fileID },
      user: { userID: 'u-1' },
    }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(sampleFiles.deleteOne).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'file_delete',
      resourceType: 'SampleFile',
      resourceId: fileID,
      severity: 'critical',
    }));
  });

  const exportMethods = [
    ['exportHL7v2', 'HL7'],
    ['exportFHIR', 'FHIR'],
    ['exportCDA', 'CDA'],
  ];

  it.each(exportMethods)('%s returns 503 when the database is unavailable', async (method) => {
    const res = createRes();
    await controller[method]({
      app: { locals: {} },
      params: { specimenId: new ObjectId().toString(), fileID: new ObjectId().toString() },
    }, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it.each(exportMethods)('%s returns 404 when the file record is absent', async (method) => {
    const specimenId = new ObjectId().toString();
    const fileID = new ObjectId().toString();
    const { db } = buildDb();
    const res = createRes();

    await controller[method]({ app: { locals: { db } }, params: { specimenId, fileID } }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Arquivo não encontrado' }));
  });

  it.each(exportMethods)('%s rejects a file/specimen linkage mismatch before reading the sample', async (method) => {
    const specimenId = new ObjectId().toString();
    const fileID = new ObjectId().toString();
    const { db, samples } = buildDb({
      fileRecord: { _id: new ObjectId(fileID), specimenId: new ObjectId().toString(), fileName: 'x.csv' },
    });
    const res = createRes();

    await controller[method]({ app: { locals: { db } }, params: { specimenId, fileID } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(samples.findOne).not.toHaveBeenCalled();
  });

  it.each(exportMethods)('%s returns 404 when the linked Sample no longer exists', async (method) => {
    const specimenId = new ObjectId().toString();
    const fileID = new ObjectId().toString();
    const { db } = buildDb({
      fileRecord: { _id: new ObjectId(fileID), specimenId, fileName: 'x.csv' },
      sample: null,
    });
    const res = createRes();

    await controller[method]({ app: { locals: { db } }, params: { specimenId, fileID } }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Amostra não encontrada' }));
  });

  it.each(exportMethods)('%s refuses an out-of-scope Sample before invoking interoperability generation', async (method) => {
    const specimenId = new ObjectId().toString();
    const fileID = new ObjectId().toString();
    const { db } = buildDb({
      fileRecord: { _id: new ObjectId(fileID), specimenId, fileName: 'x.csv', fileType: 'CSV' },
      sample: { _id: new ObjectId(specimenId), participantId: '12345678', collectionSite: 'org-2' },
    });
    const res = createRes();

    await controller[method]({
      app: { locals: { db } },
      params: { specimenId, fileID },
      organizationScope: { scope: 'organization', organizationIds: ['org-1'] },
    }, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Acesso negado' }));
  });
});
