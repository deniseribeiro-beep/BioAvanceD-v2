import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const resolveFileReference = vi.fn();
const auditInit = vi.fn();
const auditLog = vi.fn();

vi.mock('../../src/infrastructure/middleware/auth', () => ({
  authenticate: (req, _res, next) => next(),
}));

vi.mock('../../src/infrastructure/middleware/rbac', () => ({
  requireRole: () => (req, _res, next) => next(),
}));

vi.mock('../../src/services/workflowRunFileLinker', () => ({
  resolveFileReference,
}));

vi.mock('../../src/utils/auditLogger', () => ({
  init: auditInit,
  log: auditLog,
}));

const router = require('../../src/interface/routes/workflow-run-file-link.routes');

function makeApp({ findOneResults = [], updateOneResult = { matchedCount: 1 }, user } = {}) {
  const findOne = vi.fn();
  for (const value of findOneResults) {
    findOne.mockResolvedValueOnce(value);
  }
  const updateOne = vi.fn().mockResolvedValue(updateOneResult);
  const workflowRuns = { findOne, updateOne };
  const db = {
    collection: vi.fn((name) => {
      if (name === 'workflowRuns') return workflowRuns;
      throw new Error(`unexpected collection: ${name}`);
    }),
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.app.locals.db = db;
    if (user !== undefined) req.user = user;
    next();
  });
  app.use('/api/workflow-runs/:workflowRunId/files', router);

  return { app, db, workflowRuns };
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveFileReference.mockResolvedValue('sample_files');
  auditLog.mockResolvedValue();
});

