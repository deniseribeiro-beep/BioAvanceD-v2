const express = require('express');
const request = require('supertest');

const gateway = require('../../src/ingestion/ingestionGateway');
const auditLogger = require('../../src/utils/auditLogger');

vi.spyOn(gateway, 'ingestRecord');
vi.spyOn(auditLogger, 'init').mockImplementation(() => undefined);
vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);

const router = require('../../src/interface/routes/ingestionTestSupport.routes');

function appWith(db) {
  const app = express();
  app.use(express.json());
  app.locals.db = db;
  app.use('/ingestion-test', router);
  return app;
}

describe('ingestion test-support probe', () => {
  const secret = 'probe-secret';

  beforeEach(() => {
    process.env.TEST_SUPPORT_SECRET = secret;
    gateway.ingestRecord.mockReset();
    auditLogger.log.mockClear();
  });

  it('refuses a request without the support secret', async () => {
    const response = await request(appWith({})).post('/ingestion-test/probe').send({});
    expect(response.status).toBe(403);
  });

  it('reports a missing database before it calls the gateway', async () => {
    const response = await request(appWith(null))
      .post('/ingestion-test/probe')
      .set('x-test-support-secret', secret);
    expect(response.status).toBe(503);
    expect(gateway.ingestRecord).not.toHaveBeenCalled();
  });

  it('audits an accepted record and a quarantined one, including an empty body', async () => {
    gateway.ingestRecord
      .mockResolvedValueOnce({ status: 'accepted' })
      .mockResolvedValueOnce({
        status: 'quarantined',
        quarantineRecord: { ingestionQuarantineRecordId: 'q-1' },
        violations: [{ code: 'x' }],
      });

    const accepted = await request(appWith({ name: 'db' }))
      .post('/ingestion-test/probe')
      .set('x-test-support-secret', secret)
      .send({
        entityType: 'Sample',
        schemaId: 'schema-1',
        aliasMap: { a: 'b' },
        payload: { ok: true },
        provenance: { source: 'probe' },
        idempotencyKey: 'key-1',
        references: ['ref'],
        referenceCodes: ['code'],
      });
    expect(accepted.status).toBe(200);
    expect(accepted.body.status).toBe('accepted');
    expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
      status: 'success',
      severity: 'info',
      resourceType: 'Sample',
      payload: expect.objectContaining({ violationCount: 0 }),
    }));

    const quarantined = await request(appWith({ name: 'db' }))
      .post('/ingestion-test/probe')
      .set('x-test-support-secret', secret);
    expect(quarantined.status).toBe(200);
    expect(quarantined.body.status).toBe('quarantined');
    expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
      status: 'warning',
      severity: 'warning',
      resourceType: 'Unknown',
      resourceId: 'q-1',
      payload: expect.objectContaining({ violationCount: 1 }),
    }));
    expect(gateway.ingestRecord).toHaveBeenLastCalledWith(expect.objectContaining({
      schemaId: null,
      aliasMap: {},
      idempotencyKey: null,
      references: [],
      referenceCodes: [],
    }));
  });

  it('maps a gateway failure to its status and a bare failure to 500', async () => {
    const coded = new Error('recusado');
    coded.statusCode = 422;
    gateway.ingestRecord.mockRejectedValueOnce(coded);
    const rejected = await request(appWith({ name: 'db' }))
      .post('/ingestion-test/probe')
      .set('x-test-support-secret', secret)
      .send({});
    expect(rejected.status).toBe(422);
    expect(rejected.body.error).toBe('recusado');

    gateway.ingestRecord.mockRejectedValueOnce('falha');
    const bare = await request(appWith({ name: 'db' }))
      .post('/ingestion-test/probe')
      .set('x-test-support-secret', secret)
      .send({});
    expect(bare.status).toBe(500);
    expect(bare.body.error).toBe('falha');
  });
});
