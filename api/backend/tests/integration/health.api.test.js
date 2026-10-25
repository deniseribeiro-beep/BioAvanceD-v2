import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const dependencyHealth = require('../../src/infrastructure/health/dependencyHealth');
const { createDbMock } = require('../factories/db.factory');

// RNF003 AC3 (#1323): the route maps a dependency report onto the HTTP code.
// checkDependencies is replaced with canned reports, so no case reaches a
// real dependency.

function check(status, critical, reason) {
  return { status, critical, latencyMs: 1, ...(reason ? { reason } : {}) };
}

function report({ mongodb = check('up', true), neo4j = check('up', false), redis = check('up', false), influxdb = check('not_configured', false) } = {}) {
  const checks = { mongodb, neo4j, redis, influxdb };
  const all = Object.values(checks);
  return {
    critical: all.some((c) => c.critical && c.status === 'down'),
    degraded: all.some((c) => !c.critical && c.status === 'down'),
    checks,
  };
}

describe('#1323: GET /api/health', () => {
  beforeEach(() => {
    app.locals.db = createDbMock({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('answers 200 with status OK and db true when no critical check is down', async () => {
    vi.spyOn(dependencyHealth, 'checkDependencies').mockResolvedValue(report());

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'OK', db: true, degraded: false });
    expect(res.body.checks.mongodb.status).toBe('up');
  });

  it('answers 200 with degraded true when only Redis is down', async () => {
    vi.spyOn(dependencyHealth, 'checkDependencies').mockResolvedValue(
      report({ redis: check('down', false, 'not_connected') }),
    );

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'OK', db: true, degraded: true });
    expect(res.body.checks.redis).toMatchObject({ status: 'down', reason: 'not_connected' });
  });

  it('answers 503 with status UNAVAILABLE when a critical check is down', async () => {
    vi.spyOn(dependencyHealth, 'checkDependencies').mockResolvedValue(
      report({ mongodb: check('down', true, 'timeout') }),
    );

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: 'UNAVAILABLE', db: false });
    expect(res.body.checks.mongodb.reason).toBe('timeout');
  });
});
