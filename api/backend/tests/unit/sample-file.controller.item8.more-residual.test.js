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
        if (name === 'specimens') return samples;
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
      sample: { _id: new ObjectId(specimenId), specimenId, collectionSite: 'org-2' },
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
    const sample = { _id: new ObjectId(specimenId), specimenId, collectionSite: 'org-1' };
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
      sample: { _id: new ObjectId(specimenId), specimenId, collectionSite: 'org-2' },
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
      sample: { _id: new ObjectId(specimenId), specimenId, collectionSite: 'org-2' },
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
      sample: { _id: new ObjectId(specimenId), specimenId, participantId: '12345678', collectionSite: 'org-2' },
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


describe('sample-file.controller item 8 alternate file lifecycle branches', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('downloads a plaintext file without audit and tolerates a scope lookup that cannot resolve an ObjectId', async () => {
    const specimenId = 'legacy-specimen-key';
    const fileID = new ObjectId().toString();
    const { db, samples } = buildDb({
      fileRecord: {
        _id: new ObjectId(fileID),
        specimenId,
        fileName: 'plain.csv',
        fileType: 'CSV',
        fileSize: 5,
        storagePath: '/tmp/plain.csv',
        encryptionAlgorithm: null,
      },
    });
    samples.findOne.mockRejectedValueOnce(new Error('not an ObjectId'));
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('plain'));
    const audit = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    const res = createRes();

    await controller.downloadFile({
      app: { locals: { db } },
      params: { specimenId, fileID },
      organizationScope: { scope: 'organization', organizationIds: ['org-1'] },
      user: null,
    }, res);

    expect(res.send).toHaveBeenCalledWith(Buffer.from('plain'));
    expect(audit).not.toHaveBeenCalled();
  });

  it('returns 404 when a download record exists but the physical file is missing', async () => {
    const specimenId = new ObjectId().toString();
    const fileID = new ObjectId().toString();
    const { db } = buildDb({
      fileRecord: {
        _id: new ObjectId(fileID),
        specimenId,
        fileName: 'missing.csv',
        storagePath: '/tmp/missing.csv',
      },
    });
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const res = createRes();

    await controller.downloadFile({ app: { locals: { db } }, params: { specimenId, fileID } }, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('continues logical deletion when physical cleanup fails and skips audit for an anonymous request', async () => {
    const specimenId = new ObjectId().toString();
    const fileID = new ObjectId().toString();
    const { db, sampleFiles } = buildDb({
      fileRecord: {
        _id: new ObjectId(fileID),
        specimenId,
        fileName: 'locked.csv',
        storagePath: '/tmp/locked.csv',
      },
    });
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'unlinkSync').mockImplementation(() => { throw new Error('locked'); });
    const audit = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    const res = createRes();

    await controller.deleteFile({
      app: { locals: { db } },
      params: { specimenId, fileID },
      user: null,
    }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(sampleFiles.deleteOne).toHaveBeenCalledTimes(1);
    expect(audit).not.toHaveBeenCalled();
  });

  it('rejects replace requests with no upload and cleans uploads for malformed/unknown/mismatched identifiers', async () => {
    const specimenId = new ObjectId().toString();
    const validFileID = new ObjectId().toString();
    const res = createRes();

    let { db } = buildDb();
    await controller.replaceFile({ app: { locals: { db } }, params: { specimenId, fileID: validFileID } }, res);
    expect(res.status).toHaveBeenCalledWith(400);

    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const unlink = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

    ({ db } = buildDb());
    await controller.replaceFile({
      app: { locals: { db } },
      params: { specimenId, fileID: 'bad-id' },
      file: { path: '/tmp/bad.csv', originalname: 'bad.csv', size: 1 },
    }, createRes());

    ({ db } = buildDb({ fileRecord: null }));
    await controller.replaceFile({
      app: { locals: { db } },
      params: { specimenId, fileID: validFileID },
      file: { path: '/tmp/missing.csv', originalname: 'missing.csv', size: 1 },
    }, createRes());

    ({ db } = buildDb({
      fileRecord: {
        _id: new ObjectId(validFileID),
        specimenId: new ObjectId().toString(),
        fileName: 'old.csv',
      },
    }));
    await controller.replaceFile({
      app: { locals: { db } },
      params: { specimenId, fileID: validFileID },
      file: { path: '/tmp/mismatch.csv', originalname: 'mismatch.csv', size: 1 },
    }, createRes());

    expect(unlink).toHaveBeenCalledTimes(3);
  });

  it('rejects replace invalid file type and invalid explicit fileRole before encryption', async () => {
    const specimenId = new ObjectId().toString();
    const fileID = new ObjectId().toString();
    const fileRecord = {
      _id: new ObjectId(fileID),
      specimenId,
            fileName: 'old.csv',
      fileRole: 'raw',
    };
    const { db } = buildDb({ fileRecord });
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const unlink = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

    let res = createRes();
    await controller.replaceFile({
      app: { locals: { db } },
      params: { specimenId, fileID },
      file: { path: '/tmp/invalid.exe', originalname: 'invalid.exe', size: 1 },
      body: {},
    }, res);
    expect(res.status).toHaveBeenCalledWith(400);

    res = createRes();
    await controller.replaceFile({
      app: { locals: { db } },
      params: { specimenId, fileID },
      file: { path: '/tmp/role.csv', originalname: 'role.csv', size: 1 },
      body: { fileRole: 'not-a-role' },
    }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(unlink).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['exportHL7v2', 'generateHL7v2Message'],
    ['exportFHIR', 'generateFHIRResource'],
    ['exportCDA', 'generateCDA'],
  ])('%s exports an in-scope sample without an authenticated audit actor', async (method, generator) => {
    const hl7Service = require('../../src/services/hl7.service');
    const generated = method === 'exportFHIR' ? { resourceType: 'Bundle' } : 'generated-document';
    vi.spyOn(hl7Service, generator).mockResolvedValue(generated);
    const specimenId = new ObjectId().toString();
    const fileID = new ObjectId().toString();
    const { db } = buildDb({
      fileRecord: { _id: new ObjectId(fileID), specimenId, fileName: 'x.csv', fileType: 'CSV' },
      sample: { _id: new ObjectId(specimenId), specimenId, participantId: null, collectionSite: 'org-1' },
    });
    const audit = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    const res = createRes();

    await controller[method]({
      app: { locals: { db } },
      params: { specimenId, fileID },
      organizationScope: { scope: 'organization', organizationIds: ['org-1'] },
      user: null,
    }, res);

    expect(hl7Service[generator]).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ fileName: 'x.csv' }),
      expect.objectContaining({ participantId: null }),
      ''
    );
    expect(audit).not.toHaveBeenCalled();
    if (method === 'exportFHIR') expect(res.json).toHaveBeenCalledWith(generated);
    else expect(res.send).toHaveBeenCalledWith(generated);
  });

  it('maps an interoperability generator failure to the export 500 response', async () => {
    const hl7Service = require('../../src/services/hl7.service');
    vi.spyOn(hl7Service, 'generateFHIRResource').mockRejectedValue(new Error('generator down'));
    const specimenId = new ObjectId().toString();
    const fileID = new ObjectId().toString();
    const { db } = buildDb({
      fileRecord: { _id: new ObjectId(fileID), specimenId, fileName: 'x.csv' },
      sample: { _id: new ObjectId(specimenId), specimenId, participantId: '12345678' },
    });
    const res = createRes();

    await controller.exportFHIR({ app: { locals: { db } }, params: { specimenId, fileID } }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'generator down' }));
  });
});


