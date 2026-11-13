import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const platformAlert = require('../../src/services/platformAlert.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

// RNF015 AC5/AC6 (#1323): GET /api/monitoring/runs lists the recent runs of
// every phase for the Administrador only.

const RUNS = '/api/monitoring/runs';

const rbacCollectionsAdmin = buildRbacCollections([{ userAccountId: 'qa-1', accessType: 4 }]);
const rbacCollectionsCoordinator = buildRbacCollections([{ userAccountId: 'qa-3', accessType: 3 }]);

function makeToken(userID, accessType) {
  return jwt.sign(
    { userID, accessType, roleName: accessType >= 4 ? 'Administrador' : 'Coordenador', name: 'QA', mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

const asAdmin = (req) => req.set('Authorization', `Bearer ${makeToken('qa-1', 4)}`);
const asCoordinator = (req) => req.set('Authorization', `Bearer ${makeToken('qa-3', 3)}`);

function givenSession() {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'sess-1' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'sess-1' });
}

beforeEach(() => { givenSession(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('GET /api/monitoring/runs', () => {
  it('answers 200 with the runs of every phase for an Administrador', async () => {
    const referenceImportRuns = createCollectionMock();
    referenceImportRuns.find.mockImplementation(() => {
      const cursor = {};
      cursor.sort = vi.fn(() => cursor);
      cursor.limit = vi.fn(() => cursor);
      cursor.toArray = vi.fn().mockResolvedValue([{ referenceImportRunId: 'r-1', runStatus: 'failed', datasetCode: 'CID10', importMode: 'full' }]);
      return cursor;
    });
    app.locals.db = createDbMock({ referenceImportRuns, ...rbacCollectionsAdmin });

    const res = await asAdmin(request(app).get(RUNS));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.runs.referenceImportRun[0]).toMatchObject({ id: 'r-1', phase: 2, failed: true });
    expect(res.body.data.phases.map((p) => p.phase)).toEqual([1, 2, 3]);
  });

  it('lists a ReferenceImportIssue under phase 2 for an Administrador', async () => {
    const referenceImportIssues = createCollectionMock();
    referenceImportIssues.find.mockImplementation(() => {
      const cursor = {};
      cursor.sort = vi.fn(() => cursor);
      cursor.limit = vi.fn(() => cursor);
      cursor.toArray = vi.fn().mockResolvedValue([{ referenceImportIssueId: 'i-1', severity: 'fatal', errorCode: 'BAD_CODE', rawValue: 'raw-marker-value' }]);
      return cursor;
    });
    referenceImportIssues.countDocuments.mockResolvedValue(1);
    app.locals.db = createDbMock({ referenceImportIssues, ...rbacCollectionsAdmin });

    const res = await asAdmin(request(app).get(RUNS));

    expect(res.status).toBe(200);
    expect(res.body.data.runs.referenceImportIssue[0]).toMatchObject({ id: 'i-1', phase: 2, failed: true });
    expect(res.text).not.toContain('raw-marker-value');
  });

  it('refuses a Coordenador with 403', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsCoordinator });

    const res = await asCoordinator(request(app).get(RUNS));

    expect(res.status).toBe(403);
  });

  it('answers 401 without a token', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsAdmin });

    const res = await request(app).get(RUNS);

    expect(res.status).toBe(401);
  });

  it('answers 400 when limit is not an integer from 1 to 100', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsAdmin });

    for (const limit of ['0', 'abc']) {
      const res = await asAdmin(request(app).get(RUNS).query({ limit }));
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, error: 'Parâmetro inválido', message: 'limit deve ser um inteiro de 1 a 100' });
    }
  });
});

