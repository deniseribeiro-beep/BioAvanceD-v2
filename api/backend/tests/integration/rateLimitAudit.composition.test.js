import { describe, it, expect, afterEach, vi } from 'vitest';
const express = require('express');
const rateLimit = require('express-rate-limit');
const request = require('supertest');

const auditLogger = require('../../src/utils/auditLogger');
const { auditRequest } = require('../../src/infrastructure/middleware/audit.middleware');

// #1230: app.js mounts auditRequest (app.js:194) BEFORE globalLimiter
// (app.js:244), so a limiter refusal is sent through the already-wrapped
// res.send and gets its own audit row -- every request is recorded, the
// refused ones included. That is the posture #1230 settled on (volume is
// retention's job, #667), and this pins the composition it depends on.
//
// app.js itself cannot show it under vitest: NODE_ENV=test skips every
// limiter (the !isTest block). So this rebuilds the same ORDER with the real
// middleware and the real express-rate-limit, and nothing else.

function flushAudit() {
  return new Promise((resolve) => setImmediate(() => setImmediate(resolve)));
}

function buildApp() {
  const app = express();
  app.locals.db = {};
  app.use(auditRequest);
  app.use(rateLimit({ windowMs: 60 * 1000, max: 1, standardHeaders: true, legacyHeaders: false }));
  app.post('/api/iot/telemetry', (req, res) => {
    res.locals.auditReason = 'missing_sensor_id';
    res.status(400).json({ success: false });
  });
  return app;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('#1230: a limiter refusal mounted after auditRequest is itself audited', () => {
  it('writes a row for the 429 as well as for the request before it', async () => {
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    const app = buildApp();

    const first = await request(app).post('/api/iot/telemetry').send({});
    const second = await request(app).post('/api/iot/telemetry').send({});
    await flushAudit();

    // CONTROL: the limiter really refused the second request.
    expect(first.status).toBe(400);
    expect(second.status).toBe(429);

    const rows = logSpy.mock.calls.map((call) => call[0]);
    expect(rows.map((row) => row.payload.statusCode)).toEqual([400, 429]);

    // The 429 never reached the handler, so it carries no reason -- the
    // limiter's refusal is recorded as the status alone.
    expect(rows[0].payload.reason).toBe('missing_sensor_id');
    expect(rows[1].payload).not.toHaveProperty('reason');
    expect(rows[1].action).toBe('CREATE_FAILED');
  });

  // CONTROL: the ORDER is what does it. With the limiter ahead of
  // auditRequest the 429 is sent before res.send is wrapped, and no row is
  // written -- the shape #1230 rejected (RF012: every AuditEvent recorded).
  it('CONTROL: a limiter mounted before auditRequest leaves its 429 unaudited', async () => {
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    const app = express();
    app.locals.db = {};
    app.use(rateLimit({ windowMs: 60 * 1000, max: 1, standardHeaders: true, legacyHeaders: false }));
    app.use(auditRequest);
    app.post('/api/iot/telemetry', (req, res) => res.status(400).json({ success: false }));

    await request(app).post('/api/iot/telemetry').send({});
    const second = await request(app).post('/api/iot/telemetry').send({});
    await flushAudit();

    expect(second.status).toBe(429);
    expect(logSpy.mock.calls.map((call) => call[0].payload.statusCode)).toEqual([400]);
  });
});
