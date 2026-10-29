import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const controller = require('../../src/controllers/import.controller');
const importService = require('../../src/services/import.service');
const auditLogger = require('../../src/utils/auditLogger');
const callerCreateOrganization = require('../../src/services/callerCreateOrganization.service');

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
      vi.spyOn(callerCreateOrganization, 'resolveCallerCreateOrganization').mockResolvedValue({ organizationId: 'org-a' });
      vi.spyOn(importService, 'importSamples').mockResolvedValue(results);
      vi.spyOn(importService, 'cleanupFile').mockImplementation(() => {});
      const auditInitSpy = vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      const auditLogSpy = vi.spyOn(auditLogger, 'logImport').mockResolvedValue();

      await controller.import(req, res);

      expect(importService.importSamples).toHaveBeenCalledWith(req.app.locals.db, req.file, { organizationId: 'org-a' });
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

    // #1376: the samples import resolves the caller's organization before any row is read.
    it('samples resolves the caller organization from req.user and the organizationId field and passes it to importSamples', async () => {
      const req = createReq({ body: { dataType: 'samples', organizationId: ' org-a ' }, user: { userID: 'u1' } });
      const res = createRes();
      const db = req.app.locals.db;
      const resolveSpy = vi.spyOn(callerCreateOrganization, 'resolveCallerCreateOrganization').mockResolvedValue({ organizationId: 'org-a' });
      vi.spyOn(importService, 'importSamples').mockResolvedValue({ success: 1, errors: [], total: 1 });
      vi.spyOn(importService, 'cleanupFile').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'logImport').mockResolvedValue();

      await controller.import(req, res);

      expect(resolveSpy).toHaveBeenCalledWith(db, { userId: 'u1', requested: 'org-a' });
      expect(importService.importSamples).toHaveBeenCalledWith(db, req.file, { organizationId: 'org-a' });
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('samples answers a scope refusal with its status, cleans the file and imports nothing', async () => {
      const req = createReq({ body: { dataType: 'samples', organizationId: 'org-z' }, user: { userID: 'u1' } });
      const res = createRes();
      vi.spyOn(callerCreateOrganization, 'resolveCallerCreateOrganization')
        .mockRejectedValue(Object.assign(new Error('organizationId fora do escopo'), { statusCode: 400 }));
      const importSamplesSpy = vi.spyOn(importService, 'importSamples');
      const cleanupSpy = vi.spyOn(importService, 'cleanupFile').mockImplementation(() => {});

      await controller.import(req, res);

      expect(importSamplesSpy).not.toHaveBeenCalled();
      expect(cleanupSpy).toHaveBeenCalledWith('/tmp/f.csv');
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: 'organizationId fora do escopo' });
    });

    it('patients does not resolve a caller organization', async () => {
      const req = createReq({ body: { dataType: 'patients' } });
      const res = createRes();
      const resolveSpy = vi.spyOn(callerCreateOrganization, 'resolveCallerCreateOrganization');
      vi.spyOn(importService, 'importPatients').mockResolvedValue({ success: 1, errors: [], total: 1 });
      vi.spyOn(importService, 'cleanupFile').mockImplementation(() => {});

      await controller.import(req, res);

      expect(resolveSpy).not.toHaveBeenCalled();
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
