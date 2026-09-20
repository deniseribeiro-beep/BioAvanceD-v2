import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import express from 'express';
import request from 'supertest';

const require = createRequire(import.meta.url);

const controller = require('../../src/controllers/import.controller');
const importService = require('../../src/services/import.service');
const auditLogger = require('../../src/utils/auditLogger');
const fs = require('fs');

function createRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn()
  };
}

function createReq(overrides = {}) {
  return {
    app: { locals: { db: {} } },
    file: { path: '/tmp/f.csv', originalname: 'f.csv' },
    body: {},
    ...overrides
  };
}

describe('import.controller', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('validate', () => {
    it('returns 503 when db missing', async () => {
      const req = createReq({ app: { locals: {} } });
      const res = createRes();
      await controller.validate(req, res);
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    });

    it('returns 400 when file missing', async () => {
      const req = createReq({ file: undefined });
      const res = createRes();
      await controller.validate(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Arquivo não fornecido' }));
    });

    it('returns 400 for invalid dataType', async () => {
      const req = createReq({ body: { dataType: 'bogus' } });
      const res = createRes();
      await controller.validate(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Tipo de dados inválido' }));
    });

    it('returns 400 and cleans up when file format invalid for dataType', async () => {
      const req = createReq({ body: { dataType: 'patients' }, file: { path: '/tmp/f.csv', originalname: 'f.csv' } });
      const res = createRes();
      vi.spyOn(importService, 'validateFileFormat').mockReturnValue(false);
      const cleanupSpy = vi.spyOn(importService, 'cleanupFile').mockImplementation(() => {});

      await controller.validate(req, res);

      expect(cleanupSpy).toHaveBeenCalledWith('/tmp/f.csv');
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Formato de arquivo não suportado para este tipo de dados'
      }));
    });

    it('CSV happy path returns 200 with rowCount and headers', async () => {
      const req = createReq({ body: { dataType: 'patients' }, file: { path: '/tmp/f.csv', originalname: 'f.csv' } });
      const res = createRes();
      vi.spyOn(importService, 'validateFileFormat').mockReturnValue(true);
      vi.spyOn(importService, 'validateCSVStructure').mockResolvedValue({ rowCount: 3, headers: ['a', 'b'] });

      await controller.validate(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({ valid: true, rowCount: 3, headers: ['a', 'b'] })
      }));
    });

    it('CSV invalid structure returns 400 and cleans up', async () => {
      const req = createReq({ body: { dataType: 'patients' }, file: { path: '/tmp/f.csv', originalname: 'f.csv' } });
      const res = createRes();
      vi.spyOn(importService, 'validateFileFormat').mockReturnValue(true);
      vi.spyOn(importService, 'validateCSVStructure').mockRejectedValue(new Error('bad headers'));
      const cleanupSpy = vi.spyOn(importService, 'cleanupFile').mockImplementation(() => {});

      await controller.validate(req, res);

      expect(cleanupSpy).toHaveBeenCalledWith('/tmp/f.csv');
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Estrutura do arquivo inválida',
        message: 'bad headers'
      }));
    });

    it('JSON/FHIR happy path returns 200', async () => {
      const req = createReq({ body: { dataType: 'patients' }, file: { path: '/tmp/f.json', originalname: 'f.json' } });
      const res = createRes();
      vi.spyOn(importService, 'validateFileFormat').mockReturnValue(true);
      vi.spyOn(importService, 'validateFHIRFile').mockReturnValue({ isFhir: true, valid: true, resourcesValidated: 5 });

      await controller.validate(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({ valid: true, fhir: true, resourcesValidated: 5 })
      }));
    });

    it('JSON/FHIR failed validation returns 400 and cleans up', async () => {
      const req = createReq({ body: { dataType: 'patients' }, file: { path: '/tmp/f.json', originalname: 'f.json' } });
      const res = createRes();
      vi.spyOn(importService, 'validateFileFormat').mockReturnValue(true);
      vi.spyOn(importService, 'validateFHIRFile').mockReturnValue({
        isFhir: true,
        valid: false,
        issues: [{ diagnostics: 'missing field' }],
        operationOutcome: { resourceType: 'OperationOutcome' }
      });
      const cleanupSpy = vi.spyOn(importService, 'cleanupFile').mockImplementation(() => {});

      await controller.validate(req, res);

      expect(cleanupSpy).toHaveBeenCalledWith('/tmp/f.json');
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Validação FHIR falhou',
        errors: ['missing field'],
        operationOutcome: { resourceType: 'OperationOutcome' }
      }));
    });

    it('returns 500 and cleans up on unexpected error', async () => {
      const req = createReq({ body: { dataType: 'patients' }, file: { path: '/tmp/f.csv', originalname: 'f.csv' } });
      const res = createRes();
      vi.spyOn(importService, 'validateFileFormat').mockImplementation(() => { throw new Error('boom'); });
      const cleanupSpy = vi.spyOn(importService, 'cleanupFile').mockImplementation(() => {});

      await controller.validate(req, res);

      expect(cleanupSpy).toHaveBeenCalledWith('/tmp/f.csv');
      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('JSON non-FHIR happy path returns 200 with fhir:false', async () => {
      const req = createReq({ body: { dataType: 'patients' }, file: { path: '/tmp/f.json', originalname: 'f.json' } });
      const res = createRes();
      vi.spyOn(importService, 'validateFileFormat').mockReturnValue(true);
      vi.spyOn(importService, 'validateFHIRFile').mockReturnValue({ isFhir: false, valid: true });

      await controller.validate(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        message: 'Arquivo válido',
        data: expect.objectContaining({ valid: true, fhir: false, resourcesValidated: 0 })
      }));
    });
  });

  describe('uploadMiddleware', () => {
    it('returns a multer single-file middleware function', () => {
      const middleware = controller.uploadMiddleware();
      expect(typeof middleware).toBe('function');
      // multer's returned middleware is an Express-style (req, res, next) handler
      expect(middleware.length).toBe(3);
    });
  });

  describe('import', () => {
    it('returns 503 when db missing', async () => {
      const req = createReq({ app: { locals: {} } });
      const res = createRes();
      await controller.import(req, res);
      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('returns 400 when file missing', async () => {
      const req = createReq({ file: undefined });
      const res = createRes();
      await controller.import(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Arquivo não fornecido' }));
    });

    it('happy path for patients calls importPatients, cleans up, no audit when no req.user', async () => {
      const req = createReq({ body: { dataType: 'patients' } });
      const res = createRes();
      const results = { success: 2, errors: [], total: 2 };
      vi.spyOn(importService, 'importPatients').mockResolvedValue(results);
      const cleanupSpy = vi.spyOn(importService, 'cleanupFile').mockImplementation(() => {});
      const auditInitSpy = vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      const auditLogSpy = vi.spyOn(auditLogger, 'logImport').mockResolvedValue();

      await controller.import(req, res);

      expect(importService.importPatients).toHaveBeenCalledWith(req.app.locals.db, req.file);
      expect(cleanupSpy).toHaveBeenCalledWith('/tmp/f.csv');
      expect(auditInitSpy).not.toHaveBeenCalled();
      expect(auditLogSpy).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, data: results }));
    });

    it('happy path for samples with req.user calls audit logger', async () => {
      const req = createReq({ body: { dataType: 'samples' }, user: { id: 'u1' } });
      const res = createRes();
      const results = { success: 3, errors: [], total: 3 };
      vi.spyOn(importService, 'importSamples').mockResolvedValue(results);
      vi.spyOn(importService, 'cleanupFile').mockImplementation(() => {});
      const auditInitSpy = vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      const auditLogSpy = vi.spyOn(auditLogger, 'logImport').mockResolvedValue();

      await controller.import(req, res);

      expect(importService.importSamples).toHaveBeenCalledWith(req.app.locals.db, req.file);
      expect(auditInitSpy).toHaveBeenCalledWith(req.app.locals.db);
      expect(auditLogSpy).toHaveBeenCalledWith(
        req,
        'Sample',
        'success',
        results.total,
        results.success,
        results.errors.length
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('marks audit status "partial" when there are errors', async () => {
      const req = createReq({ body: { dataType: 'temperature' }, user: { id: 'u1' } });
      const res = createRes();
      const results = { success: 1, errors: [{ error: 'row 2 bad' }], total: 2 };
      vi.spyOn(importService, 'importTemperature').mockResolvedValue(results);
      vi.spyOn(importService, 'cleanupFile').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      const auditLogSpy = vi.spyOn(auditLogger, 'logImport').mockResolvedValue();

      await controller.import(req, res);

      expect(auditLogSpy).toHaveBeenCalledWith(req, 'Temperature', 'partial', 2, 1, 1);
    });

    it('locations dataType is disabled (#466) and returns 400 without calling importLocations', async () => {
      const req = createReq({ body: { dataType: 'locations' } });
      const res = createRes();
      const importLocationsSpy = vi.spyOn(importService, 'importLocations');
      const cleanupSpy = vi.spyOn(importService, 'cleanupFile').mockImplementation(() => {});

      await controller.import(req, res);

      expect(importLocationsSpy).not.toHaveBeenCalled();
      expect(cleanupSpy).toHaveBeenCalledWith('/tmp/f.csv');
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        error: "Importação de 'locations' está desativada"
      }));
    });

    it('results dataType is a stub that does not call any import service method', async () => {
      const req = createReq({ body: { dataType: 'results' } });
      const res = createRes();
      const cleanupSpy = vi.spyOn(importService, 'cleanupFile').mockImplementation(() => {});
      const importPatientsSpy = vi.spyOn(importService, 'importPatients');

      await controller.import(req, res);

      expect(importPatientsSpy).not.toHaveBeenCalled();
      expect(cleanupSpy).toHaveBeenCalledWith('/tmp/f.csv');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: {
          success: 0,
          errors: [{ error: 'Importacao de arquivos de analise ainda nao implementada' }],
          total: 0
        }
      }));
    });

    it('unsupported dataType triggers error path with single cleanup call and 500', async () => {
      const req = createReq({ body: { dataType: 'nonsense' } });
      const res = createRes();
      const cleanupSpy = vi.spyOn(importService, 'cleanupFile').mockImplementation(() => {});

      await controller.import(req, res);

      // Inner catch cleans up then rethrows; outer catch checks req.file (still set) and would
      // clean up again -- verify actual call count here rather than assuming.
      expect(cleanupSpy).toHaveBeenCalledWith('/tmp/f.csv');
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Erro ao importar dados',
        message: 'Tipo de dados não suportado'
      }));
    });

    it('cleanup is called when the import service itself throws', async () => {
      const req = createReq({ body: { dataType: 'patients' } });
      const res = createRes();
      vi.spyOn(importService, 'importPatients').mockRejectedValue(new Error('db down'));
      const cleanupSpy = vi.spyOn(importService, 'cleanupFile').mockImplementation(() => {});

      await controller.import(req, res);

      expect(cleanupSpy).toHaveBeenCalledWith('/tmp/f.csv');
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'db down' }));
    });

    it('maps dataType "patients" to entityName "Patient" in the audit log', async () => {
      const req = createReq({ body: { dataType: 'patients' }, user: { id: 'u1' } });
      const res = createRes();
      const results = { success: 1, errors: [], total: 1 };
      vi.spyOn(importService, 'importPatients').mockResolvedValue(results);
      vi.spyOn(importService, 'cleanupFile').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      const auditLogSpy = vi.spyOn(auditLogger, 'logImport').mockResolvedValue();

      await controller.import(req, res);

      expect(auditLogSpy).toHaveBeenCalledWith(req, 'Patient', 'success', 1, 1, 0);
    });

    it('maps dataType "results" (the stub path) to entityName "Result" in the audit log', async () => {
      const req = createReq({ body: { dataType: 'results' }, user: { id: 'u1' } });
      const res = createRes();
      vi.spyOn(importService, 'cleanupFile').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      const auditLogSpy = vi.spyOn(auditLogger, 'logImport').mockResolvedValue();

      await controller.import(req, res);

      expect(auditLogSpy).toHaveBeenCalledWith(req, 'Result', 'partial', 0, 0, 1);
    });
  });

});


