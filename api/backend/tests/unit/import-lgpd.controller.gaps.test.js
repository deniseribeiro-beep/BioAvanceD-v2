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
    json: vi.fn()
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
      expect(finishCall[0].status).toBe('warning');
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
        status: 'failure',
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
});
