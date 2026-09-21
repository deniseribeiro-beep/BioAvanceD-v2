import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import express from 'express';
import request from 'supertest';

const require = createRequire(import.meta.url);

const authPath = require.resolve('../../src/infrastructure/middleware/auth');
const rbacPath = require.resolve('../../src/infrastructure/middleware/rbac');
const routePath = require.resolve('../../src/interface/routes/user.routes.js');
const registerSampleUseCasePath = require.resolve('../../src/core/use-cases/RegisterSampleUseCase');
const lineageRepositoryPath = require.resolve('../../src/infrastructure/persistence/mongo/MongoLineageRepository');
const collectionResolverPath = require.resolve('../../src/utils/collectionResolver');

let currentAuth = defaultAuth;
let currentRequirePermission = () => (req, res, next) => next();
let currentRegisterSampleExecution = async (deps, input) => ({
  sample: await deps.sampleRepository.create(input.sampleData),
  strictMode: false,
  topology: { synced: true, fallbackQueued: false },
});

const registerSampleState = {
  lastDeps: null,
  lastInput: null,
};

function defaultAuth(req, res, next) {
  req.user = {
    userID: 'user-1',
    id: 'user-1',
    name: 'Coverage Admin',
    roleName: 'Administrador',
  };
  req.t = (key) => key;
  next();
}

const authModule = require(authPath);
authModule.authenticate = (req, res, next) => currentAuth(req, res, next);

const rbacModule = require(rbacPath);
rbacModule.requirePermission = (...args) => (req, res, next) =>
  currentRequirePermission(...args)(req, res, next);

// user.routes.js captures these dependencies at require-time. Replace only
// the seams needed by the route-body tests, require the router once, then
// restore the cache exports so other modules in this isolated Vitest file
// continue to see the production implementations.
const OriginalRegisterSampleUseCase = require(registerSampleUseCasePath);
const OriginalMongoLineageRepository = require(lineageRepositoryPath);
const originalCollectionResolver = require(collectionResolverPath);

class CoverageRegisterSampleUseCase {
  constructor(deps) {
    this.deps = deps;
    registerSampleState.lastDeps = deps;
  }

  async execute(input) {
    registerSampleState.lastInput = input;
    return currentRegisterSampleExecution(this.deps, input);
  }
}

class CoverageMongoLineageRepository {
  constructor(db) {
    this.db = db;
  }
}

require.cache[registerSampleUseCasePath].exports = CoverageRegisterSampleUseCase;
require.cache[lineageRepositoryPath].exports = CoverageMongoLineageRepository;
require.cache[collectionResolverPath].exports = {
  ...originalCollectionResolver,
  getCollection: async (db, name) => db.collection(name),
};

const router = require(routePath);

require.cache[registerSampleUseCasePath].exports = OriginalRegisterSampleUseCase;
require.cache[lineageRepositoryPath].exports = OriginalMongoLineageRepository;
require.cache[collectionResolverPath].exports = originalCollectionResolver;

const patientService = require('../../src/services/patient.service');
const sampleService = require('../../src/services/sample.service');
const sensorService = require('../../src/services/sensor.service');
const consentValidator = require('../../src/services/consent.validator');
const auditLogger = require('../../src/utils/auditLogger');

function buildApp({ db = {}, locals = {}, authImpl } = {}) {
  currentAuth = authImpl || defaultAuth;
  currentRequirePermission = () => (req, res, next) => next();

  const app = express();
  app.use(express.json());
  app.locals.db = db;
  Object.assign(app.locals, locals);
  app.use('/api/users', router);
  return app;
}

function collection(overrides = {}) {
  return {
    findOne: vi.fn(),
    find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'inserted-1' }),
    updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
    ...overrides,
  };
}

function dbWith(collections = {}) {
  const map = { ...collections };
  return {
    collections: map,
    collection: vi.fn((name) => {
      if (!map[name]) map[name] = collection();
      return map[name];
    }),
  };
}

