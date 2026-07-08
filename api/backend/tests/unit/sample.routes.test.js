import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import express from 'express';
import request from 'supertest';

const require = createRequire(import.meta.url);

const authPath = require.resolve('../../src/infrastructure/middleware/auth');
const rbacPath = require.resolve('../../src/infrastructure/middleware/rbac');
const consentEnforcementPath = require.resolve('../../src/infrastructure/middleware/consent.enforcement');
const sampleServicePath = require.resolve('../../src/services/sample.service');
const consentValidatorPath = require.resolve('../../src/services/consent.validator');
const auditLoggerPath = require.resolve('../../src/utils/auditLogger');
const registerSampleUseCasePath = require.resolve('../../src/core/use-cases/RegisterSampleUseCase');
const lineageRepositoryPath = require.resolve('../../src/infrastructure/database/neo4j/LineageRepository');
const sampleFileControllerPath = require.resolve('../../src/controllers/sample-file.controller');
const miabisValidatorPath = require.resolve('../../src/services/miabisValidator.service');
const sampleGraphValidatorPath = require.resolve('../../src/services/SampleGraphValidator');
const routePath = require.resolve('../../src/interface/routes/sample.routes.js');

const allPaths = [
  authPath,
  rbacPath,
  consentEnforcementPath,
  sampleServicePath,
  consentValidatorPath,
  auditLoggerPath,
  registerSampleUseCasePath,
  lineageRepositoryPath,
  sampleFileControllerPath,
  miabisValidatorPath,
  sampleGraphValidatorPath,
  routePath,
];

function clearCache() {
  for (const p of allPaths) delete require.cache[p];
}

// authenticate/requirePermission/enforceCommercialConsent and the
// RegisterSampleUseCase/LineageRepository classes are all destructured or
// captured by reference at require-time in sample.routes.js. vi.mock()
// does not reliably intercept CJS require() graphs in this repo (confirmed
// while writing this test - see hpo.routes.test.js for the same workaround).
// Instead: clear the cache, replace the dependency modules' exports, then
// require the route file fresh so its top-level requires pick up the fakes.
function loadRoute({
  registerSampleUseCaseExecute,
  sampleServiceOverrides = {},
  consentValidatorValidateAccess,
  validateMiabisCompliance,
  validateSampleCompliance,
} = {}) {
  clearCache();

  const authModule = require(authPath);
  authModule.authenticate = (req, res, next) => {
    req.user = { id: 'user-1', name: 'Tester', roleName: 'Administrador' };
    req.t = (key) => key;
    next();
  };

  const rbacModule = require(rbacPath);
  rbacModule.requirePermission = () => (req, res, next) => next();

  const consentEnforcementModule = require(consentEnforcementPath);
  consentEnforcementModule.enforceCommercialConsent = () => (req, res, next) => next();

  const sampleServiceModule = require(sampleServicePath);
  Object.assign(sampleServiceModule, sampleServiceOverrides);

  const consentValidatorModule = require(consentValidatorPath);
  consentValidatorModule.init = vi.fn();
  consentValidatorModule.validateAccess = consentValidatorValidateAccess || vi.fn().mockResolvedValue(true);

  const auditLoggerModule = require(auditLoggerPath);
  auditLoggerModule.init = vi.fn();
  auditLoggerModule.log = vi.fn().mockResolvedValue(undefined);
  auditLoggerModule.logError = vi.fn().mockResolvedValue(undefined);

  function FakeRegisterSampleUseCase() {
    this.execute = registerSampleUseCaseExecute || vi.fn();
  }
  require.cache[registerSampleUseCasePath] = {
    id: registerSampleUseCasePath,
    filename: registerSampleUseCasePath,
    loaded: true,
    exports: FakeRegisterSampleUseCase,
  };

  function FakeLineageRepository() {}
  require.cache[lineageRepositoryPath] = {
    id: lineageRepositoryPath,
    filename: lineageRepositoryPath,
    loaded: true,
    exports: FakeLineageRepository,
  };

  const miabisValidatorModule = require(miabisValidatorPath);
  miabisValidatorModule.validateMiabisCompliance = validateMiabisCompliance || vi.fn().mockResolvedValue({ compliant: true });

  function FakeSampleGraphValidator() {
    this.validateSampleCompliance = validateSampleCompliance || vi.fn().mockResolvedValue({ compliant: true });
  }
  require.cache[sampleGraphValidatorPath] = {
    id: sampleGraphValidatorPath,
    filename: sampleGraphValidatorPath,
    loaded: true,
    exports: FakeSampleGraphValidator,
  };

  const sampleFileControllerModule = require(sampleFileControllerPath);
  sampleFileControllerModule.uploadMiddleware = () => (req, res, next) => next();
  sampleFileControllerModule.uploadFile = (req, res) => res.status(200).json({ success: true });
  sampleFileControllerModule.listFiles = (req, res) => res.status(200).json({ success: true });
  sampleFileControllerModule.downloadFile = (req, res) => res.status(200).json({ success: true });
  sampleFileControllerModule.deleteFile = (req, res) => res.status(200).json({ success: true });
  sampleFileControllerModule.exportHL7v2 = (req, res) => res.status(200).json({ success: true });
  sampleFileControllerModule.exportFHIR = (req, res) => res.status(200).json({ success: true });
  sampleFileControllerModule.exportCDA = (req, res) => res.status(200).json({ success: true });

  const router = require(routePath);
  return { router, auditLoggerModule, sampleServiceModule };
}

