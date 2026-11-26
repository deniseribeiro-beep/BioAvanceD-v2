import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const express = require('express');
const request = require('supertest');
const { createFakeDb } = require('../unit/foundation/helpers/fake-db');
const { CANONICAL_COLLECTIONS } = require('../../src/config/collections');
const { CANONICAL_MODEL_RELEASE_ID } = require('../../src/foundation/readiness');

const routesPath = require.resolve('../../src/interface/routes/foundationRunsTestSupport.routes');

// RF022/RNF031 (#1485): the route runs the Foundation job's own runSeed()
// against a scratch database, never the stack's own.
describe('foundation-runs test-support routes (#1485)', () => {
  const originalSecret = process.env.TEST_SUPPORT_SECRET;
  let app;
  let live;
  let scratch;

  beforeEach(() => {
    process.env.TEST_SUPPORT_SECRET = 'the-real-secret';
    delete require.cache[routesPath];
    const router = require(routesPath);
    scratch = {};
    live = createFakeDb();
    live.databaseName = 'bioavanced_test';
    live.client = { db: (name) => (scratch[name] ||= createFakeDb()) };
    app = express();
    app.use(express.json());
    app.locals.db = live;
    app.use('/api/_test-support/foundation-runs', router);
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.TEST_SUPPORT_SECRET;
    else process.env.TEST_SUPPORT_SECRET = originalSecret;
  });

  function post(body, secret = 'the-real-secret') {
    return request(app)
      .post('/api/_test-support/foundation-runs/run')
      .set('x-test-support-secret', secret)
      .send(body);
  }

  it('refuses a call without the test-support secret', async () => {
    const response = await post({ database: 'e2e_foundation_a', mode: 'apply' }, 'wrong-secret');
    expect(response.status).toBe(403);
    expect(Object.keys(scratch)).toEqual([]);
  });

  it('refuses a database outside the e2e_foundation_ namespace', async () => {
    for (const database of ['bioavanced_test', 'e2e_foundation_', 'e2e_foundation_A', 'e2e_foundation_a.b', 42]) {
      const response = await post({ database, mode: 'apply' });
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('invalid_database');
    }
    expect(Object.keys(scratch)).toEqual([]);
  });

  it('refuses a mode the job does not run', async () => {
    for (const mode of ['list', 'APPLY', '', undefined]) {
      const response = await post({ database: 'e2e_foundation_a', mode });
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('invalid_mode');
    }
    expect(Object.keys(scratch)).toEqual([]);
  });

  it('runs dry-run, apply, verify and rollback on the scratch database and leaves the stack database untouched', async () => {
    const database = 'e2e_foundation_cycle';
    const dry = (await post({ database, mode: 'dry_run' })).body.data;
    const applied = (await post({ database, mode: 'apply' })).body.data;
    const verified = (await post({ database, mode: 'validate' })).body.data;
    const rolled = (await post({ database, mode: 'rollback' })).body.data;

    expect(dry.run).toMatchObject({ executionMode: 'dry_run', dryRunResult: 'pass', applyResult: 'not_run' });
    expect(dry.report).toBeNull();
    expect(applied.run).toMatchObject({ executionMode: 'apply', runStatus: 'completed', applyResult: 'pass', verifyResult: 'pass', rollbackResult: 'not_required' });
    expect(applied.report).toMatchObject({ status: 'ready', blockers: [] });
    expect(applied.report.gateResults.find((gate) => gate.gate === 'rcs')).toMatchObject({ result: 'pass', p0: true });
    expect(verified.run).toMatchObject({ executionMode: 'validate', verifyResult: 'pass' });
    expect(verified.report.status).toBe('ready');
    expect(rolled.run).toMatchObject({ executionMode: 'rollback', runStatus: 'rolled_back', rollbackResult: 'pass' });
    expect(rolled.run.validationSummary.rollbackTargetRunId).toBe(applied.run.foundationDataRunId);
    expect(rolled.report).toMatchObject({ status: 'blocked', blockers: [`rolled_back:${applied.run.foundationDataRunId}`] });
    expect(rolled.exitCode).toBe(0);

    expect(scratch[database].collection(CANONICAL_COLLECTIONS.foundationDataRuns).docs).toHaveLength(4);
    expect(live.collection(CANONICAL_COLLECTIONS.foundationDataRuns).docs).toHaveLength(0);
    expect(live.collection(CANONICAL_COLLECTIONS.readinessReports).docs).toHaveLength(0);
  }, 60_000);

  it('blocks an apply whose release arrives with a different dictionary checksum', async () => {
    const database = 'e2e_foundation_drift';
    live.client.db(database).collection(CANONICAL_COLLECTIONS.foundationDataRuns).insertOne({
      environment: 'test', runStatus: 'completed', startedAt: new Date(0),
      canonicalModelReleaseId: CANONICAL_MODEL_RELEASE_ID, dictionaryChecksum: 'a-different-catalog',
    });
    const { data } = (await post({ database, mode: 'apply' })).body;

    expect(data.run).toMatchObject({ runStatus: 'failed', dryRunResult: 'fail', applyResult: 'not_run' });
    expect(data.report.status).toBe('blocked');
    expect(data.report.blockers).toEqual(expect.arrayContaining(['gate:version', 'dry_run_failed']));
    expect(data.exitCode).toBe(2);
  });

  it('blocks an apply whose registered release carries a different checksum', async () => {
    const database = 'e2e_foundation_registry';
    await post({ database, mode: 'apply' });
    scratch[database].collection(CANONICAL_COLLECTIONS.canonicalModelReleases).docs[0].checksum = 'sha256:registered-elsewhere';
    const { data } = (await post({ database, mode: 'apply' })).body;

    expect(data.report.status).toBe('blocked');
    expect(data.report.blockers).toEqual(['gate:governance-registry']);
    expect(data.report.gateResults.find((gate) => gate.gate === 'governance-registry').evidence.failures).toEqual(['checksum da canonicalModelRelease diverge']);
    expect(data.exitCode).toBe(2);
  }, 60_000);
});
