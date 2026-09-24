import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');
const {
  makeAuthToken,
  TEST_USER_ACCOUNT_IDS,
  TEST_ACTOR_IDS,
} = require('../factories/auth.factory');


// #641 slice 1: Assay/Dataset are mounted via createMasterDataRouter
// (same factory Study/Protocol use) -- master-data.api.test.js already
// covers the shared router's own branches generically via
// /api/measurement-units. These tests only cover what's specific to this
// mount: the right model's validate() actually gates each POST.

const rbacCollectionsAdmin = buildRbacCollections([{ userAccountId: TEST_USER_ACCOUNT_IDS[4], accessType: 4 }]);
const rbacCollectionsTechnician = buildRbacCollections([{ userAccountId: TEST_USER_ACCOUNT_IDS[2], accessType: 2 }]);

function makeToken(accessType = 4) {
  return makeAuthToken(accessType);
}

function givenSession() {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'sess-1' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'sess-1' });
}

beforeEach(() => { givenSession(); });
afterEach(() => { vi.restoreAllMocks(); });

const VALID_ASSAY_PAYLOAD = {
  studyId: 'study-1',
  specimenIds: ['specimen-1'],
  assayType: 'RNA sequencing',
  protocolId: 'protocol-1',
  operatorId: TEST_ACTOR_IDS[4],
  laboratoryId: 'org-1',
  assayDateTime: '2026-08-19T10:00:00.000Z',
  intendedUse: 'RNA-seq discovery',
};

const VALID_DATASET_PAYLOAD = {
  datasetTitle: 'RNA-seq cohort 2026',
  datasetVersion: '1.0.0',
  creators: [{ name: 'Dr. Silva', orcid: '0000-0000-0000-0001' }],
  license: 'CC-BY-4.0',
};

describe('GET /api/assays', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/assays');
    expect(res.status).toBe(401);
  });

  it('returns list for authenticated user', async () => {
    const coll = createCollectionMock({
      find: vi.fn().mockReturnValue({ sort: vi.fn().mockReturnThis(), toArray: vi.fn().mockResolvedValue([]) }),
    });
    app.locals.db = createDbMock({ assays: coll, ...rbacCollectionsAdmin });

    const res = await request(app).get('/api/assays').set('Authorization', `Bearer ${makeToken(4)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('POST /api/assays', () => {
  it('returns 403 for a role below Coordenador', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsTechnician });

    const res = await request(app)
      .post('/api/assays')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send(VALID_ASSAY_PAYLOAD);

    expect(res.status).toBe(403);
  });

  it('returns 422 when specimenIds is missing (AssayModel.validate)', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsAdmin });
    const { specimenIds, ...invalidPayload } = VALID_ASSAY_PAYLOAD;

    const res = await request(app)
      .post('/api/assays')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send(invalidPayload);

    expect(res.status).toBe(422);
    expect(res.body.details).toContain('specimenIds é obrigatório e deve ser um array não vazio');
  });

  it('creates an assay for a Coordenador+ role', async () => {
    const coll = createCollectionMock({ insertOne: vi.fn().mockResolvedValue({ insertedId: '507f1f77bcf86cd799439011' }) });
    // #664: validateAssayReferences now checks specimenIds/protocolId/
    // operatorId/laboratoryId resolve to real records before create.
    // operatorId must be Actor.actorId (UUID); rbacCollectionsAdmin seeds actors.
    app.locals.db = createDbMock({
      assays: coll,
      specimens: createCollectionMock({ findOne: vi.fn().mockResolvedValue({ _id: 'specimen-1' }) }),
      protocols: createCollectionMock({ findOne: vi.fn().mockResolvedValue({ protocolId: 'protocol-1' }) }),
      organizations: createCollectionMock({ findOne: vi.fn().mockResolvedValue({ organizationId: 'org-1' }) }),
      ...rbacCollectionsAdmin,
    });

    const res = await request(app)
      .post('/api/assays')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send(VALID_ASSAY_PAYLOAD);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.assayId).toBeTruthy();
    expect(res.body.data.specimenIds).toEqual(['specimen-1']);
  });

  it('#664: returns 404 when specimenIds does not resolve to a real sample', async () => {
    app.locals.db = createDbMock({
      protocols: createCollectionMock({ findOne: vi.fn().mockResolvedValue({ protocolId: 'protocol-1' }) }),
      organizations: createCollectionMock({ findOne: vi.fn().mockResolvedValue({ organizationId: 'org-1' }) }),
      ...rbacCollectionsAdmin,
    });

    const res = await request(app)
      .post('/api/assays')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send(VALID_ASSAY_PAYLOAD);

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/specimenIds/);
  });
});

describe('GET /api/datasets', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/datasets');
    expect(res.status).toBe(401);
  });

  it('returns list for authenticated user', async () => {
    const coll = createCollectionMock({
      find: vi.fn().mockReturnValue({ sort: vi.fn().mockReturnThis(), toArray: vi.fn().mockResolvedValue([]) }),
    });
    app.locals.db = createDbMock({ datasets: coll, ...rbacCollectionsAdmin });

    const res = await request(app).get('/api/datasets').set('Authorization', `Bearer ${makeToken(4)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('POST /api/datasets', () => {
  it('returns 403 for a role below Coordenador', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsTechnician });

    const res = await request(app)
      .post('/api/datasets')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send(VALID_DATASET_PAYLOAD);

    expect(res.status).toBe(403);
  });

  it('returns 422 when creators is missing (DatasetModel.validate)', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsAdmin });
    const { creators, ...invalidPayload } = VALID_DATASET_PAYLOAD;

    const res = await request(app)
      .post('/api/datasets')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send(invalidPayload);

    expect(res.status).toBe(422);
    expect(res.body.details).toContain('creators é obrigatório e deve ser um array não vazio');
  });

  it('creates a dataset for a Coordenador+ role, distributionFiles defaults empty', async () => {
    const coll = createCollectionMock({ insertOne: vi.fn().mockResolvedValue({ insertedId: '507f1f77bcf86cd799439012' }) });
    app.locals.db = createDbMock({ datasets: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .post('/api/datasets')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send(VALID_DATASET_PAYLOAD);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.datasetId).toBeTruthy();
    expect(res.body.data.distributionFiles).toEqual([]);
  });
});
