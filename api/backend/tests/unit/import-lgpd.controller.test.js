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

  describe('listSmartImportReports', () => {
    it('returns 503 when no db', async () => {
      const req = { app: { locals: {} }, query: {} };
      const res = createRes();

      await controller.listSmartImportReports(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Banco de dados não disponível' });
    });

    it('uses default pagination (limit 20, page 1) when no query params given', async () => {
      const db = createDb();
      db.__collection.toArray.mockResolvedValue([{ a: 1 }]);
      db.__collection.countDocuments.mockResolvedValue(1);
      const req = { app: { locals: { db } }, query: {} };
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
      const req = { app: { locals: { db } }, query: { limit: '500' } };
      const res = createRes();

      await controller.listSmartImportReports(req, res);

      const body = res.json.mock.calls[0][0];
      expect(body.pagination.limit).toBe(100);
    });

    it('defaults limit to 20 when NaN', async () => {
      const db = createDb();
      const req = { app: { locals: { db } }, query: { limit: 'not-a-number' } };
      const res = createRes();

      await controller.listSmartImportReports(req, res);

      const body = res.json.mock.calls[0][0];
      expect(body.pagination.limit).toBe(20);
    });

    it('clamps limit < 1 up to 1', async () => {
      const db = createDb();
      const req = { app: { locals: { db } }, query: { limit: '0' } };
      const res = createRes();

      await controller.listSmartImportReports(req, res);

      const body = res.json.mock.calls[0][0];
      expect(body.pagination.limit).toBe(1);
    });

    it('clamps page < 1 up to 1 and computes skip/totalPages correctly', async () => {
      const db = createDb();
      db.__collection.countDocuments.mockResolvedValue(45);
      const req = { app: { locals: { db } }, query: { page: '-3', limit: '10' } };
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
      const req = { app: { locals: { db } }, query: { page: '3', limit: '10' } };
      const res = createRes();

      await controller.listSmartImportReports(req, res);

      expect(db.__collection.skip).toHaveBeenCalledWith(20);
      const body = res.json.mock.calls[0][0];
      expect(body.pagination.totalPages).toBe(5);
    });

    it('returns totalPages 1 minimum even when total is 0', async () => {
      const db = createDb();
      db.__collection.countDocuments.mockResolvedValue(0);
      const req = { app: { locals: { db } }, query: {} };
      const res = createRes();

      await controller.listSmartImportReports(req, res);

      const body = res.json.mock.calls[0][0];
      expect(body.pagination.totalPages).toBe(1);
    });

    it('returns 500 when db throws', async () => {
      const db = createDb();
      db.__collection.toArray.mockRejectedValue(new Error('boom'));
      const req = { app: { locals: { db } }, query: {} };
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
      const req = { app: { locals: {} } };
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
      const req = { app: { locals: { db } } };
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
      const req = { app: { locals: {} } };
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
      const req = { app: { locals: {} } };
      const res = createRes();

      await controller.importPatients(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('returns 400 when no file', async () => {
      const db = createDb();
      const req = { app: { locals: { db } } };
      const res = createRes();

      await controller.importPatients(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Arquivo não fornecido' });
    });

    it('returns 400 and cleans up when format invalid', async () => {
      const db = createDb();
      const file = { path: '/tmp/a.csv', originalname: 'a.csv' };
      const req = { app: { locals: { db } }, file };
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
      const req = { app: { locals: { db } }, file, body: { groupFields: '{not json' } };
      const res = createRes();

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      const cleanupSpy = vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});

      await controller.importPatients(req, res);

      expect(cleanupSpy).toHaveBeenCalledWith(file.path);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'groupFields inválido',
        message: 'groupFields deve ser um JSON válido'
      });
    });

    it('happy path with no errors returns 200 success message with count', async () => {
      const db = createDb();
      const file = { path: '/tmp/a.csv', originalname: 'a.csv' };
      const req = { app: { locals: { db } }, file, body: {} };
      const res = createRes();

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      vi.spyOn(importLGPDService, 'importPatients').mockResolvedValue({ total: 3, success: 3, errors: [] });
      const cleanupSpy = vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});

      await controller.importPatients(req, res);

      expect(cleanupSpy).toHaveBeenCalledWith(file.path);
      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.success).toBe(true);
      expect(body.message).toContain('3 paciente(s) cadastrado(s)');
      expect(body.data).toEqual({ total: 3, success: 3, errors: 0, errorsDetails: [] });
    });

    it('happy path with partial errors returns 200 with partial message', async () => {
      const db = createDb();
      const file = { path: '/tmp/a.csv', originalname: 'a.csv' };
      const req = { app: { locals: { db } }, file, body: {} };
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
      const req = { app: { locals: { db } }, file, body: {} };
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
      const req = { app: { locals: { db } }, file, body: {}, user: { id: 'u1' } };
      const res = createRes();

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      vi.spyOn(importLGPDService, 'importPatients').mockResolvedValue({ total: 1, success: 1, errors: [] });
      vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});
      const initSpy = vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      const logImportSpy = vi.spyOn(auditLogger, 'logImport').mockResolvedValue(undefined);

      await controller.importPatients(req, res);

      expect(initSpy).toHaveBeenCalledWith(db);
      expect(logImportSpy).toHaveBeenCalledWith(req, 'Patient', 'success', 1, 1, 0);
    });

    it('does not log audit when req.user is absent', async () => {
      const db = createDb();
      const file = { path: '/tmp/a.csv', originalname: 'a.csv' };
      const req = { app: { locals: { db } }, file, body: {} };
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
      const req = { app: { locals: { db } }, file, body: {} };
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
    it('returns 503 when no db', async () => {
      const req = { app: { locals: {} } };
      const res = createRes();

      await controller.importSamples(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('returns 400 when no file', async () => {
      const db = createDb();
      const req = { app: { locals: { db } }, body: {} };
      const res = createRes();

      await controller.importSamples(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Arquivo não fornecido' });
    });

    it('returns 400 and cleans up when format invalid', async () => {
      const db = createDb();
      const file = { path: '/tmp/s.csv', originalname: 's.csv' };
      const req = { app: { locals: { db } }, file, body: {} };
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
      const req = { app: { locals: { db } }, file, body: { groupFields: '{bad' } };
      const res = createRes();

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      const cleanupSpy = vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});

      await controller.importSamples(req, res);

      expect(cleanupSpy).toHaveBeenCalledWith(file.path);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'groupFields inválido',
        message: 'groupFields deve ser um JSON válido'
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
      const req = { app: { locals: { db } }, file, body: { autoIncrement: input } };
      const res = createRes();

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      const importSamplesSpy = vi.spyOn(importLGPDService, 'importSamples').mockResolvedValue({
        total: 0, success: 0, errors: []
      });
      vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});

      await controller.importSamples(req, res);

      expect(importSamplesSpy).toHaveBeenCalledWith(db, file, expect.objectContaining({ autoIncrement: expected }));
    });

    it('happy path returns 200 with errorsDetails mapped to row/errors/patientID', async () => {
      const db = createDb();
      const file = { path: '/tmp/s.csv', originalname: 's.csv' };
      const req = { app: { locals: { db } }, file, body: { locationID: '3' } };
      const res = createRes();

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      vi.spyOn(importLGPDService, 'importSamples').mockResolvedValue({
        total: 2,
        success: 1,
        errors: [{ row: 2, errors: ['dup barcode'], data: { patientID: '12345678' } }]
      });
      const cleanupSpy = vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});

      await controller.importSamples(req, res);

      expect(importLGPDService.importSamples).toHaveBeenCalledWith(db, file, expect.objectContaining({
        startLocationID: 3
      }));
      expect(cleanupSpy).toHaveBeenCalledWith(file.path);
      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.data).toEqual({
        total: 2,
        success: 1,
        errors: 1,
        errorsDetails: [{ row: 2, errors: ['dup barcode'], patientID: '12345678' }]
      });
    });

    it('returns 500 when service throws, cleans up if req.file present', async () => {
      const db = createDb();
      const file = { path: '/tmp/s.csv', originalname: 's.csv' };
      const req = { app: { locals: { db } }, file, body: {} };
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
        message: 'sample boom'
      });
    });
  });

  describe('importPatientsSmart', () => {
    it('happy path returns 200 with summaryReportId, persists summary, computes sha256 hash', async () => {
      const db = createDb();
      db.__collection.insertOne.mockResolvedValue({ insertedId: 'report-999' });
      const file = { path: '/tmp/smart.csv', originalname: 'smart.csv' };
      const req = { app: { locals: { db } }, file, body: {}, user: { id: 'u1', name: 'Tester' } };
      const res = createRes();

      const fileBuffer = Buffer.from('test-content');
      vi.spyOn(fs, 'readFileSync').mockReturnValue(fileBuffer);
      const expectedHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      vi.spyOn(importLGPDService, 'importPatientsSmart').mockResolvedValue({
        total: 4, success: 4, errors: []
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

      expect(auditLogger.log).toHaveBeenCalledTimes(2);
      expect(auditLogger.logImport).toHaveBeenCalledWith(req, 'Patient', 'success', 4, 4, 0);
    });

    it('returns 503 when no db', async () => {
      const req = { app: { locals: {} } };
      const res = createRes();

      await controller.importPatientsSmart(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('returns 400 when no file', async () => {
      const db = createDb();
      const req = { app: { locals: { db } } };
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

  describe('downloadSampleTemplateCSV', () => {
    it('sends a CSV with default values when no db is available', async () => {
      const req = { app: { locals: {} } };
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
      const req = { app: { locals: { db } } };
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
      const req = { app: { locals: { db } } };
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
      const req = { app: { locals: {} } };
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
      const req = { app: { locals: {} } };
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
      const req = { app: { locals: { db } } };
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
      const req = { app: { locals: {} } };
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
