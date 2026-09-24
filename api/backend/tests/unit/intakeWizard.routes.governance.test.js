import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';
import express from 'express';
import request from 'supertest';

const require = createRequire(import.meta.url);
const { TEST_USER_ACCOUNT_IDS } = require('../factories/auth.factory');

const routePath = require.resolve('../../src/interface/routes/intakeWizard.routes.js');
const authPath = require.resolve('../../src/infrastructure/middleware/auth.js');
const rbacPath = require.resolve('../../src/infrastructure/middleware/rbac.js');
const innerRoutePath = require.resolve('../../src/routes/intakeWizard.js');
const collectionResolverPath = require.resolve('../../src/utils/collectionResolver.js');
const quarantineActionServicePath = require.resolve('../../src/services/quarantine-action.service.js');

// quarantine-action.service.js destructures `getCollection` from
// collectionResolver at require-time — if it's already cached from an
// earlier-run test file (loaded before this file's mock is installed),
// its binding stays pointed at the real getCollection forever. Bust it
// alongside the route/auth/rbac paths so each loadRouter() re-requires
// it fresh, picking up the currently-installed mock.
const allPaths = [routePath, authPath, rbacPath, innerRoutePath, collectionResolverPath, quarantineActionServicePath];

function clearCache() {
  for (const p of allPaths) delete require.cache[p];
}

function buildSamplesCollection({ existingSample = null } = {}) {
  return {
    findOne: vi.fn().mockResolvedValue(existingSample),
    updateOne: vi.fn().mockResolvedValue({ matchedCount: existingSample ? 1 : 0 }),
  };
}

function buildQuarantineActionsCollection({ activeAction = null } = {}) {
  const toArray = vi.fn().mockResolvedValue(activeAction ? [activeAction] : []);
  const sort = vi.fn().mockReturnValue({ toArray });
  return {
    insertOne: vi.fn().mockResolvedValue({ insertedId: TEST_USER_ACCOUNT_IDS[4] }),
    find: vi.fn().mockReturnValue({ sort }),
    updateOne: vi.fn().mockResolvedValue({ matchedCount: activeAction ? 1 : 0 }),
  };
}

function buildGetCollectionImpl({ samplesCollection, quarantineActionsCollection } = {}) {
  const samples = samplesCollection || buildSamplesCollection();
  const quarantineActions = quarantineActionsCollection || buildQuarantineActionsCollection();
  return vi.fn((db, name) => Promise.resolve(name === 'quarantineActions' ? quarantineActions : samples));
}

function loadRouter({ getCollectionImpl, innerRouterBuilder } = {}) {
  clearCache();

  const authModule = require(authPath);
  authModule.authenticate = (req, res, next) => {
    req.user = { userID: 'user-1', accessType: 3 };
    next();
  };

  const rbacModule = require(rbacPath);
  rbacModule.requirePermission = () => (req, res, next) => next();

  const collectionResolverModule = require(collectionResolverPath);
  collectionResolverModule.getCollection = getCollectionImpl || vi.fn();

  const innerRouter = (innerRouterBuilder || defaultInnerRouter)();
  require.cache[innerRoutePath] = { id: innerRoutePath, filename: innerRoutePath, loaded: true, exports: innerRouter };

  return require(routePath);
}

function defaultInnerRouter() {
  const router = express.Router();
  router.post('/', (req, res) => res.json(req.body));
  router.get('/other', (req, res) => res.json({ success: true, note: 'not-post' }));
  return router;
}

function buildApp(router, db = {}) {
  const app = express();
  app.use(express.json());
  app.locals.db = db;
  app.use('/api/intake-wizard', router);
  return app;
}

