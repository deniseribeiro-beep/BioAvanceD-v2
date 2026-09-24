import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fs = require('fs');
const controller = require('../../src/controllers/import-lgpd.controller');
const importLGPDService = require('../../src/services/import-lgpd.service');
const rbacAssignmentService = require('../../src/services/rbac-assignment.service');
const auditLogger = require('../../src/utils/auditLogger');
const logger = require('../../src/utils/logger');

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
    get: vi.fn().mockReturnValue('item8-agent'),
    ...extra,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('import-lgpd.controller item 8 executable residual branches', () => {
  it('logs a non-Error permission failure while keeping the narrow quarantine type set', async () => {
    vi.spyOn(rbacAssignmentService, 'userHasPermission')
      .mockRejectedValue('rbac-string-failure');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    const result = await controller.resolveReadableQuarantineTypes({}, {
      user: { userID: 'u-item8' },
    });

    expect(result).toEqual([importLGPDService.QUARANTINE_BATCH_TYPES.SAMPLE]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('mantendo apenas lotes de amostra'),
      'rbac-string-failure'
    );
  });

  it('normalizes a non-Error quarantine read failure to the generic 500 response', async () => {
    vi.spyOn(controller, 'resolveReadableQuarantineTypes').mockResolvedValue(['sample']);
    vi.spyOn(importLGPDService, 'getQuarantineBatch')
      .mockRejectedValue('quarantine-storage-string-failure');
    const log = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const res = resMock();

    await controller.getQuarantineBatch(reqBase({}, {
      params: { batchId: 'batch-string-error' },
    }), res);

    expect(log).toHaveBeenCalledWith(
      'Erro ao ler lote de quarentena LGPD:',
      'quarantine-storage-string-failure'
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Erro ao ler lote de quarentena',
    });
  });

  it('ignores legacy _id for actor; only userID is used (Stage 2E)', async () => {
    vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
    const run = vi.spyOn(importLGPDService, 'importPatients').mockResolvedValue({
      total: 1,
      success: 1,
      skipped: 0,
      duplicates: 0,
      errors: [],
      stagingBatchId: null,
    });
    vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    vi.spyOn(auditLogger, 'logImport').mockResolvedValue(undefined);
    const res = resMock();

    await controller.importPatients(reqBase({}, {
      body: {},
      file: { path: '/tmp/item8-patient.csv', originalname: 'item8-patient.csv' },
      user: { _id: 'legacy-object-id-item8', name: 'Synthetic User' },
    }), res);

    expect(run.mock.calls[0][2].actor).toMatchObject({
      userID: null,
      userId: null,
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('forwards the request user-agent and exposes a present smart-import stagingBatchId', async () => {
    const insertOne = vi.fn().mockResolvedValue({ insertedId: 'summary-item8' });
    const db = {
      collection: vi.fn(() => ({ insertOne })),
    };
    vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('synthetic-smart-import'));
    vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
    const run = vi.spyOn(importLGPDService, 'importPatientsSmart').mockResolvedValue({
      total: 1,
      success: 1,
      skipped: 0,
      duplicates: 0,
      errors: [],
      stagingBatchId: 'smart-batch-item8',
    });
    vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});
    const get = vi.fn().mockReturnValue('item8-smart-agent');
    const res = resMock();

    await controller.importPatientsSmart(reqBase(db, {
      body: {},
      file: { path: '/tmp/item8-smart.csv', originalname: 'item8-smart.csv' },
      get,
    }), res);

    expect(run.mock.calls[0][2].actor.userAgent).toBe('item8-smart-agent');
    expect(get).toHaveBeenCalledWith('user-agent');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        stagingBatchId: 'smart-batch-item8',
      }),
    }));
  });

  it('normalizes a non-Error failed-batch persistence failure without masking the original sample import error', async () => {
    vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
    vi.spyOn(importLGPDService, 'importSamples')
      .mockRejectedValue(new Error('original sample import failure'));
    const recordFailed = vi.spyOn(importLGPDService, 'recordFailedImportBatch')
      .mockRejectedValue('failed-batch-string-failure');
    const cleanup = vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});
    const log = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const res = resMock();

    await controller.importSamples(reqBase({}, {
      body: { groupFields: '{}' },
      file: { path: '/tmp/item8-sample.csv', originalname: 'item8-sample.csv' },
      user: { userID: 'canonical-user-item8' },
    }), res);

    expect(recordFailed).toHaveBeenCalledWith({}, expect.objectContaining({
      actor: {
        userID: 'canonical-user-item8',
        userId: 'canonical-user-item8',
      },
    }));
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('Falha ao registrar lote FAILED'),
      'failed-batch-string-failure'
    );
    expect(cleanup).toHaveBeenCalledWith('/tmp/item8-sample.csv');
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: 'original sample import failure',
    }));
  });

  it('builds the Excel sample template from live reference ids when all three catalogs are available', async () => {
    const rowsByCollection = {
      sampleTypes: [{ id: 'PLASMA-LIVE' }],
      sampleOrigins: [{ id: 'VENOUS-BLOOD-LIVE' }],
      extractionProtocols: [{ id: 'EDTA-LIVE' }],
    };
    const db = {
      collection: vi.fn((name) => ({
        find: vi.fn(() => ({
          toArray: vi.fn().mockResolvedValue(rowsByCollection[name] || []),
        })),
      })),
    };
    const res = resMock();

    await controller.downloadSampleTemplateExcel(reqBase(db), res);

    expect(db.collection).toHaveBeenCalledWith('sampleTypes');
    expect(db.collection).toHaveBeenCalledWith('sampleOrigins');
    expect(db.collection).toHaveBeenCalledWith('extractionProtocols');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(res.send).toHaveBeenCalledWith(expect.any(Buffer));
  });
});
