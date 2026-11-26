import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const crypto = require('crypto');
const fs = require('fs');
const express = require('express');
const request = require('supertest');
const pipeline = require('../../src/reference-data/reference-imports/pipeline');

const routesPath = require.resolve('../../src/interface/routes/referenceImportsTestSupport.routes');
const MOCK_RESULT = { run: { runStatus: 'completed' }, releaseId: 'rel-1', approved: true, idempotent: false, assetUri: 'objstore://x' };

describe('reference-imports test-support routes (#1476)', () => {
  const originalSecret = process.env.TEST_SUPPORT_SECRET;
  let app;
  let runImport;

  beforeEach(() => {
    process.env.TEST_SUPPORT_SECRET = 'the-real-secret';
    runImport = vi.spyOn(pipeline, 'runImport').mockResolvedValue(MOCK_RESULT);

    delete require.cache[routesPath];
    const router = require(routesPath);
    app = express();
    app.use(express.json());
    app.locals.db = { collection() { throw new Error('no db in this test'); } };
    app.use('/api/_test-support/reference-import-runs', router);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalSecret === undefined) delete process.env.TEST_SUPPORT_SECRET;
    else process.env.TEST_SUPPORT_SECRET = originalSecret;
  });

  function post(path, body, secret = 'the-real-secret') {
    return request(app)
      .post(`/api/_test-support/reference-import-runs/${path}`)
      .set('x-test-support-secret', secret)
      .send(body);
  }

  it('refuses a call without the test-support secret', async () => {
    const response = await post('run', { datasetCode: 'E2E_X', datasetVersion: 'v1', records: [{ id: 'HP:1', lbl: 'x' }] }, 'wrong-secret');
    expect(response.status).toBe(403);
    expect(runImport).not.toHaveBeenCalled();
  });

  it('refuses a datasetCode outside the E2E_ namespace', async () => {
    const response = await post('run', { datasetCode: 'HPO', datasetVersion: 'v1', records: [{ id: 'HP:1', lbl: 'x' }] });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('invalid_dataset_code');
    expect(runImport).not.toHaveBeenCalled();
  });

  it('refuses an empty records array', async () => {
    const response = await post('run', { datasetCode: 'E2E_X', datasetVersion: 'v1', records: [] });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('invalid_records');
    expect(runImport).not.toHaveBeenCalled();
  });

  it('runs the real pipeline on a source whose checksum is the posted records\' own, and removes the temp file', async () => {
    let source = null;
    let fileSha256 = null;
    runImport.mockImplementation(async (args) => {
      source = args.source;
      fileSha256 = crypto.createHash('sha256').update(fs.readFileSync(source.fixturePath)).digest('hex');
      return MOCK_RESULT;
    });

    const response = await post('run', {
      datasetCode: 'E2E_X',
      datasetVersion: 'v1',
      records: [{ id: 'HP:1', lbl: 'one' }, { id: 'HP:2', lbl: 'two' }],
    });

    expect(response.status).toBe(200);
    expect(runImport).toHaveBeenCalledTimes(1);
    expect(fileSha256).toBe(source.expectedChecksum);
    expect(source.datasetCode).toBe('E2E_X');
    expect(source.systemUri).toBe('urn:bioavanced:e2e:E2E_X');
    expect(source.sourceId).toBe('SRC_HPO');
    expect(fs.existsSync(source.fixturePath)).toBe(false);
    expect(response.body.data.releaseId).toBe('rel-1');
  });

  it('refuses an asset check whose checksum is not 64 hex digits', async () => {
    const response = await post('asset', { datasetCode: 'E2E_X', checksum: 'abc' });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('invalid_checksum');
  });

  it('reports a missing preserved asset as not existing', async () => {
    const response = await post('asset', { datasetCode: `E2E_MISSING_${Date.now()}`, checksum: '0'.repeat(64) });
    expect(response.status).toBe(200);
    expect(response.body.data.exists).toBe(false);
    expect(response.body.data.sha256).toBe(null);
  });
});
