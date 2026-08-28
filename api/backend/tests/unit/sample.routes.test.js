import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import express from 'express';
import request from 'supertest';

const require = createRequire(import.meta.url);

const { createMatchingCollection } = require('../factories/filter.factory');

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

// authenticate/requirePermission/enforceCommercialConsent/validateMiabisCompliance
// are destructured at require-time in sample.routes.js, and
// RegisterSampleUseCase/LineageRepository/SampleGraphValidator are captured
// as constructor references. Re-requiring this ~1100-line route file fresh
// per test (as label.routes.test.js/hpo.routes.test.js do for their much
// smaller files) makes V8's per-file branch coverage undercount here -
// confirmed empirically: routes with both a true- and false-path test (e.g.
// GET /:id's 404 vs 200) still reported the false branch as 0 hits despite
// the 200 test's assertions passing, deterministically, across reruns.
// Fix: require every dependency and the route itself exactly ONCE, and give
// each mockable seam a stable proxy/constructor that reads a mutable
// `current*` closure variable - so route.js's one-time destructuring still
// always calls through to whatever the current test configured.
let currentAuth = defaultAuth;
let currentRequirePermission = () => (req, res, next) => next();
let currentRequireOrganizationScope = (req, res, next) => {
  req.organizationScope = { scope: 'global', organizationIds: [] };
  next();
};
let currentEnforceCommercialConsent = () => (req, res, next) => next();
let currentValidateMiabisCompliance = () => Promise.resolve({ compliant: true });
let currentRegisterSampleUseCaseExecute = () => Promise.resolve();
let currentValidateSampleCompliance = () => Promise.resolve({ compliant: true });
let currentConsentValidatorValidateAccess = () => Promise.resolve(true);

function defaultAuth(req, res, next) {
  req.user = { id: 'user-1', name: 'Tester', roleName: 'Administrador' };
  req.t = (key) => key;
  next();
}

const authModule = require(authPath);
authModule.authenticate = (req, res, next) => currentAuth(req, res, next);

const rbacModule = require(rbacPath);
rbacModule.requirePermission = (...args) => currentRequirePermission(...args);
rbacModule.requireOrganizationScope = (req, res, next) => currentRequireOrganizationScope(req, res, next);

const consentEnforcementModule = require(consentEnforcementPath);
consentEnforcementModule.enforceCommercialConsent = (...args) => currentEnforceCommercialConsent(...args);

const miabisValidatorModule = require(miabisValidatorPath);
miabisValidatorModule.validateMiabisCompliance = (...args) => currentValidateMiabisCompliance(...args);

let capturedSampleRepository;
function StableRegisterSampleUseCase({ sampleRepository } = {}) {
  capturedSampleRepository = sampleRepository;
  this.execute = (...args) => currentRegisterSampleUseCaseExecute(...args);
}
require.cache[registerSampleUseCasePath] = {
  id: registerSampleUseCasePath,
  filename: registerSampleUseCasePath,
  loaded: true,
  exports: StableRegisterSampleUseCase,
};

function StableLineageRepository() {}
require.cache[lineageRepositoryPath] = {
  id: lineageRepositoryPath,
  filename: lineageRepositoryPath,
  loaded: true,
  exports: StableLineageRepository,
};

function StableSampleGraphValidator() {
  this.validateSampleCompliance = (...args) => currentValidateSampleCompliance(...args);
}
require.cache[sampleGraphValidatorPath] = {
  id: sampleGraphValidatorPath,
  filename: sampleGraphValidatorPath,
  loaded: true,
  exports: StableSampleGraphValidator,
};

const sampleServiceModule = require(sampleServicePath);
const originalSampleServiceModule = { ...sampleServiceModule };
const consentValidatorModule = require(consentValidatorPath);
consentValidatorModule.init = vi.fn();
consentValidatorModule.validateAccess = (...args) => currentConsentValidatorValidateAccess(...args);

const auditLoggerModule = require(auditLoggerPath);

const sampleFileControllerModule = require(sampleFileControllerPath);
sampleFileControllerModule.uploadMiddleware = () => (req, res, next) => next();
sampleFileControllerModule.uploadFile = (req, res) => res.status(200).json({ success: true });
sampleFileControllerModule.listFiles = (req, res) => res.status(200).json({ success: true });
sampleFileControllerModule.downloadFile = (req, res) => res.status(200).json({ success: true });
sampleFileControllerModule.deleteFile = (req, res) => res.status(200).json({ success: true });
sampleFileControllerModule.exportHL7v2 = (req, res) => res.status(200).json({ success: true });
sampleFileControllerModule.exportFHIR = (req, res) => res.status(200).json({ success: true });
sampleFileControllerModule.exportCDA = (req, res) => res.status(200).json({ success: true });

// Required exactly once - see comment above.
const router = require(routePath);

function loadRoute({
  registerSampleUseCaseExecute,
  sampleServiceOverrides = {},
  consentValidatorValidateAccess,
  validateMiabisCompliance,
  validateSampleCompliance,
  authImpl,
  requirePermissionImpl,
  requireOrganizationScopeImpl,
  enforceCommercialConsentImpl,
} = {}) {
  currentAuth = authImpl || defaultAuth;
  currentRequirePermission = requirePermissionImpl || (() => (req, res, next) => next());
  currentRequireOrganizationScope = requireOrganizationScopeImpl || ((req, res, next) => {
    req.organizationScope = { scope: 'global', organizationIds: [] };
    next();
  });
  currentEnforceCommercialConsent = enforceCommercialConsentImpl || (() => (req, res, next) => next());
  currentValidateMiabisCompliance = validateMiabisCompliance || (() => Promise.resolve({ compliant: true }));
  currentRegisterSampleUseCaseExecute = registerSampleUseCaseExecute || (() => Promise.resolve());
  currentValidateSampleCompliance = validateSampleCompliance || (() => Promise.resolve({ compliant: true }));
  currentConsentValidatorValidateAccess = consentValidatorValidateAccess || (() => Promise.resolve(true));

  // sample.service/consent.validator/auditLogger/sample-file.controller are
  // required as whole modules (not destructured) by sample.routes.js, so
  // mutating their exports in place is picked up without re-requiring it.
  // Restore the real implementations before layering this test's overrides,
  // so a mock from a previous test never leaks into this one.
  Object.assign(sampleServiceModule, originalSampleServiceModule, sampleServiceOverrides);

  auditLoggerModule.init = vi.fn();
  auditLoggerModule.log = vi.fn().mockResolvedValue(undefined);
  auditLoggerModule.logError = vi.fn().mockResolvedValue(undefined);

  return { router, auditLoggerModule, sampleServiceModule };
}

function buildApp(router, db = {}, { stripReqIp } = {}) {
  const app = express();
  app.use(express.json());
  app.locals.db = db;
  if (stripReqIp) {
    app.use((req, res, next) => {
      Object.defineProperty(req, 'ip', { value: undefined, configurable: true });
      next();
    });
  }
  app.use('/api/samples', router);
  return app;
}

const VALID_PAYLOAD = {
  participantId: '12345678',
  sampleType: 'PLASMA',
  sampleOrigin: 'VENOUS_BLOOD',
  extractionProtocol: 'TUBE_EDTA',
  quantity: 5,
  quality: 'GOOD',
  linkedProject: 'Projeto X',
  registeredAt: '2026-01-01',
  boxId: '507f1f77bcf86cd799439011',
  positionCode: 'A1',
};

