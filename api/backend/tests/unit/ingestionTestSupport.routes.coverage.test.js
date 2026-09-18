import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const routePath = require.resolve('../../src/interface/routes/ingestionTestSupport.routes');
const gatewayPath = require.resolve('../../src/ingestion/ingestionGateway');
const gatePath = require.resolve('../../src/utils/testSupportGate');
const auditPath = require.resolve('../../src/utils/auditLogger');

let ingestRecord;
let auditLogger;

function setCached(modulePath, exports) {
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports,
  };
}

function loadRouter(enabled = true) {
  ingestRecord = vi.fn();
  auditLogger = {
    init: vi.fn(),
    log: vi.fn().mockResolvedValue(undefined),
  };
  setCached(gatewayPath, { ingestRecord });
  setCached(gatePath, {
    testSupportRoutesEnabled: vi.fn(() => enabled),
    requireTestSupportSecret: (_req, _res, next) => next(),
  });
  setCached(auditPath, auditLogger);
  delete require.cache[routePath];
  return require(routePath);
}

function makeApp(router, db) {
  const app = express();
  app.use(express.json());
  if (db !== undefined) app.locals.db = db;
  app.use('/ingestion', router);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  for (const modulePath of [routePath, gatewayPath, gatePath, auditPath]) {
    delete require.cache[modulePath];
  }
});

describe('ingestionTestSupport.routes item 8 branches', () => {
  it('does not register the probe when test-support routes are disabled', async () => {
    const app = makeApp(loadRouter(false), { marker: 'db' });
    const response = await request(app).post('/ingestion/probe').send({});
    expect(response.status).toBe(404);
  });

  it('returns 503 when the database is unavailable', async () => {
    const app = makeApp(loadRouter(true), undefined);
    const response = await request(app).post('/ingestion/probe').send({});
    expect(response.status).toBe(503);
    expect(ingestRecord).not.toHaveBeenCalled();
  });

  it('passes canonical defaults and audits an accepted outcome', async () => {
    const db = { marker: 'db' };
    const app = makeApp(loadRouter(true), db);
    ingestRecord.mockResolvedValue({ status: 'accepted' });

    const response = await request(app).post('/ingestion/probe').send({
      entityType: 'Specimen',
      payload: { specimenId: 'SPEC-1' },
      provenance: { source: 'synthetic' },
    });

    expect(response.status).toBe(200);
    expect(ingestRecord).toHaveBeenCalledWith({
      db,
      entityType: 'Specimen',
      schemaId: null,
      aliasMap: {},
      payload: { specimenId: 'SPEC-1' },
      provenance: { source: 'synthetic' },
      idempotencyKey: null,
      references: [],
      referenceCodes: [],
    });
    expect(auditLogger.init).toHaveBeenCalledWith(db);
    expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'INGESTION_GATEWAY_PROBE',
      resourceType: 'Specimen',
      resourceId: null,
      status: 'success',
      severity: 'info',
      payload: { entityType: 'Specimen', status: 'accepted', violationCount: 0 },
    }));
    expect(response.body).toEqual({ success: true, status: 'accepted' });
  });

  it('passes explicit optional inputs and audits a quarantined outcome', async () => {
    const db = { marker: 'db' };
    const app = makeApp(loadRouter(true), db);
    ingestRecord.mockResolvedValue({
      status: 'quarantined',
      quarantineRecord: { ingestionQuarantineRecordId: 'Q-1' },
      violations: [{ code: 'V1' }, { code: 'V2' }],
    });

    const response = await request(app).post('/ingestion/probe').send({
      schemaId: 'schema-1',
      aliasMap: { old: 'new' },
      payload: { any: true },
      provenance: { source: 'synthetic' },
      idempotencyKey: 'idem-1',
      references: [{ type: 'Study', id: 'S-1' }],
      referenceCodes: ['HPO:1'],
    });

    expect(response.status).toBe(200);
    expect(ingestRecord).toHaveBeenCalledWith(expect.objectContaining({
      schemaId: 'schema-1',
      aliasMap: { old: 'new' },
      idempotencyKey: 'idem-1',
      references: [{ type: 'Study', id: 'S-1' }],
      referenceCodes: ['HPO:1'],
    }));
    expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
      resourceType: 'Unknown',
      resourceId: 'Q-1',
      status: 'warning',
      severity: 'warning',
      payload: { entityType: undefined, status: 'quarantined', violationCount: 2 },
    }));
  });

  it('uses an explicit statusCode/message from gateway errors', async () => {
    const app = makeApp(loadRouter(true), { marker: 'db' });
    const error = Object.assign(new Error('invalid ingestion'), { statusCode: 422 });
    ingestRecord.mockRejectedValue(error);

    const response = await request(app).post('/ingestion/probe').send({});
    expect(response.status).toBe(422);
    expect(response.body).toEqual({ success: false, error: 'invalid ingestion' });
  });

  it('falls back to 500 and String(error) for non-Error rejections', async () => {
    const app = makeApp(loadRouter(true), { marker: 'db' });
    ingestRecord.mockRejectedValue('raw gateway failure');

    const response = await request(app).post('/ingestion/probe').send({});
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ success: false, error: 'raw gateway failure' });
  });
});