describe('sample-file.controller item 8 safe identifier and ownership guards', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('downloadFile rejects malformed file IDs before any filesystem access', async () => {
    const { db } = buildDb();
    const exists = vi.spyOn(fs, 'existsSync');
    const res = createRes();

    await controller.downloadFile({
      app: { locals: { db } },
      params: { specimenId: 'SPEC-1', fileID: 'not-an-object-id' },
    }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(exists).not.toHaveBeenCalled();
  });

  it('downloadFile rejects a valid file that belongs to another specimen', async () => {
    const fileID = new ObjectId().toString();
    const { db } = buildDb({
      fileRecord: {
        _id: new ObjectId(fileID),
        specimenId: 'SPEC-OTHER',
        fileName: 'x.csv',
        storagePath: '/tmp/x.csv',
      },
    });
    const exists = vi.spyOn(fs, 'existsSync');
    const res = createRes();

    await controller.downloadFile({
      app: { locals: { db } },
      params: { specimenId: 'SPEC-1', fileID },
    }, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(exists).not.toHaveBeenCalled();
  });

  it('deleteFile rejects malformed file IDs and ownership mismatches before deletion', async () => {
    let fixture = buildDb();
    let res = createRes();

    await controller.deleteFile({
      app: { locals: { db: fixture.db } },
      params: { specimenId: 'SPEC-1', fileID: 'not-an-object-id' },
    }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(fixture.sampleFiles.deleteOne).not.toHaveBeenCalled();

    const fileID = new ObjectId().toString();
    fixture = buildDb({
      fileRecord: {
        _id: new ObjectId(fileID),
        specimenId: 'SPEC-OTHER',
        fileName: 'x.csv',
        storagePath: '/tmp/x.csv',
      },
    });
    res = createRes();
    await controller.deleteFile({
      app: { locals: { db: fixture.db } },
      params: { specimenId: 'SPEC-1', fileID },
    }, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(fixture.sampleFiles.deleteOne).not.toHaveBeenCalled();
  });

  it('listFiles resolves a non-ObjectId canonical specimenId', async () => {
    const sample = { _id: new ObjectId(), specimenId: '42', collectionSite: 'org-1' };
    const { db, samples } = buildDb({ sample, files: [] });
    const res = createRes();

    await controller.listFiles({
      app: { locals: { db } },
      params: { specimenId: '42' },
      user: null,
    }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(samples.findOne).toHaveBeenCalledTimes(1);
    expect(samples.findOne).toHaveBeenCalledWith({ specimenId: '42' });
  });

  it('downloadFile serves encrypted-path errors as 500 without leaking decrypt details', async () => {
    const specimenId = new ObjectId().toString();
    const fileID = new ObjectId().toString();
    const { db } = buildDb({
      fileRecord: {
        _id: new ObjectId(fileID),
        specimenId,
        fileName: 'encrypted.csv',
        storagePath: '/tmp/encrypted.csv',
        encryptionAlgorithm: 'aes-256-gcm',
        encryptionKeyId: 'missing-key-id',
        encryptionIv: 'AA==',
        encryptionTag: 'AA==',
      },
    });
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('ciphertext'));
    const res = createRes();

    await controller.downloadFile({
      app: { locals: { db } },
      params: { specimenId, fileID },
      user: null,
    }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
    }));
  });
});
