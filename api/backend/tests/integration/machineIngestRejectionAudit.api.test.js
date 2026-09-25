import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const auditLogger = require('../../src/utils/auditLogger');
const { createDbMock } = require('../factories/db.factory');

// #1095 asked whether a rejected machine-ingest submission leaves any record on
// the two HTTP transports, the way the MQTT sibling's three `reason` codes do.
// It does, and not from either controller: app.js:194 mounts
// audit.middleware.js#auditRequest GLOBALLY, before every route mount, and it
// wraps res.send -- so it fires on the 400 and on the gate's 403 alike, the
// latter before the controller runs at all.
//
// Nothing pinned that composition. audit.middleware.test.js pins the
// 4xx->action mapping in isolation and iot.controller.test.js pins the
// controller's explicit accepted-path row in isolation; both call their subject
// directly, so neither shows that a rejected telemetry POST produces a row --
// and neither could show #1119, which only exists once a real mounted router is
// in the path.
//
// #1119: these cases are also the end-to-end pin for the resourceType fix. The
// split matters when reading a failure:
//   CONTROL (unchanged by #1119) - the status code, and `action`, which comes
//     from the statusCode branch and from the HTTP verb, not from the path.
//   DISCRIMINATING - `resourceType` and `payload.path`, which pre-fix read
//     'Sistema' and '/telemetry' because the wrapper saw Express's
//     router-relative path.

const INGEST_SECRET = 'vitest-telemetry-secret';

function flushAudit() {
  // auditRequest defers its write with setImmediate so it cannot block the
  // response, so assertions have to let that callback run first.
  return new Promise((resolve) => setImmediate(() => setImmediate(resolve)));
}

describe('#1095/#1119: HTTP machine-ingest rejections are audited, with the right entity', () => {
  let auditLogSpy;

  beforeEach(() => {
    process.env.TELEMETRY_INGEST_SECRET = INGEST_SECRET;
    app.locals.db = createDbMock({});
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    auditLogSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env.TELEMETRY_INGEST_SECRET;
    vi.restoreAllMocks();
  });

  function soleRow() {
    const rows = auditLogSpy.mock.calls.map((call) => call[0]);
    expect(rows).toHaveLength(1);
    return rows[0];
  }

  it('audits an INVALID PAYLOAD on POST /api/iot/telemetry', async () => {
    const res = await request(app)
      .post('/api/iot/telemetry')
      .set('x-telemetry-ingest-secret', INGEST_SECRET)
      .send({ sensorId: '', temperature: 'abc' });

    expect(res.status).toBe(400);
    await flushAudit();
    const row = soleRow();

    // CONTROL: POST -> CREATE, then _FAILED for a non-401/403 4xx.
    expect(row.action).toBe('CREATE_FAILED');
    expect(row.status).toBe('error');
    expect(row.severity).toBe('warning');
    expect(row.payload.statusCode).toBe(400);

    // #1119: ENTITY_MAP['iot'], reachable only from the unstripped path.
    expect(row.payload.path).toBe('/api/iot/telemetry');
    expect(row.resourceType).toBe('TelemetryReading');
    // #1120: empty sensorId wins over non-finite temperature when both fail.
    expect(row.payload.reason).toBe('empty_sensorId');
    expect(res.body.reason).toBe('empty_sensorId');
  });

  it('#1120: names non_finite_temperature when sensorId is present but temperature is not finite', async () => {
    const res = await request(app)
      .post('/api/iot/telemetry')
      .set('x-telemetry-ingest-secret', INGEST_SECRET)
      .send({ sensorId: 'sensor-1', temperature: 'abc' });

    expect(res.status).toBe(400);
    await flushAudit();
    const row = soleRow();

    expect(row.action).toBe('CREATE_FAILED');
    expect(row.payload.reason).toBe('non_finite_temperature');
    expect(res.body.reason).toBe('non_finite_temperature');
  });

  // The gate refusal is the case #1095 called "arguably the most
  // security-relevant of the four" and left [not established]. It is recorded,
  // even though requireMachineIngestSecret returns before the controller runs.
  it('audits a GATE REFUSAL on POST /api/iot/telemetry as FORBIDDEN', async () => {
    const res = await request(app)
      .post('/api/iot/telemetry')
      .set('x-telemetry-ingest-secret', 'wrong-secret')
      .send({ sensorId: 'sensor-1', temperature: 5 });

    expect(res.status).toBe(403);
    await flushAudit();
    const row = soleRow();

    // CONTROL: the 403 branch names the action, whatever the path.
    expect(row.action).toBe('FORBIDDEN');
    expect(row.status).toBe('error');
    expect(row.payload.statusCode).toBe(403);

    expect(row.payload.path).toBe('/api/iot/telemetry');
    expect(row.resourceType).toBe('TelemetryReading');
  });

  it('audits a GATE REFUSAL on the temperature sibling, with its own entity', async () => {
    const res = await request(app)
      .post('/api/temperature/system/reading')
      .set('x-telemetry-ingest-secret', 'wrong-secret')
      .send({ sensorId: 'sensor-1', temperatureValue: 5 });

    expect(res.status).toBe(403);
    await flushAudit();
    const row = soleRow();

    expect(row.action).toBe('FORBIDDEN');
    expect(row.payload.path).toBe('/api/temperature/system/reading');
    // Distinct from the iot sibling's TelemetryReading -- the two machine
    // routes are different entities, which is only visible once the path is
    // unstripped.
    expect(row.resourceType).toBe('Temperature');
    expect(row.module).toBe('Monitoramento');
  });

  // CONTROL: unaffected by #1119 in both directions. The ignoredPaths check
  // runs synchronously at middleware entry, while req.path is still full, so
  // it never had the bug and must not acquire one.
  it('CONTROL: /api/health is still skipped entirely and writes no row', async () => {
    await request(app).get('/api/health');
    await flushAudit();

    expect(auditLogSpy).not.toHaveBeenCalled();
  });
});