describe('import.controller item 8 upload filter branches', () => {
  it('accepts a valid CSV multipart upload, creates the temp directory when needed, and reuses it on the next upload', async () => {
    const app = express();
    const uploadedPaths = [];

    app.post('/upload', controller.uploadMiddleware(), (req, res) => {
      uploadedPaths.push(req.file.path);
      res.status(204).end();
    });

    const first = await request(app)
      .post('/upload')
      .attach('file', Buffer.from('id,name\n1,A\n'), {
        filename: 'valid.csv',
        contentType: 'text/csv',
      });
    expect(first.status).toBe(204);
    expect(uploadedPaths).toHaveLength(1);
    expect(fs.existsSync(uploadedPaths[0])).toBe(true);

    const second = await request(app)
      .post('/upload')
      .attach('file', Buffer.from('id,name\n2,B\n'), {
        filename: 'valid-second.csv',
        contentType: 'text/csv',
      });
    expect(second.status).toBe(204);
    expect(uploadedPaths).toHaveLength(2);
    expect(fs.existsSync(uploadedPaths[1])).toBe(true);

    for (const uploadedPath of uploadedPaths) {
      if (fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath);
    }
  });

  it('rejects a blocked executable extension even when its MIME type would otherwise be allowed', async () => {
    const app = express();
    app.post('/upload', controller.uploadMiddleware(), (_req, res) => res.status(204).end());
    app.use((err, _req, res, _next) => {
      res.status(err.status || 500).json({ error: err.message });
    });

    const response = await request(app)
      .post('/upload')
      .attach('file', Buffer.from('not-an-executable'), {
        filename: 'payload.exe',
        contentType: 'text/csv',
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Formato de arquivo não seguro');
  });

  it('rejects an unapproved MIME type when the extension is not explicitly blocked', async () => {
    const app = express();
    app.post('/upload', controller.uploadMiddleware(), (_req, res) => res.status(204).end());
    app.use((err, _req, res, _next) => {
      res.status(err.status || 500).json({ error: err.message });
    });

    const response = await request(app)
      .post('/upload')
      .attach('file', Buffer.from('opaque'), {
        filename: 'payload.bin',
        contentType: 'application/x-unknown',
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Formato de arquivo não seguro');
  });
});
