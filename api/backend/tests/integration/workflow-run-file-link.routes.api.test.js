import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');

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


// RF027 AC#3 (#716 slice 2/4): links an existing file (already uploaded
// via sample/assay/dataset's own upload routes) to a WorkflowRun's
// inputFileIds/outputFileIds -- mounted at
// /api/workflow-runs/:workflowRunId/files, mirroring assay-file.routes.js/
// dataset-file.routes.js's mount shape.

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

const workflowRunId = 'wf-run-1';
const workflowRunDoc = { _id: new ObjectId(), workflowRunId, inputFileIds: [], outputFileIds: [] };

describe('GET /api/workflow-runs/:workflowRunId/files', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get(`/api/workflow-runs/${workflowRunId}/files`);
    expect(res.status).toBe(401);
  });

  it('returns 404 when the workflow run does not exist', async () => {
    app.locals.db = createDbMock({
      workflowRuns: createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) }),
      ...rbacCollectionsAdmin,
    });

    const res = await request(app)
      .get(`/api/workflow-runs/${workflowRunId}/files`)
      .set('Authorization', `Bearer ${makeToken(TEST_USER_ACCOUNT_IDS[4], 4)}`);

    expect(res.status).toBe(404);
  });

  it('returns the linked input/output file ids', async () => {
    app.locals.db = createDbMock({
      workflowRuns: createCollectionMock({
        findOne: vi.fn().mockResolvedValue({ ...workflowRunDoc, inputFileIds: ['file-1'], outputFileIds: ['file-2'] }),
      }),
      ...rbacCollectionsAdmin,
    });

    const res = await request(app)
      .get(`/api/workflow-runs/${workflowRunId}/files`)
      .set('Authorization', `Bearer ${makeToken(TEST_USER_ACCOUNT_IDS[4], 4)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ inputFileIds: ['file-1'], outputFileIds: ['file-2'] });
  });
});

describe('POST /api/workflow-runs/:workflowRunId/files', () => {
  it('returns 403 for a role below Coordenador', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsTechnician });

    const res = await request(app)
      .post(`/api/workflow-runs/${workflowRunId}/files`)
      .set('Authorization', `Bearer ${makeToken('qa-2', 2)}`)
      .send({ fileId: new ObjectId().toString(), direction: 'input' });

    expect(res.status).toBe(403);
  });

  it('returns 422 for an invalid direction', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsAdmin });

    const res = await request(app)
      .post(`/api/workflow-runs/${workflowRunId}/files`)
      .set('Authorization', `Bearer ${makeToken(TEST_USER_ACCOUNT_IDS[4], 4)}`)
      .send({ fileId: new ObjectId().toString(), direction: 'sideways' });

    expect(res.status).toBe(422);
  });

  it('returns 404 when the workflow run does not exist', async () => {
    app.locals.db = createDbMock({
      workflowRuns: createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) }),
      ...rbacCollectionsAdmin,
    });

    const res = await request(app)
      .post(`/api/workflow-runs/${workflowRunId}/files`)
      .set('Authorization', `Bearer ${makeToken(TEST_USER_ACCOUNT_IDS[4], 4)}`)
      .send({ fileId: new ObjectId().toString(), direction: 'input' });

    expect(res.status).toBe(404);
  });

  it('returns 404 when fileId does not resolve to a real file in any collection', async () => {
    app.locals.db = createDbMock({
      workflowRuns: createCollectionMock({ findOne: vi.fn().mockResolvedValue(workflowRunDoc) }),
      sample_files: createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) }),
      assayFiles: createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) }),
      datasetFiles: createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) }),
      ...rbacCollectionsAdmin,
    });

    const res = await request(app)
      .post(`/api/workflow-runs/${workflowRunId}/files`)
      .set('Authorization', `Bearer ${makeToken(TEST_USER_ACCOUNT_IDS[4], 4)}`)
      .send({ fileId: new ObjectId().toString(), direction: 'input' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/fileId/);
  });

  it('links a resolvable file as input and returns the updated arrays', async () => {
    const fileId = new ObjectId().toString();
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const findOneSeq = vi.fn()
      .mockResolvedValueOnce(workflowRunDoc)
      .mockResolvedValueOnce({ ...workflowRunDoc, inputFileIds: [fileId] });

    app.locals.db = createDbMock({
      workflowRuns: createCollectionMock({ findOne: findOneSeq, updateOne }),
      sample_files: createCollectionMock({ findOne: vi.fn().mockResolvedValue({ _id: new ObjectId(fileId) }) }),
      assayFiles: createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) }),
      datasetFiles: createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) }),
      ...rbacCollectionsAdmin,
    });

    const res = await request(app)
      .post(`/api/workflow-runs/${workflowRunId}/files`)
      .set('Authorization', `Bearer ${makeToken(TEST_USER_ACCOUNT_IDS[4], 4)}`)
      .send({ fileId, direction: 'input' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.inputFileIds).toEqual([fileId]);
    expect(updateOne).toHaveBeenCalledWith(
      { _id: workflowRunDoc._id },
      { $addToSet: { inputFileIds: fileId }, $set: expect.objectContaining({ updatedAt: expect.any(Date) }) }
    );
  });
});
