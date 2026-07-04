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
function loadRoute({ registerSampleUseCaseExecute, sampleServiceOverrides = {}, consentValidatorValidateAccess } = {}) {
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
});