function translatedAuth(user, translate = (key) => key) {
  return (req, res, next) => {
    req.user = user;
    req.t = translate;
    next();
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  currentAuth = defaultAuth;
  currentRequirePermission = () => (req, res, next) => next();
  currentRegisterSampleExecution = async (deps, input) => ({
    sample: await deps.sampleRepository.create(input.sampleData),
    strictMode: false,
    topology: { synced: true, fallbackQueued: false },
  });
  registerSampleState.lastDeps = null;
  registerSampleState.lastInput = null;

  vi.spyOn(consentValidator, 'init').mockImplementation(() => {});
  vi.spyOn(consentValidator, 'validateAccess').mockResolvedValue(true);
  vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
  vi.spyOn(auditLogger, 'logDelete').mockResolvedValue(undefined);
});

describe('user.routes item 8 coverage — lower route bodies', () => {
  describe('DELETE /:id', () => {
    it('returns 503 when the route has no database', async () => {
      const res = await request(buildApp({ db: null })).delete('/api/users/u1');
      expect(res.status).toBe(503);
    });

    it('returns 404 when no user is deleted', async () => {
      const users = collection({ deleteOne: vi.fn().mockResolvedValue({ deletedCount: 0 }) });
      const res = await request(buildApp({ db: dbWith({ users }) })).delete('/api/users/u1');
      expect(res.status).toBe(404);
      expect(auditLogger.logDelete).not.toHaveBeenCalled();
    });

    it('deletes and audits the target user', async () => {
      const users = collection({ deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }) });
      const res = await request(buildApp({ db: dbWith({ users }) })).delete('/api/users/u1');
      expect(res.status).toBe(200);
      expect(auditLogger.init).toHaveBeenCalledTimes(1);
      expect(auditLogger.logDelete).toHaveBeenCalledWith(expect.anything(), 'User', 'u1');
    });

    it('maps delete failures to the route 400 response', async () => {
      const users = collection({ deleteOne: vi.fn().mockRejectedValue(new Error('delete failed')) });
      const res = await request(buildApp({ db: dbWith({ users }) })).delete('/api/users/u1');
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('delete failed');
    });
  });

  describe('GET /:id/validate-status', () => {
    it('returns 503 without a database', async () => {
      const res = await request(buildApp({ db: null })).get('/api/users/u1/validate-status');
      expect(res.status).toBe(503);
    });

    it('returns 404 when the user does not exist', async () => {
      const users = collection({ findOne: vi.fn().mockResolvedValue(null) });
      const res = await request(buildApp({ db: dbWith({ users }) })).get('/api/users/u1/validate-status');
      expect(res.status).toBe(404);
    });

    it('returns the stored status when present', async () => {
      const users = collection({ findOne: vi.fn().mockResolvedValue({ _id: 'u1', status: 'active' }) });
      const res = await request(buildApp({ db: dbWith({ users }) })).get('/api/users/u1/validate-status');
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('active');
    });

    it('falls back to inactive when status is absent', async () => {
      const users = collection({ findOne: vi.fn().mockResolvedValue({ _id: 'u1' }) });
      const res = await request(buildApp({ db: dbWith({ users }) })).get('/api/users/u1/validate-status');
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('inactive');
    });

    it('maps lookup failures to 500', async () => {
      const users = collection({ findOne: vi.fn().mockRejectedValue(new Error('lookup failed')) });
      const res = await request(buildApp({ db: dbWith({ users }) })).get('/api/users/u1/validate-status');
      expect(res.status).toBe(500);
      expect(res.body.message).toBe('lookup failed');
    });
  });

  describe('POST /register-patient', () => {
    it('returns 503 without a database', async () => {
      const res = await request(buildApp({ db: null }))
        .post('/api/users/register-patient')
        .send({});
      expect(res.status).toBe(503);
    });

    it('returns the patient created by patient.service', async () => {
      const db = dbWith();
      vi.spyOn(patientService, 'createPatient').mockResolvedValue({ participantId: 'P-1' });

      const res = await request(buildApp({ db }))
        .post('/api/users/register-patient')
        .send({ patientName: 'Synthetic Person' });

      expect(res.status).toBe(201);
      expect(patientService.createPatient).toHaveBeenCalledWith(db, { patientName: 'Synthetic Person' });
      expect(res.body.data.participantId).toBe('P-1');
    });

    it('maps service failures to 400', async () => {
      vi.spyOn(patientService, 'createPatient').mockRejectedValue(new Error('patient invalid'));
      const res = await request(buildApp({ db: dbWith() }))
        .post('/api/users/register-patient')
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('patient invalid');
    });
  });

  describe('POST /register-sample', () => {
    it('returns 503 without a database', async () => {
      const res = await request(buildApp({ db: null }))
        .post('/api/users/register-sample')
        .send({});
      expect(res.status).toBe(503);
    });

    it('returns 201 for a fully synchronized permissive registration', async () => {
      const db = dbWith();
      vi.spyOn(sampleService, 'createSample').mockResolvedValue({
        _id: 'sample-1',
        barcode: 'SYN-001',
      });

      const res = await request(buildApp({ db }))
        .post('/api/users/register-sample')
        .send({ barcode: 'SYN-001' });

      expect(res.status).toBe(201);
      expect(res.body.partialSuccess).toBe(false);
      expect(res.body.data.sampleID).toBe('sample-1');
      expect(res.body.data.operationMode).toBe('PERMISSIVE');
      expect(res.body.data.topology).toEqual({ synced: true, fallbackQueued: false });
      expect(registerSampleState.lastInput.sampleData).toEqual({ barcode: 'SYN-001' });
      expect(registerSampleState.lastInput.actor.userId).toBe('user-1');
      expect(registerSampleState.lastInput.actor.userName).toBe('Coverage Admin');
      expect(registerSampleState.lastInput.actor.userRole).toBe('Administrador');
    });

    it('returns 202 and the fallback message for a quarantined strict-mode projection', async () => {
      const db = dbWith();
      vi.spyOn(sampleService, 'createSample').mockResolvedValue({
        _id: null,
        id: 'sample-fallback-id',
        barcode: 'SYN-002',
      });
      currentRegisterSampleExecution = async (deps, input) => ({
        sample: await deps.sampleRepository.create(input.sampleData),
        strictMode: true,
        topology: { synced: false, fallbackQueued: true },
      });

      const res = await request(buildApp({
        db,
        authImpl: translatedAuth(
          { _id: { toString: () => 'mongo-user' }, username: 'synthetic-user', role: 'Curador' },
          () => ''
        ),
      }))
        .post('/api/users/register-sample')
        .set('user-agent', 'coverage-agent')
        .send({ barcode: 'SYN-002' });

      expect(res.status).toBe(202);
      expect(res.body.partialSuccess).toBe(true);
      expect(res.body.message).toContain('Amostra registrada com sucesso');
      expect(res.body.data.sampleID).toBe('sample-fallback-id');
      expect(res.body.data.operationMode).toBe('STRICT');
      expect(registerSampleState.lastInput.actor.userId).toBe('mongo-user');
      expect(registerSampleState.lastInput.actor.userName).toBe('synthetic-user');
      expect(registerSampleState.lastInput.actor.userRole).toBe('Curador');
      expect(registerSampleState.lastInput.actor.userAgent).toBe('coverage-agent');
    });

    // Legacy synchronous lineage/quarantine service injection was removed from
    // RegisterSampleUseCase wiring in canonical v2. The route now supplies only
    // the canonical sample repository; projection/quarantine is derived outside
    // this request path.

    it('covers the repository rollback helper with an ObjectId target', async () => {
      const samples = collection();
      const db = dbWith({ samples });
      const objectId = '507f1f77bcf86cd799439011';
      vi.spyOn(sampleService, 'createSample').mockResolvedValue({ _id: 'sample-6' });
      currentRegisterSampleExecution = async (deps, input) => {
        await deps.sampleRepository.deleteById(objectId);
        return {
          sample: await deps.sampleRepository.create(input.sampleData),
          strictMode: false,
          topology: { synced: true, fallbackQueued: false },
        };
      };

      const res = await request(buildApp({ db }))
        .post('/api/users/register-sample')
        .send({ barcode: 'SYN-006' });

      expect(res.status).toBe(201);
      expect(samples.deleteOne).toHaveBeenCalledTimes(1);
      const filter = samples.deleteOne.mock.calls[0][0];
      expect(filter._id.toString()).toBe(objectId);
    });

    it('covers the repository rollback helper with a non-ObjectId target', async () => {
      const samples = collection();
      const db = dbWith({ samples });
      vi.spyOn(sampleService, 'createSample').mockResolvedValue({ _id: 'sample-7' });
      currentRegisterSampleExecution = async (deps, input) => {
        await deps.sampleRepository.deleteById('business-key');
        return {
          sample: await deps.sampleRepository.create(input.sampleData),
          strictMode: false,
          topology: { synced: true, fallbackQueued: false },
        };
      };

      const res = await request(buildApp({ db }))
        .post('/api/users/register-sample')
        .send({ barcode: 'SYN-007' });

      expect(res.status).toBe(201);
      expect(samples.deleteOne).toHaveBeenCalledWith({ _id: 'business-key' });
    });

    it('maps statusCode 403 failures to STRICT_MODE_BLOCKED', async () => {
      currentRegisterSampleExecution = async () => {
        const error = new Error('blocked by status');
        error.statusCode = 403;
        throw error;
      };
      const res = await request(buildApp({ db: dbWith() }))
        .post('/api/users/register-sample')
        .send({});
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('STRICT_MODE_BLOCKED');
    });

    it('maps code STRICT_MODE_BLOCKED failures to 403', async () => {
      currentRegisterSampleExecution = async () => {
        const error = new Error('blocked by code');
        error.code = 'STRICT_MODE_BLOCKED';
        throw error;
      };
      const res = await request(buildApp({ db: dbWith() }))
        .post('/api/users/register-sample')
        .send({});
      expect(res.status).toBe(403);
    });

    it('maps STRICT_MODE_BLOCKED message failures to 403', async () => {
      currentRegisterSampleExecution = async () => {
        throw new Error('STRICT_MODE_BLOCKED: synthetic policy');
      };
      const res = await request(buildApp({ db: dbWith() }))
        .post('/api/users/register-sample')
        .send({});
      expect(res.status).toBe(403);
    });

    it('maps ordinary use-case failures to 400', async () => {
      currentRegisterSampleExecution = async () => {
        throw new Error('ordinary failure');
      };
      const res = await request(buildApp({ db: dbWith() }))
        .post('/api/users/register-sample')
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('ordinary failure');
    });
  });

  describe('POST /record-withdrawal', () => {
    it('returns 503 without a database', async () => {
      const res = await request(buildApp({ db: null }))
        .post('/api/users/record-withdrawal')
        .send({ sampleID: '507f1f77bcf86cd799439011' });
      expect(res.status).toBe(503);
    });

    it('requires sampleID after consent validation', async () => {
      const res = await request(buildApp({ db: dbWith() }))
        .post('/api/users/record-withdrawal')
        .send({ requiredScope: 'research' });

      expect(res.status).toBe(400);
      expect(consentValidator.validateAccess).toHaveBeenCalledWith(undefined, 'research');
    });

    it('uses consentScope as the fallback authorization scope', async () => {
      vi.spyOn(sampleService, 'withdrawSample').mockResolvedValue({ ok: true });
      const sampleID = '507f1f77bcf86cd799439011';
      const res = await request(buildApp({ db: dbWith() }))
        .post('/api/users/record-withdrawal')
        .send({ sampleID, consentScope: 'diagnostics', amount: 2 });

      expect(res.status).toBe(200);
      expect(consentValidator.validateAccess).toHaveBeenCalledWith(sampleID, 'diagnostics');
      expect(sampleService.withdrawSample).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({}),
        expect.objectContaining({ consentScope: 'diagnostics', amount: 2 })
      );
    });

    it('passes null when no consent scope is supplied', async () => {
      vi.spyOn(sampleService, 'withdrawSample').mockResolvedValue({ ok: true });
      const sampleID = '507f1f77bcf86cd799439011';
      const res = await request(buildApp({ db: dbWith() }))
        .post('/api/users/record-withdrawal')
        .send({ sampleID, amount: 1 });

      expect(res.status).toBe(200);
      expect(consentValidator.validateAccess).toHaveBeenCalledWith(sampleID, null);
    });

    it('maps invalid ObjectId input to the route 400 response', async () => {
      const withdrawSpy = vi.spyOn(sampleService, 'withdrawSample').mockResolvedValue({ ok: true });
      const res = await request(buildApp({ db: dbWith() }))
        .post('/api/users/record-withdrawal')
        .send({ sampleID: 'not-an-object-id' });

      expect(res.status).toBe(400);
      expect(withdrawSpy).not.toHaveBeenCalled();
    });

    it('maps withdraw service failures to 400', async () => {
      vi.spyOn(sampleService, 'withdrawSample').mockRejectedValue(new Error('withdraw failed'));
      const res = await request(buildApp({ db: dbWith() }))
        .post('/api/users/record-withdrawal')
        .send({ sampleID: '507f1f77bcf86cd799439011' });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('withdraw failed');
    });
  });

  describe('POST /generate-report', () => {
    it('returns 503 without a database', async () => {
      const res = await request(buildApp({ db: null }))
        .post('/api/users/generate-report')
        .send({ reportType: 'samples' });
      expect(res.status).toBe(503);
    });

    it('creates a report with supplied filters and the acting user', async () => {
      const reports = collection({ insertOne: vi.fn().mockResolvedValue({ insertedId: 'report-1' }) });
      const db = dbWith({ reports });

      const res = await request(buildApp({ db }))
        .post('/api/users/generate-report')
        .send({ reportType: 'samples', filters: { specimenStatus: 'available' } });

      expect(res.status).toBe(201);
      expect(res.body.data._id).toBe('report-1');
      expect(res.body.data.filters).toEqual({ specimenStatus: 'available' });
      expect(res.body.data.generatedBy).toBe('user-1');
    });

    it('falls back to empty filters and null generatedBy when absent', async () => {
      const reports = collection({ insertOne: vi.fn().mockResolvedValue({ insertedId: 'report-2' }) });
      const db = dbWith({ reports });
      const res = await request(buildApp({
        db,
        authImpl: translatedAuth(undefined),
      }))
        .post('/api/users/generate-report')
        .send({ reportType: 'audit' });

      expect(res.status).toBe(201);
      expect(res.body.data.filters).toEqual({});
      expect(res.body.data.generatedBy).toBeNull();
    });

    it('maps insert failures to 400', async () => {
      const reports = collection({ insertOne: vi.fn().mockRejectedValue(new Error('report write failed')) });
      const res = await request(buildApp({ db: dbWith({ reports }) }))
        .post('/api/users/generate-report')
        .send({ reportType: 'samples' });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('report write failed');
    });
  });

  describe('POST /register-sensor', () => {
    it('returns 503 without a database', async () => {
      const res = await request(buildApp({ db: null }))
        .post('/api/users/register-sensor')
        .send({});
      expect(res.status).toBe(503);
    });

    it('returns the sensor created by sensor.service', async () => {
      const db = dbWith();
      vi.spyOn(sensorService, 'createSensor').mockResolvedValue({ sensorId: 'sensor-1' });

      const res = await request(buildApp({ db }))
        .post('/api/users/register-sensor')
        .send({ sensorType: 'temperature' });

      expect(res.status).toBe(201);
      expect(sensorService.createSensor).toHaveBeenCalledWith(db, { sensorType: 'temperature' });
      expect(res.body.data.sensorId).toBe('sensor-1');
    });

    it('maps sensor service failures to 400', async () => {
      vi.spyOn(sensorService, 'createSensor').mockRejectedValue(new Error('sensor invalid'));
      const res = await request(buildApp({ db: dbWith() }))
        .post('/api/users/register-sensor')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('sensor invalid');
    });
  });
});


