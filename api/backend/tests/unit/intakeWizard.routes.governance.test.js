import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';
import express from 'express';
import request from 'supertest';

const require = createRequire(import.meta.url);

const routePath = require.resolve('../../src/interface/routes/intakeWizard.routes.js');
const authPath = require.resolve('../../src/infrastructure/middleware/auth.js');
const rbacPath = require.resolve('../../src/infrastructure/middleware/rbac.js');
const innerRoutePath = require.resolve('../../src/routes/intakeWizard.js');
const collectionResolverPath = require.resolve('../../src/utils/collectionResolver.js');

const allPaths = [routePath, authPath, rbacPath, innerRoutePath, collectionResolverPath];

function clearCache() {
  for (const p of allPaths) delete require.cache[p];
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
    expect(res.body.sample.quarantineStatus).toBe('RELEASED');
  });

  it('skips persistence when the sample has no id/specimenId/barcode to query by', async () => {
    const updateOne = vi.fn();
    const getCollectionImpl = vi.fn().mockResolvedValue({ updateOne });
    const router = loadRouter({ getCollectionImpl });
    const app = buildApp(router, {});

    const res = await request(app).post('/api/intake-wizard').send({
      success: true,
      sample: {},
      consent: { active: true },
    });

    expect(res.status).toBe(200);
    expect(updateOne).not.toHaveBeenCalled();
    expect(res.body.sample.status).toBe('AVAILABLE');
  });

  it('persists BLOCKED status and quarantine reason when consent is inactive', async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const getCollectionImpl = vi.fn().mockResolvedValue({ updateOne });
    const router = loadRouter({ getCollectionImpl });
    const app = buildApp(router, {});

    const res = await request(app).post('/api/intake-wizard').send({
      success: true,
      sample: { specimenId: 'spec-1' },
      consent: { active: false, reason: 'PENDING_SIGNATURE' },
    });

    expect(res.status).toBe(200);
    expect(res.body.sample.status).toBe('BLOCKED');
    expect(res.body.sample.quarantineStatus).toBe('QUARANTINED');
    expect(res.body.sample.quarantineReason).toBe('PENDING_SIGNATURE');
    expect(updateOne).toHaveBeenCalledWith(
      { $or: [{ specimenId: 'spec-1' }] },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'BLOCKED',
          quarantineStatus: 'QUARANTINED',
          quarantineReason: 'PENDING_SIGNATURE',
        }),
      })
    );
  });

  it('persists BLOCKED status when the release status itself is BLOCKED (consent active)', async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const getCollectionImpl = vi.fn().mockResolvedValue({ updateOne });
    const router = loadRouter({ getCollectionImpl });
    const app = buildApp(router, {});

    const res = await request(app).post('/api/intake-wizard').send({
      success: true,
      sample: { specimenId: 'spec-2', releaseStatus: 'blocked' },
      consent: { active: true },
    });

    expect(res.status).toBe(200);
    expect(res.body.sample.status).toBe('BLOCKED');
    expect(res.body.sample.quarantineReason).toBe('CONSENT_PENDING');
  });

  it('persists QUARANTINE status via release status alias', async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const getCollectionImpl = vi.fn().mockResolvedValue({ updateOne });
    const router = loadRouter({ getCollectionImpl });
    const app = buildApp(router, {});

    const res = await request(app).post('/api/intake-wizard').send({
      success: true,
      sample: { specimenId: 'spec-3', release_status: 'quarantine' },
      consent: { active: true },
    });

    expect(res.status).toBe(200);
    expect(res.body.sample.status).toBe('QUARANTINE');
    expect(res.body.sample.availabilityStatus).toBe('BLOCKED');
    expect(res.body.sample.quarantineReason).toBe('QUALITY_GOVERNANCE_FAILURE');
  });

  it('persists QUARANTINE status when sample.quarantineStatus is already QUARANTINED', async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const getCollectionImpl = vi.fn().mockResolvedValue({ updateOne });
    const router = loadRouter({ getCollectionImpl });
    const app = buildApp(router, {});

    const res = await request(app).post('/api/intake-wizard').send({
      success: true,
      sample: { specimenId: 'spec-4', quarantineStatus: 'QUARANTINED', quarantineReason: 'CUSTOM_REASON' },
      consent: { active: true },
    });

    expect(res.status).toBe(200);
    expect(res.body.sample.status).toBe('QUARANTINE');
    expect(res.body.sample.quarantineReason).toBe('CUSTOM_REASON');
  });

  it('persists AVAILABLE status and builds the query from _id when it is a valid ObjectId', async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const getCollectionImpl = vi.fn().mockResolvedValue({ updateOne });
    const router = loadRouter({ getCollectionImpl });
    const app = buildApp(router, {});

    const res = await request(app).post('/api/intake-wizard').send({
      success: true,
      sample: { _id: '507f1f77bcf86cd799439011', barcode: 'BC-1' },
      consent: { active: true },
    });

    expect(res.status).toBe(200);
    expect(res.body.sample.status).toBe('AVAILABLE');
    expect(res.body.sample.quarantineStatus).toBe('RELEASED');
    expect(res.body.sample.quarantineReason).toBeNull();

    const [query] = updateOne.mock.calls[0];
    expect(query.$or).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ _id: expect.anything() }),
        { barcode: 'BC-1' },
      ])
    );
  });

  it('ignores an invalid (non-ObjectId) _id when building the persistence query', async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const getCollectionImpl = vi.fn().mockResolvedValue({ updateOne });
    const router = loadRouter({ getCollectionImpl });
    const app = buildApp(router, {});

    const res = await request(app).post('/api/intake-wizard').send({
      success: true,
      sample: { _id: 'not-an-object-id', barcode: 'BC-2' },
      consent: { active: true },
    });

    expect(res.status).toBe(200);
    const [query] = updateOne.mock.calls[0];
    expect(query).toEqual({ $or: [{ barcode: 'BC-2' }] });
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
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const getCollectionImpl = vi.fn().mockResolvedValue({ updateOne });
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
      patientMatch: { patientID: '123' },
      storageLocation: { boxId: 'box-1' },
      label: { text: 'label-1' },
      sample: {
        _id: '507f1f77bcf86cd799439011',
        sampleID: 'sid-1',
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
    expect(res.body.patientMatch).toEqual({ patientID: '123' });
    expect(res.body.label).toEqual({ text: 'label-1' });
  });
});
