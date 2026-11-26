import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const controller = require('../../src/controllers/import-lgpd.controller');
const importLGPDService = require('../../src/services/import-lgpd.service');
const logger = require('../../src/utils/logger');
const auditLogger = require('../../src/utils/auditLogger');
const fs = require('fs');
const crypto = require('crypto');

function createRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    setHeader: vi.fn(),
    send: vi.fn()
  };
}

function createDb(overrides = {}) {
  const collection = {
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'mock-id-1' }),
    find: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue([]),
    countDocuments: vi.fn().mockResolvedValue(0),
    ...overrides
  };
  return {
    collection: vi.fn().mockReturnValue(collection),
    __collection: collection
  };
}

describe('import-lgpd.controller', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('persistSmartImportSummary', () => {
    it('builds document with type/createdAt/payload and returns it with _id from insert result', async () => {
      const db = createDb();
      db.__collection.insertOne.mockResolvedValue({ insertedId: 'summary-123' });

      const payload = { fileName: 'x.csv', totalSucesso: 5 };
      const result = await controller.persistSmartImportSummary(db, payload);

      expect(db.collection).toHaveBeenCalledWith('importSummaryReports');
      const insertedDoc = db.__collection.insertOne.mock.calls[0][0];
      expect(insertedDoc.type).toBe('patients-smart-import');
      expect(insertedDoc.createdAt).toBeInstanceOf(Date);
      expect(insertedDoc.fileName).toBe('x.csv');
      expect(insertedDoc.totalSucesso).toBe(5);

      expect(result._id).toBe('summary-123');
      expect(result.type).toBe('patients-smart-import');
      expect(result.fileName).toBe('x.csv');
    });
  });

  describe('resubmitQuarantinedRow (#1352)', () => {
    function makeReq(body = { row: { sampleType: 'PLASMA' } }) {
      return {
        organizationScope: { scope: 'global' }, app: { locals: { db: {}, neo4jDriver: 'driver' } },
        params: { batchId: 'b1', recordId: 'r1' },
        body,
        user: { userID: 'u1', name: 'Ana', role: 'Tecnico' },
        ip: '10.0.0.1',
        get: () => 'agent',
      };
    }

    it('passes the ids, the row and the caller as actor, and answers 200 with the result', async () => {
      const spy = vi.spyOn(importLGPDService, 'resubmitQuarantinedSampleRow')
        .mockResolvedValue({ sampleId: 's1', recordStatus: 'RESUBMITTED', batchStatus: 'RESOLVED' });
      const res = createRes();

      await controller.resubmitQuarantinedRow(makeReq(), res);

      const [, batchId, recordId, row, options] = spy.mock.calls[0];
      expect([batchId, recordId, row]).toEqual(['b1', 'r1', { sampleType: 'PLASMA' }]);
      expect(options.neo4jDriver).toBe('driver');
      expect(options.actor).toMatchObject({ userID: 'u1', userId: 'u1', userName: 'Ana', userRole: 'Tecnico' });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { sampleId: 's1', recordStatus: 'RESUBMITTED', batchStatus: 'RESOLVED' } });
    });

    it('answers a rejected correction with 422 and its row errors', async () => {
      const error = Object.assign(new Error('A linha corrigida foi rejeitada novamente.'), {
        statusCode: 422,
        errors: ['atcCode inválido: X'],
      });
      vi.spyOn(importLGPDService, 'resubmitQuarantinedSampleRow').mockRejectedValue(error);
      const res = createRes();

      await controller.resubmitQuarantinedRow(makeReq(), res);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'A linha corrigida foi rejeitada novamente.',
        errors: ['atcCode inválido: X'],
      });
    });

    it('hides an unexpected error behind a generic 500', async () => {
      vi.spyOn(importLGPDService, 'resubmitQuarantinedSampleRow').mockRejectedValue(new Error('mongo down'));
      vi.spyOn(logger, 'error').mockImplementation(() => {});
      const res = createRes();

      await controller.resubmitQuarantinedRow(makeReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Erro ao reenviar linha de quarentena' });
    });
  });

  describe('listSmartImportReports', () => {
    it('returns 503 when no db', async () => {
      const req = { organizationScope: { scope: 'global' }, app: { locals: {} }, query: {} };
      const res = createRes();

      await controller.listSmartImportReports(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Banco de dados não disponível' });
    });

    it('uses default pagination (limit 20, page 1) when no query params given', async () => {
      const db = createDb();
      db.__collection.toArray.mockResolvedValue([{ a: 1 }]);
      db.__collection.countDocuments.mockResolvedValue(1);
      const req = { organizationScope: { scope: 'global' }, app: { locals: { db } }, query: {} };
      const res = createRes();

      await controller.listSmartImportReports(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.pagination.limit).toBe(20);
      expect(body.pagination.page).toBe(1);
      expect(db.__collection.skip).toHaveBeenCalledWith(0);
      expect(db.__collection.limit).toHaveBeenCalledWith(20);
    });

    it('clamps limit > 100 down to 100', async () => {
      const db = createDb();
      const req = { organizationScope: { scope: 'global' }, app: { locals: { db } }, query: { limit: '500' } };
      const res = createRes();

      await controller.listSmartImportReports(req, res);

      const body = res.json.mock.calls[0][0];
      expect(body.pagination.limit).toBe(100);
    });

    it('defaults limit to 20 when NaN', async () => {
      const db = createDb();
      const req = { organizationScope: { scope: 'global' }, app: { locals: { db } }, query: { limit: 'not-a-number' } };
      const res = createRes();

      await controller.listSmartImportReports(req, res);

      const body = res.json.mock.calls[0][0];
      expect(body.pagination.limit).toBe(20);
    });

    it('clamps limit < 1 up to 1', async () => {
      const db = createDb();
      const req = { organizationScope: { scope: 'global' }, app: { locals: { db } }, query: { limit: '0' } };
      const res = createRes();

      await controller.listSmartImportReports(req, res);

      const body = res.json.mock.calls[0][0];
      expect(body.pagination.limit).toBe(1);
    });

    it('clamps page < 1 up to 1 and computes skip/totalPages correctly', async () => {
      const db = createDb();
      db.__collection.countDocuments.mockResolvedValue(45);
      const req = { organizationScope: { scope: 'global' }, app: { locals: { db } }, query: { page: '-3', limit: '10' } };
      const res = createRes();

      await controller.listSmartImportReports(req, res);

      const body = res.json.mock.calls[0][0];
      expect(body.pagination.page).toBe(1);
      expect(db.__collection.skip).toHaveBeenCalledWith(0);
      expect(body.pagination.totalPages).toBe(5);
    });

    it('computes skip and totalPages for a mid-range page', async () => {
      const db = createDb();
      db.__collection.countDocuments.mockResolvedValue(45);
      const req = { organizationScope: { scope: 'global' }, app: { locals: { db } }, query: { page: '3', limit: '10' } };
      const res = createRes();

      await controller.listSmartImportReports(req, res);

      expect(db.__collection.skip).toHaveBeenCalledWith(20);
      const body = res.json.mock.calls[0][0];
      expect(body.pagination.totalPages).toBe(5);
    });

    it('returns totalPages 1 minimum even when total is 0', async () => {
      const db = createDb();
      db.__collection.countDocuments.mockResolvedValue(0);
      const req = { organizationScope: { scope: 'global' }, app: { locals: { db } }, query: {} };
      const res = createRes();

      await controller.listSmartImportReports(req, res);

      const body = res.json.mock.calls[0][0];
      expect(body.pagination.totalPages).toBe(1);
    });

    it('returns 500 when db throws', async () => {
      const db = createDb();
      db.__collection.toArray.mockRejectedValue(new Error('boom'));
      const req = { organizationScope: { scope: 'global' }, app: { locals: { db } }, query: {} };
      const res = createRes();
      const loggerSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

      await controller.listSmartImportReports(req, res);

      expect(loggerSpy).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Erro ao listar summary reports',
        message: 'boom'
      });
    });
  });

  describe('getPatientsSmartImportMetadata', () => {
    it('returns 200 with consentTemplates.available false when no db', async () => {
      vi.spyOn(importLGPDService, 'getPatientsSmartImportMetadata').mockReturnValue({ foo: 'bar' });
      const req = { organizationScope: { scope: 'global' }, app: { locals: {} } };
      const res = createRes();

      await controller.getPatientsSmartImportMetadata(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.data.foo).toBe('bar');
      expect(body.data.consentTemplates).toEqual({ available: false, count: 0, items: [] });
    });

    it('fetches consent templates and maps fields with defaults when db present', async () => {
      vi.spyOn(importLGPDService, 'getPatientsSmartImportMetadata').mockReturnValue({ foo: 'bar' });
      const db = createDb();
      db.__collection.countDocuments.mockResolvedValue(2);
      db.__collection.toArray.mockResolvedValue([
        { _id: 'abc123', title: 'TCLE 1', version: '1.0', caae: '12345', active: true },
        { _id: 'def456' } // missing title/version/caae/active
      ]);
      const req = { organizationScope: { scope: 'global' }, app: { locals: { db } } };
      const res = createRes();

      await controller.getPatientsSmartImportMetadata(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.data.consentTemplates.available).toBe(true);
      expect(body.data.consentTemplates.count).toBe(2);
      expect(body.data.consentTemplates.items[0]).toEqual({
        _id: 'abc123',
        title: 'TCLE 1',
        version: '1.0',
        caae: '12345',
        active: true
      });
      expect(body.data.consentTemplates.items[1]).toEqual({
        _id: 'def456',
        title: '',
        version: '',
        caae: '--',
        active: false
      });
    });

    it('returns 500 when service throws', async () => {
      vi.spyOn(importLGPDService, 'getPatientsSmartImportMetadata').mockImplementation(() => {
        throw new Error('meta boom');
      });
      const req = { organizationScope: { scope: 'global' }, app: { locals: {} } };
      const res = createRes();
      const loggerSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

      await controller.getPatientsSmartImportMetadata(req, res);

      expect(loggerSpy).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Erro ao obter metadados de importação',
        message: 'meta boom'
      });
    });
  });

  describe('importPatients', () => {
    it('returns 503 when no db', async () => {
      const req = { organizationScope: { scope: 'global' }, app: { locals: {} } };
      const res = createRes();

      await controller.importPatients(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('returns 400 when no file', async () => {
      const db = createDb();
      const req = { organizationScope: { scope: 'global' }, app: { locals: { db } } };
      const res = createRes();

      await controller.importPatients(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Arquivo não fornecido' });
    });

    it('returns 400 and cleans up when format invalid', async () => {
      const db = createDb();
      const file = { path: '/tmp/a.csv', originalname: 'a.csv' };
      const req = { organizationScope: { scope: 'global' }, app: { locals: { db } }, file };
      const res = createRes();

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(false);
      const cleanupSpy = vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});

      await controller.importPatients(req, res);

      expect(cleanupSpy).toHaveBeenCalledWith(file.path);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Formato de arquivo inválido',
        message: 'Apenas arquivos CSV ou Excel (.xlsx) são aceitos'
      });
    });

    it('returns 400 and cleans up when groupFields is invalid JSON', async () => {
      const db = createDb();
      const file = { path: '/tmp/a.csv', originalname: 'a.csv' };
      const req = { organizationScope: { scope: 'global' }, app: { locals: { db } }, file, body: { groupFields: '{not json' } };
      const res = createRes();

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      const cleanupSpy = vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});

      await controller.importPatients(req, res);

      expect(cleanupSpy).toHaveBeenCalledWith(file.path);
      expect(res.status).toHaveBeenCalledWith(400);
      // #840: the full body -- error, reason token AND message -- not just
      // typeof message, which is what let the four endpoints' bodies drift
      // apart unnoticed in the first place.
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'groupFields inválido',
        reason: 'malformed',
        message: 'groupFields deve ser um JSON válido'
      });
    });

    it('returns 400 with the "value" reason when groupFields has an operator-shaped key (#840)', async () => {
      const db = createDb();
      const file = { path: '/tmp/a.csv', originalname: 'a.csv' };
      const req = { organizationScope: { scope: 'global' }, app: { locals: { db } }, file, body: { groupFields: '{"$ne": null}' } };
      const res = createRes();

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      const cleanupSpy = vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});

      await controller.importPatients(req, res);

      expect(cleanupSpy).toHaveBeenCalledWith(file.path);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'groupFields inválido',
        reason: 'value',
        message: 'groupFields aceita apenas chaves simples com valores texto, número ou booleano'
      });
    });

    it('happy path with no errors returns 200 success message with count', async () => {
      const db = createDb();
      const file = { path: '/tmp/a.csv', originalname: 'a.csv' };
      const req = { organizationScope: { scope: 'global' }, app: { locals: { db } }, file, body: {} };
      const res = createRes();

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      vi.spyOn(importLGPDService, 'importPatients').mockResolvedValue({ total: 3, success: 3, errors: [], duplicates: 1, skipped: 2 });
      const cleanupSpy = vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});

      await controller.importPatients(req, res);

      expect(cleanupSpy).toHaveBeenCalledWith(file.path);
      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.success).toBe(true);
      expect(body.message).toContain('3 paciente(s) cadastrado(s)');
      // #814: importPatients now carries stagingBatchId the way importSamples
      // always has -- null here because a clean import quarantines nothing
      // and therefore opens no batch. This assertion is a strict toEqual, so
      // it is the one place in this file that had to move for the new field.
      // #970: duplicatesFound passes through the service's results.duplicates
      // count, the same one the async job report already exposes.
      // #980: skipped now ships on the response `data` too. The mock carries a
      // NON-ZERO skipped on purpose: toEqual treats an explicit `undefined` and
      // an absent key as equal, so asserting `skipped: undefined` here would
      // pass just as happily with the controller hunk deleted -- which is the
      // same unpinned-hunk defect #970's review found, one field over.
      expect(body.data).toEqual({ total: 3, success: 3, errors: 0, skipped: 2, duplicatesFound: 1, errorsDetails: [], stagingBatchId: null });
    });

    it('happy path with partial errors returns 200 with partial message', async () => {
      const db = createDb();
      const file = { path: '/tmp/a.csv', originalname: 'a.csv' };
      const req = { organizationScope: { scope: 'global' }, app: { locals: { db } }, file, body: {} };
      const res = createRes();

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      vi.spyOn(importLGPDService, 'importPatients').mockResolvedValue({
        total: 5,
        success: 3,
        errors: [{ row: 2, errors: 'bad email' }, { row: 4, errors: ['missing name'] }]
      });
      vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});

      await controller.importPatients(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.success).toBe(false);
      expect(body.message).toContain('parcialmente concluída');
      expect(body.data.errorsDetails).toEqual([
        { row: 2, errors: ['bad email'] },
        { row: 4, errors: ['missing name'] }
      ]);
    });

    it('happy path with all failures still returns 200 with "não realizada" message', async () => {
      const db = createDb();
      const file = { path: '/tmp/a.csv', originalname: 'a.csv' };
      const req = { organizationScope: { scope: 'global' }, app: { locals: { db } }, file, body: {} };
      const res = createRes();

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      vi.spyOn(importLGPDService, 'importPatients').mockResolvedValue({
        total: 2,
        success: 0,
        errors: [{ row: 1, errors: 'bad' }, { row: 2, errors: 'bad' }]
      });
      vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});

      await controller.importPatients(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.success).toBe(false);
      expect(body.message).toContain('não realizada');
    });

    it('logs audit only when req.user present', async () => {
      const db = createDb();
      const file = { path: '/tmp/a.csv', originalname: 'a.csv' };
      const req = { organizationScope: { scope: 'global' }, app: { locals: { db } }, file, body: {}, user: { id: 'u1' } };
      const res = createRes();

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      vi.spyOn(importLGPDService, 'importPatients').mockResolvedValue({ total: 1, success: 1, errors: [] });
      vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});
      const initSpy = vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      const logImportSpy = vi.spyOn(auditLogger, 'logImport').mockResolvedValue(undefined);

      await controller.importPatients(req, res);

      expect(initSpy).toHaveBeenCalledWith(db);
      // #798: logImport now carries a 7th `context` argument holding the
      // blank-row count. The mocked service returns no `skipped`, so the
      // value is undefined here -- what this assertion pins is the call
      // shape, not the count; the count itself is pinned in the three
      // per-loop service tests and in audit-logger.unit.test.js.
      expect(logImportSpy).toHaveBeenCalledWith(
        req, 'Patient', 'success', 1, 1, 0, expect.objectContaining({ skipped: undefined })
      );
    });

    it('does not log audit when req.user is absent', async () => {
      const db = createDb();
      const file = { path: '/tmp/a.csv', originalname: 'a.csv' };
      const req = { organizationScope: { scope: 'global' }, app: { locals: { db } }, file, body: {} };
      const res = createRes();

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      vi.spyOn(importLGPDService, 'importPatients').mockResolvedValue({ total: 1, success: 1, errors: [] });
      vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});
      const logImportSpy = vi.spyOn(auditLogger, 'logImport').mockResolvedValue(undefined);

      await controller.importPatients(req, res);

      expect(logImportSpy).not.toHaveBeenCalled();
    });

    it('returns 500 and cleans up file when service throws', async () => {
      const db = createDb();
      const file = { path: '/tmp/a.csv', originalname: 'a.csv' };
      const req = { organizationScope: { scope: 'global' }, app: { locals: { db } }, file, body: {} };
      const res = createRes();

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      vi.spyOn(importLGPDService, 'importPatients').mockRejectedValue(new Error('svc boom'));
      const cleanupSpy = vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});
      vi.spyOn(logger, 'error').mockImplementation(() => {});

      await controller.importPatients(req, res);

      expect(cleanupSpy).toHaveBeenCalledWith(file.path);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Erro ao importar pacientes',
        message: 'svc boom'
      });
    });
  });

  describe('importSamples', () => {
    // #911: the actor handed to importSamples was resolved as
    // `req.user?.id || req.user?._id`, and NEITHER key exists on req.user.
    // auth.service.js signs { userID, email, username, accessType, name,
    // mfaVerified, jti } and `authenticate` assigns req.user = decoded
    // verbatim, so the actor identity was null on every real request --
    // which is what quarantineRejectedSampleRows records as the batch's
    // createdBy. The pre-existing fixtures in this file all use { id: 'u1' },
    // a shape the app never produces, so they could not have caught it.
    // This test uses the REAL token payload.
    it('resolves the actor identity from the JWT userID, not a nonexistent id (#911)', async () => {
      const db = createDb();
      const file = { path: '/tmp/s.csv', originalname: 's.csv' };
      const req = {
        organizationScope: { scope: 'global' }, app: { locals: { db } },
        file,
        body: {},
        // Exactly what auth.service.js#signAccessToken puts in the token.
        user: { userID: '507f1f77bcf86cd799439011', email: 'op@lab.test', username: 'op', accessType: 2, name: 'Operador' },
        get: () => 'jest-agent',
      };
      const res = createRes();

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      const importSpy = vi.spyOn(importLGPDService, 'importSamples')
        .mockResolvedValue({ total: 1, success: 1, errors: [] });
      vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});

      await controller.importSamples(req, res);

      expect(importSpy).toHaveBeenCalled();
      const callArgs = importSpy.mock.calls[0];
      const options = callArgs[callArgs.length - 1];
      // Both spellings are live consumers: quarantineRejectedSampleRows reads
      // actor?.userID for createdBy, the storage-allocation audit trail reads
      // actor?.userId. Neither may be null for an authenticated request.
      expect(options.actor.userID).toBe('507f1f77bcf86cd799439011');
      expect(options.actor.userId).toBe('507f1f77bcf86cd799439011');
      expect(options.actor.userName).toBe('Operador');
    });

    it('returns 503 when no db', async () => {
      const req = { organizationScope: { scope: 'global' }, app: { locals: {} } };
      const res = createRes();

      await controller.importSamples(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('returns 400 when no file', async () => {
      const db = createDb();
      const req = { organizationScope: { scope: 'global' }, app: { locals: { db } }, body: {} };
      const res = createRes();

      await controller.importSamples(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Arquivo não fornecido' });
    });

    it('returns 400 and cleans up when format invalid', async () => {
      const db = createDb();
      const file = { path: '/tmp/s.csv', originalname: 's.csv' };
      const req = { organizationScope: { scope: 'global' }, app: { locals: { db } }, file, body: {} };
      const res = createRes();

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(false);
      const cleanupSpy = vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});

      await controller.importSamples(req, res);

      expect(cleanupSpy).toHaveBeenCalledWith(file.path);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 and cleans up when groupFields is invalid JSON', async () => {
      const db = createDb();
      const file = { path: '/tmp/s.csv', originalname: 's.csv' };
      const req = { organizationScope: { scope: 'global' }, app: { locals: { db } }, file, body: { groupFields: '{bad' } };
      const res = createRes();

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      const cleanupSpy = vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});

      await controller.importSamples(req, res);

      expect(cleanupSpy).toHaveBeenCalledWith(file.path);
      expect(res.status).toHaveBeenCalledWith(400);
      // #840: full body, not just typeof message.
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'groupFields inválido',
        reason: 'malformed',
        message: 'groupFields deve ser um JSON válido'
      });
    });

    it('returns 400 with the "value" reason when groupFields has a dotted key (#840)', async () => {
      const db = createDb();
      const file = { path: '/tmp/s.csv', originalname: 's.csv' };
      const req = { organizationScope: { scope: 'global' }, app: { locals: { db } }, file, body: { groupFields: '{"a.b": 1}' } };
      const res = createRes();

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      const cleanupSpy = vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});

      await controller.importSamples(req, res);

      expect(cleanupSpy).toHaveBeenCalledWith(file.path);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'groupFields inválido',
        reason: 'value',
        message: 'groupFields aceita apenas chaves simples com valores texto, número ou booleano'
      });
    });

    it.each([
      ['true', true],
      [true, true],
      ['1', true],
      ['false', false],
      [false, false],
      [undefined, false],
      ['yes', false]
    ])('parses autoIncrement %p as %p', async (input, expected) => {
      const db = createDb();
      const file = { path: '/tmp/s.csv', originalname: 's.csv' };
      const req = { organizationScope: { scope: 'global' }, app: { locals: { db } }, file, body: { autoIncrement: input } };
      const res = createRes();

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      const importSamplesSpy = vi.spyOn(importLGPDService, 'importSamples').mockResolvedValue({
        total: 0, success: 0, errors: []
      });
      vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});

      await controller.importSamples(req, res);

      expect(importSamplesSpy).toHaveBeenCalledWith(db, file, expect.objectContaining({ autoIncrement: expected }));
    });

    it('happy path returns 200 with errorsDetails mapped to row/errors/participantId', async () => {
      const db = createDb();
      const file = { path: '/tmp/s.csv', originalname: 's.csv' };
      const req = { organizationScope: { scope: 'global' }, app: { locals: { db } }, file, body: { boxId: 'box-3' } };
      const res = createRes();

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      vi.spyOn(importLGPDService, 'importSamples').mockResolvedValue({
        total: 2,
        success: 1,
        errors: [{ row: 2, errors: ['dup barcode'], data: { participantId: '12345678' } }],
        duplicates: 1,
        skipped: 3
      });
      const cleanupSpy = vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});

      await controller.importSamples(req, res);

      expect(importLGPDService.importSamples).toHaveBeenCalledWith(db, file, expect.objectContaining({
        startBoxId: 'box-3'
      }));
      expect(cleanupSpy).toHaveBeenCalledWith(file.path);
      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      // #970: duplicatesFound passes through the service's results.duplicates
      // count, the same one the async job report already exposes.
      // #980: skipped now ships on the response `data` too, pinned with a
      // non-zero value for the reason spelled out on the importPatients
      // assertion above.
      expect(body.data).toEqual({
        total: 2,
        success: 1,
        errors: 1,
        skipped: 3,
        duplicatesFound: 1,
        errorsDetails: [{ row: 2, errors: ['dup barcode'], participantId: '12345678' }],
        // #787 (RNF011 AC#4): the response now points at the quarantine
        // batch holding the rejected rows. Null here because this test's
        // stubbed service result carries no stagingBatchId.
        stagingBatchId: null
      });
    });

    // #806 (RNF011 AC#4): a throw at header level no longer deletes the
    // upload unconditionally -- it opens a FAILED batch (via
    // recordFailedImportBatch) and retains the file against it instead, the
    // same way #792 already retains a file when individual rows are
    // quarantined. `db` here is this file's own createDb() mock, whose
    // `insertOne` resolves, so the FAILED batch is created successfully;
    // `retainSourceFileForBatch`'s real implementation then returns null
    // because '/tmp/s.csv' does not exist on disk in this test, and #1419
    // removes the staging file on a null retention, so `cleanupFile` runs
    // once, after the FAILED batch was opened.
    it('returns 500 when service throws, opens a FAILED batch and cleans up the unretained file if req.file present', async () => {
      const db = createDb();
      const file = { path: '/tmp/s.csv', originalname: 's.csv' };
      const req = { organizationScope: { scope: 'global' }, app: { locals: { db } }, file, body: {} };
      const res = createRes();

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      vi.spyOn(importLGPDService, 'importSamples').mockRejectedValue(new Error('sample boom'));
      const cleanupSpy = vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});
      vi.spyOn(logger, 'error').mockImplementation(() => {});

      await controller.importSamples(req, res);

      expect(cleanupSpy).toHaveBeenCalledTimes(1);
      expect(cleanupSpy).toHaveBeenCalledWith('/tmp/s.csv');
      const insertedBatch = db.__collection.insertOne.mock.calls[0][0];
      expect(insertedBatch.status).toBe('FAILED');
      expect(insertedBatch.error).toBe('sample boom');
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Erro ao importar amostras',
        message: 'sample boom'
      });
    });

    // #806: the FAILED-batch path is not best-effort the way row-level
    // quarantine is -- if recordFailedImportBatch (or retention) itself
    // fails, the controller must fall back to the pre-#806 cleanup rather
    // than leave the upload orphaned in temp/, and the client must still see
    // the ORIGINAL import error, not the secondary failure.
    it('falls back to cleaning up the file when recording the FAILED batch itself fails', async () => {
      const db = createDb();
      db.__collection.insertOne.mockRejectedValue(new Error('db unavailable'));
      const file = { path: '/tmp/s.csv', originalname: 's.csv' };
      const req = { organizationScope: { scope: 'global' }, app: { locals: { db } }, file, body: {} };
      const res = createRes();

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      vi.spyOn(importLGPDService, 'importSamples').mockRejectedValue(new Error('sample boom'));
      const cleanupSpy = vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});
      vi.spyOn(logger, 'error').mockImplementation(() => {});

      await controller.importSamples(req, res);

      expect(cleanupSpy).toHaveBeenCalledWith(file.path);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Erro ao importar amostras',
        // The original service error, not "db unavailable".
        message: 'sample boom'
      });
    });
  });

  describe('importPatientsSmart', () => {
    it('happy path returns 200 with summaryReportId, persists summary, computes sha256 hash', async () => {
      const db = createDb();
      db.__collection.insertOne.mockResolvedValue({ insertedId: 'report-999' });
      const file = { path: '/tmp/smart.csv', originalname: 'smart.csv' };
      const req = { organizationScope: { scope: 'global' }, app: { locals: { db } }, file, body: {}, user: { id: 'u1', name: 'Tester' } };
      const res = createRes();

      const fileBuffer = Buffer.from('test-content');
      vi.spyOn(fs, 'readFileSync').mockReturnValue(fileBuffer);
      const expectedHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      vi.spyOn(importLGPDService, 'importPatientsSmart').mockResolvedValue({
        // #970: `duplicates` was missing from this mock, so
        // `duplicatesFound` evaluated to undefined, `res.json` dropped the
        // key, and no assertion below looked at it -- the smart-import
        // handler's #970 hunk was unpinned. Give it a duplicates count and
        // assert it below so it is.
        total: 4, success: 4, errors: [], duplicates: 2, skipped: 1
      });
      vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
      vi.spyOn(auditLogger, 'logImport').mockResolvedValue(undefined);

      await controller.importPatientsSmart(req, res);

      expect(db.__collection.insertOne).toHaveBeenCalled();
      const insertedDoc = db.__collection.insertOne.mock.calls[0][0];
      expect(insertedDoc.summaryReport.hashSHA256ArquivoOriginal).toBe(expectedHash);

      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.success).toBe(true);
      expect(body.data.summaryReportId).toBe('report-999');
      expect(body.data.total).toBe(4);
      expect(body.data.success).toBe(4);
      expect(body.data.duplicatesFound).toBe(2);
      // #980: pins the THIRD of the three response literals. The mock
      // previously carried no `skipped`, so this hunk was revertible with the
      // whole file green -- the same unpinned-hunk defect this test block was
      // rewritten to fix for `duplicatesFound`, missed one field over.
      expect(body.data.skipped).toBe(1);

      expect(auditLogger.log).toHaveBeenCalledTimes(2);
      // #798: as above -- the 7th `context` argument is the blank-row count.
      // This asserted `skipped: undefined`, a shape importPatientsSmart can
      // never produce: import-lgpd.service.js initialises `skipped: 0` and
      // returns `results` verbatim. It pinned the MOCK's shape rather than the
      // service's -- the #803/#797 mock-fidelity family.
      expect(auditLogger.logImport).toHaveBeenCalledWith(
        req, 'Patient', 'success', 4, 4, 0, expect.objectContaining({ skipped: 1 })
      );
    });

    it('returns 503 when no db', async () => {
      const req = { organizationScope: { scope: 'global' }, app: { locals: {} } };
      const res = createRes();

      await controller.importPatientsSmart(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('returns 400 when no file', async () => {
      const db = createDb();
      const req = { organizationScope: { scope: 'global' }, app: { locals: { db } } };
      const res = createRes();

      await controller.importPatientsSmart(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('downloadPatientTemplateExcel', () => {
    it('builds a workbook and sends it with the correct headers', async () => {
      const req = {};
      const res = createRes();

      await controller.downloadPatientTemplateExcel(req, res);

      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="pacientes_template.xlsx"'
      );
      expect(res.send).toHaveBeenCalledTimes(1);
      expect(Buffer.isBuffer(res.send.mock.calls[0][0])).toBe(true);
    });

    it('returns 500 when workbook generation throws', async () => {
      const ExcelJS = require('exceljs');
      vi.spyOn(ExcelJS.Workbook.prototype, 'addWorksheet').mockImplementation(() => {
        throw new Error('workbook error');
      });
      const req = {};
      const res = createRes();

      await controller.downloadPatientTemplateExcel(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Erro ao gerar template',
        message: 'workbook error',
      });
    });
  });


  // #815: `importLGPDService.downloadTemplate('patients', 'csv')` built
  // `/import-lgpd/pacientes/template/csv`, a route that had never existed --
  // three of the four type x format combinations were routed, this one was
  // not, and nothing called the method so nothing noticed.
  describe('#815 downloadPatientTemplateCSV', () => {
    it('sends a CSV with the patient template content type and filename', async () => {
      const req = {};
      const res = createRes();

      await controller.downloadPatientTemplateCSV(req, res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="pacientes_template.csv"'
      );
      expect(res.send).toHaveBeenCalledTimes(1);
      // BOM, so Excel opens the file as UTF-8 -- same as the samples CSV.
      expect(res.send.mock.calls[0][0]).toMatch(/^\ufeff/);
    });

    // The point of sharing PATIENT_TEMPLATE_HEADERS between the two builders:
    // an operator who downloads the CSV and one who downloads the xlsx must be
    // filling in the same columns, or one of the two templates silently stops
    // matching what the importer accepts.
    it('emits exactly the same header row as the xlsx template', async () => {
      const req = {};
      const res = createRes();

      await controller.downloadPatientTemplateCSV(req, res);

      const csv = res.send.mock.calls[0][0].replace(/^\ufeff/, '');
      const headerLine = csv.split(/\r?\n/)[0];
      expect(headerLine.split(',')).toEqual(controller.PATIENT_TEMPLATE_HEADERS);
    });

    it('includes the same example row the xlsx template ships', async () => {
      const req = {};
      const res = createRes();

      await controller.downloadPatientTemplateCSV(req, res);

      const csv = res.send.mock.calls[0][0].replace(/^\ufeff/, '');
      expect(csv.split(/\r?\n/).length).toBeGreaterThanOrEqual(2);
      expect(csv).toContain('joao.silva@email.com');
    });

    it('returns 500 when CSV generation throws', async () => {
      const req = {};
      const res = createRes();
      // Force a failure inside the handler without stubbing the handler itself.
      res.setHeader = vi.fn(() => {
        throw new Error('csv error');
      });

      await controller.downloadPatientTemplateCSV(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Erro ao gerar template',
        message: 'csv error',
      });
    });
  });

  // The defect this issue is actually about is the *missing route*, not the
  // missing handler: a handler nothing routes to is still a 404.
  describe('#815 route registration', () => {
    it('routes GET /pacientes/template/csv', () => {
      const router = require('../../src/interface/routes/import-lgpd.routes');
      const registered = router.stack
        .filter((layer) => layer.route)
        .map((layer) => layer.route.path);

      expect(registered).toContain('/pacientes/template/csv');
    });

    it('routes all four type x format template combinations', () => {
      const router = require('../../src/interface/routes/import-lgpd.routes');
      const registered = router.stack
        .filter((layer) => layer.route)
        .map((layer) => layer.route.path);

      for (const path of [
        '/pacientes/template/csv',
        '/pacientes/template/xlsx',
        '/amostras/template/csv',
        '/amostras/template/xlsx',
      ]) {
        expect(registered).toContain(path);
      }
    });
  });

  describe('downloadSampleTemplateCSV', () => {
    it('sends a CSV with default values when no db is available', async () => {
      const req = { organizationScope: { scope: 'global' }, app: { locals: {} } };
      const res = createRes();

      await controller.downloadSampleTemplateCSV(req, res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="amostras_template.csv"'
      );
      expect(res.send).toHaveBeenCalledTimes(1);
      expect(res.send.mock.calls[0][0]).toMatch(/^﻿/);
    });

    it('uses db-backed sampleTypes/sampleOrigins/extractionProtocols when present', async () => {
      const collection = {
        find: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([{ id: 'CUSTOM_TYPE', description: 'Custom' }]),
      };
      const db = { collection: vi.fn().mockReturnValue(collection) };
      const req = { organizationScope: { scope: 'global' }, app: { locals: { db } } };
      const res = createRes();

      await controller.downloadSampleTemplateCSV(req, res);

      expect(db.collection).toHaveBeenCalledWith('sampleTypes');
      expect(db.collection).toHaveBeenCalledWith('sampleOrigins');
      expect(db.collection).toHaveBeenCalledWith('extractionProtocols');
      const csvBody = res.send.mock.calls[0][0];
      expect(csvBody).toContain('CUSTOM_TYPE');
    });

    it('falls back to defaults and logs a warning when db collections throw', async () => {
      const collection = {
        find: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockRejectedValue(new Error('db error')),
      };
      const db = { collection: vi.fn().mockReturnValue(collection) };
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const req = { organizationScope: { scope: 'global' }, app: { locals: { db } } };
      const res = createRes();

      await controller.downloadSampleTemplateCSV(req, res);

      expect(warnSpy).toHaveBeenCalled();
      expect(res.send).toHaveBeenCalledTimes(1);
    });

    it('returns 500 when CSV generation throws', async () => {
      const csvSync = require('csv-stringify/sync');
      vi.spyOn(csvSync, 'stringify').mockImplementation(() => {
        throw new Error('csv error');
      });
      const req = { organizationScope: { scope: 'global' }, app: { locals: {} } };
      const res = createRes();

      await controller.downloadSampleTemplateCSV(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Erro ao gerar template',
        message: 'csv error',
      });
    });
  });

  describe('downloadSampleTemplateExcel', () => {
    it('builds a workbook with default values when no db is available', async () => {
      const req = { organizationScope: { scope: 'global' }, app: { locals: {} } };
      const res = createRes();

      await controller.downloadSampleTemplateExcel(req, res);

      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="amostras_template.xlsx"'
      );
      expect(res.send).toHaveBeenCalledTimes(1);
      expect(Buffer.isBuffer(res.send.mock.calls[0][0])).toBe(true);
    });

    it('adds a reference sheet and per-collection warnings when some db lookups fail', async () => {
      let call = 0;
      const collection = {
        find: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockImplementation(() => {
          call += 1;
          // sampleTypes succeeds, sampleOrigins and extractionProtocols fail.
          return call === 1
            ? Promise.resolve([{ id: 'PLASMA', description: 'Plasma' }])
            : Promise.reject(new Error('db error'));
        }),
      };
      const db = { collection: vi.fn().mockReturnValue(collection) };
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const req = { organizationScope: { scope: 'global' }, app: { locals: { db } } };
      const res = createRes();

      await controller.downloadSampleTemplateExcel(req, res);

      expect(warnSpy).toHaveBeenCalledTimes(2);
      expect(res.send).toHaveBeenCalledTimes(1);
    });

    it('returns 500 when workbook generation throws', async () => {
      const ExcelJS = require('exceljs');
      vi.spyOn(ExcelJS.Workbook.prototype, 'addWorksheet').mockImplementation(() => {
        throw new Error('workbook error');
      });
      const req = { organizationScope: { scope: 'global' }, app: { locals: {} } };
      const res = createRes();

      await controller.downloadSampleTemplateExcel(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Erro ao gerar template',
        message: 'workbook error',
      });
    });
  });
});