describe('intakeWizard.routes.js (interface wrapper / governance guard)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearCache();
  });

  it('leaves the response untouched for non-POST requests', async () => {
    const router = loadRouter();
    const app = buildApp(router, {});

    const res = await request(app).get('/api/intake-wizard/other');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, note: 'not-post' });
  });

  it('passes through a non-success body unchanged (sample stays as-is)', async () => {
    const router = loadRouter();
    const app = buildApp(router, {});

    const res = await request(app).post('/api/intake-wizard').send({ success: false, error: 'boom' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: false, error: 'boom' });
  });

  it('returns null enforcement (no persistence) when db is missing, still sanitizes the response', async () => {
    const router = loadRouter();
    const app = buildApp(router, null);

    const res = await request(app).post('/api/intake-wizard').send({
      success: true,
      message: 'ok',
      sample: { _id: '507f1f77bcf86cd799439011', specimenId: 'spec-1' },
      consent: { active: true },
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.sample.status).toBe('AVAILABLE');
  });

  it('skips persistence when the sample has no canonical _id/specimenId to query by', async () => {
    const samplesCollection = buildSamplesCollection();
    const getCollectionImpl = buildGetCollectionImpl({ samplesCollection });
    const router = loadRouter({ getCollectionImpl });
    const app = buildApp(router, {});

    const res = await request(app).post('/api/intake-wizard').send({
      success: true,
      sample: {},
      consent: { active: true },
    });

    expect(res.status).toBe(200);
    expect(samplesCollection.updateOne).not.toHaveBeenCalled();
    expect(res.body.sample.status).toBe('AVAILABLE');
  });

  it('persists BLOCKED status, sets specimenStatus quarantined, and records a QuarantineAction when consent is inactive', async () => {
    const existingSample = { _id: 'sample-1', specimenId: 'spec-1', specimenStatus: 'available' };
    const samplesCollection = buildSamplesCollection({ existingSample });
    const quarantineActionsCollection = buildQuarantineActionsCollection();
    const getCollectionImpl = buildGetCollectionImpl({ samplesCollection, quarantineActionsCollection });
    const router = loadRouter({ getCollectionImpl });
    const app = buildApp(router, {});

    const res = await request(app).post('/api/intake-wizard').send({
      success: true,
      sample: { specimenId: 'spec-1' },
      consent: { active: false, reason: 'PENDING_SIGNATURE' },
    });

    expect(res.status).toBe(200);
    expect(res.body.sample.status).toBe('BLOCKED');
    expect(res.body.sample.quarantineReason).toBe('PENDING_SIGNATURE');
    expect(samplesCollection.updateOne).toHaveBeenCalledWith(
      { $or: [{ specimenId: 'spec-1' }] },
      expect.objectContaining({
        $set: expect.objectContaining({
          specimenStatus: 'quarantined',
          quarantineReason: 'PENDING_SIGNATURE',
        }),
      })
    );
    // #540: status/currentStatus are legacy fields canonical-data-contract-v1.md
    // bans on the Sample document — specimenStatus is the sole persisted signal.
    const persistedSet = samplesCollection.updateOne.mock.calls[0][1].$set;
    expect(persistedSet.status).toBeUndefined();
    expect(persistedSet.currentStatus).toBeUndefined();
    expect(quarantineActionsCollection.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ specimenIds: ['sample-1'], reasonCodes: ['PENDING_SIGNATURE'] }),
      undefined
    );
  });

  it('persists BLOCKED status when the persisted specimenStatus itself is unavailable (consent active)', async () => {
    const existingSample = { _id: 'sample-2', specimenId: 'spec-2', specimenStatus: 'available' };
    const samplesCollection = buildSamplesCollection({ existingSample });
    const getCollectionImpl = buildGetCollectionImpl({ samplesCollection });
    const router = loadRouter({ getCollectionImpl });
    const app = buildApp(router, {});

    const res = await request(app).post('/api/intake-wizard').send({
      success: true,
      sample: { specimenId: 'spec-2', specimenStatus: 'unavailable' },
      consent: { active: true },
    });

    expect(res.status).toBe(200);
    expect(res.body.sample.status).toBe('BLOCKED');
    expect(res.body.sample.quarantineReason).toBe('CONSENT_PENDING');
  });

  it('persists QUARANTINE status from the persisted specimenStatus and records a QuarantineAction', async () => {
    const existingSample = { _id: 'sample-3', specimenId: 'spec-3', specimenStatus: 'available' };
    const samplesCollection = buildSamplesCollection({ existingSample });
    const quarantineActionsCollection = buildQuarantineActionsCollection();
    const getCollectionImpl = buildGetCollectionImpl({ samplesCollection, quarantineActionsCollection });
    const router = loadRouter({ getCollectionImpl });
    const app = buildApp(router, {});

    const res = await request(app).post('/api/intake-wizard').send({
      success: true,
      sample: { specimenId: 'spec-3', specimenStatus: 'quarantined' },
      consent: { active: true },
    });

    expect(res.status).toBe(200);
    expect(res.body.sample.status).toBe('QUARANTINE');
    expect(res.body.sample.quarantineReason).toBe('QUALITY_GOVERNANCE_FAILURE');
    expect(quarantineActionsCollection.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ specimenIds: ['sample-3'] }),
      undefined
    );
  });

  it('persists QUARANTINE status when sample already quarantined, without recording a duplicate QuarantineAction', async () => {
    const existingSample = { _id: 'sample-4', specimenId: 'spec-4', specimenStatus: 'quarantined' };
    const samplesCollection = buildSamplesCollection({ existingSample });
    const quarantineActionsCollection = buildQuarantineActionsCollection();
    const getCollectionImpl = buildGetCollectionImpl({ samplesCollection, quarantineActionsCollection });
    const router = loadRouter({ getCollectionImpl });
    const app = buildApp(router, {});

    const res = await request(app).post('/api/intake-wizard').send({
      success: true,
      sample: { specimenId: 'spec-4', specimenStatus: 'quarantined', quarantineReason: 'CUSTOM_REASON' },
      consent: { active: true },
    });

    expect(res.status).toBe(200);
    expect(res.body.sample.status).toBe('QUARANTINE');
    expect(res.body.sample.quarantineReason).toBe('CUSTOM_REASON');
    expect(quarantineActionsCollection.insertOne).not.toHaveBeenCalled();
  });

  it('releases the active QuarantineAction, attributed to the authenticated user, when a previously quarantined sample resolves to AVAILABLE', async () => {
    const existingSample = { _id: 'sample-9', specimenId: 'spec-9', specimenStatus: 'quarantined' };
    const activeAction = { quarantineActionId: 'qa-9', specimenIds: ['sample-9'], actionStatus: 'active' };
    const samplesCollection = buildSamplesCollection({ existingSample });
    const quarantineActionsCollection = buildQuarantineActionsCollection({ activeAction });
    const getCollectionImpl = buildGetCollectionImpl({ samplesCollection, quarantineActionsCollection });
    const router = loadRouter({ getCollectionImpl });
    const app = buildApp(router, {});

    const res = await request(app).post('/api/intake-wizard').send({
      success: true,
      sample: { specimenId: 'spec-9' },
      consent: { active: true },
    });

    expect(res.status).toBe(200);
    expect(res.body.sample.status).toBe('AVAILABLE');
    expect(quarantineActionsCollection.updateOne).toHaveBeenCalledWith(
      { quarantineActionId: 'qa-9' },
      expect.objectContaining({ $set: expect.objectContaining({ actionStatus: 'released', authorizedBy: 'user-1' }) }),
      undefined
    );
  });

  it('persists AVAILABLE status and builds the query from _id when it is a valid ObjectId', async () => {
    const existingSample = { _id: '507f1f77bcf86cd799439011', barcode: 'BC-1', specimenStatus: 'available' };
    const samplesCollection = buildSamplesCollection({ existingSample });
    const getCollectionImpl = buildGetCollectionImpl({ samplesCollection });
    const router = loadRouter({ getCollectionImpl });
    const app = buildApp(router, {});

    const res = await request(app).post('/api/intake-wizard').send({
      success: true,
      sample: { _id: '507f1f77bcf86cd799439011', barcode: 'BC-1' },
      consent: { active: true },
    });

    expect(res.status).toBe(200);
    expect(res.body.sample.status).toBe('AVAILABLE');
    expect(res.body.sample.quarantineReason).toBeNull();

    const [query] = samplesCollection.updateOne.mock.calls[0];
    expect(query.$or).toEqual([
      expect.objectContaining({ _id: expect.anything() }),
    ]);
  });

  it('does not use Data Matrix encodedValue as an identity fallback when _id is invalid', async () => {
    const samplesCollection = buildSamplesCollection();
    const getCollectionImpl = buildGetCollectionImpl({ samplesCollection });
    const router = loadRouter({ getCollectionImpl });
    const app = buildApp(router, {});

    const res = await request(app).post('/api/intake-wizard').send({
      success: true,
      sample: { _id: 'not-an-object-id', barcode: 'DM-ONLY-2' },
      consent: { active: true },
    });

    expect(res.status).toBe(200);
    expect(samplesCollection.findOne).not.toHaveBeenCalled();
    expect(samplesCollection.updateOne).not.toHaveBeenCalled();
  });

  it('falls back to sanitizing without the persisted governance status when persistence throws', async () => {
    const getCollectionImpl = vi.fn().mockRejectedValue(new Error('db down'));
    const router = loadRouter({ getCollectionImpl });
    const app = buildApp(router, {});

    const res = await request(app).post('/api/intake-wizard').send({
      success: true,
      sample: { specimenId: 'spec-5' },
      consent: { active: true },
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.sample.status).toBe('AVAILABLE');
  });

  it('defaults sample/consent to {} when entirely absent from the body (still resolves AVAILABLE)', async () => {
    const router = loadRouter();
    const app = buildApp(router, {});

    const res = await request(app).post('/api/intake-wizard').send({ success: true });

    expect(res.status).toBe(200);
    expect(res.body.sample.status).toBe('AVAILABLE');
    expect(res.body.sample._id).toBeNull();
  });

  it('falls back to the raw sample.quarantineReason when governance status leaves it null (AVAILABLE)', async () => {
    const existingSample = { _id: 'sample-6', specimenId: 'spec-6', specimenStatus: 'available' };
    const samplesCollection = buildSamplesCollection({ existingSample });
    const getCollectionImpl = buildGetCollectionImpl({ samplesCollection });
    const router = loadRouter({ getCollectionImpl });
    const app = buildApp(router, {});

    const res = await request(app).post('/api/intake-wizard').send({
      success: true,
      sample: { specimenId: 'spec-6', quarantineReason: 'LEFTOVER_NOTE' },
      consent: { active: true },
    });

    expect(res.status).toBe(200);
    expect(res.body.sample.status).toBe('AVAILABLE');
    expect(res.body.sample.quarantineReason).toBe('LEFTOVER_NOTE');
  });

  it('builds a safe sample summary that strips fields not on the allow-list and preserves numeric/zero rcs_score', async () => {
    const router = loadRouter();
    const app = buildApp(router, {});

    const res = await request(app).post('/api/intake-wizard').send({
      success: true,
      message: 'created',
      qualidade: 'A',
      qualityAssessment: { score: 90 },
      patientMatch: { participantId: '123' },
      storageLocation: { boxId: 'box-1' },
      label: { text: 'label-1' },
      sample: {
        _id: '507f1f77bcf86cd799439011',
        specimenId: 'sid-1',
        rcs_score: 0,
        final_grade: 'B',
        sprec: { matrixType: 'fluid' },
        storageLocation: { boxId: 'box-1' },
        secretInternalField: 'should-not-leak',
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.sample.secretInternalField).toBeUndefined();
    expect(res.body.sample.rcs_score).toBe(0);
    expect(res.body.sample.specimenId).toBe('sid-1');
    expect(res.body.sample.final_grade).toBe('B');
    expect(res.body.message).toBe('created');
    expect(res.body.qualityAssessment).toEqual({ score: 90 });
    expect(res.body.patientMatch).toEqual({ participantId: '123' });
    expect(res.body.label).toEqual({ text: 'label-1' });
  });
});
