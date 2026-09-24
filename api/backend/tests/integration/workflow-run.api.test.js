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
  makeLegacyClaimsToken,
  buildAuthenticatedCollections,
  userForAccessType,
  TEST_USER_ACCOUNT_IDS,
} = require('../factories/auth.factory');


// RF027 slice 1/4 (#716): WorkflowRun is mounted via createMasterDataRouter
// (same factory Assay/Dataset/Study/Protocol use) -- master-data.api.test.js
// already covers the shared router's own branches generically via
// /api/measurement-units. These tests only cover what's specific to this
// mount: WorkflowRunModel.validate() actually gates each POST, and there is
// no validateReferences hook (like Dataset, unlike Assay).

const rbacCollectionsAdmin = buildRbacCollections([{ userAccountId: TEST_USER_ACCOUNT_IDS[4], accessType: 4 }]);
const rbacCollectionsTechnician = buildRbacCollections([{ userAccountId: 'qa-2', accessType: 2 }]);

function makeToken(accessType = 4) {
  return makeAuthToken(accessType);
}

function givenSession() {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'sess-1' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'sess-1' });
}

beforeEach(() => { givenSession(); });
afterEach(() => { vi.restoreAllMocks(); });

const VALID_WORKFLOW_RUN_PAYLOAD = {
  workflowId: 'variant-calling-pipeline',
  workflowVersion: '2.3.1',
  createdBy: 'User/user-1',
  startedAt: '2026-08-21T10:00:00.000Z',
  runStatus: 'succeeded',
};

describe('GET /api/workflow-runs', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/workflow-runs');
    expect(res.status).toBe(401);
  });

  it('returns list for authenticated user', async () => {
    const coll = createCollectionMock({
      find: vi.fn().mockReturnValue({ sort: vi.fn().mockReturnThis(), toArray: vi.fn().mockResolvedValue([]) }),
    });
    app.locals.db = createDbMock({ workflowRuns: coll, ...rbacCollectionsAdmin });

    const res = await request(app).get('/api/workflow-runs').set('Authorization', `Bearer ${makeToken(TEST_USER_ACCOUNT_IDS[4], 4)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('POST /api/workflow-runs', () => {
  it('returns 403 for a role below Coordenador', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsTechnician });

    const res = await request(app)
      .post('/api/workflow-runs')
      .set('Authorization', `Bearer ${makeToken('qa-2', 2)}`)
      .send(VALID_WORKFLOW_RUN_PAYLOAD);

    expect(res.status).toBe(403);
  });

  it('returns 422 when createdBy is missing (WorkflowRunModel.validate, AC#4)', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsAdmin });
    const { createdBy, ...invalidPayload } = VALID_WORKFLOW_RUN_PAYLOAD;

    const res = await request(app)
      .post('/api/workflow-runs')
      .set('Authorization', `Bearer ${makeToken(TEST_USER_ACCOUNT_IDS[4], 4)}`)
      .send(invalidPayload);

    expect(res.status).toBe(422);
    expect(res.body.details).toContain('createdBy é obrigatório');
  });

  it('returns 422 when runStatus is out of enum', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsAdmin });

    const res = await request(app)
      .post('/api/workflow-runs')
      .set('Authorization', `Bearer ${makeToken(TEST_USER_ACCOUNT_IDS[4], 4)}`)
      .send({ ...VALID_WORKFLOW_RUN_PAYLOAD, runStatus: 'paused' });

    expect(res.status).toBe(422);
  });

  it('creates a workflow run for a Coordenador+ role (AC#1/#2/#4)', async () => {
    const coll = createCollectionMock({ insertOne: vi.fn().mockResolvedValue({ insertedId: '507f1f77bcf86cd799439011' }) });
    app.locals.db = createDbMock({ workflowRuns: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .post('/api/workflow-runs')
      .set('Authorization', `Bearer ${makeToken(TEST_USER_ACCOUNT_IDS[4], 4)}`)
      .send(VALID_WORKFLOW_RUN_PAYLOAD);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.workflowRunId).toBeTruthy();
    expect(res.body.data.workflowId).toBe('variant-calling-pipeline');
    expect(res.body.data.createdBy).toBe('User/user-1');
    expect(res.body.data.runStatus).toBe('succeeded');
  });
});
