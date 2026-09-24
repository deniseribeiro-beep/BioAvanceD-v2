import { afterEach, describe, expect, it, vi } from 'vitest';

const controller = require('../../src/controllers/import-lgpd.controller');
const importLGPDService = require('../../src/services/import-lgpd.service');
const rbacAssignmentService = require('../../src/services/rbac-assignment.service');
const auditLogger = require('../../src/utils/auditLogger');
const fs = require('fs');

function resMock() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    send: vi.fn().mockReturnThis(),
  };
}

function reqBase(db, extra = {}) {
  return {
    app: { locals: { db } },
    params: {},
    query: {},
    body: {},
    user: null,
    ip: '127.0.0.1',
    get: vi.fn().mockReturnValue('vitest-agent'),
    ...extra,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('import-lgpd.controller item8 residual branches', () => {
  it('resolves readable quarantine types for allowed, denied and permission-error callers', async () => {
    const sampleType = importLGPDService.QUARANTINE_BATCH_TYPES.SAMPLE;
    const patientType = importLGPDService.QUARANTINE_BATCH_TYPES.PATIENT;
    const permission = vi.spyOn(rbacAssignmentService, 'userHasPermission');

    permission.mockResolvedValueOnce(true);
    await expect(controller.resolveReadableQuarantineTypes({}, { user: { userID: 'u1' } }))
      .resolves.toEqual([sampleType, patientType]);

    permission.mockResolvedValueOnce(false);
    await expect(controller.resolveReadableQuarantineTypes({}, { user: { userID: 'u2' } }))
      .resolves.toEqual([sampleType]);

    permission.mockRejectedValueOnce(new Error('rbac unavailable'));
    await expect(controller.resolveReadableQuarantineTypes({}, { user: null }))
      .resolves.toEqual([sampleType]);
  });

  it('reads quarantine batches with resolved type scope and preserves client status codes', async () => {
    const service = vi.spyOn(importLGPDService, 'getQuarantineBatch');
    vi.spyOn(controller, 'resolveReadableQuarantineTypes').mockResolvedValue(['sample']);

    let res = resMock();
    await controller.getQuarantineBatch(reqBase(null, { params: { batchId: 'b1' } }), res);
    expect(res.status).toHaveBeenCalledWith(503);

    service.mockResolvedValueOnce({ batch: { batchId: 'b1' }, records: [{ row: 1 }] });
    res = resMock();
    await controller.getQuarantineBatch(reqBase({}, { params: { batchId: 'b1' } }), res);
    expect(service).toHaveBeenCalledWith({}, 'b1', { types: ['sample'] });
    expect(res.status).toHaveBeenCalledWith(200);

    const notFound = new Error('batch not found');
    notFound.statusCode = 404;
    service.mockRejectedValueOnce(notFound);
    res = resMock();
    await controller.getQuarantineBatch(reqBase({}, { params: { batchId: 'missing' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'batch not found' });

    service.mockRejectedValueOnce(new Error('storage down'));
    res = resMock();
    await controller.getQuarantineBatch(reqBase({}, { params: { batchId: 'b2' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Erro ao ler lote de quarentena' });
  });

  it('lists quarantine batches and pagination, including service failure', async () => {
    vi.spyOn(controller, 'resolveReadableQuarantineTypes').mockResolvedValue(['sample', 'patient']);
    const list = vi.spyOn(importLGPDService, 'listQuarantineBatches')
      .mockResolvedValueOnce({
        batches: [{ batchId: 'b1' }],
        page: 2,
        limit: 5,
        total: 11,
        totalPages: 3,
      });

    let res = resMock();
    await controller.listQuarantineBatches(reqBase(null), res);
    expect(res.status).toHaveBeenCalledWith(503);

    res = resMock();
    await controller.listQuarantineBatches(reqBase({}, { query: { limit: '5', page: '2' } }), res);
    expect(list).toHaveBeenCalledWith({}, {
      limit: '5',
      page: '2',
      types: ['sample', 'patient'],
    });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      pagination: { page: 2, limit: 5, total: 11, totalPages: 3 },
    }));

    list.mockRejectedValueOnce(new Error('query failed'));
    res = resMock();
    await controller.listQuarantineBatches(reqBase({}), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('persists smart-import summary and returns inserted id', async () => {
    const insertOne = vi.fn().mockResolvedValue({ insertedId: 'report-1' });
    const db = { collection: vi.fn(() => ({ insertOne })) };

    const result = await controller.persistSmartImportSummary(db, { total: 4 });
    expect(result).toMatchObject({
      _id: 'report-1',
      type: 'patients-smart-import',
      total: 4,
    });
    expect(result.createdAt).toBeInstanceOf(Date);
  });

  it('normalizes smart-import report pagination defaults, clamps and handles NaN', async () => {
    const chain = {
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([{ _id: 'r1' }]),
    };
    const reports = {
      find: vi.fn(() => chain),
      countDocuments: vi.fn().mockResolvedValue(0),
    };
    const db = { collection: vi.fn(() => reports) };

    let res = resMock();
    await controller.listSmartImportReports(reqBase(null), res);
    expect(res.status).toHaveBeenCalledWith(503);

    res = resMock();
    await controller.listSmartImportReports(reqBase(db, { query: { limit: 'not-a-number', page: 'bad' } }), res);
    expect(chain.skip).toHaveBeenLastCalledWith(0);
    expect(chain.limit).toHaveBeenLastCalledWith(20);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    }));

    reports.countDocuments.mockResolvedValueOnce(350);
    res = resMock();
    await controller.listSmartImportReports(reqBase(db, { query: { limit: '999', page: '-4' } }), res);
    expect(chain.limit).toHaveBeenLastCalledWith(100);
    expect(chain.skip).toHaveBeenLastCalledWith(0);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      pagination: expect.objectContaining({ page: 1, limit: 100, totalPages: 4 }),
    }));

    reports.find.mockImplementationOnce(() => { throw new Error('db error'); });
    res = resMock();
    await controller.listSmartImportReports(reqBase(db), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('returns patient smart-import metadata without db and with consent templates', async () => {
    vi.spyOn(importLGPDService, 'getPatientsSmartImportMetadata').mockReturnValue({ version: 'v2' });

    let res = resMock();
    await controller.getPatientsSmartImportMetadata(reqBase(null), res);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        version: 'v2',
        consentTemplates: { available: false, count: 0, items: [] },
      },
    });

    const cursor = {
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        { _id: 42, title: null, version: null, caae: null, active: 1 },
      ]),
    };
    const collection = {
      countDocuments: vi.fn().mockResolvedValue(1),
      find: vi.fn(() => cursor),
    };
    const db = { collection: vi.fn(() => collection) };
    res = resMock();
    await controller.getPatientsSmartImportMetadata(reqBase(db), res);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        version: 'v2',
        consentTemplates: {
          available: true,
          count: 1,
          items: [{ _id: '42', title: '', version: '', caae: '--', active: true }],
        },
      },
    });

    collection.countDocuments.mockRejectedValueOnce(new Error('metadata failed'));
    res = resMock();
    await controller.getPatientsSmartImportMetadata(reqBase(db), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('covers importPatients guards plus clean, partial and total-failure result messaging', async () => {
    const validate = vi.spyOn(importLGPDService, 'validateFileFormat');
    const cleanup = vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});
    const run = vi.spyOn(importLGPDService, 'importPatients');
    const db = {};

    let res = resMock();
    await controller.importPatients(reqBase(null), res);
    expect(res.status).toHaveBeenCalledWith(503);

    res = resMock();
    await controller.importPatients(reqBase(db), res);
    expect(res.status).toHaveBeenCalledWith(400);

    validate.mockReturnValueOnce(false);
    res = resMock();
    await controller.importPatients(reqBase(db, {
      file: { path: '/tmp/p.csv', originalname: 'p.csv' },
    }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(cleanup).toHaveBeenCalledWith('/tmp/p.csv');

    validate.mockReturnValue(true);
    run.mockResolvedValueOnce({
      total: 2, success: 2, skipped: 0, duplicates: 0, errors: [], stagingBatchId: null,
    });
    res = resMock();
    await controller.importPatients(reqBase(db, {
      body: {},
      file: { path: '/tmp/p.csv', originalname: 'p.csv' },
    }), res);
    expect(res.json.mock.calls[0][0].message).toContain('sucesso');

    run.mockResolvedValueOnce({
      total: 2, success: 1, skipped: 0, duplicates: 1,
      errors: [{ row: 2, errors: 'bad row' }], stagingBatchId: 'batch-1',
    });
    res = resMock();
    await controller.importPatients(reqBase(db, {
      body: {},
      file: { path: '/tmp/p.csv', originalname: 'p.csv' },
    }), res);
    const partial = res.json.mock.calls[0][0];
    expect(partial.success).toBe(false);
    expect(partial.message).toContain('parcialmente');
    expect(partial.data.errorsDetails[0].errors).toEqual(['bad row']);
    expect(partial.data.stagingBatchId).toBe('batch-1');

    run.mockResolvedValueOnce({
      total: 2, success: 0, skipped: 1, duplicates: 0,
      errors: [{ row: 1, errors: ['bad'] }, { row: 2, errors: ['bad2'] }],
      stagingBatchId: null,
    });
    res = resMock();
    await controller.importPatients(reqBase(db, {
      body: {},
      file: { path: '/tmp/p.csv', originalname: 'p.csv' },
    }), res);
    expect(res.json.mock.calls[0][0].message).toContain('não realizada');
  });

  it('ignores legacy id/_id actor fields; only userID populates actor (Stage 2E)', async () => {
    vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
    vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});
    const run = vi.spyOn(importLGPDService, 'importPatients').mockResolvedValue({
      total: 1, success: 1, skipped: 0, duplicates: 0, errors: [], stagingBatchId: null,
    });
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logImport = vi.spyOn(auditLogger, 'logImport').mockResolvedValue(undefined);
    const db = {};

    await controller.importPatients(reqBase(db, {
      body: {},
      file: { path: '/tmp/p.csv', originalname: 'p.csv' },
      user: { id: 'legacy-id', email: 'u@example.test', role: 'coordinator' },
    }), resMock());

    expect(run.mock.calls[0][2].actor).toMatchObject({
      userID: null,
      userId: null,
      userName: 'u@example.test',
      userRole: 'coordinator',
    });
    expect(logImport).toHaveBeenCalled();
  });

  it('handles patient import exception with successful and failed audit logging and file cleanup', async () => {
    vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
    vi.spyOn(importLGPDService, 'importPatients').mockRejectedValue(new Error('import broke'));
    const cleanup = vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logError = vi.spyOn(auditLogger, 'logError').mockResolvedValueOnce(undefined);
    const db = {};

    let res = resMock();
    await controller.importPatients(reqBase(db, {
      body: {},
      file: { path: '/tmp/p.csv', originalname: 'p.csv' },
      user: { userID: 'u1' },
    }), res);
    expect(logError).toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledWith('/tmp/p.csv');
    expect(res.status).toHaveBeenCalledWith(500);

    logError.mockRejectedValueOnce(new Error('audit failed'));
    res = resMock();
    await controller.importPatients(reqBase(db, {
      body: {},
      file: { path: '/tmp/p.csv', originalname: 'p.csv' },
      user: { userID: 'u1' },
    }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('covers sample import clean vs staged-file retention and actor/neo4j fallbacks', async () => {
    vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
    const run = vi.spyOn(importLGPDService, 'importSamples');
    const retain = vi.spyOn(importLGPDService, 'retainSourceFileForBatch').mockResolvedValue(undefined);
    const cleanup = vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});
    const db = {};
    const neo4jDriver = {};

    run.mockResolvedValueOnce({
      total: 1, success: 1, skipped: 0, duplicates: 0, errors: [], stagingBatchId: null,
    });
    await controller.importSamples(reqBase(db, {
      app: { locals: { db, neo4jDriver } },
      body: { autoIncrement: '1', boxId: 'box-1' },
      file: { path: '/tmp/s.csv', originalname: 's.csv' },
      user: { _id: 'legacy-object-id', name: 'Synthetic User' },
    }), resMock());

    expect(run.mock.calls[0][2]).toMatchObject({
      startBoxId: 'box-1',
      autoIncrement: true,
      neo4jDriver,
      actor: {
        userID: null,
        userId: null,
        userName: 'Synthetic User',
      },
    });
    expect(cleanup).toHaveBeenCalledWith('/tmp/s.csv');

    run.mockResolvedValueOnce({
      total: 1, success: 0, skipped: 0, duplicates: 0,
      errors: [{ row: 1, errors: ['bad'], data: {} }],
      stagingBatchId: 'batch-2',
    });
    await controller.importSamples(reqBase(db, {
      body: { autoIncrement: true },
      file: { path: '/tmp/s2.csv', originalname: 's2.csv' },
    }), resMock());
    expect(retain).toHaveBeenCalledWith(db, expect.objectContaining({ path: '/tmp/s2.csv' }), 'batch-2');
  });

  it('covers sample-import failed-batch retention and cleanup fallback paths', async () => {
    vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
    vi.spyOn(importLGPDService, 'importSamples').mockRejectedValue(new Error('header failure'));
    const recordFailed = vi.spyOn(importLGPDService, 'recordFailedImportBatch').mockResolvedValue('failed-batch');
    const retain = vi.spyOn(importLGPDService, 'retainSourceFileForBatch').mockResolvedValue(undefined);
    const cleanup = vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});

    const db = {};
    let res = resMock();
    await controller.importSamples(reqBase(db, {
      body: { autoIncrement: 'true', boxId: 'box-1', groupFields: '{}' },
      file: { path: '/tmp/s.csv', originalname: 's.csv' },
      user: { userID: 'u1' },
    }), res);
    expect(recordFailed).toHaveBeenCalled();
    expect(retain).toHaveBeenCalledWith(db, expect.any(Object), 'failed-batch');
    expect(res.status).toHaveBeenCalledWith(500);

    recordFailed.mockRejectedValueOnce(new Error('failed batch write'));
    res = resMock();
    await controller.importSamples(reqBase(db, {
      body: {},
      file: { path: '/tmp/s2.csv', originalname: 's2.csv' },
    }), res);
    expect(cleanup).toHaveBeenCalledWith('/tmp/s2.csv');

    cleanup.mockClear();
    res = resMock();
    await controller.importSamples({
      app: { locals: {} },
      body: {},
      file: { path: '/tmp/no-db.csv', originalname: 'no-db.csv' },
      user: null,
    }, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(cleanup).not.toHaveBeenCalled();
  });

  it('keeps uploader middleware available as a single-file middleware', () => {
    expect(typeof controller.uploadMiddleware()).toBe('function');
  });
});