describe('user.routes item 8 safe upper-route and neutral-update branches', () => {
  it('covers list/log/get database guards and get not-found response', async () => {
    expect((await request(buildApp({ db: null })).get('/api/users')).status).toBe(503);
    expect((await request(buildApp({ db: null })).get('/api/users/logs')).status).toBe(503);
    expect((await request(buildApp({ db: null })).get('/api/users/u1')).status).toBe(503);

    const users = collection({ findOne: vi.fn().mockResolvedValue(null) });
    const res = await request(buildApp({ db: dbWith({ users }) })).get('/api/users/u1');
    expect(res.status).toBe(404);
  });

  it('covers PUT database and target-user not-found guards', async () => {
    expect((await request(buildApp({ db: null })).put('/api/users/u1').send({ name: 'X' })).status).toBe(503);

    const users = collection({ findOne: vi.fn().mockResolvedValue(null) });
    const res = await request(buildApp({ db: dbWith({ users }) }))
      .put('/api/users/u1')
      .send({ name: 'X' });
    expect(res.status).toBe(404);
  });

  it('normalizes explicit empty phone and organizationId on a neutral update', async () => {
    const rbacAssignments = require('../../src/services/rbac-assignment.service');
    vi.spyOn(rbacAssignments, 'isAdministrator').mockResolvedValue(false);
    vi.spyOn(rbacAssignments, 'resolveRoleDisplayName').mockResolvedValue('Técnico');

    const target = {
      _id: { toString: () => 'u1' },
      name: 'Before',
      email: 'before@example.test',
      username: 'before',
      status: 'active',
      organizationId: null,
    };
    const updated = {
      _id: { toString: () => 'u1' },
      name: 'After',
      email: 'before@example.test',
      username: 'before',
      organizationId: null,
    };
    const users = collection({
      findOne: vi.fn()
        .mockResolvedValueOnce(target)
        .mockResolvedValueOnce(updated),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    });

    vi.spyOn(auditLogger, 'logUpdate').mockResolvedValue(undefined);
    const res = await request(buildApp({ db: dbWith({ users }) }))
      .put('/api/users/u1')
      .send({ name: 'After', phone: '', organizationId: '' });

    expect(res.status).toBe(200);
    expect(users.updateOne).toHaveBeenCalledWith(
      expect.anything(),
      { $set: expect.objectContaining({ phone: null, organizationId: null }) }
    );
    expect(res.body.data.status).toBeUndefined();
    expect(res.body.data.id).toBe('u1');
  });

  it('rejects an organizationId that does not resolve to a canonical Organization', async () => {
    const target = {
      _id: { toString: () => 'u1' },
      name: 'Before',
      email: 'before@example.test',
      username: 'before',
      status: 'active',
    };
    const users = collection({ findOne: vi.fn().mockResolvedValue(target) });
    const organizations = collection({ findOne: vi.fn().mockResolvedValue(null) });
    const res = await request(buildApp({ db: dbWith({ users, organizations }) }))
      .put('/api/users/u1')
      .send({ organizationId: 'ORG-MISSING' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('não encontrado');
  });

  it('returns updateNotFound when the target disappears after the guarded update', async () => {
    const rbacAssignments = require('../../src/services/rbac-assignment.service');
    vi.spyOn(rbacAssignments, 'isAdministrator').mockResolvedValue(false);

    const target = {
      _id: { toString: () => 'u1' },
      name: 'Before',
      email: 'before@example.test',
      username: 'before',
      status: 'active',
    };
    const users = collection({
      findOne: vi.fn()
        .mockResolvedValueOnce(target)
        .mockResolvedValueOnce(null),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    });

    const res = await request(buildApp({ db: dbWith({ users }) }))
      .put('/api/users/u1')
      .send({ name: 'After' });
    expect(res.status).toBe(404);
  });

  it('covers same-level role request without hierarchy escalation and preserves ordinary MFA state', async () => {
    const rbacAssignments = require('../../src/services/rbac-assignment.service');
    vi.spyOn(rbacAssignments, 'isAdministrator').mockResolvedValue(false);
    vi.spyOn(rbacAssignments, 'resolveUserHierarchyLevel').mockResolvedValue(2);
    vi.spyOn(rbacAssignments, 'resolveRoleDisplayName').mockResolvedValue('Técnico');

    const target = {
      _id: { toString: () => 'u1' },
      name: 'Before',
      email: 'before@example.test',
      username: 'before',
      status: 'active',
      organizationId: 'ORG-1',
      mfaEnabled: true,
      mfaSecretCiphertext: { keyId: 'test', ciphertext: 'opaque' },
    };
    const updated = { ...target, name: 'After' };
    const users = collection({
      findOne: vi.fn()
        .mockResolvedValueOnce(target)
        .mockResolvedValueOnce(updated),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    });

    const res = await request(buildApp({ db: dbWith({ users }) }))
      .put('/api/users/u1')
      .send({ name: 'After', roleName: 'Técnico' });

    expect(res.status).toBe(200);
    const update = users.updateOne.mock.calls[0][1].$set;
    expect(update.mfaEnabled).toBeUndefined();
    expect(update.mfaSecretCiphertext).toBeUndefined();
  });
});