function buildApp(router, db = {}) {
  const app = express();
  app.use(express.json());
  app.locals.db = db;
  app.use('/api/samples', router);
  return app;
}

const VALID_PAYLOAD = {
  patientID: '12345678',
  sampleType: 'PLASMA',
  sampleOrigin: 'VENOUS_BLOOD',
  extractionProtocol: 'TUBE_EDTA',
  quantity: 5,
  quality: 'GOOD',
  linkedProject: 'Projeto X',
  registerDate: '2026-01-01',
};

describe('sample.routes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearCache();
  });

  describe('POST / payload validation', () => {
    it('returns 422 with aggregated errors when required fields are missing', async () => {
      const executeMock = vi.fn();
      const { router } = loadRoute({ registerSampleUseCaseExecute: executeMock });
      const app = buildApp(router, {});

      const res = await request(app).post('/api/samples').send({});

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.details.length).toBeGreaterThan(0);
      expect(executeMock).not.toHaveBeenCalled();
    });

    it('rejects a patientID that is not 8 digits', async () => {
      const { router } = loadRoute({ registerSampleUseCaseExecute: vi.fn() });
      const app = buildApp(router, {});

      const res = await request(app)
        .post('/api/samples')
        .send({ ...VALID_PAYLOAD, patientID: '123' });

      expect(res.status).toBe(422);
      expect(res.body.details).toContain('patientID deve ser uma string com 8 dígitos');
    });

    it('accepts registrationDate as an alternative to registerDate', async () => {
      const executeMock = vi.fn().mockResolvedValue({
        sample: { _id: { toString: () => 'sample-1' }, patientID: '12345678' },
        strictMode: false,
      });
      const { router } = loadRoute({ registerSampleUseCaseExecute: executeMock });
      const app = buildApp(router, {});
      const { registerDate, ...withoutRegisterDate } = VALID_PAYLOAD;

      const res = await request(app)
        .post('/api/samples')
        .send({ ...withoutRegisterDate, registrationDate: '2026-01-01' });

      expect(res.status).toBe(201);
    });
  });

  describe('POST / happy path and error mapping', () => {
    it('returns 503 when db is unavailable', async () => {
      const { router } = loadRoute({ registerSampleUseCaseExecute: vi.fn() });
      const app = buildApp(router, null);

      const res = await request(app).post('/api/samples').send(VALID_PAYLOAD);

      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
    });

    it('returns 201 on success', async () => {
      const executeMock = vi.fn().mockResolvedValue({
        sample: { _id: { toString: () => 'sample-1' }, patientID: '12345678', sampleType: 'Sangue', barcode: 'BC1' },
        strictMode: true,
        topology: { synced: true, fallbackQueued: false },
      });
      const { router, auditLoggerModule } = loadRoute({ registerSampleUseCaseExecute: executeMock });
      const app = buildApp(router, {});

      const res = await request(app).post('/api/samples').send(VALID_PAYLOAD);

      expect(res.status).toBe(201);
      expect(res.body.data.operationMode).toBe('STRICT');
      expect(res.body.partialSuccess).toBe(false);
      expect(auditLoggerModule.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'sample_create' })
      );
    });

    it('returns 202 when topology sync falls back to quarantine', async () => {
      const executeMock = vi.fn().mockResolvedValue({
        sample: { _id: { toString: () => 'sample-1' }, patientID: '12345678' },
        strictMode: false,
        topology: { synced: false, fallbackQueued: true },
      });
      const { router } = loadRoute({ registerSampleUseCaseExecute: executeMock });
      const app = buildApp(router, {});

      const res = await request(app).post('/api/samples').send(VALID_PAYLOAD);

      expect(res.status).toBe(202);
      expect(res.body.partialSuccess).toBe(true);
    });

    it('maps STRICT_MODE_BLOCKED errors to 403', async () => {
      const err = new Error('STRICT_MODE_BLOCKED: quarantine active');
      err.code = 'STRICT_MODE_BLOCKED';
      const { router } = loadRoute({ registerSampleUseCaseExecute: vi.fn().mockRejectedValue(err) });
      const app = buildApp(router, {});

      const res = await request(app).post('/api/samples').send(VALID_PAYLOAD);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('STRICT_MODE_BLOCKED');
    });

    it('maps a 409 statusCode error to 409', async () => {
      const err = new Error('Posição já ocupada');
      err.statusCode = 409;
      const { router } = loadRoute({ registerSampleUseCaseExecute: vi.fn().mockRejectedValue(err) });
      const app = buildApp(router, {});

      const res = await request(app).post('/api/samples').send(VALID_PAYLOAD);

      expect(res.status).toBe(409);
    });

    it('maps a "não encontrado" message to 404', async () => {
      const { router } = loadRoute({
        registerSampleUseCaseExecute: vi.fn().mockRejectedValue(new Error('Recurso não encontrado')),
      });
      const app = buildApp(router, {});

      const res = await request(app).post('/api/samples').send(VALID_PAYLOAD);

      expect(res.status).toBe(404);
    });

    it('maps an unexpected error to 500 and logs it via auditLogger', async () => {
      const { router, auditLoggerModule } = loadRoute({
        registerSampleUseCaseExecute: vi.fn().mockRejectedValue(new Error('boom')),
      });
      const app = buildApp(router, {});

      const res = await request(app).post('/api/samples').send(VALID_PAYLOAD);

      expect(res.status).toBe(500);
      expect(auditLoggerModule.logError).toHaveBeenCalled();
    });
  });

  describe('GET /:id/label', () => {
    it('returns 404 when the sample cannot be found', async () => {
      const { router } = loadRoute();
      const findOne = vi.fn().mockResolvedValue(null);
      const app = buildApp(router, { collection: () => ({ findOne }) });

      const res = await request(app).get('/api/samples/000000000000000000000000/label');

      expect(res.status).toBe(404);
    });

    it('returns an SVG label with XML-escaped fields', async () => {
      const { router } = loadRoute();
      const findOne = vi.fn().mockResolvedValue({
        sampleID: 42,
        barcode: 'BC<1>&"\'',
        sampleType: 'Sangue & Plasma',
      });
      const app = buildApp(router, { collection: () => ({ findOne }) });

      const res = await request(app).get('/api/samples/000000000000000000000000/label');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('image/svg+xml');
      const svgText = Buffer.isBuffer(res.body) ? res.body.toString('utf-8') : res.text;
      expect(svgText).toContain('&lt;1&gt;');
      expect(svgText).toContain('&amp;');
      expect(svgText).not.toContain('BC<1>&"\'');
    });
  });

  describe('GET /search/by-term', () => {
    it('returns 400 when the term is too short', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples/search/by-term').query({ q: 'a' });

      expect(res.status).toBe(400);
    });

    it('returns matching samples for a valid term, excluding withdrawn ones', async () => {
      const { router } = loadRoute();
      const toArray = vi.fn().mockResolvedValue([{ _id: '1', barcode: 'BC1' }]);
      const project = vi.fn().mockReturnValue({ toArray });
      const limit = vi.fn().mockReturnValue({ project });
      const find = vi.fn().mockReturnValue({ limit });
      const app = buildApp(router, { collection: () => ({ find }) });

      const res = await request(app).get('/api/samples/search/by-term').query({ q: 'BC1' });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([{ _id: '1', barcode: 'BC1' }]);
      expect(find).toHaveBeenCalledWith(
        expect.objectContaining({ currentStatus: { $ne: 'WITHDRAWN' } })
      );
    });
  });

  describe('GET /by-barcode/:barcode', () => {
    it('returns 404 and logs a warning when no sample matches the barcode', async () => {
      const getSampleByBarcode = vi.fn().mockResolvedValue({ sample: null });
      const { router, auditLoggerModule } = loadRoute({ sampleServiceOverrides: { getSampleByBarcode } });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples/by-barcode/UNKNOWN');

      expect(res.status).toBe(404);
      expect(auditLoggerModule.log).toHaveBeenCalledWith(
        expect.objectContaining({ result: 'error' })
      );
    });

    it('returns 200 with the sample when found', async () => {
      const getSampleByBarcode = vi.fn().mockResolvedValue({ sample: { _id: { toString: () => 's1' } } });
      const { router } = loadRoute({ sampleServiceOverrides: { getSampleByBarcode } });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples/by-barcode/BC1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('GET /:id/movements', () => {
    it('returns 503 when db is unavailable', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, null);

      const res = await request(app).get('/api/samples/s1/movements');

      expect(res.status).toBe(503);
    });

    it('returns movements on success', async () => {
      const getSampleMovements = vi.fn().mockResolvedValue([{ movementID: 'm1' }]);
      const { router } = loadRoute({ sampleServiceOverrides: { getSampleMovements } });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples/s1/movements');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([{ movementID: 'm1' }]);
    });

    it('returns 500 when the service throws', async () => {
      const getSampleMovements = vi.fn().mockRejectedValue(new Error('db down'));
      const { router } = loadRoute({ sampleServiceOverrides: { getSampleMovements } });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples/s1/movements');

      expect(res.status).toBe(500);
    });
  });

  describe('GET /:id/miabis-compliance', () => {
    it('returns 200 with the compliance report', async () => {
      const validateMiabisCompliance = vi.fn().mockResolvedValue({ compliant: true, missing: [] });
      const { router } = loadRoute({ validateMiabisCompliance });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples/s1/miabis-compliance');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ compliant: true, missing: [] });
      expect(validateMiabisCompliance).toHaveBeenCalledWith('s1', {});
    });

    it('returns 500 when the validator throws', async () => {
      const validateMiabisCompliance = vi.fn().mockRejectedValue(new Error('boom'));
      const { router } = loadRoute({ validateMiabisCompliance });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples/s1/miabis-compliance');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });

    it('returns 503 when db is unavailable', async () => {
      const validateMiabisCompliance = vi.fn().mockResolvedValue({ compliant: true, missing: [] });
      const { router } = loadRoute({ validateMiabisCompliance });
      const app = buildApp(router, null);

      const res = await request(app).get('/api/samples/s1/miabis-compliance');

      expect(res.status).toBe(503);
      expect(validateMiabisCompliance).not.toHaveBeenCalled();
    });
  });

  describe('GET /:id/compliance-graph', () => {
    it('returns 503 when db is unavailable', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, null);

      const res = await request(app).get('/api/samples/s1/compliance-graph');

      expect(res.status).toBe(503);
    });

    it('returns 200 with the validator report', async () => {
      const validateSampleCompliance = vi.fn().mockResolvedValue({ ok: true });
      const { router } = loadRoute({ validateSampleCompliance });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples/s1/compliance-graph');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: { ok: true } });
    });

    it('returns 400 when the validator throws', async () => {
      const validateSampleCompliance = vi.fn().mockRejectedValue(new Error('bad graph'));
      const { router } = loadRoute({ validateSampleCompliance });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples/s1/compliance-graph');

      expect(res.status).toBe(400);
    });
  });

  describe('GET /', () => {
    it('returns 503 when db is unavailable', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, null);

      const res = await request(app).get('/api/samples');

      expect(res.status).toBe(503);
    });

    it('enriches samples with consent info when a patient and active consent exist', async () => {
      const listSamples = vi.fn().mockResolvedValue({
        samples: [{ patientID: 'P1' }],
        total: 1,
      });
      const { router } = loadRoute({ sampleServiceOverrides: { listSamples } });

      const patient = { _id: { toString: () => 'patient-1' } };
      const patientsCollection = { findOne: vi.fn().mockResolvedValue(patient) };
      const consentsCollection = {
        findOne: vi.fn().mockResolvedValue({ status: 'ACTIVE' }),
        countDocuments: vi.fn().mockResolvedValue(1),
      };
      const db = {
        collection: (name) => (name === 'patients' ? patientsCollection : consentsCollection),
      };
      const app = buildApp(router, db);

      const res = await request(app).get('/api/samples');

      expect(res.status).toBe(200);
      expect(res.body.data[0]).toEqual(
        expect.objectContaining({ consentValid: true, consentMessage: 'TCLE Assinado', canUse: true })
      );
    });

    it('marks consent as pending when a patient exists with no active consent and consents are already tracked', async () => {
      const listSamples = vi.fn().mockResolvedValue({
        samples: [{ patientID: 'P1' }],
        total: 1,
      });
      const { router } = loadRoute({ sampleServiceOverrides: { listSamples } });

      const patient = { _id: { toString: () => 'patient-1' } };
      const patientsCollection = { findOne: vi.fn().mockResolvedValue(patient) };
      const consentsCollection = {
        findOne: vi.fn().mockResolvedValue(null),
        countDocuments: vi.fn().mockResolvedValue(5),
      };
      const db = {
        collection: (name) => (name === 'patients' ? patientsCollection : consentsCollection),
      };
      const app = buildApp(router, db);

      const res = await request(app).get('/api/samples');

      expect(res.status).toBe(200);
      expect(res.body.data[0]).toEqual(
        expect.objectContaining({ consentValid: false, consentMessage: 'TCLE Pendente', canUse: false })
      );
    });

    it('allows use when the patient cannot be found', async () => {
      const listSamples = vi.fn().mockResolvedValue({
        samples: [{ patientID: 'MISSING' }],
        total: 1,
      });
      const { router } = loadRoute({ sampleServiceOverrides: { listSamples } });

      const patientsCollection = { findOne: vi.fn().mockResolvedValue(null) };
      const consentsCollection = { findOne: vi.fn(), countDocuments: vi.fn() };
      const db = {
        collection: (name) => (name === 'patients' ? patientsCollection : consentsCollection),
      };
      const app = buildApp(router, db);

      const res = await request(app).get('/api/samples');

      expect(res.status).toBe(200);
      expect(res.body.data[0]).toEqual(
        expect.objectContaining({ consentValid: true, consentMessage: 'Paciente não encontrado', canUse: true })
      );
    });

    it('returns 500 when listSamples throws', async () => {
      const listSamples = vi.fn().mockRejectedValue(new Error('db down'));
      const { router } = loadRoute({ sampleServiceOverrides: { listSamples } });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples');

      expect(res.status).toBe(500);
    });
  });

  describe('GET /:id', () => {
    it('returns 503 when db is unavailable', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, null);

      const res = await request(app).get('/api/samples/000000000000000000000000');

      expect(res.status).toBe(503);
    });

    it('returns 404 and logs a warning when the sample is not found', async () => {
      const getSample = vi.fn().mockResolvedValue(null);
      const { router, auditLoggerModule } = loadRoute({ sampleServiceOverrides: { getSample } });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples/000000000000000000000000');

      expect(res.status).toBe(404);
      expect(auditLoggerModule.log).toHaveBeenCalledWith(expect.objectContaining({ result: 'error' }));
    });

    it('returns 200 with the sample', async () => {
      const getSample = vi.fn().mockResolvedValue({ _id: '1', patientID: 'P1' });
      const { router } = loadRoute({ sampleServiceOverrides: { getSample } });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples/000000000000000000000000');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ _id: '1', patientID: 'P1' });
    });

    it('returns 500 when the service throws', async () => {
      const getSample = vi.fn().mockRejectedValue(new Error('db down'));
      const { router } = loadRoute({ sampleServiceOverrides: { getSample } });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples/000000000000000000000000');

      expect(res.status).toBe(500);
    });
  });

  describe('PUT /:id', () => {
    it('returns 503 when db is unavailable', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, null);

      const res = await request(app).put('/api/samples/000000000000000000000000').send({ quantity: 1 });

      expect(res.status).toBe(503);
    });

    it('returns 404 when the sample does not exist', async () => {
      const updateSample = vi.fn().mockResolvedValue(null);
      const { router } = loadRoute({ sampleServiceOverrides: { updateSample } });
      const app = buildApp(router, {});

      const res = await request(app).put('/api/samples/000000000000000000000000').send({ quantity: 1 });

      expect(res.status).toBe(404);
    });

    it('returns 200 and logs the update on success', async () => {
      const updateSample = vi.fn().mockResolvedValue({ _id: '1', quantity: 1 });
      const { router, auditLoggerModule } = loadRoute({ sampleServiceOverrides: { updateSample } });
      const app = buildApp(router, {});

      const res = await request(app).put('/api/samples/000000000000000000000000').send({ quantity: 1 });

      expect(res.status).toBe(200);
      expect(auditLoggerModule.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'UPDATE' }));
    });

    it('returns 400 when the service throws', async () => {
      const updateSample = vi.fn().mockRejectedValue(new Error('invalid'));
      const { router } = loadRoute({ sampleServiceOverrides: { updateSample } });
      const app = buildApp(router, {});

      const res = await request(app).put('/api/samples/000000000000000000000000').send({ quantity: 1 });

      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /:id', () => {
    it('returns 503 when db is unavailable', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, null);

      const res = await request(app).delete('/api/samples/000000000000000000000000');

      expect(res.status).toBe(503);
    });

    it('returns 404 when the sample does not exist', async () => {
      const deleteSample = vi.fn().mockResolvedValue(null);
      const { router } = loadRoute({ sampleServiceOverrides: { deleteSample } });
      const app = buildApp(router, {});

      const res = await request(app).delete('/api/samples/000000000000000000000000');

      expect(res.status).toBe(404);
    });

    it('returns 200 and logs the deletion on success', async () => {
      const deleteSample = vi.fn().mockResolvedValue(true);
      const { router, auditLoggerModule } = loadRoute({ sampleServiceOverrides: { deleteSample } });
      const app = buildApp(router, {});

      const res = await request(app).delete('/api/samples/000000000000000000000000');

      expect(res.status).toBe(200);
      expect(auditLoggerModule.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'DELETE' }));
    });

    it('returns 400 when the service throws', async () => {
      const deleteSample = vi.fn().mockRejectedValue(new Error('cannot delete'));
      const { router } = loadRoute({ sampleServiceOverrides: { deleteSample } });
      const app = buildApp(router, {});

      const res = await request(app).delete('/api/samples/000000000000000000000000');

      expect(res.status).toBe(400);
    });
  });

  describe('POST /:id/withdraw', () => {
    it('returns 503 when db is unavailable', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, null);

      const res = await request(app).post('/api/samples/000000000000000000000000/withdraw').send({});

      expect(res.status).toBe(503);
    });

    it('returns 200 and logs a high-severity audit entry on success', async () => {
      const withdrawSample = vi.fn().mockResolvedValue({ withdrawnQuantity: 2, remainingQuantity: 3, movementID: 'm1' });
      const { router, auditLoggerModule } = loadRoute({ sampleServiceOverrides: { withdrawSample } });
      const app = buildApp(router, {});

      const res = await request(app)
        .post('/api/samples/000000000000000000000000/withdraw')
        .send({ withdrawalType: 'DISPOSAL', withdrawalResponsible: 'Dr. X' });

      expect(res.status).toBe(200);
      expect(res.body.data.withdrawnQuantity).toBe(2);
      expect(auditLoggerModule.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'WITHDRAW', severity: 'high' }));
    });

    it('returns 400 when consent validation rejects the request', async () => {
      const consentValidatorValidateAccess = vi.fn().mockRejectedValue(new Error('no consent'));
      const { router } = loadRoute({ consentValidatorValidateAccess });
      const app = buildApp(router, {});

      const res = await request(app).post('/api/samples/000000000000000000000000/withdraw').send({});

      expect(res.status).toBe(400);
    });
  });

  describe('POST /:id/return', () => {
    it('returns 503 when db is unavailable', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, null);

      const res = await request(app).post('/api/samples/000000000000000000000000/return').send({});

      expect(res.status).toBe(503);
    });

    it('returns 200 and logs a high-severity audit entry on success', async () => {
      const returnSample = vi.fn().mockResolvedValue({ returnedQuantity: 1, condition: 'OK', newAvailableQuantity: 4, movementID: 'm2' });
      const { router, auditLoggerModule } = loadRoute({ sampleServiceOverrides: { returnSample } });
      const app = buildApp(router, {});

      const res = await request(app)
        .post('/api/samples/000000000000000000000000/return')
        .send({ returnResponsible: 'Dr. Y' });

      expect(res.status).toBe(200);
      expect(res.body.data.returnedQuantity).toBe(1);
      expect(auditLoggerModule.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'RETURN', severity: 'high' }));
    });

    it('returns 400 when the service throws', async () => {
      const returnSample = vi.fn().mockRejectedValue(new Error('boom'));
      const { router } = loadRoute({ sampleServiceOverrides: { returnSample } });
      const app = buildApp(router, {});

      const res = await request(app).post('/api/samples/000000000000000000000000/return').send({});

      expect(res.status).toBe(400);
    });
  });

  describe('GET /:id/results', () => {
    it('returns 503 when db is unavailable', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, null);

      const res = await request(app).get('/api/samples/000000000000000000000000/results');

      expect(res.status).toBe(503);
    });

    it('returns 200 with the results and logs the query', async () => {
      const getSampleResults = vi.fn().mockResolvedValue([{ fileID: 'f1' }]);
      const { router, auditLoggerModule } = loadRoute({ sampleServiceOverrides: { getSampleResults } });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples/000000000000000000000000/results');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([{ fileID: 'f1' }]);
      expect(auditLoggerModule.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'QUERY' }));
    });

    it('returns 500 when the service throws', async () => {
      const getSampleResults = vi.fn().mockRejectedValue(new Error('boom'));
      const { router } = loadRoute({ sampleServiceOverrides: { getSampleResults } });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples/000000000000000000000000/results');

      expect(res.status).toBe(500);
    });
  });

  describe('GET /by-barcode/:barcode/symbology-assets', () => {
    it('returns 404 when the sample cannot be found by barcode', async () => {
      const getSampleByBarcode = vi.fn().mockResolvedValue({ sample: null });
      const { router } = loadRoute({ sampleServiceOverrides: { getSampleByBarcode } });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples/by-barcode/UNKNOWN/symbology-assets');

      expect(res.status).toBe(404);
    });

    it('returns 200 with generated barcode assets', async () => {
      const getSampleByBarcode = vi.fn().mockResolvedValue({ sample: { _id: 's1' } });
      const getBarcodeIndustrialAssets = vi.fn().mockResolvedValue({
        canonicalValue: 'BC1',
        generatedAt: '2026-01-01',
        code128: 'code128data',
        dataMatrix: 'dataMatrixData',
      });
      const { router } = loadRoute({
        sampleServiceOverrides: { getSampleByBarcode, getBarcodeIndustrialAssets },
      });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples/by-barcode/BC1/symbology-assets');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(
        expect.objectContaining({ barcode: 'BC1', includePayload: false, code128: 'code128data' })
      );
      expect(getBarcodeIndustrialAssets).toHaveBeenCalledWith('BC1', { includePayload: false });
    });

    it('returns 500 when generating assets throws', async () => {
      const getSampleByBarcode = vi.fn().mockResolvedValue({ sample: { _id: 's1' } });
      const getBarcodeIndustrialAssets = vi.fn().mockRejectedValue(new Error('boom'));
      const { router } = loadRoute({
        sampleServiceOverrides: { getSampleByBarcode, getBarcodeIndustrialAssets },
      });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples/by-barcode/BC1/symbology-assets');

      expect(res.status).toBe(500);
    });
  });
});
