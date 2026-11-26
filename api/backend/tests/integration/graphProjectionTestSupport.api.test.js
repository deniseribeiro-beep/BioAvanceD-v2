import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const express = require('express');
const request = require('supertest');
const reconcileScript = require('../../scripts/graph-projection-reconcile');

const routesPath = require.resolve('../../src/interface/routes/graphProjectionTestSupport.routes');

// RF023 AC6, RNF019 C6 C7 (#1502): the route runs the reconciliation
// script's own reconcile(), always scoped to the samples it is given.
describe('graph-projection test-support routes (#1502)', () => {
  const originalSecret = process.env.TEST_SUPPORT_SECRET;
  const specimenId = '64b0c0ffee0000000000abcd';
  const canned = { projectorName: 'canonical', unprojected: [], samplesMissingFromGraph: [], reappended: 0 };
  let app;
  let db;
  let sessions;
  let reconcile;

  beforeEach(() => {
    process.env.TEST_SUPPORT_SECRET = 'the-real-secret';
    delete require.cache[routesPath];
    const router = require(routesPath);
    db = {};
    sessions = [];
    reconcile = vi.spyOn(reconcileScript, 'reconcile').mockResolvedValue(canned);
    app = express();
    app.use(express.json());
    app.locals.db = db;
    app.locals.neo4jDriver = {
      session: (opts) => {
        const session = { opts, closes: 0, close: async () => { session.closes += 1; } };
        sessions.push(session);
        return session;
      },
    };
    app.use('/api/_test-support/graph-projection', router);
  });

  afterEach(() => {
    reconcile.mockRestore();
    if (originalSecret === undefined) delete process.env.TEST_SUPPORT_SECRET;
    else process.env.TEST_SUPPORT_SECRET = originalSecret;
  });

  function post(body, secret = 'the-real-secret') {
    return request(app)
      .post('/api/_test-support/graph-projection/reconcile')
      .set('x-test-support-secret', secret)
      .send(body);
  }

  it('refuses a call without the test-support secret', async () => {
    const response = await post({ specimenIds: [specimenId], repair: true }, 'wrong-secret');
    expect(response.status).toBe(403);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('refuses a missing, empty, oversized or malformed specimen list, never running unscoped', async () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => i.toString(16).padStart(24, '0'));
    for (const specimenIds of [undefined, [], tooMany, ['not-an-id'], [42], specimenId]) {
      const response = await post({ specimenIds, repair: true });
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('invalid_specimen_ids');
    }
    expect(reconcile).not.toHaveBeenCalled();
    expect(sessions).toEqual([]);
  });

  it('refuses a repair that is not a boolean', async () => {
    for (const repair of [undefined, 'true', 1]) {
      const response = await post({ specimenIds: [specimenId], repair });
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('invalid_repair');
    }
    expect(reconcile).not.toHaveBeenCalled();
    expect(sessions).toEqual([]);
  });

  it('answers 503 when Neo4j is not connected', async () => {
    app.locals.neo4jDriver = null;
    const response = await post({ specimenIds: [specimenId], repair: true });
    expect(response.status).toBe(503);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('runs the reconciliation scoped to the named samples on a read session, and closes it', async () => {
    const response = await post({ specimenIds: [specimenId], repair: true });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: canned });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].opts).toMatchObject({ defaultAccessMode: 'READ' });
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile.mock.calls[0][0]).toBe(db);
    expect(reconcile.mock.calls[0][1]).toEqual({ repair: true, specimenIds: [specimenId], neo4jSession: sessions[0] });
    expect(reconcile.mock.calls[0][1].neo4jSession).toBe(sessions[0]);
    expect(sessions[0].closes).toBe(1);
  });

  it('answers 500 when the reconciliation fails, and still closes the session', async () => {
    reconcile.mockRejectedValue(new Error('graph down'));
    const response = await post({ specimenIds: [specimenId], repair: false });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ success: false, error: 'graph down' });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].closes).toBe(1);
  });
});
