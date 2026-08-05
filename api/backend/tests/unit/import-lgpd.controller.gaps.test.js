import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Fills branch gaps left by import-lgpd.controller.test.js: the multer
// storage/fileFilter config (never exercised there) and importPatientsSmart's
// invalid-format/mapping-parse/partial-error/catch-block branches.
const importLGPDService = require('../../src/services/import-lgpd.service');
const auditLogger = require('../../src/utils/auditLogger');
const logger = require('../../src/utils/logger');

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
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'mock-id' }),
    ...overrides
  };
  return {
    collection: vi.fn().mockReturnValue(collection),
    __collection: collection
  };
}

describe('import-lgpd.controller gaps', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('multer storage/fileFilter config (internal callbacks)', () => {
    const multerPath = require.resolve('multer');
    const controllerPath = require.resolve('../../src/controllers/import-lgpd.controller');

    function loadControllerWithCapturedMulterConfig() {
      let diskStorageConfig;
      let uploadConfig;

      require('multer'); // ensure multer is in require.cache before we grab it
      const realMulterModule = require.cache[multerPath];
      const realMulter = realMulterModule.exports;

      const wrapper = (config) => {
        uploadConfig = config;
        return realMulter(config);
      };
      wrapper.diskStorage = (config) => {
        diskStorageConfig = config;
        return realMulter.diskStorage(config);
      };
      realMulterModule.exports = wrapper;

      delete require.cache[controllerPath];
      try {
        require('../../src/controllers/import-lgpd.controller');
      } finally {
        realMulterModule.exports = realMulter;
      }

      return {
        get destination() { return diskStorageConfig.destination; },
        get filename() { return diskStorageConfig.filename; },
        get fileFilter() { return uploadConfig.fileFilter; }
      };
    }

    afterEach(() => {
      delete require.cache[controllerPath];
      require('../../src/controllers/import-lgpd.controller');
    });

    it('destination: creates uploads dir when missing and calls back with it', async () => {
      const fs = require('fs');
      const { destination } = await loadControllerWithCapturedMulterConfig();

      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
      const cb = vi.fn();

      destination({}, {}, cb);

      expect(mkdirSpy).toHaveBeenCalledWith(expect.stringContaining('uploads'), { recursive: true });
      expect(cb).toHaveBeenCalledWith(null, expect.stringContaining('uploads'));
    });

    it('destination: skips mkdir when uploads dir already exists', async () => {
      const fs = require('fs');
      const { destination } = await loadControllerWithCapturedMulterConfig();

      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
      const cb = vi.fn();

      destination({}, {}, cb);

      expect(mkdirSpy).not.toHaveBeenCalled();
      expect(cb).toHaveBeenCalledWith(null, expect.stringContaining('uploads'));
    });

    it('filename: builds a unique suffixed name preserving the original extension', async () => {
      const { filename } = await loadControllerWithCapturedMulterConfig();

      const cb = vi.fn();
      filename({}, { originalname: 'patients.xlsx' }, cb);

      expect(cb).toHaveBeenCalledTimes(1);
      const [err, generatedName] = cb.mock.calls[0];
      expect(err).toBeNull();
      expect(generatedName).toMatch(/^\d+-\d+\.xlsx$/);
    });

    it('fileFilter: rejects blocked extensions (.sh) with a 400 error', async () => {
      const { fileFilter } = await loadControllerWithCapturedMulterConfig();

      const cb = vi.fn();
      fileFilter({}, { originalname: 'script.sh', mimetype: 'text/plain' }, cb);

      expect(cb).toHaveBeenCalledTimes(1);
      const [err, accepted] = cb.mock.calls[0];
      expect(accepted).toBe(false);
      expect(err.message).toBe('Formato de arquivo não seguro');
      expect(err.status).toBe(400);
    });

    it('fileFilter: rejects disallowed mimetypes even with a safe extension', async () => {
      const { fileFilter } = await loadControllerWithCapturedMulterConfig();

      const cb = vi.fn();
      fileFilter({}, { originalname: 'payload.csv', mimetype: 'application/x-msdownload' }, cb);

      expect(cb).toHaveBeenCalledTimes(1);
      const [err, accepted] = cb.mock.calls[0];
      expect(accepted).toBe(false);
      expect(err.message).toBe('Formato de arquivo não seguro');
      expect(err.status).toBe(400);
    });

    it('fileFilter: accepts an allowed extension/mimetype combination', async () => {
      const { fileFilter } = await loadControllerWithCapturedMulterConfig();

      const cb = vi.fn();
      fileFilter({}, { originalname: 'patients.csv', mimetype: 'text/csv' }, cb);

      expect(cb).toHaveBeenCalledWith(null, true);
    });

    it('fileFilter: accepts a zip mimetype (batch/smart import archives)', async () => {
      const { fileFilter } = await loadControllerWithCapturedMulterConfig();

      const cb = vi.fn();
      fileFilter({}, { originalname: 'archive.zip', mimetype: 'application/zip' }, cb);

      expect(cb).toHaveBeenCalledWith(null, true);
    });
  });

  describe('importPatientsSmart gaps', () => {
    it('returns 400 and cleans up when format invalid', async () => {
      const controller = require('../../src/controllers/import-lgpd.controller');
      const db = createDb();
      const file = { path: '/tmp/smart.csv', originalname: 'smart.csv' };
      const req = { app: { locals: { db } }, file, body: {} };
      const res = createRes();

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(false);
      const cleanupSpy = vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});

      await controller.importPatientsSmart(req, res);

      expect(cleanupSpy).toHaveBeenCalledWith(file.path);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Formato de arquivo inválido',
        message: 'Apenas CSV, TXT ou Excel (.xlsx) são aceitos'
      });
    });

    it('parses string groupFields/mapping JSON bodies and forwards parsed objects to the service', async () => {
      const controller = require('../../src/controllers/import-lgpd.controller');
      const db = createDb();
      const file = { path: '/tmp/smart.csv', originalname: 'smart.csv' };
      const req = {
        app: { locals: { db } },
        file,
        body: {
          groupFields: '{"clinicalUnit":"HUSF"}',
          mapping: '{"patientName":"nome"}'
        }
      };
      const res = createRes();

      const fs = require('fs');
      vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('content'));
      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      const importSpy = vi.spyOn(importLGPDService, 'importPatientsSmart').mockResolvedValue({
        total: 1, success: 1, errors: []
      });
      vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});

      await controller.importPatientsSmart(req, res);

      expect(importSpy).toHaveBeenCalledWith(db, file, {
        mapping: { patientName: 'nome' },
        groupFields: { clinicalUnit: 'HUSF' }
      });
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 500 when groupFields JSON is malformed (uncaught parse error hits outer catch)', async () => {
      const controller = require('../../src/controllers/import-lgpd.controller');
      const db = createDb();
      const file = { path: '/tmp/smart.csv', originalname: 'smart.csv' };
      const req = { app: { locals: { db } }, file, body: { groupFields: '{not json' } };
      const res = createRes();

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      const cleanupSpy = vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});
      vi.spyOn(logger, 'error').mockImplementation(() => {});

      await controller.importPatientsSmart(req, res);

      expect(cleanupSpy).toHaveBeenCalledWith(file.path);
      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('logs a warning-status audit event and partial message when some rows fail', async () => {
      const controller = require('../../src/controllers/import-lgpd.controller');
      const db = createDb();
      db.__collection.insertOne.mockResolvedValue({ insertedId: 'report-1' });
      const file = { path: '/tmp/smart.csv', originalname: 'smart.csv' };
      const req = { app: { locals: { db } }, file, body: {}, user: { id: 'u1', name: 'Tester' } };
      const res = createRes();

      const fs = require('fs');
      vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('content'));
      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      vi.spyOn(importLGPDService, 'importPatientsSmart').mockResolvedValue({
        total: 3,
        success: 2,
        errors: [{ row: 2, errors: ['bad'] }]
      });
      vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
      vi.spyOn(auditLogger, 'logImport').mockResolvedValue(undefined);

      await controller.importPatientsSmart(req, res);

      const finishCall = logSpy.mock.calls.find(([payload]) => payload.payload?.stage === 'finish');
      expect(finishCall[0].result).toBe('warning');
      expect(finishCall[0].severity).toBe('warning');
      expect(finishCall[0].message).toContain('inconsistências');
      expect(res.json.mock.calls[0][0].success).toBe(false);
    });

    it('does not emit start/finish audit events or persist a summary when req.user is absent', async () => {
      const controller = require('../../src/controllers/import-lgpd.controller');
      const db = createDb();
      const file = { path: '/tmp/smart.csv', originalname: 'smart.csv' };
      const req = { app: { locals: { db } }, file, body: {} };
      const res = createRes();

      const fs = require('fs');
      vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('content'));
      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      vi.spyOn(importLGPDService, 'importPatientsSmart').mockResolvedValue({
        total: 1, success: 1, errors: []
      });
      vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});
      const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
      const logImportSpy = vi.spyOn(auditLogger, 'logImport').mockResolvedValue(undefined);

      await controller.importPatientsSmart(req, res);

      expect(logSpy).not.toHaveBeenCalled();
      expect(logImportSpy).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('catch block: logs a failure audit event when db and req.user are present, then still returns 500', async () => {
      const controller = require('../../src/controllers/import-lgpd.controller');
      const db = createDb();
      const file = { path: '/tmp/smart.csv', originalname: 'smart.csv' };
      const req = { app: { locals: { db } }, file, body: {}, user: { id: 'u1' } };
      const res = createRes();

      const fs = require('fs');
      vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('content'));
      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      vi.spyOn(importLGPDService, 'importPatientsSmart').mockRejectedValue(new Error('smart boom'));
      const cleanupSpy = vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});
      vi.spyOn(logger, 'error').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);

      await controller.importPatientsSmart(req, res);

      expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
        action: 'SMART_IMPORT_EXECUTION',
        result: 'error'
      }));
      expect(cleanupSpy).toHaveBeenCalledWith(file.path);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Erro ao importar pacientes em lote',
        message: 'smart boom'
      });
    });

    it('catch block: swallows a failing audit-log call without crashing the response', async () => {
      const controller = require('../../src/controllers/import-lgpd.controller');
      const db = createDb();
      const file = { path: '/tmp/smart.csv', originalname: 'smart.csv' };
      const req = { app: { locals: { db } }, file, body: {}, user: { id: 'u1' } };
      const res = createRes();

      const fs = require('fs');
      vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('content'));
      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      vi.spyOn(importLGPDService, 'importPatientsSmart').mockRejectedValue(new Error('smart boom'));
      vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});
      vi.spyOn(logger, 'error').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'log').mockImplementation((payload) => {
        // Start-stage log (in the main try) must succeed so the service's
        // rejection is what reaches the outer catch; only the catch block's
        // own failure-stage audit log should fail, to exercise its swallow.
        if (payload?.payload?.stage === 'failure') {
          return Promise.reject(new Error('audit log down'));
        }
        return Promise.resolve(undefined);
      });

      await controller.importPatientsSmart(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Erro ao importar pacientes em lote',
        message: 'smart boom'
      });
    });

  });

  describe('uploadMiddleware', () => {
    it('returns a middleware function bound to a single "file" upload', () => {
      const controller = require('../../src/controllers/import-lgpd.controller');
      const mw = controller.uploadMiddleware();
      expect(typeof mw).toBe('function');
    });
  });

  describe('importPatients gaps', () => {
    it('accepts an already-parsed object groupFields body without JSON.parse', async () => {
      const controller = require('../../src/controllers/import-lgpd.controller');
      const db = createDb();
      const file = { path: '/tmp/a.csv', originalname: 'a.csv' };
      const req = { app: { locals: { db } }, file, body: { groupFields: { clinicalUnit: 'HUSF' } } };
      const res = createRes();

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      const importSpy = vi.spyOn(importLGPDService, 'importPatients').mockResolvedValue({ total: 1, success: 1, errors: [] });
      vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});

      await controller.importPatients(req, res);

      expect(importSpy).toHaveBeenCalledWith(db, file, { groupFields: { clinicalUnit: 'HUSF' } });
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('logs a "partial" audit event when req.user is present and some rows failed', async () => {
      const controller = require('../../src/controllers/import-lgpd.controller');
      const db = createDb();
      const file = { path: '/tmp/a.csv', originalname: 'a.csv' };
      const req = { app: { locals: { db } }, file, body: {}, user: { id: 'u1' } };
      const res = createRes();

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      vi.spyOn(importLGPDService, 'importPatients').mockResolvedValue({
        total: 2, success: 1, errors: [{ row: 2, errors: 'bad' }]
      });
      vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      const logImportSpy = vi.spyOn(auditLogger, 'logImport').mockResolvedValue(undefined);

      await controller.importPatients(req, res);

      expect(logImportSpy).toHaveBeenCalledWith(req, 'Patient', 'partial', 2, 1, 1);
    });

    it('catch block: logs an audit error via auditLogger.logError when req.user is present', async () => {
      const controller = require('../../src/controllers/import-lgpd.controller');
      const db = createDb();
      const file = { path: '/tmp/a.csv', originalname: 'a.csv' };
      const req = { app: { locals: { db } }, file, body: {}, user: { id: 'u1' } };
      const res = createRes();

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      vi.spyOn(importLGPDService, 'importPatients').mockRejectedValue(new Error('boom'));
      const cleanupSpy = vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});
      vi.spyOn(logger, 'error').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      const logErrorSpy = vi.spyOn(auditLogger, 'logError').mockResolvedValue(undefined);

      await controller.importPatients(req, res);

      expect(logErrorSpy).toHaveBeenCalledWith(req, 'Patient', expect.any(Error), {
        action: 'IMPORT',
        fileName: 'a.csv'
      });
      expect(cleanupSpy).toHaveBeenCalledWith(file.path);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json.mock.calls[0][0].message).toBe('boom');
    });

    it('catch block: falls back to "N/A" fileName when req.file has no originalname', async () => {
      const controller = require('../../src/controllers/import-lgpd.controller');
      const db = createDb();
      const file = { path: '/tmp/a.csv' };
      const req = { app: { locals: { db } }, file, body: {}, user: { id: 'u1' } };
      const res = createRes();

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      vi.spyOn(importLGPDService, 'importPatients').mockRejectedValue(new Error('boom'));
      vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});
      vi.spyOn(logger, 'error').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      const logErrorSpy = vi.spyOn(auditLogger, 'logError').mockResolvedValue(undefined);

      await controller.importPatients(req, res);

      expect(logErrorSpy).toHaveBeenCalledWith(req, 'Patient', expect.any(Error), {
        action: 'IMPORT',
        fileName: 'N/A'
      });
    });

    it('catch block: swallows a failing auditLogger.logError call and still returns 500', async () => {
      const controller = require('../../src/controllers/import-lgpd.controller');
      const db = createDb();
      const file = { path: '/tmp/a.csv', originalname: 'a.csv' };
      const req = { app: { locals: { db } }, file, body: {}, user: { id: 'u1' } };
      const res = createRes();

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      vi.spyOn(importLGPDService, 'importPatients').mockRejectedValue(new Error('boom'));
      vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});
      vi.spyOn(logger, 'error').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'logError').mockRejectedValue(new Error('audit down'));

      await controller.importPatients(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json.mock.calls[0][0].message).toBe('boom');
    });

    it('catch block: falls back to a default message when the thrown error has no message', async () => {
      const controller = require('../../src/controllers/import-lgpd.controller');
      const db = createDb();
      const file = { path: '/tmp/a.csv', originalname: 'a.csv' };
      const req = { app: { locals: { db } }, file, body: {} };
      const res = createRes();

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      const err = new Error();
      err.message = '';
      vi.spyOn(importLGPDService, 'importPatients').mockRejectedValue(err);
      vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});
      vi.spyOn(logger, 'error').mockImplementation(() => {});

      await controller.importPatients(req, res);

      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Erro ao importar pacientes',
        message: 'Erro desconhecido ao importar pacientes'
      });
    });
  });

  describe('importPatientsSmart entityId/mapping gaps', () => {
    it('accepts already-parsed object groupFields/mapping bodies without JSON.parse', async () => {
      const controller = require('../../src/controllers/import-lgpd.controller');
      const db = createDb();
      const fs = require('fs');
      vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('content'));
      const file = { path: '/tmp/smart.csv', originalname: 'smart.csv' };
      const req = {
        app: { locals: { db } },
        file,
        body: { groupFields: { clinicalUnit: 'HUSF' }, mapping: { patientName: 'nome' } }
      };
      const res = createRes();

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      const importSpy = vi.spyOn(importLGPDService, 'importPatientsSmart').mockResolvedValue({
        total: 1, success: 1, errors: []
      });
      vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});

      await controller.importPatientsSmart(req, res);

      expect(importSpy).toHaveBeenCalledWith(db, file, {
        mapping: { patientName: 'nome' },
        groupFields: { clinicalUnit: 'HUSF' }
      });
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('uses null entityId in start/finish audit events when the file has no originalname', async () => {
      const controller = require('../../src/controllers/import-lgpd.controller');
      const db = createDb();
      db.__collection.insertOne.mockResolvedValue({ insertedId: 'report-1' });
      const fs = require('fs');
      vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('content'));
      const file = { path: '/tmp/smart.csv' };
      const req = { app: { locals: { db } }, file, body: {}, user: { id: 'u1' } };
      const res = createRes();

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      vi.spyOn(importLGPDService, 'importPatientsSmart').mockResolvedValue({ total: 1, success: 1, errors: [] });
      vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
      vi.spyOn(auditLogger, 'logImport').mockResolvedValue(undefined);

      await controller.importPatientsSmart(req, res);

      const startCall = logSpy.mock.calls.find(([p]) => p.payload?.stage === 'start');
      const finishCall = logSpy.mock.calls.find(([p]) => p.payload?.stage === 'finish');
      expect(startCall[0].entityId).toBeNull();
      expect(finishCall[0].entityId).toBeNull();
    });

    it('catch block: uses null entityId and a default error message when the file has no originalname/message', async () => {
      const controller = require('../../src/controllers/import-lgpd.controller');
      const db = createDb();
      const fs = require('fs');
      vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('content'));
      const file = { path: '/tmp/smart.csv' };
      const req = { app: { locals: { db } }, file, body: {}, user: { id: 'u1' } };
      const res = createRes();

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      const err = new Error();
      err.message = '';
      vi.spyOn(importLGPDService, 'importPatientsSmart').mockRejectedValue(err);
      vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});
      vi.spyOn(logger, 'error').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);

      await controller.importPatientsSmart(req, res);

      expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
        entityId: null,
        payload: expect.objectContaining({ error: 'Erro desconhecido' })
      }));
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Erro ao importar pacientes em lote',
        message: 'Erro desconhecido'
      });
    });
  });

  describe('downloadSampleTemplateCSV gaps', () => {
    it('falls back to description when sampleOrigins/extractionProtocols items have no id', async () => {
      const controller = require('../../src/controllers/import-lgpd.controller');
      const collections = {
        sampleTypes: { toArray: vi.fn().mockResolvedValue([{ id: 'PLASMA', description: 'Plasma' }]) },
        sampleOrigins: { toArray: vi.fn().mockResolvedValue([{ description: 'Sangue Venoso' }]) },
        extractionProtocols: { toArray: vi.fn().mockResolvedValue([{ description: 'Tubo EDTA' }]) }
      };
      const db = {
        collection: vi.fn((name) => ({
          find: vi.fn().mockReturnThis(),
          toArray: collections[name].toArray
        }))
      };
      const req = { app: { locals: { db } } };
      const res = createRes();

      await controller.downloadSampleTemplateCSV(req, res);

      const csvBody = res.send.mock.calls[0][0];
      expect(csvBody).toContain('Sangue Venoso');
      expect(csvBody).toContain('Tubo EDTA');
    });
  });

  describe('downloadSampleTemplateExcel gaps', () => {
    it('falls back to defaults and warns when sampleTypes lookup itself throws', async () => {
      const controller = require('../../src/controllers/import-lgpd.controller');
      let call = 0;
      const collection = {
        find: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockImplementation(() => {
          call += 1;
          return call === 1 ? Promise.reject(new Error('sampleTypes down')) : Promise.resolve([]);
        })
      };
      const db = { collection: vi.fn().mockReturnValue(collection) };
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const req = { app: { locals: { db } } };
      const res = createRes();

      await controller.downloadSampleTemplateExcel(req, res);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('sampleTypes'),
        'sampleTypes down'
      );
      expect(res.send).toHaveBeenCalledTimes(1);
    });

    it('exampleRow: falls back to canonical defaults when db items have neither id nor description', async () => {
      const controller = require('../../src/controllers/import-lgpd.controller');
      const collections = {
        sampleTypes: [{}],
        sampleOrigins: [{}],
        extractionProtocols: [{}]
      };
      const db = {
        collection: vi.fn((name) => ({
          find: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue(collections[name])
        }))
      };
      const req = { app: { locals: { db } } };
      const res = createRes();

      await controller.downloadSampleTemplateExcel(req, res);

      expect(res.send).toHaveBeenCalledTimes(1);
    });

    it('reference sheet: covers the id/description/name/N-A fallback chain for each collection', async () => {
      const controller = require('../../src/controllers/import-lgpd.controller');
      const collections = {
        sampleTypes: [{ id: 'PLASMA' }, { description: 'Soro' }, { name: 'Only Name' }, {}],
        sampleOrigins: [{ id: 'VENOUS_BLOOD' }],
        extractionProtocols: [{ id: 'TUBE_EDTA' }]
      };
      const db = {
        collection: vi.fn((name) => ({
          find: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue(collections[name])
        }))
      };
      const req = { app: { locals: { db } } };
      const res = createRes();

      await controller.downloadSampleTemplateExcel(req, res);

      expect(res.send).toHaveBeenCalledTimes(1);
    });

    it('returns 500 with a default message when the thrown error has no message', async () => {
      const controller = require('../../src/controllers/import-lgpd.controller');
      const ExcelJS = require('exceljs');
      const err = new Error();
      err.message = '';
      vi.spyOn(ExcelJS.Workbook.prototype, 'addWorksheet').mockImplementation(() => {
        throw err;
      });
      const req = { app: { locals: {} } };
      const res = createRes();

      await controller.downloadSampleTemplateExcel(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Erro ao gerar template',
        message: 'Erro desconhecido ao gerar template Excel'
      });
    });

    it('exampleRow: uses db-provided ids for all three collections when present', async () => {
      const controller = require('../../src/controllers/import-lgpd.controller');
      const collections = {
        sampleTypes: [{ id: 'PLASMA', description: 'Plasma' }],
        sampleOrigins: [{ id: 'VENOUS_BLOOD', description: 'Sangue Venoso' }],
        extractionProtocols: [{ id: 'TUBE_EDTA', description: 'Tubo EDTA' }]
      };
      const db = {
        collection: vi.fn((name) => ({
          find: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue(collections[name])
        }))
      };
      const req = { app: { locals: { db } } };
      const res = createRes();

      await controller.downloadSampleTemplateExcel(req, res);

      expect(res.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('listSmartImportReports / getPatientsSmartImportMetadata error-message fallback', () => {
    it('listSmartImportReports: falls back to a default message when the thrown error has no message', async () => {
      const controller = require('../../src/controllers/import-lgpd.controller');
      const db = createDb();
      const err = new Error();
      err.message = '';
      db.__collection.toArray = vi.fn().mockRejectedValue(err);
      db.collection = vi.fn(() => ({
        find: vi.fn().mockReturnThis(),
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockRejectedValue(err),
        countDocuments: vi.fn().mockResolvedValue(0)
      }));
      const req = { app: { locals: { db } }, query: {} };
      const res = createRes();
      vi.spyOn(logger, 'error').mockImplementation(() => {});

      await controller.listSmartImportReports(req, res);

      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Erro ao listar summary reports',
        message: 'Erro desconhecido'
      });
    });

    it('getPatientsSmartImportMetadata: falls back to a default message when the thrown error has no message', async () => {
      const controller = require('../../src/controllers/import-lgpd.controller');
      const err = new Error();
      err.message = '';
      vi.spyOn(importLGPDService, 'getPatientsSmartImportMetadata').mockImplementation(() => {
        throw err;
      });
      const req = { app: { locals: {} } };
      const res = createRes();
      vi.spyOn(logger, 'error').mockImplementation(() => {});

      await controller.getPatientsSmartImportMetadata(req, res);

      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Erro ao obter metadados de importação',
        message: 'Erro desconhecido'
      });
    });
  });

  describe('importSamples req.user audit logging', () => {
    it('logs a "success" audit event when req.user is present and no rows failed', async () => {
      const controller = require('../../src/controllers/import-lgpd.controller');
      const db = createDb();
      const file = { path: '/tmp/s.csv', originalname: 's.csv' };
      const req = { app: { locals: { db } }, file, body: {}, user: { id: 'u1' } };
      const res = createRes();

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      vi.spyOn(importLGPDService, 'importSamples').mockResolvedValue({ total: 2, success: 2, errors: [] });
      vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      const logImportSpy = vi.spyOn(auditLogger, 'logImport').mockResolvedValue(undefined);

      await controller.importSamples(req, res);

      expect(logImportSpy).toHaveBeenCalledWith(req, 'Sample', 'success', 2, 2, 0);
    });

    it('logs a "partial" audit event when req.user is present and some rows failed', async () => {
      const controller = require('../../src/controllers/import-lgpd.controller');
      const db = createDb();
      const file = { path: '/tmp/s.csv', originalname: 's.csv' };
      const req = { app: { locals: { db } }, file, body: {}, user: { id: 'u1' } };
      const res = createRes();

      vi.spyOn(importLGPDService, 'validateFileFormat').mockReturnValue(true);
      vi.spyOn(importLGPDService, 'importSamples').mockResolvedValue({
        total: 2, success: 1, errors: [{ row: 2, errors: ['dup'] }]
      });
      vi.spyOn(importLGPDService, 'cleanupFile').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      const logImportSpy = vi.spyOn(auditLogger, 'logImport').mockResolvedValue(undefined);

      await controller.importSamples(req, res);

      expect(logImportSpy).toHaveBeenCalledWith(req, 'Sample', 'partial', 2, 1, 1);
    });
  });
});
