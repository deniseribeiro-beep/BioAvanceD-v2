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

// RF027 AC4 (#1322): GET /api/workflow-runs/:workflowRunId/lineage walks
// the runs that produced a run's inputs and consumed its outputs. The
// collection's find and findOne evaluate their filters, because
// createCollectionMock's default find ignores its filter.

const rbacCollectionsTechnician = buildRbacCollections([{ userAccountId: 'qa-2', accessType: 2 }]);

function makeToken(userID, accessType) {
  return jwt.sign(
    { userID, accessType, roleName: accessType >= 3 ? 'Coordenador' : 'Tecnico', name: 'QA', mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function givenSession() {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'sess-1' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'sess-1' });
}

beforeEach(() => { givenSession(); });
afterEach(() => { vi.restoreAllMocks(); });

function workflowRunsCollection(docs) {
  const matchesIn = (doc, filter) => Object.entries(filter).every(([field, condition]) => (
    (Array.isArray(doc[field]) ? doc[field] : []).some((value) => condition.$in.includes(value))
  ));
  const matchesLookup = (doc, filter) => filter.$or.some((clause) => (
    ('_id' in clause && String(doc._id) === String(clause._id))
    || ('workflowRunId' in clause && doc.workflowRunId === clause.workflowRunId)
  ));
  return createCollectionMock({
    findOne: vi.fn(async (filter) => docs.find((doc) => matchesLookup(doc, filter)) || null),
    find: vi.fn((filter) => ({ toArray: async () => docs.filter((doc) => matchesIn(doc, filter)) })),
  });
}

const chain = [
  { _id: new ObjectId(), workflowRunId: 'run-A', workflowId: 'wf-1', workflowVersion: '1', runStatus: 'completed', inputFileIds: [], outputFileIds: ['f1'] },
  { _id: new ObjectId(), workflowRunId: 'run-B', workflowId: 'wf-1', workflowVersion: '1', runStatus: 'completed', inputFileIds: ['f1'], outputFileIds: ['f2'] },
  { _id: new ObjectId(), workflowRunId: 'run-C', workflowId: 'wf-1', workflowVersion: '1', runStatus: 'failed', inputFileIds: ['f2'], outputFileIds: [] },
];

describe('GET /api/workflow-runs/:workflowRunId/lineage (RF027 AC4, #1322)', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/workflow-runs/run-B/lineage');
    expect(res.status).toBe(401);
  });

  it('returns 404 when the workflow run does not exist', async () => {
    app.locals.db = createDbMock({ workflowRuns: workflowRunsCollection(chain), ...rbacCollectionsTechnician });

    const res = await request(app)
      .get('/api/workflow-runs/run-unknown/lineage')
      .set('Authorization', `Bearer ${makeToken('qa-2', 2)}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'workflowRunId não encontrado' });
  });

  it('returns the chain to an authenticated user at accessType 2, with no role gate', async () => {
    app.locals.db = createDbMock({ workflowRuns: workflowRunsCollection(chain), ...rbacCollectionsTechnician });

    const res = await request(app)
      .get('/api/workflow-runs/run-B/lineage')
      .set('Authorization', `Bearer ${makeToken('qa-2', 2)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.workflowRunId).toBe('run-B');
    expect(res.body.data.truncated).toBe(false);
    expect(res.body.data.runs.map(({ workflowRunId, relation, depth }) => ({ workflowRunId, relation, depth }))).toEqual([
      { workflowRunId: 'run-B', relation: 'root', depth: 0 },
      { workflowRunId: 'run-A', relation: 'upstream', depth: 1 },
      { workflowRunId: 'run-C', relation: 'downstream', depth: 1 },
    ]);
    expect(res.body.data.edges).toEqual([
      { fromWorkflowRunId: 'run-A', toWorkflowRunId: 'run-B', fileId: 'f1' },
      { fromWorkflowRunId: 'run-B', toWorkflowRunId: 'run-C', fileId: 'f2' },
    ]);
  });
});