describe('workflow-run-file-link.routes item 8 residual branches', () => {
  it('GET supports a non-ObjectId workflowRunId and normalizes missing file arrays', async () => {
    const workflowRun = { _id: 'internal-1', workflowRunId: 'WR-1' };
    const { app, workflowRuns } = makeApp({ findOneResults: [workflowRun] });

    const response = await request(app).get('/api/workflow-runs/WR-1/files');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ inputFileIds: [], outputFileIds: [] });
    expect(workflowRuns.findOne).toHaveBeenCalledWith({
      $or: [{ workflowRunId: 'WR-1' }],
    });
  });

  it('GET includes the ObjectId lookup branch for a valid Mongo id', async () => {
    const id = '507f1f77bcf86cd799439011';
    const workflowRun = { _id: id, workflowRunId: 'WR-OID', inputFileIds: ['f1'], outputFileIds: ['f2'] };
    const { app, workflowRuns } = makeApp({ findOneResults: [workflowRun] });

    const response = await request(app).get(`/api/workflow-runs/${id}/files`);

    expect(response.status).toBe(200);
    const query = workflowRuns.findOne.mock.calls[0][0];
    expect(query.$or).toHaveLength(2);
    expect(query.$or[0]._id.toString()).toBe(id);
    expect(query.$or[1]).toEqual({ workflowRunId: id });
    expect(response.body.data).toEqual({ inputFileIds: ['f1'], outputFileIds: ['f2'] });
  });

  it('GET returns 404 for an unknown workflow run and 500 for collection failures', async () => {
    let ctx = makeApp({ findOneResults: [null] });
    let response = await request(ctx.app).get('/api/workflow-runs/WR-404/files');
    expect(response.status).toBe(404);

    ctx = makeApp();
    ctx.workflowRuns.findOne.mockRejectedValueOnce(new Error('workflow lookup failed'));
    response = await request(ctx.app).get('/api/workflow-runs/WR-ERR/files');
    expect(response.status).toBe(500);
    expect(response.body.message).toBe('workflow lookup failed');
  });

  it('POST validates direction and fileId before touching persistence', async () => {
    const { app, workflowRuns } = makeApp();

    let response = await request(app)
      .post('/api/workflow-runs/WR-1/files')
      .send({ fileId: 'f1', direction: 'sideways' });
    expect(response.status).toBe(422);

    response = await request(app)
      .post('/api/workflow-runs/WR-1/files')
      .send({ fileId: '   ', direction: 'input' });
    expect(response.status).toBe(422);

    expect(workflowRuns.findOne).not.toHaveBeenCalled();
  });

  it('POST returns 404 when either the workflow run or referenced file is missing', async () => {
    let ctx = makeApp({ findOneResults: [null] });
    let response = await request(ctx.app)
      .post('/api/workflow-runs/WR-404/files')
      .send({ fileId: 'file-1', direction: 'input' });
    expect(response.status).toBe(404);

    const workflowRun = { _id: 'internal-1', workflowRunId: 'WR-1' };
    ctx = makeApp({ findOneResults: [workflowRun] });
    resolveFileReference.mockResolvedValueOnce(null);
    response = await request(ctx.app)
      .post('/api/workflow-runs/WR-1/files')
      .send({ fileId: 'file-missing', direction: 'input' });
    expect(response.status).toBe(404);
    expect(ctx.workflowRuns.updateOne).not.toHaveBeenCalled();
  });

  it('POST links input and output files and skips audit when req.user is absent', async () => {
    const workflowRun = { _id: 'internal-1', workflowRunId: 'WR-1' };
    let updated = { ...workflowRun, inputFileIds: ['file-in'], outputFileIds: [] };
    let ctx = makeApp({ findOneResults: [workflowRun, updated] });

    let response = await request(ctx.app)
      .post('/api/workflow-runs/WR-1/files')
      .send({ fileId: 'file-in', direction: 'input' });

    expect(response.status).toBe(200);
    expect(ctx.workflowRuns.updateOne).toHaveBeenCalledWith(
      { _id: 'internal-1' },
      expect.objectContaining({
        $addToSet: { inputFileIds: 'file-in' },
        $set: { updatedAt: expect.any(Date) },
      })
    );
    expect(auditLog).not.toHaveBeenCalled();

    updated = { ...workflowRun, inputFileIds: [], outputFileIds: ['file-out'] };
    ctx = makeApp({ findOneResults: [workflowRun, updated] });
    response = await request(ctx.app)
      .post('/api/workflow-runs/WR-1/files')
      .send({ fileId: 'file-out', direction: 'output' });

    expect(response.status).toBe(200);
    expect(ctx.workflowRuns.updateOne.mock.calls[0][1].$addToSet).toEqual({ outputFileIds: 'file-out' });
  });

  it('POST audits an authenticated link and normalizes missing arrays on the updated document', async () => {
    const workflowRun = { _id: 'internal-2', workflowRunId: 'WR-2' };
    const updated = { _id: 'internal-2', workflowRunId: 'WR-2' };
    const { app, db } = makeApp({
      findOneResults: [workflowRun, updated],
      user: { userID: 'user-1' },
    });

    const response = await request(app)
      .post('/api/workflow-runs/WR-2/files')
      .send({ fileId: 'file-2', direction: 'output' });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ inputFileIds: [], outputFileIds: [] });
    expect(auditInit).toHaveBeenCalledWith(db);
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'WORKFLOW_RUN_FILE_LINK',
      resourceType: 'WorkflowRun',
      resourceId: 'WR-2',
      payload: {
        fileId: 'file-2',
        direction: 'output',
        foundInCollection: 'sample_files',
      },
    }));
  });

  it('POST maps unexpected persistence errors to the route error contract', async () => {
    const workflowRun = { _id: 'internal-3', workflowRunId: 'WR-3' };
    const { app, workflowRuns } = makeApp({ findOneResults: [workflowRun] });
    workflowRuns.updateOne.mockRejectedValueOnce(new Error('update failed'));

    const response = await request(app)
      .post('/api/workflow-runs/WR-3/files')
      .send({ fileId: 'file-3', direction: 'input' });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      error: 'Erro ao vincular arquivo',
      message: 'update failed',
    });
  });
});
