import { describe, it, expect, vi } from 'vitest';
const express = require('express');
const request = require('supertest');

const { createHttpMetrics } = require('../../../../src/infrastructure/metrics/httpMetrics');

// RNF015 C1/C2 (#1323): request metrics are labelled by route template, never
// by URL, including after next(err) leaves a sub-router and under a mount with
// a param.

function buildApp(options) {
  const metrics = createHttpMetrics(options);
  const app = express();
  app.use(metrics.middleware);

  const things = express.Router();
  things.get('/err/x', (req, res, next) => next(new Error('boom')));
  things.get('/bad', (req, res) => res.status(400).json({}));
  things.get('/:id', (req, res) => res.json({ id: req.params.id }));
  app.use('/api/things', things);

  const files = express.Router({ mergeParams: true });
  files.get('/:fid', (req, res) => res.json({}));
  app.use('/api/a/:aid/files', files);

  app.get('/one', (req, res) => res.json({}));
  app.get('/two', (req, res) => res.json({}));
  app.get('/three', (req, res) => res.json({}));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => res.status(500).json({}));
  return { app, metrics };
}

// A request is recorded on 'finish', which may land just after the client
// reads the response.
async function settled(metrics, requests) {
  await vi.waitFor(() => expect(metrics.snapshot().totals.requests).toBe(requests));
  return metrics.snapshot();
}

const find = (snap, route) => snap.routes.find((r) => r.route === route);

describe('#1323: httpMetrics', () => {
  it('counts a /:id route under its template, and the id appears nowhere', async () => {
    const { app, metrics } = buildApp();
    await request(app).get('/api/things/abc123xyz');
    await request(app).get('/api/things/def456uvw');

    const snap = await settled(metrics, 2);

    expect(find(snap, '/api/things/:id')).toMatchObject({ method: 'GET', requests: 2 });
    expect(JSON.stringify(snap)).not.toContain('abc123xyz');
    expect(JSON.stringify(snap)).not.toContain('def456uvw');
  });

  it('labels a route under a mergeParams mount with a param by its template', async () => {
    const { app, metrics } = buildApp();
    await request(app).get('/api/a/9871/files/5432');

    const snap = await settled(metrics, 1);

    expect(snap.routes.map((r) => r.route)).toEqual(['/api/a/:aid/files/:fid']);
    expect(JSON.stringify(snap)).not.toContain('9871');
  });

  it('counts next(err) from a mounted router as one error under its full route', async () => {
    const { app, metrics } = buildApp();
    const res = await request(app).get('/api/things/err/x');
    expect(res.status).toBe(500);

    const snap = await settled(metrics, 1);

    expect(snap.routes.map((r) => r.route)).toEqual(['/api/things/err/x']);
    expect(find(snap, '/api/things/err/x')).toMatchObject({ requests: 1, errors: 1, statusCounts: { 500: 1 } });
  });

  it('counts an unmatched path under __unmatched__, and its URL appears nowhere', async () => {
    const { app, metrics } = buildApp();
    const res = await request(app).get('/no/such/secretpath');
    expect(res.status).toBe(404);

    const snap = await settled(metrics, 1);

    expect(snap.routes.map((r) => r.route)).toEqual(['__unmatched__']);
    expect(JSON.stringify(snap)).not.toContain('secretpath');
  });

  it('sends 4xx to clientErrors and 5xx to errors', async () => {
    const { app, metrics } = buildApp();
    await request(app).get('/api/things/bad');
    await request(app).get('/api/things/err/x');
    await request(app).get('/api/things/ok');

    const snap = await settled(metrics, 3);

    expect(snap.totals).toMatchObject({ requests: 3, clientErrors: 1, errors: 1, statusCounts: { 200: 1, 400: 1, 500: 1 } });
    expect(find(snap, '/api/things/bad')).toMatchObject({ clientErrors: 1, errors: 0 });
  });

  it('keeps a latency histogram whose count equals the request count', async () => {
    const { app, metrics } = buildApp();
    for (let i = 0; i < 3; i += 1) await request(app).get(`/api/things/${i}`);

    const snap = await settled(metrics, 3);
    const { latency } = find(snap, '/api/things/:id');

    expect(latency.count).toBe(3);
    expect(Object.values(latency.buckets).reduce((a, b) => a + b, 0)).toBe(3);
    expect(latency.sumMs).toBeGreaterThan(0);
    expect(latency.p95UpperBoundMs).not.toBeNull();
    expect(snap.totals.latency.count).toBe(3);
  });

  it('sends a new route past maxSeries to __other__', async () => {
    const { app, metrics } = buildApp({ maxSeries: 2 });
    await request(app).get('/one');
    await request(app).get('/two');
    await request(app).get('/three');

    const snap = await settled(metrics, 3);

    expect(snap.routes.map((r) => r.route)).toEqual(['/one', '/two', '__other__']);
    expect(find(snap, '__other__').requests).toBe(1);
  });

  it('counts a request once, not on both finish and close', async () => {
    const { app, metrics } = buildApp();
    await request(app).get('/one');

    await settled(metrics, 1);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(metrics.snapshot().totals.requests).toBe(1);
    expect(find(metrics.snapshot(), '/one').requests).toBe(1);
  });
});