// RNF015 C1/C2 (#1323): GET /api/monitoring/metrics gives the Administrador
// the request metrics and the queue depths.
describe('GET /api/monitoring/metrics', () => {
  const METRICS = '/api/monitoring/metrics';

  it('answers 200 with the request metrics and both queues for an Administrador', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsAdmin });
    // A request is recorded when it finishes, so one goes first.
    await request(app).get(METRICS);

    const res = await asAdmin(request(app).get(METRICS));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.http.totals.requests).toBeGreaterThanOrEqual(1);
    expect(res.body.data.queues.map((q) => q.name)).toEqual(['import-queue', 'notification-queue']);
  });

  it('refuses the metrics to a Coordenador with 403', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsCoordinator });

    const res = await asCoordinator(request(app).get(METRICS));

    expect(res.status).toBe(403);
  });

  it('answers 401 without a token', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsAdmin });

    const res = await request(app).get(METRICS);

    expect(res.status).toBe(401);
  });

  // RNF015 C1/C3 and C7 (#1468): the worker job metrics in the JSON, and the
  // same metrics in the Prometheus text format.
  function workerJobMetricsMock() {
    const workerJobMetrics = createCollectionMock();
    workerJobMetrics.find.mockImplementation(() => {
      const cursor = {};
      cursor.sort = vi.fn(() => cursor);
      cursor.limit = vi.fn(() => cursor);
      cursor.toArray = vi.fn().mockResolvedValue([{ worker: 'neo4j-projection', job: 'project-event', completed: 5, failed: 1, durationMsSum: 12.5, durationMsMax: 4 }]);
      return cursor;
    });
    return workerJobMetrics;
  }

  it('carries the worker job metrics in the JSON for an Administrador', async () => {
    app.locals.db = createDbMock({ workerJobMetrics: workerJobMetricsMock(), ...rbacCollectionsAdmin });

    const res = await asAdmin(request(app).get(METRICS));

    expect(res.status).toBe(200);
    expect(res.body.data.jobs).toEqual([expect.objectContaining({ worker: 'neo4j-projection', job: 'project-event', completed: 5, failed: 1 })]);
  });

  it('answers ?format=prometheus with the text format 0.0.4 for an Administrador', async () => {
    app.locals.db = createDbMock({ workerJobMetrics: workerJobMetricsMock(), ...rbacCollectionsAdmin });
    // A request is recorded when it finishes, so one goes first.
    await request(app).get(METRICS);

    const res = await asAdmin(request(app).get(METRICS).query({ format: 'prometheus' }));

    expect(res.status).toBe(200);
    expect(res.headers['content-type'].startsWith('text/plain; version=0.0.4')).toBe(true);
    expect(res.text).toMatch(/^bioavanced_http_requests_total\{/m);
    expect(res.text).toContain('bioavanced_worker_jobs_total{worker="neo4j-projection",job="project-event",outcome="completed"} 5\n');
  });

  it('answers 400 to a format other than json or prometheus', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsAdmin });

    const res = await asAdmin(request(app).get(METRICS).query({ format: 'xml' }));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'Parâmetro inválido', message: 'format deve ser json ou prometheus' });
  });

  it('refuses ?format=prometheus to a Coordenador with 403', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsCoordinator });

    const res = await asCoordinator(request(app).get(METRICS).query({ format: 'prometheus' }));

    expect(res.status).toBe(403);
  });
});

// RNF015 C2 (#1323): GET /api/monitoring/alerts gives the Administrador the
// last platform alert evaluation and the active episodes.
describe('GET /api/monitoring/alerts', () => {
  const ALERTS = '/api/monitoring/alerts';

  it('answers 200 with no evaluation and the active episodes for an Administrador', async () => {
    platformAlert._resetForTests();
    app.locals.db = createDbMock({ ...rbacCollectionsAdmin });

    const res = await asAdmin(request(app).get(ALERTS));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.evaluatedAt).toBeNull();
    expect(Array.isArray(res.body.data.active)).toBe(true);
  });

  it('refuses the alerts to a Coordenador with 403', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsCoordinator });

    const res = await asCoordinator(request(app).get(ALERTS));

    expect(res.status).toBe(403);
  });

  it('answers 401 without a token', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsAdmin });

    const res = await request(app).get(ALERTS);

    expect(res.status).toBe(401);
  });
});