describe('sample.routes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
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

    it('rejects a participantId that is not 8 digits', async () => {
      const { router } = loadRoute({ registerSampleUseCaseExecute: vi.fn() });
      const app = buildApp(router, {});

      const res = await request(app)
        .post('/api/samples')
        .send({ ...VALID_PAYLOAD, participantId: '123' });

      expect(res.status).toBe(422);
      expect(res.body.details).toContain('participantId deve ser uma string com 8 dígitos');
    });

    it('rejects registrationDate as a non-canonical alias of registeredAt', async () => {
      const { router } = loadRoute({ registerSampleUseCaseExecute: vi.fn() });
      const app = buildApp(router, {});
      const { registeredAt, ...withoutRegisteredAt } = VALID_PAYLOAD;

      const res = await request(app)
        .post('/api/samples')
        .send({ ...withoutRegisteredAt, registrationDate: '2026-01-01' });

      expect(res.status).toBe(422);
      expect(res.body.error).toBe('NON_CANONICAL_FIELD');
      expect(res.body.fields).toContain('registrationDate');
    });

    it.each([
      ['patientID', 'p1'],
      ['sampleID', 's1'],
      ['sampleId', 's1'],
      ['registerDate', '2026-01-01'],
      ['currentStatus', 'ACTIVE'],
      ['merkle_root', 'abc123'],
    ])('rejects %s as a non-canonical alias field', async (field, value) => {
      const { router } = loadRoute({ registerSampleUseCaseExecute: vi.fn() });
      const app = buildApp(router, {});

      const res = await request(app)
        .post('/api/samples')
        .send({ ...VALID_PAYLOAD, [field]: value });

      expect(res.status).toBe(422);
      expect(res.body.error).toBe('NON_CANONICAL_FIELD');
      expect(res.body.fields).toContain(field);
    });

    it('rejects a sampleType that is a valid string but not a recognized MIABIS id', async () => {
      const { router } = loadRoute({ registerSampleUseCaseExecute: vi.fn() });
      const app = buildApp(router, {});

      const res = await request(app)
        .post('/api/samples')
        .send({ ...VALID_PAYLOAD, sampleType: 'NOT_A_REAL_TYPE' });

      expect(res.status).toBe(422);
      expect(res.body.details).toContain('sampleType inválido conforme MIABIS');
    });

    it('rejects a sampleOrigin that is a valid string but not a recognized MIABIS id', async () => {
      const { router } = loadRoute({ registerSampleUseCaseExecute: vi.fn() });
      const app = buildApp(router, {});

      const res = await request(app)
        .post('/api/samples')
        .send({ ...VALID_PAYLOAD, sampleOrigin: 'NOT_A_REAL_ORIGIN' });

      expect(res.status).toBe(422);
      expect(res.body.details).toContain('sampleOrigin inválido conforme MIABIS');
    });

    it('rejects an extractionProtocol that is a valid string but not a recognized MIABIS id', async () => {
      const { router } = loadRoute({ registerSampleUseCaseExecute: vi.fn() });
      const app = buildApp(router, {});

      const res = await request(app)
        .post('/api/samples')
        .send({ ...VALID_PAYLOAD, extractionProtocol: 'NOT_A_REAL_PROTOCOL' });

      expect(res.status).toBe(422);
      expect(res.body.details).toContain('extractionProtocol inválido conforme MIABIS');
    });

    it('rejects a quality that is a valid non-empty string but not a recognized MIABIS id', async () => {
      const { router } = loadRoute({ registerSampleUseCaseExecute: vi.fn() });
      const app = buildApp(router, {});

      const res = await request(app)
        .post('/api/samples')
        .send({ ...VALID_PAYLOAD, quality: 'NOT_A_REAL_QUALITY' });

      expect(res.status).toBe(422);
      expect(res.body.details).toContain('quality inválido conforme MIABIS');
    });

    it('rejects a missing linkedProject', async () => {
      const { router } = loadRoute({ registerSampleUseCaseExecute: vi.fn() });
      const app = buildApp(router, {});
      const { linkedProject, ...withoutLinkedProject } = VALID_PAYLOAD;

      const res = await request(app).post('/api/samples').send(withoutLinkedProject);

      expect(res.status).toBe(422);
      expect(res.body.details).toContain('linkedProject é obrigatório');
    });

    it('rejects a non-string linkedProject', async () => {
      const { router } = loadRoute({ registerSampleUseCaseExecute: vi.fn() });
      const app = buildApp(router, {});

      const res = await request(app)
        .post('/api/samples')
        .send({ ...VALID_PAYLOAD, linkedProject: 12345 });

      expect(res.status).toBe(422);
      expect(res.body.details).toContain('linkedProject é obrigatório');
    });

    it('rejects a non-boolean isRareDisease', async () => {
      const { router } = loadRoute({ registerSampleUseCaseExecute: vi.fn() });
      const app = buildApp(router, {});

      const res = await request(app)
        .post('/api/samples')
        .send({ ...VALID_PAYLOAD, isRareDisease: 'yes' });

      expect(res.status).toBe(422);
      expect(res.body.details).toContain('isRareDisease deve ser boolean');
    });

    it('accepts a boolean isRareDisease', async () => {
      const executeMock = vi.fn().mockResolvedValue({
        sample: { _id: { toString: () => 's1' }, patientID: '12345678' },
        strictMode: true,
        topology: {},
      });
      const { router } = loadRoute({ registerSampleUseCaseExecute: executeMock });
      const app = buildApp(router, {});

      const res = await request(app)
        .post('/api/samples')
        .send({ ...VALID_PAYLOAD, isRareDisease: true });

      expect(res.status).toBe(201);
    });

    it('accepts a valid boxId/positionCode pair, per issue #462', async () => {
      const executeMock = vi.fn().mockResolvedValue({
        sample: { _id: { toString: () => 's1' }, patientID: '12345678' },
        strictMode: true,
        topology: {},
      });
      const { router } = loadRoute({ registerSampleUseCaseExecute: executeMock });
      const app = buildApp(router, {});

      const res = await request(app)
        .post('/api/samples')
        .send({ ...VALID_PAYLOAD, boxId: '507f1f77bcf86cd799439012' });

      expect(res.status).toBe(201);
    });

    it('rejects a boxId that is not a valid ObjectId, per issue #462', async () => {
      const { router } = loadRoute({ registerSampleUseCaseExecute: vi.fn() });
      const app = buildApp(router, {});

      const res = await request(app)
        .post('/api/samples')
        .send({ ...VALID_PAYLOAD, boxId: 'not-a-valid-object-id' });

      expect(res.status).toBe(422);
      expect(res.body.details).toContain(
        'Localização física obrigatória para cadastro de amostra: boxId deve ser um identificador válido'
      );
    });

    it('rejects a missing positionCode, per issue #462', async () => {
      const { router } = loadRoute({ registerSampleUseCaseExecute: vi.fn() });
      const app = buildApp(router, {});
      const { positionCode, ...withoutPositionCode } = VALID_PAYLOAD;

      const res = await request(app)
        .post('/api/samples')
        .send(withoutPositionCode);

      expect(res.status).toBe(422);
      expect(res.body.details).toContain(
        'Localização física obrigatória para cadastro de amostra: positionCode é obrigatório'
      );
    });

    it('parses req.body as an empty object when no body is sent at all', async () => {
      const executeMock = vi.fn();
      const { router } = loadRoute({ registerSampleUseCaseExecute: executeMock });
      const app = buildApp(router, {});

      const res = await request(app).post('/api/samples').type('text/plain').send();

      expect(res.status).toBe(422);
      expect(executeMock).not.toHaveBeenCalled();
    });

    it('treats a genuinely undefined req.body as an empty payload (router._test)', () => {
      const { router } = loadRoute();
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };
      const next = vi.fn();

      router._test.validateCreateSamplePayload({ body: undefined }, res, next);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(next).not.toHaveBeenCalled();
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

    it('maps a validation-shaped Error (no statusCode) to 400', async () => {
      const { router } = loadRoute({
        registerSampleUseCaseExecute: vi.fn().mockRejectedValue(new Error('sampleType inválido')),
      });
      const app = buildApp(router, {});

      const res = await request(app).post('/api/samples').send(VALID_PAYLOAD);

      expect(res.status).toBe(400);
    });

    it('maps a 400 error.status (not statusCode) using the createError fallback message', async () => {
      const err = new Error('bad payload');
      err.status = 400;
      const authImpl = (req, res, next) => {
        req.user = { id: 'user-1' };
        // no req.t at all - exercises the `req.t?.(...)` optional-chain fallback
        next();
      };
      const { router } = loadRoute({
        registerSampleUseCaseExecute: vi.fn().mockRejectedValue(err),
        authImpl,
      });
      const app = buildApp(router, {});

      const res = await request(app).post('/api/samples').send(VALID_PAYLOAD);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Erro ao criar amostra');
    });

    it('falls back to a default error message when a non-Error value is thrown', async () => {
      const { router } = loadRoute({
        registerSampleUseCaseExecute: vi.fn().mockRejectedValue('just a string'),
      });
      const app = buildApp(router, {});

      const res = await request(app).post('/api/samples').send(VALID_PAYLOAD);

      expect(res.status).toBe(500);
    });

    it('swallows a non-Error thrown from auditLogger.logError without crashing the request', async () => {
      const { router, auditLoggerModule } = loadRoute({
        registerSampleUseCaseExecute: vi.fn().mockRejectedValue(new Error('boom')),
      });
      auditLoggerModule.logError = vi.fn().mockRejectedValue('audit backend down');
      const app = buildApp(router, {});

      const res = await request(app).post('/api/samples').send(VALID_PAYLOAD);

      expect(res.status).toBe(500);
    });

    it('uses req.t fallback strings and quality=null when req.t is absent and sample.quality is undefined', async () => {
      const executeMock = vi.fn().mockResolvedValue({
        sample: { _id: { toString: () => 'sample-1' }, patientID: '12345678', quality: undefined },
        strictMode: true,
        topology: { synced: true, fallbackQueued: false },
      });
      const authImpl = (req, res, next) => {
        req.user = { id: 'user-1' };
        req.t = () => undefined;
        next();
      };
      const { router, auditLoggerModule } = loadRoute({ registerSampleUseCaseExecute: executeMock, authImpl });
      const app = buildApp(router, {});

      const res = await request(app).post('/api/samples').send(VALID_PAYLOAD);

      expect(res.status).toBe(201);
      expect(res.body.message).toBe('Amostra criada com sucesso');
      expect(auditLoggerModule.log).toHaveBeenCalledWith(
        expect.objectContaining({ payload: expect.objectContaining({ quality: null }) })
      );
    });

    it('uses the partial-success message suffix when topology sync falls back to quarantine', async () => {
      const executeMock = vi.fn().mockResolvedValue({
        sample: { _id: { toString: () => 'sample-1' }, patientID: '12345678', quality: null },
        strictMode: false,
        topology: { synced: false, fallbackQueued: true },
      });
      const { router } = loadRoute({ registerSampleUseCaseExecute: executeMock });
      const app = buildApp(router, {});

      const res = await request(app).post('/api/samples').send(VALID_PAYLOAD);

      expect(res.status).toBe(202);
      expect(res.body.message).toContain('integração topológica em quarentena');
    });

    it('resolves the actor from req.user._id/userID and req.headers/connection when id/name/ip are absent', async () => {
      const executeMock = vi.fn();
      const authImpl = (req, res, next) => {
        req.user = { _id: { toString: () => 'u2' }, userID: 'u2-alt', username: 'alt-name', role: 'Coordenador' };
        next();
      };
      const { router } = loadRoute({ registerSampleUseCaseExecute: executeMock, authImpl });
      const app = buildApp(router, {});

      await request(app).post('/api/samples').send(VALID_PAYLOAD);

      expect(executeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          actor: expect.objectContaining({
            userId: 'u2',
            userName: 'alt-name',
            userRole: 'Coordenador',
          }),
        })
      );
    });

    it('falls back to null actor fields when req.user is absent entirely (no audit log write)', async () => {
      const executeMock = vi.fn().mockResolvedValue({
        sample: { _id: { toString: () => 's1' }, patientID: '12345678' },
        strictMode: true,
        topology: {},
      });
      const authImpl = (req, res, next) => {
        req.t = (key) => key;
        next();
      };
      const { router, auditLoggerModule } = loadRoute({ registerSampleUseCaseExecute: executeMock, authImpl });
      const app = buildApp(router, {});

      const res = await request(app).post('/api/samples').send(VALID_PAYLOAD);

      expect(res.status).toBe(201);
      expect(executeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          actor: expect.objectContaining({ userId: null, userName: null, userRole: null }),
        })
      );
      expect(auditLoggerModule.log).not.toHaveBeenCalled();
    });

    it('falls back to the x-forwarded-for header when req.ip is unavailable', async () => {
      const executeMock = vi.fn();
      const { router } = loadRoute({ registerSampleUseCaseExecute: executeMock });
      const app = buildApp(router, {}, { stripReqIp: true });

      await request(app)
        .post('/api/samples')
        .set('x-forwarded-for', '203.0.113.5')
        .send(VALID_PAYLOAD);

      expect(executeMock).toHaveBeenCalledWith(
        expect.objectContaining({ actor: expect.objectContaining({ ipAddress: '203.0.113.5' }) })
      );
    });

    it('falls back to req.connection.remoteAddress when both req.ip and the x-forwarded-for header are unavailable', async () => {
      const executeMock = vi.fn();
      const { router } = loadRoute({ registerSampleUseCaseExecute: executeMock });
      const app = buildApp(router, {}, { stripReqIp: true });

      await request(app).post('/api/samples').send(VALID_PAYLOAD);

      expect(executeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          actor: expect.objectContaining({ ipAddress: expect.any(String) }),
        })
      );
      const actor = executeMock.mock.calls[0][0].actor;
      expect(actor.ipAddress).not.toBeNull();
    });

    it('falls back to req.user.userID when neither id nor _id are present', async () => {
      const executeMock = vi.fn();
      const authImpl = (req, res, next) => {
        req.user = { userID: 'legacy-id-only' };
        req.t = (key) => key;
        next();
      };
      const { router } = loadRoute({ registerSampleUseCaseExecute: executeMock, authImpl });
      const app = buildApp(router, {});

      await request(app).post('/api/samples').send(VALID_PAYLOAD);

      expect(executeMock).toHaveBeenCalledWith(
        expect.objectContaining({ actor: expect.objectContaining({ userId: 'legacy-id-only' }) })
      );
    });

    it('maps a 422 error.statusCode (not status) using the req.t createError fallback', async () => {
      const err = new Error('invalid enum');
      err.statusCode = 422;
      const authImpl = (req, res, next) => {
        req.user = { id: 'user-1' };
        req.t = () => undefined;
        next();
      };
      const { router } = loadRoute({ registerSampleUseCaseExecute: vi.fn().mockRejectedValue(err), authImpl });
      const app = buildApp(router, {});

      const res = await request(app).post('/api/samples').send(VALID_PAYLOAD);

      expect(res.status).toBe(422);
      expect(res.body.error).toBe('Erro ao criar amostra');
    });

    it('uses the req.t fallback in the partial-success (202) message', async () => {
      const executeMock = vi.fn().mockResolvedValue({
        sample: { _id: { toString: () => 'sample-1' }, patientID: '12345678' },
        strictMode: false,
        topology: { synced: false, fallbackQueued: true },
      });
      const authImpl = (req, res, next) => {
        req.user = { id: 'user-1' };
        req.t = () => undefined;
        next();
      };
      const { router } = loadRoute({ registerSampleUseCaseExecute: executeMock, authImpl });
      const app = buildApp(router, {});

      const res = await request(app).post('/api/samples').send(VALID_PAYLOAD);

      expect(res.status).toBe(202);
      expect(res.body.message).toBe('Amostra criada com sucesso (integração topológica em quarentena)');
    });

    it('uses req.t?. fallback in the 503 unavailable-db message', async () => {
      const authImpl = (req, res, next) => {
        req.user = { id: 'user-1' };
        req.t = () => undefined;
        next();
      };
      const { router } = loadRoute({ registerSampleUseCaseExecute: vi.fn(), authImpl });
      const app = buildApp(router, null);

      const res = await request(app).post('/api/samples').send(VALID_PAYLOAD);

      expect(res.status).toBe(503);
      expect(res.body.error).toBe('Banco de dados não disponível');
    });

    it('exercises the inline sampleRepository.create/deleteById helpers via the use-case execute call', async () => {
      const createSample = vi.fn().mockResolvedValue({ _id: 'created-1' });
      const deleteOne = vi.fn().mockResolvedValue(undefined);

      const registerSampleUseCaseExecute = async ({ sampleData }) => {
        // capturedSampleRepository is set by StableRegisterSampleUseCase's
        // constructor, which the route always calls before .execute() -
        // touching it here covers the default `options = {}` arg and the
        // ObjectId ternary in sampleRepository.create/deleteById, neither of
        // which the stable fake otherwise exercises.
        await capturedSampleRepository.create({ participantId: sampleData.participantId });
        await capturedSampleRepository.deleteById('not-a-valid-object-id');
        await capturedSampleRepository.deleteById('000000000000000000000000');
        return {
          sample: { _id: { toString: () => 'sample-1' }, patientID: sampleData.participantId },
          strictMode: true,
          topology: {},
        };
      };

      const { router } = loadRoute({
        registerSampleUseCaseExecute,
        sampleServiceOverrides: { createSample },
      });
      const app = buildApp(router, { collection: () => ({ deleteOne }) });

      const res = await request(app).post('/api/samples').send(VALID_PAYLOAD);

      expect(res.status).toBe(201);
      expect(createSample).toHaveBeenCalledWith(
        expect.anything(),
        { participantId: VALID_PAYLOAD.participantId },
        // #474: the route's sampleRepository.create wrapper now also
        // forwards neo4jDriver so createSample can pass it through to
        // AllocateSampleUseCase's lineage repository.
        { neo4jDriver: null }
      );
      expect(deleteOne).toHaveBeenCalledTimes(2);
    });
  });

  describe('GET /:id/label', () => {
    it('returns 503 when db is unavailable', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, null);

      const res = await request(app).get('/api/samples/000000000000000000000000/label');

      expect(res.status).toBe(503);
    });

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
      // #646 Wave 3 (RF016 AC#6): recordLabelGeneration's labelGenerations
      // insertOne, reused (harmlessly) across every collection name this
      // mock serves.
      const insertOne = vi.fn().mockResolvedValue({ insertedId: 'lg1' });
      const app = buildApp(router, { collection: () => ({ findOne, insertOne }) });

      const res = await request(app).get('/api/samples/000000000000000000000000/label');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('image/svg+xml');
      const svgText = Buffer.isBuffer(res.body) ? res.body.toString('utf-8') : res.text;
      expect(svgText).toContain('&lt;1&gt;');
      expect(svgText).toContain('&amp;');
      expect(svgText).not.toContain('BC<1>&"\'');
    });

    it('falls back to _id, req.params.id, sampleIdentifier and "AMOSTRA" when sample fields are absent', async () => {
      const { router } = loadRoute();
      const findOne = vi.fn().mockResolvedValue({ _id: { toString: () => 'raw-id' } });
      const insertOne = vi.fn().mockResolvedValue({ insertedId: 'lg1' });
      const app = buildApp(router, { collection: () => ({ findOne, insertOne }) });

      const res = await request(app).get('/api/samples/000000000000000000000000/label');

      expect(res.status).toBe(200);
      const svgText = Buffer.isBuffer(res.body) ? res.body.toString('utf-8') : res.text;
      expect(svgText).toContain('raw-id');
      expect(svgText).toContain('AMOSTRA');
    });

    it('falls back to req.params.id when sample has neither sampleID nor _id', async () => {
      const { router } = loadRoute();
      const findOne = vi.fn().mockResolvedValue({});
      const insertOne = vi.fn().mockResolvedValue({ insertedId: 'lg1' });
      const app = buildApp(router, { collection: () => ({ findOne, insertOne }) });

      const res = await request(app).get('/api/samples/fallback-param-id/label');

      expect(res.status).toBe(200);
      const svgText = Buffer.isBuffer(res.body) ? res.body.toString('utf-8') : res.text;
      expect(svgText).toContain('fallback-param-id');
    });

    it('returns 500 when the collection lookup throws', async () => {
      const { router } = loadRoute();
      const findOne = vi.fn().mockRejectedValue(new Error('db down'));
      const app = buildApp(router, { collection: () => ({ findOne }) });

      const res = await request(app).get('/api/samples/000000000000000000000000/label');

      expect(res.status).toBe(500);
    });

    // #619: mirrors #340's GET /:id out-of-scope 403 for this sub-resource.
    it('returns 403 when the sample exists but is outside the caller\'s organization scope', async () => {
      const findOne = vi.fn().mockResolvedValue({ sampleID: 42, collectionSite: 'org-other' });
      const { router } = loadRoute({
        requireOrganizationScopeImpl: (req, res, next) => {
          req.organizationScope = { scope: 'organization', organizationIds: ['org-mine'] };
          next();
        },
      });
      const app = buildApp(router, { collection: () => ({ findOne }) });

      const res = await request(app).get('/api/samples/000000000000000000000000/label');

      expect(res.status).toBe(403);
    });
  });

  describe('GET /search/by-term', () => {
    it('returns 503 when db is unavailable', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, null);

      const res = await request(app).get('/api/samples/search/by-term').query({ q: 'BC1' });

      expect(res.status).toBe(503);
    });

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
      // #533: currentStatus:'WITHDRAWN' is never written by any backend
      // flow (sample.service.js#withdrawSample sets withdrawnAt, not a
      // currentStatus string) — the old filter never excluded anything.
      expect(find).toHaveBeenCalledWith(
        expect.objectContaining({ withdrawnAt: null })
      );
    });

    it('returns 500 when the collection lookup throws', async () => {
      const { router } = loadRoute();
      const find = vi.fn().mockImplementation(() => {
        throw new Error('db down');
      });
      const app = buildApp(router, { collection: () => ({ find }) });

      const res = await request(app).get('/api/samples/search/by-term').query({ q: 'BC1' });

      expect(res.status).toBe(500);
    });
  });

  describe('GET /by-barcode/:barcode', () => {
    it('returns 503 when db is unavailable', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, null);

      const res = await request(app).get('/api/samples/by-barcode/BC1');

      expect(res.status).toBe(503);
    });

    it('returns 500 when the service throws', async () => {
      const getSampleByBarcode = vi.fn().mockRejectedValue(new Error('boom'));
      const { router } = loadRoute({ sampleServiceOverrides: { getSampleByBarcode } });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples/by-barcode/BC1');

      expect(res.status).toBe(500);
    });

    it('returns 404 and logs a warning when no sample matches the barcode', async () => {
      const getSampleByBarcode = vi.fn().mockResolvedValue({ sample: null });
      const { router, auditLoggerModule } = loadRoute({ sampleServiceOverrides: { getSampleByBarcode } });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples/by-barcode/UNKNOWN');

      expect(res.status).toBe(404);
      expect(auditLoggerModule.log).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'error' })
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
      const getSample = vi.fn().mockResolvedValue(null);
      const { router } = loadRoute({ sampleServiceOverrides: { getSampleMovements, getSample } });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples/s1/movements');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([{ movementID: 'm1' }]);
    });

    it('returns 500 when the service throws', async () => {
      const getSampleMovements = vi.fn().mockRejectedValue(new Error('db down'));
      const getSample = vi.fn().mockResolvedValue(null);
      const { router } = loadRoute({ sampleServiceOverrides: { getSampleMovements, getSample } });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples/s1/movements');

      expect(res.status).toBe(500);
    });

    // #619: mirrors #340's GET /:id out-of-scope 403 for this sub-resource.
    it('returns 403 when the sample exists but is outside the caller\'s organization scope', async () => {
      const getSampleMovements = vi.fn().mockResolvedValue([{ movementID: 'm1' }]);
      const getSample = vi.fn().mockResolvedValue({ _id: 's1', collectionSite: 'org-other' });
      const { router } = loadRoute({
        sampleServiceOverrides: { getSampleMovements, getSample },
        requireOrganizationScopeImpl: (req, res, next) => {
          req.organizationScope = { scope: 'organization', organizationIds: ['org-mine'] };
          next();
        },
      });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples/s1/movements');

      expect(res.status).toBe(403);
      expect(getSampleMovements).not.toHaveBeenCalled();
    });
  });

  describe('GET /:id/rcs-assessments', () => {
    it('returns 503 when db is unavailable', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, null);

      const res = await request(app).get('/api/samples/s1/rcs-assessments');

      expect(res.status).toBe(503);
    });

    it('returns versioned RCS snapshots on success', async () => {
      const getRcsAssessments = vi.fn().mockResolvedValue([{ rcsScore: 92, finalGrade: 'A' }]);
      const getSample = vi.fn().mockResolvedValue(null);
      const { router } = loadRoute({ sampleServiceOverrides: { getRcsAssessments, getSample } });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples/s1/rcs-assessments');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([{ rcsScore: 92, finalGrade: 'A' }]);
      expect(getRcsAssessments).toHaveBeenCalledWith({}, 's1');
    });

    it('returns 500 when the service throws', async () => {
      const getRcsAssessments = vi.fn().mockRejectedValue(new Error('db down'));
      const getSample = vi.fn().mockResolvedValue(null);
      const { router } = loadRoute({ sampleServiceOverrides: { getRcsAssessments, getSample } });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples/s1/rcs-assessments');

      expect(res.status).toBe(500);
    });

    // #619: mirrors #340's GET /:id out-of-scope 403 for this sub-resource.
    it('returns 403 when the sample exists but is outside the caller\'s organization scope', async () => {
      const getRcsAssessments = vi.fn().mockResolvedValue([{ rcsScore: 92, finalGrade: 'A' }]);
      const getSample = vi.fn().mockResolvedValue({ _id: 's1', collectionSite: 'org-other' });
      const { router } = loadRoute({
        sampleServiceOverrides: { getRcsAssessments, getSample },
        requireOrganizationScopeImpl: (req, res, next) => {
          req.organizationScope = { scope: 'organization', organizationIds: ['org-mine'] };
          next();
        },
      });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples/s1/rcs-assessments');

      expect(res.status).toBe(403);
      expect(getRcsAssessments).not.toHaveBeenCalled();
    });
  });

  describe('GET /:id/quarantine-actions', () => {
    it('returns 503 when db is unavailable', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, null);

      const res = await request(app).get('/api/samples/s1/quarantine-actions');

      expect(res.status).toBe(503);
    });

    it('returns versioned quarantine actions on success', async () => {
      const getQuarantineActions = vi.fn().mockResolvedValue([{ quarantineActionId: 'q1', actionStatus: 'active' }]);
      const getSample = vi.fn().mockResolvedValue(null);
      const { router } = loadRoute({ sampleServiceOverrides: { getQuarantineActions, getSample } });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples/s1/quarantine-actions');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([{ quarantineActionId: 'q1', actionStatus: 'active' }]);
      expect(getQuarantineActions).toHaveBeenCalledWith({}, 's1');
    });

    it('returns 500 when the service throws', async () => {
      const getQuarantineActions = vi.fn().mockRejectedValue(new Error('db down'));
      const getSample = vi.fn().mockResolvedValue(null);
      const { router } = loadRoute({ sampleServiceOverrides: { getQuarantineActions, getSample } });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples/s1/quarantine-actions');

      expect(res.status).toBe(500);
    });

    // #619: mirrors #340's GET /:id out-of-scope 403 for this sub-resource.
    it('returns 403 when the sample exists but is outside the caller\'s organization scope', async () => {
      const getQuarantineActions = vi.fn().mockResolvedValue([{ quarantineActionId: 'q1', actionStatus: 'active' }]);
      const getSample = vi.fn().mockResolvedValue({ _id: 's1', collectionSite: 'org-other' });
      const { router } = loadRoute({
        sampleServiceOverrides: { getQuarantineActions, getSample },
        requireOrganizationScopeImpl: (req, res, next) => {
          req.organizationScope = { scope: 'organization', organizationIds: ['org-mine'] };
          next();
        },
      });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples/s1/quarantine-actions');

      expect(res.status).toBe(403);
      expect(getQuarantineActions).not.toHaveBeenCalled();
    });
  });

  describe('GET /:id/sprec-profiles', () => {
    it('returns 503 when db is unavailable', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, null);

      const res = await request(app).get('/api/samples/s1/sprec-profiles');

      expect(res.status).toBe(503);
    });

    it('returns versioned SPREC snapshots on success', async () => {
      const getSprecProfiles = vi.fn().mockResolvedValue([{ matrixType: 'fluid', sampleType: 'BLD' }]);
      const getSample = vi.fn().mockResolvedValue(null);
      const { router } = loadRoute({ sampleServiceOverrides: { getSprecProfiles, getSample } });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples/s1/sprec-profiles');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([{ matrixType: 'fluid', sampleType: 'BLD' }]);
      expect(getSprecProfiles).toHaveBeenCalledWith({}, 's1');
    });

    it('returns 500 when the service throws', async () => {
      const getSprecProfiles = vi.fn().mockRejectedValue(new Error('db down'));
      const getSample = vi.fn().mockResolvedValue(null);
      const { router } = loadRoute({ sampleServiceOverrides: { getSprecProfiles, getSample } });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples/s1/sprec-profiles');

      expect(res.status).toBe(500);
    });

    // #619: mirrors #340's GET /:id out-of-scope 403 for this sub-resource.
    it('returns 403 when the sample exists but is outside the caller\'s organization scope', async () => {
      const getSprecProfiles = vi.fn().mockResolvedValue([{ matrixType: 'fluid', sampleType: 'BLD' }]);
      const getSample = vi.fn().mockResolvedValue({ _id: 's1', collectionSite: 'org-other' });
      const { router } = loadRoute({
        sampleServiceOverrides: { getSprecProfiles, getSample },
        requireOrganizationScopeImpl: (req, res, next) => {
          req.organizationScope = { scope: 'organization', organizationIds: ['org-mine'] };
          next();
        },
      });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples/s1/sprec-profiles');

      expect(res.status).toBe(403);
      expect(getSprecProfiles).not.toHaveBeenCalled();
    });
  });

  describe('GET /:id/miabis-compliance', () => {
    it('returns 200 with the compliance report', async () => {
      const validateMiabisCompliance = vi.fn().mockResolvedValue({ compliant: true, missing: [] });
      const getSample = vi.fn().mockResolvedValue(null);
      const { router } = loadRoute({ validateMiabisCompliance, sampleServiceOverrides: { getSample } });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples/s1/miabis-compliance');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ compliant: true, missing: [] });
      expect(validateMiabisCompliance).toHaveBeenCalledWith('s1', {});
    });

    it('returns 500 when the validator throws', async () => {
      const validateMiabisCompliance = vi.fn().mockRejectedValue(new Error('boom'));
      const getSample = vi.fn().mockResolvedValue(null);
      const { router } = loadRoute({ validateMiabisCompliance, sampleServiceOverrides: { getSample } });
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

    // #624: mirrors #340/#619/#623's out-of-scope 403 pattern.
    it('returns 403 when the sample exists but is outside the caller\'s organization scope', async () => {
      const validateMiabisCompliance = vi.fn();
      const getSample = vi.fn().mockResolvedValue({ _id: 's1', collectionSite: 'org-other' });
      const { router } = loadRoute({
        validateMiabisCompliance,
        sampleServiceOverrides: { getSample },
        requireOrganizationScopeImpl: (req, res, next) => {
          req.organizationScope = { scope: 'organization', organizationIds: ['org-mine'] };
          next();
        },
      });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples/s1/miabis-compliance');

      expect(res.status).toBe(403);
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
      const getSample = vi.fn().mockResolvedValue(null);
      const { router } = loadRoute({ validateSampleCompliance, sampleServiceOverrides: { getSample } });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples/s1/compliance-graph');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: { ok: true } });
    });

    it('returns 400 when the validator throws', async () => {
      const validateSampleCompliance = vi.fn().mockRejectedValue(new Error('bad graph'));
      const getSample = vi.fn().mockResolvedValue(null);
      const { router } = loadRoute({ validateSampleCompliance, sampleServiceOverrides: { getSample } });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples/s1/compliance-graph');

      expect(res.status).toBe(400);
    });

    // #624: mirrors #340/#619/#623's out-of-scope 403 pattern.
    it('returns 403 when the sample exists but is outside the caller\'s organization scope', async () => {
      const validateSampleCompliance = vi.fn();
      const getSample = vi.fn().mockResolvedValue({ _id: 's1', collectionSite: 'org-other' });
      const { router } = loadRoute({
        validateSampleCompliance,
        sampleServiceOverrides: { getSample },
        requireOrganizationScopeImpl: (req, res, next) => {
          req.organizationScope = { scope: 'organization', organizationIds: ['org-mine'] };
          next();
        },
      });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples/s1/compliance-graph');

      expect(res.status).toBe(403);
      expect(validateSampleCompliance).not.toHaveBeenCalled();
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
        samples: [{ participantId: '53117577' }],
        total: 1,
      });
      const { router } = loadRoute({ sampleServiceOverrides: { listSamples } });

      // #847: the patient must carry its own participantId for
      // buildActiveConsentQuery to issue a consent lookup at all.
      const patient = { _id: { toString: () => 'patient-1' }, participantId: '53117577' };
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
        samples: [{ participantId: '53117577' }],
        total: 1,
      });
      const { router } = loadRoute({ sampleServiceOverrides: { listSamples } });

      // #847: the patient must carry its own participantId for
      // buildActiveConsentQuery to issue a consent lookup at all.
      const patient = { _id: { toString: () => 'patient-1' }, participantId: '53117577' };
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

    it('blocks use when the patient cannot be found (fail-closed, matches MongoPatientConsentReadRepository)', async () => {
      const listSamples = vi.fn().mockResolvedValue({
        samples: [{ participantId: '00000000' }],
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
        expect.objectContaining({ consentValid: false, consentMessage: 'Paciente não encontrado', canUse: false })
      );
    });

    // #788: the consent badge was computed from `sample.patientID`. No writer
    // sets that field -- Sample.js:31 declares `participantId`, and both
    // RegisterSample.js and import-lgpd.service.js write only that. Patient.js's
    // CANONICAL_FIELDS has no `patientID` either, so BOTH legs of the old
    // `$or` were dead. `undefined` serialises to null, so the query degenerated
    // to `{ patientID: null }`, which matches every patient document -- findOne
    // then returned an arbitrary one and every sample was badged from that
    // unrelated patient's consent record (confirmed against the Docker stack:
    // 7/7 patients lacked `patientID`; a sample for participant 53117577 was
    // badged from patient 64404470).
    //
    // Every consent fixture above resolves `patientsCollection.findOne` to a
    // fixed value regardless of the filter it is handed, so the broken query
    // was structurally invisible to them. These two use a stub that actually
    // matches, against patient documents shaped like the real ones.
    it('resolves the consent badge from the sample own participant, not an arbitrary patient (#788)', async () => {
      const listSamples = vi.fn().mockResolvedValue({
        samples: [{ _id: 'sample-1', participantId: '53117577' }],
        total: 1,
      });
      const { router } = loadRoute({ sampleServiceOverrides: { listSamples } });

      // Deliberately ordered so an unfiltered/degenerate query finds the WRONG
      // patient first -- which is what the live database does.
      const patientsCollection = createMatchingCollection([
        { _id: 'patient-unrelated', participantId: '64404470' },
        { _id: 'patient-real', participantId: '53117577' },
      ]);
      // #847: every writer of the `consents` collection emits `participantId`
      // (PatientConsent.js:63, consent.service.js:901/918, RegisterSample.js:128,
      // intakeWizard.js:523) -- never `patientId`. Seeded with the real field
      // name, not the dead one buildActiveConsentQuery used to query on.
      const consentsCollection = createMatchingCollection([
        { participantId: '53117577', status: 'ACTIVE' },
      ]);
      const db = {
        collection: (name) => (name === 'patients' ? patientsCollection : consentsCollection),
      };
      const app = buildApp(router, db);

      const res = await request(app).get('/api/samples');

      expect(res.status).toBe(200);
      expect(res.body.data[0]).toEqual(
        expect.objectContaining({
          consentValid: true,
          consentMessage: 'TCLE Assinado',
          canUse: true,
          consentReasonCode: null,
        })
      );
      // The identifier actually queried must be the sample's own.
      expect(JSON.stringify(patientsCollection.findOne.mock.calls[0][0])).toContain('53117577');
      // #847: the consent lookup itself must filter on the patient's
      // participantId, not a dead `patientId` key nor the patient's _id.
      expect(consentsCollection.findOne.mock.calls[0][0]).toEqual({
        participantId: '53117577',
        status: 'ACTIVE',
      });
    });

    it('fails closed when a sample carries no participant identifier, instead of matching an arbitrary patient (#788)', async () => {
      const listSamples = vi.fn().mockResolvedValue({
        samples: [{ _id: 'sample-2' }],
        total: 1,
      });
      const { router } = loadRoute({ sampleServiceOverrides: { listSamples } });

      // This patient HAS an active consent. A degenerate `{ field: null }`
      // filter matches it, which would badge an unidentified specimen as
      // usable -- asserting a consent that does not exist for it.
      const patientsCollection = createMatchingCollection([
        { _id: 'patient-unrelated', participantId: '64404470' },
      ]);
      const consentsCollection = createMatchingCollection([
        { patientId: 'patient-unrelated', status: 'ACTIVE' },
      ]);
      const db = {
        collection: (name) => (name === 'patients' ? patientsCollection : consentsCollection),
      };
      const app = buildApp(router, db);

      const res = await request(app).get('/api/samples');

      expect(res.status).toBe(200);
      expect(res.body.data[0]).toEqual(
        expect.objectContaining({
          consentValid: false,
          canUse: false,
          consentReasonCode: 'PATIENT_NOT_FOUND',
        })
      );
    });

    // #847: buildActiveConsentQuery(patient) built its filter from
    // `patient.patientID` (a field no writer of Patient.js sets) and
    // `patient._id.toString()` (an ObjectId string, never what `consents`
    // documents store their participant under). The fix queries on the
    // patient's own `participantId` instead, and must refuse to query at
    // all when that is absent -- an absent id must never degrade into a
    // match-anything filter, which was #788's original failure mode.
    it('does not query consents when a matched patient record carries no participantId of its own (#847)', async () => {
      const listSamples = vi.fn().mockResolvedValue({
        samples: [{ _id: 'sample-3', participantId: '53117577' }],
        total: 1,
      });
      const { router } = loadRoute({ sampleServiceOverrides: { listSamples } });

      // The patient IS found (by the sample's own participantId, per the
      // #788 guard), but the patient record itself has no participantId
      // field -- only an ObjectId-shaped _id, which the old code fell back
      // to and which must not be queried against `consents` at all.
      const patient = { _id: { toString: () => 'patient-no-participant-id' } };
      const patientsCollection = { findOne: vi.fn().mockResolvedValue(patient) };
      const consentsCollection = { findOne: vi.fn(), countDocuments: vi.fn() };
      const db = {
        collection: (name) => (name === 'patients' ? patientsCollection : consentsCollection),
      };
      const app = buildApp(router, db);

      const res = await request(app).get('/api/samples');

      expect(res.status).toBe(200);
      expect(consentsCollection.findOne).not.toHaveBeenCalled();
      expect(res.body.data[0]).toEqual(
        expect.objectContaining({
          consentValid: false,
          canUse: false,
          consentReasonCode: 'NO_ACTIVE_CONSENT',
        })
      );
    });

    it('returns 500 when listSamples throws', async () => {
      const listSamples = vi.fn().mockRejectedValue(new Error('db down'));
      const { router } = loadRoute({ sampleServiceOverrides: { listSamples } });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples');

      expect(res.status).toBe(500);
    });

    it('embeds resolvedStorageLocation and currentSpecimenPreanalytics per sample, batched (#517)', async () => {
      const boxId = 'box-1';
      const listSamples = vi.fn().mockResolvedValue({
        samples: [{
          _id: 'sample-1',
          participantId: '53117577',
          specimenId: 'SPEC-1',
          storageLocation: { boxId, boxName: 'Box A', position: 'A1' },
        }],
        total: 1,
      });
      const { router } = loadRoute({ sampleServiceOverrides: { listSamples } });

      const patientsCollection = { findOne: vi.fn().mockResolvedValue(null) };
      const patientConsentsCollection = { findOne: vi.fn(), countDocuments: vi.fn() };
      const storagePathsFind = vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { boxId, path: 'Freezer1/Shelf1/Rack1/BoxA', freezerId: 'F1', shelfId: 'S1', rackId: 'R1' },
        ]),
      });
      const storagePathsCollection = { find: storagePathsFind };
      const specimenPreanalyticsFind = vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([
          { _id: 'profile-1', specimenId: 'SPEC-1', matrixType: 'fluid', recordedAt: new Date('2026-06-01') },
        ]),
      });
      const specimenPreanalyticsCollection = { find: specimenPreanalyticsFind };
      const collectionsByName = {
        patients: patientsCollection,
        patientConsents: patientConsentsCollection,
        storagePaths: storagePathsCollection,
        specimenPreanalytics: specimenPreanalyticsCollection,
      };
      const db = { collection: (name) => collectionsByName[name] };
      const app = buildApp(router, db);

      const res = await request(app).get('/api/samples');

      expect(res.status).toBe(200);
      expect(storagePathsFind).toHaveBeenCalledTimes(1);
      expect(specimenPreanalyticsFind).toHaveBeenCalledTimes(1);
      expect(res.body.data[0].resolvedStorageLocation).toEqual(
        expect.objectContaining({ path: 'Freezer1/Shelf1/Rack1/BoxA' })
      );
      expect(res.body.data[0].currentSpecimenPreanalytics).toEqual(
        expect.objectContaining({ specimenId: 'SPEC-1', matrixType: 'fluid' })
      );
    });

    it('maps resolvedStorageLocation/currentSpecimenPreanalytics to null when a sample has no location or profile', async () => {
      const listSamples = vi.fn().mockResolvedValue({
        samples: [{ _id: 'sample-2', participantId: '53117577', specimenId: 'SPEC-2' }],
        total: 1,
      });
      const { router } = loadRoute({ sampleServiceOverrides: { listSamples } });

      const patientsCollection = { findOne: vi.fn().mockResolvedValue(null) };
      const patientConsentsCollection = { findOne: vi.fn(), countDocuments: vi.fn() };
      const storagePathsCollection = { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) };
      const specimenPreanalyticsCollection = {
        find: vi.fn().mockReturnValue({ sort: vi.fn().mockReturnThis(), toArray: vi.fn().mockResolvedValue([]) }),
      };
      const collectionsByName = {
        patients: patientsCollection,
        patientConsents: patientConsentsCollection,
        storagePaths: storagePathsCollection,
        specimenPreanalytics: specimenPreanalyticsCollection,
      };
      const db = { collection: (name) => collectionsByName[name] };
      const app = buildApp(router, db);

      const res = await request(app).get('/api/samples');

      expect(res.status).toBe(200);
      expect(res.body.data[0].resolvedStorageLocation).toBeNull();
      expect(res.body.data[0].currentSpecimenPreanalytics).toBeNull();
    });

    // #340 (RF003 AC#3): org-scope enforcement gate — requireOrganizationScope
    // runs before the handler and its resolved scope flows into listSamples'
    // filters.
    it('returns 403 when requireOrganizationScope denies (org-less caller)', async () => {
      const listSamples = vi.fn();
      const { router } = loadRoute({
        sampleServiceOverrides: { listSamples },
        requireOrganizationScopeImpl: (req, res) => res.status(403).json({ success: false, error: 'Sem organização atribuída' }),
      });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples');

      expect(res.status).toBe(403);
      expect(listSamples).not.toHaveBeenCalled();
    });

    it('passes req.organizationScope through to listSamples filters', async () => {
      const listSamples = vi.fn().mockResolvedValue({ samples: [], total: 0 });
      const organizationScope = { scope: 'organization', organizationIds: ['org-1'] };
      const { router } = loadRoute({
        sampleServiceOverrides: { listSamples },
        requireOrganizationScopeImpl: (req, res, next) => { req.organizationScope = organizationScope; next(); },
      });
      const emptyCollection = { findOne: vi.fn().mockResolvedValue(null), countDocuments: vi.fn().mockResolvedValue(0) };
      const db = { collection: () => emptyCollection };
      const app = buildApp(router, db);

      const res = await request(app).get('/api/samples');

      expect(res.status).toBe(200);
      expect(listSamples).toHaveBeenCalledWith(db, expect.objectContaining({ organizationScope }));
    });

    // #785: the route built "patientID: req.query.patientID" while
    // listSamples only ever reads filters.participantId, so the filter was
    // dropped in flight and the caller got an unfiltered page with a 200.
    // participantId is the canonical name (Sample.js:31); patientID is the
    // pre-rename alias validateCreateSamplePayload rejects with a 422
    // NON_CANONICAL_FIELD, so it is deliberately not accepted as an alias here.
    it('passes the canonical participantId query filter through to listSamples', async () => {
      const listSamples = vi.fn().mockResolvedValue({ samples: [], total: 0 });
      const { router } = loadRoute({ sampleServiceOverrides: { listSamples } });
      const emptyCollection = { findOne: vi.fn().mockResolvedValue(null), countDocuments: vi.fn().mockResolvedValue(0) };
      const db = { collection: () => emptyCollection };
      const app = buildApp(router, db);

      const res = await request(app).get('/api/samples?participantId=12345678');

      expect(res.status).toBe(200);
      expect(listSamples).toHaveBeenCalledWith(db, expect.objectContaining({ participantId: '12345678' }));
    });
  });

  // #646 Wave 3 (RF016 AC#4): batch label generation given a list of
  // specimen identifiers.
  describe('POST /labels/batch', () => {
    function statefulDb({ samples = [], organizationScope } = {}) {
      const labelGenerations = { docs: [], findOne: null, insertOne: null };
      labelGenerations.findOne = vi.fn(async (query) => labelGenerations.docs.find((d) => d.specimenId === query.specimenId) || null);
      labelGenerations.insertOne = vi.fn(async (doc) => { labelGenerations.docs.push(doc); return { insertedId: 'lg-' + labelGenerations.docs.length }; });

      const samplesCollection = { findOne: vi.fn(async (query) => samples.find((s) => query.$or.some((cond) => Object.entries(cond).every(([k, v]) => String(s[k]) === String(v)))) || null) };

      return {
        db: { collection: (name) => (name === 'labelGenerations' ? labelGenerations : samplesCollection) },
        labelGenerations,
      };
    }

    it('returns 400 when specimenIds is missing or empty', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, {});

      const res = await request(app).post('/api/samples/labels/batch').send({});
      expect(res.status).toBe(400);

      const res2 = await request(app).post('/api/samples/labels/batch').send({ specimenIds: [] });
      expect(res2.status).toBe(400);
    });

    it('generates labels for every resolvable specimen, reporting per-id success and totals', async () => {
      const getBarcodeIndustrialAssets = vi.fn(async (barcode) => ({
        canonicalValue: barcode,
        code128: { payload: barcode },
        dataMatrix: { payload: barcode },
        qr: { payload: barcode },
      }));
      const { router } = loadRoute({ sampleServiceOverrides: { getBarcodeIndustrialAssets } });
      const { db, labelGenerations } = statefulDb({
        samples: [
          { _id: 's1', sampleID: 's1', barcode: 'BC-1' },
          { _id: 's2', sampleID: 's2', barcode: 'BC-2' },
        ],
      });
      const app = buildApp(router, db);

      const res = await request(app).post('/api/samples/labels/batch').send({ specimenIds: ['s1', 's2'] });

      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(2);
      expect(res.body.data.generated).toBe(2);
      expect(res.body.data.failed).toBe(0);
      expect(res.body.data.results).toEqual([
        expect.objectContaining({ specimenId: 's1', success: true, barcode: 'BC-1', reprint: false }),
        expect.objectContaining({ specimenId: 's2', success: true, barcode: 'BC-2', reprint: false }),
      ]);
      expect(labelGenerations.insertOne).toHaveBeenCalledTimes(2);
    });

    it('marks a second generation for the same specimen as a reprint', async () => {
      const getBarcodeIndustrialAssets = vi.fn(async (barcode) => ({
        canonicalValue: barcode, code128: {}, dataMatrix: {}, qr: {},
      }));
      const { router } = loadRoute({ sampleServiceOverrides: { getBarcodeIndustrialAssets } });
      const { db } = statefulDb({ samples: [{ _id: 's1', sampleID: 's1', barcode: 'BC-1' }] });
      const app = buildApp(router, db);

      const first = await request(app).post('/api/samples/labels/batch').send({ specimenIds: ['s1'] });
      expect(first.body.data.results[0].reprint).toBe(false);

      const second = await request(app).post('/api/samples/labels/batch').send({ specimenIds: ['s1'] });
      expect(second.body.data.results[0].reprint).toBe(true);
    });

    it('reports a per-id failure (not found) without failing the whole batch', async () => {
      const getBarcodeIndustrialAssets = vi.fn(async (barcode) => ({
        canonicalValue: barcode, code128: {}, dataMatrix: {}, qr: {},
      }));
      const { router } = loadRoute({ sampleServiceOverrides: { getBarcodeIndustrialAssets } });
      const { db } = statefulDb({ samples: [{ _id: 's1', sampleID: 's1', barcode: 'BC-1' }] });
      const app = buildApp(router, db);

      const res = await request(app).post('/api/samples/labels/batch').send({ specimenIds: ['s1', 'missing'] });

      expect(res.status).toBe(200);
      expect(res.body.data.generated).toBe(1);
      expect(res.body.data.failed).toBe(1);
      expect(res.body.data.results[1]).toEqual(
        expect.objectContaining({ specimenId: 'missing', success: false, error: 'Amostra não encontrada' })
      );
    });

    it('reports a per-id 403 when a specimen is outside the caller\'s organization scope, without failing the whole batch', async () => {
      const getBarcodeIndustrialAssets = vi.fn(async (barcode) => ({
        canonicalValue: barcode, code128: {}, dataMatrix: {}, qr: {},
      }));
      const { router } = loadRoute({
        sampleServiceOverrides: { getBarcodeIndustrialAssets },
        requireOrganizationScopeImpl: (req, res, next) => {
          req.organizationScope = { scope: 'organization', organizationIds: ['org-1'] };
          next();
        },
      });
      const { db } = statefulDb({
        samples: [{ _id: 's1', sampleID: 's1', barcode: 'BC-1', collectionSite: 'org-9' }],
      });
      const app = buildApp(router, db);

      const res = await request(app).post('/api/samples/labels/batch').send({ specimenIds: ['s1'] });

      expect(res.status).toBe(200);
      expect(res.body.data.failed).toBe(1);
      expect(res.body.data.results[0]).toEqual(
        expect.objectContaining({ specimenId: 's1', success: false, status: 403 })
      );
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
      expect(auditLoggerModule.log).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
    });

    it('returns 200 with the sample', async () => {
      const getSample = vi.fn().mockResolvedValue({ _id: '1', patientID: 'P1' });
      const { router } = loadRoute({ sampleServiceOverrides: { getSample } });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples/000000000000000000000000');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ _id: '1', patientID: 'P1' });
    });

    // #340: an existing sample outside the caller's organization scope
    // 403s rather than 404s, matching sample-file.controller.js's
    // out-of-scope precedent.
    it('returns 403 when the sample belongs to a different organization', async () => {
      const getSample = vi.fn().mockResolvedValue({ _id: '1', collectionSite: 'org-9' });
      const { router } = loadRoute({
        sampleServiceOverrides: { getSample },
        requireOrganizationScopeImpl: (req, res, next) => { req.organizationScope = { scope: 'organization', organizationIds: ['org-1'] }; next(); },
      });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples/000000000000000000000000');

      expect(res.status).toBe(403);
    });

    it('returns 200 when the sample belongs to one of the scoped organizations', async () => {
      const getSample = vi.fn().mockResolvedValue({ _id: '1', collectionSite: 'org-1' });
      const { router } = loadRoute({
        sampleServiceOverrides: { getSample },
        requireOrganizationScopeImpl: (req, res, next) => { req.organizationScope = { scope: 'organization', organizationIds: ['org-1'] }; next(); },
      });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples/000000000000000000000000');

      expect(res.status).toBe(200);
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
      const getSample = vi.fn().mockResolvedValue(null);
      const { router } = loadRoute({ sampleServiceOverrides: { updateSample, getSample } });
      const app = buildApp(router, {});

      const res = await request(app).put('/api/samples/000000000000000000000000').send({ quantity: 1 });

      expect(res.status).toBe(404);
    });

    it('returns 200 and logs the update on success', async () => {
      const updateSample = vi.fn().mockResolvedValue({ _id: '1', quantity: 1 });
      const getSample = vi.fn().mockResolvedValue(null);
      const { router, auditLoggerModule } = loadRoute({ sampleServiceOverrides: { updateSample, getSample } });
      const app = buildApp(router, {});

      const res = await request(app).put('/api/samples/000000000000000000000000').send({ quantity: 1 });

      expect(res.status).toBe(200);
      expect(auditLoggerModule.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'UPDATE' }));
    });

    it('returns 400 when the service throws', async () => {
      const updateSample = vi.fn().mockRejectedValue(new Error('invalid'));
      const getSample = vi.fn().mockResolvedValue(null);
      const { router } = loadRoute({ sampleServiceOverrides: { updateSample, getSample } });
      const app = buildApp(router, {});

      const res = await request(app).put('/api/samples/000000000000000000000000').send({ quantity: 1 });

      expect(res.status).toBe(400);
    });

    it('logs a sample_release audit entry when consentStatus is SIGNED', async () => {
      const updateSample = vi.fn().mockResolvedValue({ _id: '1', consentStatus: 'SIGNED' });
      const getSample = vi.fn().mockResolvedValue(null);
      const { router, auditLoggerModule } = loadRoute({ sampleServiceOverrides: { updateSample, getSample } });
      const app = buildApp(router, {});

      const res = await request(app)
        .put('/api/samples/000000000000000000000000')
        .send({ consentStatus: 'SIGNED', quarantineReason: 'ethics cleared' });

      expect(res.status).toBe(200);
      expect(auditLoggerModule.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'sample_release',
          payload: expect.objectContaining({ consentStatus: 'SIGNED', quarantineReason: 'ethics cleared' }),
        })
      );
    });

    it('logs a sample_release audit entry when specimenStatus is available (case-insensitive)', async () => {
      const updateSample = vi.fn().mockResolvedValue({ _id: '1' });
      const getSample = vi.fn().mockResolvedValue(null);
      const { router, auditLoggerModule } = loadRoute({ sampleServiceOverrides: { updateSample, getSample } });
      const app = buildApp(router, {});

      const res = await request(app)
        .put('/api/samples/000000000000000000000000')
        .send({ specimenStatus: 'Available' });

      expect(res.status).toBe(200);
      expect(auditLoggerModule.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'sample_release' })
      );
    });

    it('logs a sample_release audit entry when specimenStatus is available, with null payload fallbacks', async () => {
      const updateSample = vi.fn().mockResolvedValue({ _id: '1' });
      const getSample = vi.fn().mockResolvedValue(null);
      const { router, auditLoggerModule } = loadRoute({ sampleServiceOverrides: { updateSample, getSample } });
      const app = buildApp(router, {});

      const res = await request(app)
        .put('/api/samples/000000000000000000000000')
        .send({ specimenStatus: 'available' });

      expect(res.status).toBe(200);
      expect(auditLoggerModule.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'sample_release',
          payload: expect.objectContaining({ consentStatus: null, quarantineReason: null }),
        })
      );
    });

    // #623: mirrors #340/#619's out-of-scope 403 pattern for this mutation route.
    it('returns 403 when the sample exists but is outside the caller\'s organization scope', async () => {
      const updateSample = vi.fn();
      const getSample = vi.fn().mockResolvedValue({ _id: '1', collectionSite: 'org-other' });
      const { router } = loadRoute({
        sampleServiceOverrides: { updateSample, getSample },
        requireOrganizationScopeImpl: (req, res, next) => {
          req.organizationScope = { scope: 'organization', organizationIds: ['org-mine'] };
          next();
        },
      });
      const app = buildApp(router, {});

      const res = await request(app).put('/api/samples/000000000000000000000000').send({ quantity: 1 });

      expect(res.status).toBe(403);
      expect(updateSample).not.toHaveBeenCalled();
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
      const getSample = vi.fn().mockResolvedValue(null);
      const { router } = loadRoute({ sampleServiceOverrides: { deleteSample, getSample } });
      const app = buildApp(router, {});

      const res = await request(app).delete('/api/samples/000000000000000000000000');

      expect(res.status).toBe(404);
    });

    it('returns 200 and logs the deletion on success', async () => {
      const deleteSample = vi.fn().mockResolvedValue(true);
      const getSample = vi.fn().mockResolvedValue(null);
      const { router, auditLoggerModule } = loadRoute({ sampleServiceOverrides: { deleteSample, getSample } });
      const app = buildApp(router, {});

      const res = await request(app).delete('/api/samples/000000000000000000000000');

      expect(res.status).toBe(200);
      expect(auditLoggerModule.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'DELETE' }));
    });

    it('returns 400 when the service throws', async () => {
      const deleteSample = vi.fn().mockRejectedValue(new Error('cannot delete'));
      const getSample = vi.fn().mockResolvedValue(null);
      const { router } = loadRoute({ sampleServiceOverrides: { deleteSample, getSample } });
      const app = buildApp(router, {});

      const res = await request(app).delete('/api/samples/000000000000000000000000');

      expect(res.status).toBe(400);
    });

    // #623: mirrors #340/#619's out-of-scope 403 pattern for this mutation route.
    it('returns 403 when the sample exists but is outside the caller\'s organization scope', async () => {
      const deleteSample = vi.fn();
      const getSample = vi.fn().mockResolvedValue({ _id: '1', collectionSite: 'org-other' });
      const { router } = loadRoute({
        sampleServiceOverrides: { deleteSample, getSample },
        requireOrganizationScopeImpl: (req, res, next) => {
          req.organizationScope = { scope: 'organization', organizationIds: ['org-mine'] };
          next();
        },
      });
      const app = buildApp(router, {});

      const res = await request(app).delete('/api/samples/000000000000000000000000');

      expect(res.status).toBe(403);
      expect(deleteSample).not.toHaveBeenCalled();
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
      const getSample = vi.fn().mockResolvedValue(null);
      const { router, auditLoggerModule } = loadRoute({ sampleServiceOverrides: { withdrawSample, getSample } });
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
      const getSample = vi.fn().mockResolvedValue(null);
      const { router } = loadRoute({ consentValidatorValidateAccess, sampleServiceOverrides: { getSample } });
      const app = buildApp(router, {});

      const res = await request(app).post('/api/samples/000000000000000000000000/withdraw').send({});

      expect(res.status).toBe(400);
    });

    it('resolves the audit actor from _id/username/role and the x-forwarded-for header, with a req.t fallback message', async () => {
      const withdrawSample = vi.fn().mockResolvedValue({ withdrawnQuantity: 1, remainingQuantity: 1, movementID: 'm3' });
      const getSample = vi.fn().mockResolvedValue(null);
      const authImpl = (req, res, next) => {
        req.user = { _id: { toString: () => 'u9' }, username: 'alt-user', role: 'Coordenador' };
        req.t = () => undefined;
        next();
      };
      const { router } = loadRoute({ sampleServiceOverrides: { withdrawSample, getSample }, authImpl });
      const app = buildApp(router, {}, { stripReqIp: true });

      const res = await request(app)
        .post('/api/samples/000000000000000000000000/withdraw')
        .set('x-forwarded-for', '198.51.100.7')
        .send({ withdrawalType: 'DISPOSAL', withdrawalResponsible: 'Dr. X' });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Retirada registrada com sucesso');
      expect(withdrawSample).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ userId: 'u9', userName: 'alt-user', userRole: 'Coordenador', ipAddress: '198.51.100.7' })
      );
    });

    it('falls back to req.connection.remoteAddress when req.ip and the x-forwarded-for header are both unavailable', async () => {
      const withdrawSample = vi.fn().mockResolvedValue({ withdrawnQuantity: 1, remainingQuantity: 1, movementID: 'm5' });
      const getSample = vi.fn().mockResolvedValue(null);
      const { router } = loadRoute({ sampleServiceOverrides: { withdrawSample, getSample } });
      const app = buildApp(router, {}, { stripReqIp: true });

      await request(app)
        .post('/api/samples/000000000000000000000000/withdraw')
        .send({ withdrawalType: 'DISPOSAL', withdrawalResponsible: 'Dr. X' });

      const auditInfo = withdrawSample.mock.calls[0][3];
      expect(auditInfo.ipAddress).toBeTruthy();
    });

    // #623: mirrors #340/#619's out-of-scope 403 pattern for this mutation route.
    it('returns 403 when the sample exists but is outside the caller\'s organization scope', async () => {
      const withdrawSample = vi.fn();
      const getSample = vi.fn().mockResolvedValue({ _id: '1', collectionSite: 'org-other' });
      const { router } = loadRoute({
        sampleServiceOverrides: { withdrawSample, getSample },
        requireOrganizationScopeImpl: (req, res, next) => {
          req.organizationScope = { scope: 'organization', organizationIds: ['org-mine'] };
          next();
        },
      });
      const app = buildApp(router, {});

      const res = await request(app).post('/api/samples/000000000000000000000000/withdraw').send({});

      expect(res.status).toBe(403);
      expect(withdrawSample).not.toHaveBeenCalled();
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
      const getSample = vi.fn().mockResolvedValue(null);
      const { router, auditLoggerModule } = loadRoute({ sampleServiceOverrides: { returnSample, getSample } });
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
      const getSample = vi.fn().mockResolvedValue(null);
      const { router } = loadRoute({ sampleServiceOverrides: { returnSample, getSample } });
      const app = buildApp(router, {});

      const res = await request(app).post('/api/samples/000000000000000000000000/return').send({});

      expect(res.status).toBe(400);
    });

    it('resolves the audit actor role from req.user.role and the x-forwarded-for header, with a req.t fallback message', async () => {
      const returnSample = vi.fn().mockResolvedValue({ returnedQuantity: 1, condition: 'OK', newAvailableQuantity: 1, movementID: 'm4' });
      const getSample = vi.fn().mockResolvedValue(null);
      const authImpl = (req, res, next) => {
        req.user = { id: 'u1', name: 'Tester', role: 'Coordenador' };
        req.t = () => undefined;
        next();
      };
      const { router } = loadRoute({ sampleServiceOverrides: { returnSample, getSample }, authImpl });
      const app = buildApp(router, {}, { stripReqIp: true });

      const res = await request(app)
        .post('/api/samples/000000000000000000000000/return')
        .set('x-forwarded-for', '198.51.100.9')
        .send({ returnResponsible: 'Dr. Y' });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Devolução registrada com sucesso');
      expect(returnSample).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ userRole: 'Coordenador', ipAddress: '198.51.100.9' })
      );
    });

    it('falls back to req.connection.remoteAddress when req.ip and the x-forwarded-for header are both unavailable', async () => {
      const returnSample = vi.fn().mockResolvedValue({ returnedQuantity: 1, condition: 'OK', newAvailableQuantity: 1, movementID: 'm6' });
      const getSample = vi.fn().mockResolvedValue(null);
      const { router } = loadRoute({ sampleServiceOverrides: { returnSample, getSample } });
      const app = buildApp(router, {}, { stripReqIp: true });

      await request(app)
        .post('/api/samples/000000000000000000000000/return')
        .send({ returnResponsible: 'Dr. Y' });

      const auditInfo = returnSample.mock.calls[0][3];
      expect(auditInfo.ipAddress).toBeTruthy();
    });

    // #623: mirrors #340/#619's out-of-scope 403 pattern for this mutation route.
    it('returns 403 when the sample exists but is outside the caller\'s organization scope', async () => {
      const returnSample = vi.fn();
      const getSample = vi.fn().mockResolvedValue({ _id: '1', collectionSite: 'org-other' });
      const { router } = loadRoute({
        sampleServiceOverrides: { returnSample, getSample },
        requireOrganizationScopeImpl: (req, res, next) => {
          req.organizationScope = { scope: 'organization', organizationIds: ['org-mine'] };
          next();
        },
      });
      const app = buildApp(router, {});

      const res = await request(app).post('/api/samples/000000000000000000000000/return').send({});

      expect(res.status).toBe(403);
      expect(returnSample).not.toHaveBeenCalled();
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
      const getSample = vi.fn().mockResolvedValue(null);
      const { router, auditLoggerModule } = loadRoute({ sampleServiceOverrides: { getSampleResults, getSample } });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples/000000000000000000000000/results');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([{ fileID: 'f1' }]);
      expect(auditLoggerModule.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'QUERY' }));
    });

    it('returns 500 when the service throws', async () => {
      const getSampleResults = vi.fn().mockRejectedValue(new Error('boom'));
      const getSample = vi.fn().mockResolvedValue(null);
      const { router } = loadRoute({ sampleServiceOverrides: { getSampleResults, getSample } });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples/000000000000000000000000/results');

      expect(res.status).toBe(500);
    });

    // #619: mirrors #340's GET /:id out-of-scope 403 for this sub-resource.
    it('returns 403 when the sample exists but is outside the caller\'s organization scope', async () => {
      const getSampleResults = vi.fn().mockResolvedValue([{ fileID: 'f1' }]);
      const getSample = vi.fn().mockResolvedValue({ _id: 's1', collectionSite: 'org-other' });
      const { router } = loadRoute({
        sampleServiceOverrides: { getSampleResults, getSample },
        requireOrganizationScopeImpl: (req, res, next) => {
          req.organizationScope = { scope: 'organization', organizationIds: ['org-mine'] };
          next();
        },
      });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples/000000000000000000000000/results');

      expect(res.status).toBe(403);
      expect(getSampleResults).not.toHaveBeenCalled();
    });
  });

  describe('GET /by-barcode/:barcode/symbology-assets', () => {
    it('returns 503 when db is unavailable', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, null);

      const res = await request(app).get('/api/samples/by-barcode/BC1/symbology-assets');

      expect(res.status).toBe(503);
    });

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
        qr: 'qrData',
      });
      const { router } = loadRoute({
        sampleServiceOverrides: { getSampleByBarcode, getBarcodeIndustrialAssets },
      });
      // #646 Wave 3 (RF016 AC#6): recordLabelGeneration reads/writes
      // labelGenerations -- no prior entry for 's1', so this call is a
      // first generation (reprint: false).
      const labelGenerations = { findOne: vi.fn().mockResolvedValue(null), insertOne: vi.fn().mockResolvedValue({ insertedId: 'lg1' }) };
      const app = buildApp(router, { collection: (name) => (name === 'labelGenerations' ? labelGenerations : {}) });

      const res = await request(app).get('/api/samples/by-barcode/BC1/symbology-assets');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(
        expect.objectContaining({ barcode: 'BC1', includePayload: false, code128: 'code128data', qr: 'qrData', reprint: false })
      );
      expect(getBarcodeIndustrialAssets).toHaveBeenCalledWith('BC1', { includePayload: false });
      expect(labelGenerations.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({ specimenId: 's1', formats: ['code128', 'dataMatrix', 'qr'], reprint: false })
      );
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

    // #653/#655: this route had no requireOrganizationScope/
    // isRecordInOrganizationScope check at all, unlike every other sample
    // sub-resource route in this file (mirrors #619's GET /:id/label test).
    it('returns 403 when the sample exists but is outside the caller\'s organization scope', async () => {
      const getSampleByBarcode = vi.fn().mockResolvedValue({
        sample: { _id: 's1', collectionSite: 'org-other' },
      });
      const { router } = loadRoute({
        sampleServiceOverrides: { getSampleByBarcode },
        requireOrganizationScopeImpl: (req, res, next) => {
          req.organizationScope = { scope: 'organization', organizationIds: ['org-mine'] };
          next();
        },
      });
      const app = buildApp(router, {});

      const res = await request(app).get('/api/samples/by-barcode/BC1/symbology-assets');

      expect(res.status).toBe(403);
    });
  });

  describe('GET /:id/label/print-job', () => {
    it('returns 503 when db is unavailable', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, null);

      const res = await request(app).get('/api/samples/000000000000000000000000/label/print-job');

      expect(res.status).toBe(503);
    });

    it('returns 404 when the sample cannot be found', async () => {
      const { router } = loadRoute();
      const findOne = vi.fn().mockResolvedValue(null);
      const app = buildApp(router, { collection: () => ({ findOne }) });

      const res = await request(app).get('/api/samples/000000000000000000000000/label/print-job');

      expect(res.status).toBe(404);
    });

    it('returns 403 when the sample exists but is outside the caller\'s organization scope', async () => {
      const findOne = vi.fn().mockResolvedValue({ sampleID: 42, barcode: 'BC1', collectionSite: 'org-other' });
      const { router } = loadRoute({
        requireOrganizationScopeImpl: (req, res, next) => {
          req.organizationScope = { scope: 'organization', organizationIds: ['org-mine'] };
          next();
        },
      });
      const app = buildApp(router, { collection: () => ({ findOne }) });

      const res = await request(app).get('/api/samples/000000000000000000000000/label/print-job');

      expect(res.status).toBe(403);
    });

    it('returns 409 when the sample has no barcode generated yet', async () => {
      const { router } = loadRoute();
      const findOne = vi.fn().mockResolvedValue({ sampleID: 42 });
      const app = buildApp(router, { collection: () => ({ findOne }) });

      const res = await request(app).get('/api/samples/000000000000000000000000/label/print-job');

      expect(res.status).toBe(409);
    });

    it('returns ZPL with the barcode drawn via ^BC and audits the generation', async () => {
      const { router } = loadRoute();
      const findOne = vi.fn().mockResolvedValue({
        sampleID: 42,
        barcode: 'BC1',
        storageLocation: { boxName: 'Box A', position: 'A1' },
      });
      const labelGenerations = { findOne: vi.fn().mockResolvedValue(null), insertOne: vi.fn().mockResolvedValue({ insertedId: 'lg1' }) };
      const app = buildApp(router, {
        collection: (name) => (name === 'labelGenerations' ? labelGenerations : { findOne }),
      });

      const res = await request(app).get('/api/samples/000000000000000000000000/label/print-job');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(
        expect.objectContaining({
          sampleId: '42',
          barcode: 'BC1',
          format: 'zpl',
          printerLanguage: 'ZPL',
          location: 'Box Box A / Pos A1',
          reprint: false,
        })
      );
      expect(res.body.data.zpl).toContain('^BCN,80,Y,N,N^FDBC1^FS');
      expect(labelGenerations.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({ specimenId: expect.any(String), formats: ['zpl'], reprint: false })
      );
    });

    it('escapes ^ and ~ out of ZPL field data and omits the location line when absent', async () => {
      const { router } = loadRoute();
      const findOne = vi.fn().mockResolvedValue({ sampleID: 42, barcode: 'BC^1~x' });
      const insertOne = vi.fn().mockResolvedValue({ insertedId: 'lg1' });
      const app = buildApp(router, { collection: () => ({ findOne, insertOne }) });

      const res = await request(app).get('/api/samples/000000000000000000000000/label/print-job');

      expect(res.status).toBe(200);
      expect(res.body.data.location).toBeNull();
      expect(res.body.data.zpl).toContain('^FDBC1x^FS');
      expect(res.body.data.zpl).not.toContain('BC^1~x');
    });

    it('returns 500 when the collection lookup throws', async () => {
      const { router } = loadRoute();
      const findOne = vi.fn().mockRejectedValue(new Error('db down'));
      const app = buildApp(router, { collection: () => ({ findOne }) });

      const res = await request(app).get('/api/samples/000000000000000000000000/label/print-job');

      expect(res.status).toBe(500);
    });
  });
});
