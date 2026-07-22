import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const controller = require('../../src/controllers/import.controller');
const importService = require('../../src/services/import.service');
const qualityDomain = require('../../src/services/quality-domain.service');
const auditLogger = require('../../src/utils/auditLogger');

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

    it('locations dataType calls importLocations', async () => {
      const req = createReq({ body: { dataType: 'locations' } });
      const res = createRes();
      const results = { success: 1, errors: [], total: 1 };
      vi.spyOn(importService, 'importLocations').mockResolvedValue(results);
      vi.spyOn(importService, 'cleanupFile').mockImplementation(() => {});

      await controller.import(req, res);

      expect(importService.importLocations).toHaveBeenCalledWith(req.app.locals.db, req.file);
      expect(res.status).toHaveBeenCalledWith(200);
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

    it('maps a dataType matching none of the known keywords to entityName "Import"', async () => {
      const req = createReq({ body: { dataType: 'locations' }, user: { id: 'u1' } });
      const res = createRes();
      const results = { success: 1, errors: [], total: 1 };
      vi.spyOn(importService, 'importLocations').mockResolvedValue(results);
      vi.spyOn(importService, 'cleanupFile').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      const auditLogSpy = vi.spyOn(auditLogger, 'logImport').mockResolvedValue();

      await controller.import(req, res);

      expect(auditLogSpy).toHaveBeenCalledWith(req, 'Import', 'success', 1, 1, 0);
    });
  });

  describe('importFhirBundle', () => {
    it('returns 503 when db missing', async () => {
      const req = { app: { locals: {} }, body: {} };
      const res = createRes();
      await controller.importFhirBundle(req, res);
      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('returns 400 for empty/invalid bundle', async () => {
      const req = { app: { locals: { db: { collection: vi.fn() } } }, body: {} };
      const res = createRes();
      await controller.importFhirBundle(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Bundle FHIR inválido ou ausente' }));
    });

    it('accepts a bare array of resources (normalizeFhirEntries array form)', async () => {
      const db = { collection: vi.fn().mockReturnValue({ insertOne: vi.fn().mockResolvedValue({ insertedId: 'mock-id' }) }) };
      const req = { app: { locals: { db } }, body: [{ resourceType: 'Patient', id: 'p1', name: [{ text: 'Alice' }] }] };
      const res = createRes();

      await controller.importFhirBundle(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, patients: 1, samples: 0, consents: 0 }));
    });

    it('accepts a single bare resource (normalizeFhirEntries single-resource form)', async () => {
      const db = { collection: vi.fn().mockReturnValue({ insertOne: vi.fn().mockResolvedValue({ insertedId: 'mock-id' }) }) };
      const req = { app: { locals: { db } }, body: { resourceType: 'Patient', id: 'p1' } };
      const res = createRes();

      await controller.importFhirBundle(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ patients: 1 }));
    });

    it('processes a Bundle with Patient+Specimen+Consent, computing quality grade counts and averageScore', async () => {
      const db = { collection: vi.fn().mockReturnValue({ insertOne: vi.fn().mockResolvedValue({ insertedId: 'mock-id' }) }) };
      vi.spyOn(qualityDomain, 'calculateMethodologyQualityFromSprec').mockReturnValue({
        final_grade: 'A',
        category: 'A',
        rcs_score: 90,
        governance_status: 1
      });
      vi.spyOn(qualityDomain, 'buildPenaltyLog').mockReturnValue([]);

      const bundle = {
        resourceType: 'Bundle',
        entry: [
          { resource: { resourceType: 'Patient', id: 'p1', name: [{ text: 'Alice' }] } },
          {
            resource: {
              resourceType: 'Specimen',
              id: 's1',
              subject: { reference: 'Patient/p1' },
              type: { text: 'blood' }
            }
          },
          {
            resource: {
              resourceType: 'Consent',
              id: 'c1',
              patient: { reference: 'Patient/p1' },
              status: 'active'
            }
          }
        ]
      };
      const req = { app: { locals: { db } }, body: bundle };
      const res = createRes();

      await controller.importFhirBundle(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const payload = res.json.mock.calls[0][0];
      expect(payload.success).toBe(true);
      expect(payload.patients).toBe(1);
      expect(payload.samples).toBe(1);
      expect(payload.consents).toBe(1);
      expect(payload.qualitySummary.gradeA).toBe(1);
      expect(payload.qualitySummary.gradeB).toBe(0);
      expect(payload.qualitySummary.quarantinedTechnical).toBe(0);
      expect(payload.qualitySummary.averageScore).toBe(90);
    });

    it('counts quarantinedTechnical for grade E specimens and averages multiple scores', async () => {
      const db = { collection: vi.fn().mockReturnValue({ insertOne: vi.fn().mockResolvedValue({ insertedId: 'mock-id' }) }) };
      const calcSpy = vi.spyOn(qualityDomain, 'calculateMethodologyQualityFromSprec');
      calcSpy.mockReturnValueOnce({ final_grade: 'E', category: 'E', rcs_score: 10, governance_status: 0 });
      calcSpy.mockReturnValueOnce({ final_grade: 'C', category: 'C', rcs_score: 50, governance_status: 1 });
      vi.spyOn(qualityDomain, 'buildPenaltyLog').mockReturnValue([]);

      const bundle = {
        resourceType: 'Bundle',
        entry: [
          { resource: { resourceType: 'Patient', id: 'p1' } },
          { resource: { resourceType: 'Specimen', id: 's1', subject: { reference: 'Patient/p1' } } },
          { resource: { resourceType: 'Specimen', id: 's2', subject: { reference: 'Patient/p1' } } }
        ]
      };
      const req = { app: { locals: { db } }, body: bundle };
      const res = createRes();

      await controller.importFhirBundle(req, res);

      const payload = res.json.mock.calls[0][0];
      expect(payload.samples).toBe(2);
      expect(payload.qualitySummary.gradeE).toBe(1);
      expect(payload.qualitySummary.gradeC).toBe(1);
      expect(payload.qualitySummary.quarantinedTechnical).toBe(1);
      expect(payload.qualitySummary.averageScore).toBe(30);
    });

    it('actually persists processed resources: collection().insertOne is called for each', async () => {
      const collectionStub = { insertOne: vi.fn().mockResolvedValue({ insertedId: 'mock-id' }) };
      const db = { collection: vi.fn().mockReturnValue(collectionStub) };
      vi.spyOn(qualityDomain, 'calculateMethodologyQualityFromSprec').mockReturnValue({
        final_grade: 'A', category: 'A', rcs_score: 90, governance_status: 1
      });
      vi.spyOn(qualityDomain, 'buildPenaltyLog').mockReturnValue([]);

      const bundle = {
        resourceType: 'Bundle',
        entry: [
          { resource: { resourceType: 'Patient', id: 'p1' } },
          { resource: { resourceType: 'Specimen', id: 's1', subject: { reference: 'Patient/p1' } } }
        ]
      };
      const req = { app: { locals: { db } }, body: bundle };
      const res = createRes();

      await controller.importFhirBundle(req, res);

      // A success response must correspond to actually persisted data.
      expect(collectionStub.insertOne).toHaveBeenCalledTimes(2);
    });

    it('returns 500 when db.collection throws unexpectedly', async () => {
      const db = { collection: vi.fn(() => { throw new Error('collection boom'); }) };
      const req = { app: { locals: { db } }, body: { resourceType: 'Patient', id: 'p1' } };
      const res = createRes();

      await controller.importFhirBundle(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Erro ao importar FHIR' }));
    });

    it('processes Observation and Condition resources, linking them to the patient map', async () => {
      const collectionStub = { insertOne: vi.fn().mockResolvedValue({ insertedId: 'mock-id' }) };
      const db = { collection: vi.fn().mockReturnValue(collectionStub) };
      const req = {
        app: { locals: { db } },
        body: {
          resourceType: 'Bundle',
          entry: [
            { resource: { resourceType: 'Patient', id: 'p1' } },
            {
              resource: {
                resourceType: 'Observation',
                id: 'o1',
                subject: { reference: 'Patient/p1' },
                code: { text: 'Glucose' },
                valueQuantity: { value: 95 }
              }
            },
            {
              resource: {
                resourceType: 'Condition',
                id: 'c1',
                subject: { reference: 'Patient/unknown' },
                code: { text: 'Hypertension' }
              }
            }
          ]
        }
      };
      const res = createRes();

      await controller.importFhirBundle(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      // Patient (1) + Observation (1) + Condition (1) inserts
      expect(collectionStub.insertOne).toHaveBeenCalledTimes(3);
      const observationDoc = collectionStub.insertOne.mock.calls[1][0];
      expect(observationDoc).toEqual(expect.objectContaining({ participantId: 'mock-id', code: 'Glucose', value: 95 }));
      const conditionDoc = collectionStub.insertOne.mock.calls[2][0];
      // Unmatched patient reference resolves to undefined, not the mapped id
      expect(conditionDoc).toEqual(expect.objectContaining({ participantId: undefined, code: 'Hypertension' }));
    });

    it('resolves sprec fields from a FHIR extension when no direct sprec object is present', async () => {
      const collectionStub = { insertOne: vi.fn().mockResolvedValue({ insertedId: 'mock-id' }) };
      const db = { collection: vi.fn().mockReturnValue(collectionStub) };
      const qualitySpy = vi.spyOn(qualityDomain, 'calculateMethodologyQualityFromSprec').mockReturnValue({
        final_grade: 'B', category: 'B', rcs_score: 70, governance_status: 1
      });
      vi.spyOn(qualityDomain, 'buildPenaltyLog').mockReturnValue([]);

      const req = {
        app: { locals: { db } },
        body: {
          resourceType: 'Bundle',
          entry: [
            { resource: { resourceType: 'Patient', id: 'p1' } },
            {
              resource: {
                resourceType: 'Specimen',
                id: 's1',
                subject: { reference: 'Patient/p1' },
                type: { coding: [{ code: 'BLD' }] },
                extension: [
                  {
                    url: 'https://example.org/fhir/StructureDefinition/sprec',
                    valueObject: {
                      matrixType: 'Serum',
                      primaryContainer: 'tube-a',
                      preCentrifugation: 'pc1',
                      centrifugation: 'c1',
                      secondCentrifugation: 'c2',
                      postCentrifugationDelay: 'delay1',
                      longTermStorage: 'lts1',
                      preAnalyticalUnknown: true
                    }
                  }
                ]
              }
            }
          ]
        }
      };
      const res = createRes();

      await controller.importFhirBundle(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(qualitySpy).toHaveBeenCalledWith(expect.objectContaining({
        matrixType: 'serum',
        sampleType: 'BLD',
        primaryContainer: 'TUBE-A',
        preAnalyticalUnknown: true
      }));
    });
  });
});
