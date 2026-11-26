import { describe, it, expect, vi, afterEach } from 'vitest';

const temperatureController = require('../../src/controllers/temperature.controller');
const temperatureService = require('../../src/services/temperature.service');
const auditLogger = require('../../src/utils/auditLogger');
const logger = require('../../src/utils/logger');

function buildRes() {
  // Express always supplies res.locals; #1120's audit reason is written there.
  const res = { locals: {} };
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('temperature.controller.createReading', () => {
  it('returns 503 when req.app.locals.db is falsy', async () => {
    const req = { app: { locals: { db: null } }, body: {} };
    const res = buildRes();

    await temperatureController.createReading(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Banco de dados não disponível' });
  });

  it('creates a reading and returns 201, without auditing when req.user is absent', async () => {
    const fakeReading = { telemetryReadingId: 'r1', temperatureValue: 4.2, temperatureUnit: 'C' };
    vi.spyOn(temperatureService, 'createTemperatureReading').mockResolvedValue(fakeReading);
    const req = { app: { locals: { db: {} } }, body: { value: 4.2 } };
    const res = buildRes();

    await temperatureController.createReading(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Leitura de temperatura registrada',
      data: fakeReading,
    });
  });

  // #1317 (RF009 AC7): a replayed idempotencyKey wrote nothing.
  it('answers 200 with the stored reading for a replayed idempotencyKey, and records no CREATE', async () => {
    const stored = { telemetryReadingId: 'r0', temperatureValue: 4.2, replayed: true };
    vi.spyOn(temperatureService, 'createTemperatureReading').mockResolvedValue(stored);
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    const req = { app: { locals: { db: {} } }, body: { idempotencyKey: 'k-1' }, organizationScope: { scope: 'global' } };
    const res = buildRes();

    await temperatureController.createReading(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, data: stored }));
    expect(logSpy).not.toHaveBeenCalled();
  });

  // #1317 (RF009 AC1): InfluxDB did not confirm the write, nothing was stored.
  it('answers 503 with the code when InfluxDB did not persist the reading', async () => {
    vi.spyOn(temperatureService, 'createTemperatureReading')
      .mockRejectedValue(Object.assign(new Error('Leitura não persistida no InfluxDB: down'), { statusCode: 503, code: 'TELEMETRY_NOT_PERSISTED' }));
    const req = { app: { locals: { db: {} } }, body: {}, organizationScope: { scope: 'global' } };
    const res = buildRes();

    await temperatureController.createReading(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, code: 'TELEMETRY_NOT_PERSISTED' }));
  });

  it('returns 400 with the error message when the service throws', async () => {
    vi.spyOn(temperatureService, 'createTemperatureReading').mockRejectedValue(new Error('invalid payload'));
    const req = { app: { locals: { db: {} } }, body: {} };
    const res = buildRes();

    await temperatureController.createReading(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Erro ao registrar temperatura',
      message: 'invalid payload',
    });
  });

  // #636: organizationId lookup failures throw statusCode:404.
  it('returns 404 when creation throws a statusCode:404 error (organizationId not found)', async () => {
    const notFound = new Error('organizationId org-x não encontrado');
    notFound.statusCode = 404;
    vi.spyOn(temperatureService, 'createTemperatureReading').mockRejectedValue(notFound);
    const req = { app: { locals: { db: {} } }, body: { organizationId: 'org-x' } };
    const res = buildRes();

    await temperatureController.createReading(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  // #1080: POST /system/reading is machine ingest -- no session, so no
  // req.organizationScope. It used to keep the body's organizationId verbatim,
  // which let any TELEMETRY_INGEST_SECRET holder attribute a cold-chain reading
  // to ANY organization in the catalogue: assertOrganizationIdResolves only
  // checks that the organization EXISTS, never that the caller may write to it.
  // The organization is now derived from the sensor instead, which is where the
  // dictionary hangs organizational custody (TelemetryReading.sensorId, 1..1).
  function machineIngestSetup(sensorDoc, body) {
    const fakeReading = { telemetryReadingId: 'r1', temperatureValue: 4.2, temperatureUnit: 'C' };
    const create = vi.spyOn(temperatureService, 'createTemperatureReading').mockResolvedValue(fakeReading);
    const findOne = vi.fn().mockResolvedValue(sensorDoc);
    const db = { collection: vi.fn().mockReturnValue({ findOne }) };
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    const req = { app: { locals: { db } }, body };
    return { create, db, logSpy, req, res: buildRes(), fakeReading };
  }

  it('#1080: derives organizationId from the sensor, ignoring the body\'s', async () => {
    const { create, db, req, res } = machineIngestSetup(
      { sensorId: 's-1', organizationId: 'org-real' },
      { sensorId: 's-1', value: 4.2, organizationId: 'org-attacker' }
    );

    await temperatureController.createReading(req, res);

    expect(db.collection).toHaveBeenCalledWith('sensors');
    expect(create.mock.calls[0][1].organizationId).toBe('org-real');
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('#1080: 404s when the reading names a sensor that does not exist', async () => {
    const { create, req, res } = machineIngestSetup(null, { sensorId: 'ghost', value: 4.2, organizationId: 'org-attacker' });

    await temperatureController.createReading(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(create).not.toHaveBeenCalled();
  });

  // A sensor predating #634 carries organizationId: null by design -- that
  // commit declined to backfill. Rejecting it would turn a working telemetry
  // ingest into a hard outage on any legacy database, so it is stored
  // unattributed. The defect is still closed: the BODY cannot choose.
  it('#1080: stores null rather than rejecting when the sensor carries no organization', async () => {
    const { create, req, res } = machineIngestSetup(
      { sensorId: 's-legacy', organizationId: null },
      { sensorId: 's-legacy', value: 4.2, organizationId: 'org-attacker' }
    );

    await temperatureController.createReading(req, res);

    expect(create.mock.calls[0][1].organizationId).toBeNull();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  // temperatureValue, not value: a field this route does not read is stripped
  // and audited first (RULE-025, #1582), and this case reads the CREATE row.
  it('#1080: writes an audit row for the machine caller, which has no req.user', async () => {
    const { logSpy, req, res } = machineIngestSetup(
      { sensorId: 's-1', organizationId: 'org-real' },
      { sensorId: 's-1', temperatureValue: 4.2 }
    );

    await temperatureController.createReading(req, res);

    expect(logSpy).toHaveBeenCalled();
    const entry = logSpy.mock.calls[0][0];
    expect(entry.action).toBe('CREATE');
    expect(entry.resourceType).toBe('Temperature');
    // #1391: the reading's id, since no Mongo copy carries an _id.
    expect(entry.resourceId).toBe('r1');
    expect(res.status).toHaveBeenCalledWith(201);
  });

  // CONTROL: the authenticated path behaves identically before and after
  // #1080, so a red here in the pre-fix run means the setup is wrong rather
  // than the bug being present.
  it('CONTROL: the authenticated path stamps from the caller scope and looks up no sensor', async () => {
    const fakeReading = { telemetryReadingId: 'r1', temperatureValue: 4.2, temperatureUnit: 'C' };
    const create = vi.spyOn(temperatureService, 'createTemperatureReading').mockResolvedValue(fakeReading);
    const db = { collection: vi.fn() };
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    const req = {
      app: { locals: { db } },
      organizationScope: { scope: 'global' },
      user: { id: 'u1' },
      body: { sensorId: 's-1', value: 4.2, organizationId: 'org-a' },
    };
    const res = buildRes();

    await temperatureController.createReading(req, res);

    expect(db.collection).not.toHaveBeenCalledWith('sensors');
    expect(create.mock.calls[0][1].organizationId).toBe('org-a');
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

// RULE-025 (#1582): a reading sent with fields outside the route's contract
// reaches the service without them and with their names, and one security
// audit names them, never a value, written before any refusal. A
// contract-only body writes none.
describe('RULE-025 on the temperature routes (#1582)', () => {
  const PII_NAME = 'Maria da Silva 123.456.789-09';
  const extras = { patientName: PII_NAME, cpf: '12345678909' };

  function setup({ sensorDoc = { sensorId: 's-1', organizationId: 'org-real' }, body, organizationScope } = {}) {
    const fakeReading = { telemetryReadingId: 'r1', sensorId: 's-1', temperatureValue: 4.2, temperatureUnit: '°C' };
    const create = vi.spyOn(temperatureService, 'createTemperatureReading').mockResolvedValue(fakeReading);
    const findOne = vi.fn().mockResolvedValue(sensorDoc);
    const db = { collection: vi.fn().mockReturnValue({ findOne }) };
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    const req = { app: { locals: { db } }, body, ...(organizationScope ? { organizationScope } : {}) };
    return { create, logSpy, req, res: buildRes() };
  }

  const strippedAudits = (logSpy) => logSpy.mock.calls
    .map(([entry]) => entry)
    .filter((entry) => entry && entry.action === 'TELEMETRY_PII_STRIPPED');

  it('(a) passes a valid reading on without its extra fields and audits it once', async () => {
    const { create, logSpy, req, res } = setup({
      body: { sensorId: 's-1', temperatureValue: 4.2, ...extras },
      organizationScope: { scope: 'global' },
    });

    await temperatureController.createReading(req, res);

    const passed = create.mock.calls[0][1];
    expect(passed).not.toHaveProperty('patientName');
    expect(passed).not.toHaveProperty('cpf');
    expect(passed).toMatchObject({ sensorId: 's-1', temperatureValue: 4.2 });
    expect(create.mock.calls[0][2]).toEqual({ strippedFields: ['cpf', 'patientName'] });
    expect(strippedAudits(logSpy)).toEqual([expect.objectContaining({
      resourceType: 'TelemetryReading',
      resourceId: 's-1',
      severity: 'warning',
      source: 'api',
      payload: { ingestionService: 'temperature-api', fieldNames: ['cpf', 'patientName'], unlistedFieldCount: 0 },
    })]);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('(b) an unknown sensor on the machine route is refused 404 and still audited', async () => {
    const { create, logSpy, req, res } = setup({ sensorDoc: null, body: { sensorId: 'ghost', temperatureValue: 4.2, ...extras } });

    await temperatureController.createReading(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(strippedAudits(logSpy)).toHaveLength(1);
    expect(create).not.toHaveBeenCalled();
  });

  it('(c) a contract-only body writes no security audit', async () => {
    const { create, logSpy, req, res } = setup({ body: { sensorId: 's-1', temperatureValue: 4.2 } });

    await temperatureController.createReading(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(strippedAudits(logSpy)).toHaveLength(0);
    expect(create.mock.calls[0][2]).toEqual({ strippedFields: [] });
  });

  it('(d) no extra field value reaches a log or the response', async () => {
    const logCalls = Object.keys(logger)
      .filter((name) => typeof logger[name] === 'function')
      .map((name) => vi.spyOn(logger, name).mockImplementation(() => {}));
    const accepted = setup({ body: { sensorId: 's-1', temperatureValue: 4.2, ...extras }, organizationScope: { scope: 'global' } });
    await temperatureController.createReading(accepted.req, accepted.res);
    const refused = setup({ sensorDoc: null, body: { sensorId: 'ghost', temperatureValue: 4.2, ...extras } });
    await temperatureController.createReading(refused.req, refused.res);

    expect(accepted.res.status).toHaveBeenCalledWith(201);
    expect(refused.res.status).toHaveBeenCalledWith(404);
    // The refusal is logged, so the logs are read, not merely silent.
    expect(logCalls.some((spy) => spy.mock.calls.length)).toBe(true);
    const seen = JSON.stringify([
      ...logCalls.flatMap((spy) => spy.mock.calls),
      accepted.res.json.mock.calls,
      refused.res.json.mock.calls,
    ]);
    expect(seen).not.toContain('Maria');
    expect(seen).not.toContain('12345678909');
  });
});

describe('temperature.controller.getHistory', () => {
  it('returns 503 when req.app.locals.db is falsy', async () => {
    const req = { app: { locals: { db: null } }, query: {} };
    const res = buildRes();

    await temperatureController.getHistory(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('defaults limit/skip and maps sensorID to sensorId when delegating', async () => {
    vi.spyOn(temperatureService, 'getTemperatureHistory').mockResolvedValue({ items: [] });
    const req = { app: { locals: { db: {} } }, query: { sensorID: 'sensor-1' } };
    const res = buildRes();

    await temperatureController.getHistory(req, res);

    expect(temperatureService.getTemperatureHistory).toHaveBeenCalledWith(req.app.locals.db, {
      sensorId: 'sensor-1',
      startDate: undefined,
      endDate: undefined,
      limit: 1000,
      skip: 0,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { items: [] } });
  });

  it('returns 500 with the error message when the service throws', async () => {
    vi.spyOn(temperatureService, 'getTemperatureHistory').mockRejectedValue(new Error('boom'));
    const req = { app: { locals: { db: {} } }, query: {} };
    const res = buildRes();

    await temperatureController.getHistory(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Erro ao buscar histórico',
      message: 'boom',
    });
  });

  // #636: req.organizationScope must reach the service to filter/gate.
  it('passes req.organizationScope through to getTemperatureHistory', async () => {
    vi.spyOn(temperatureService, 'getTemperatureHistory').mockResolvedValue({ items: [] });
    const scope = { scope: 'organization', organizationIds: ['org-1'] };
    const req = { app: { locals: { db: {} } }, query: {}, organizationScope: scope };
    const res = buildRes();

    await temperatureController.getHistory(req, res);

    expect(temperatureService.getTemperatureHistory).toHaveBeenCalledWith(
      req.app.locals.db,
      expect.objectContaining({ organizationScope: scope })
    );
  });
});

describe('temperature.controller.getAlerts', () => {
  it('returns 503 when req.app.locals.db is falsy', async () => {
    const req = { app: { locals: { db: null } } };
    const res = buildRes();

    await temperatureController.getAlerts(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('returns active alerts from the service', async () => {
    vi.spyOn(temperatureService, 'getActiveAlerts').mockResolvedValue([{ _id: 'a1' }]);
    const req = { app: { locals: { db: {} } } };
    const res = buildRes();

    await temperatureController.getAlerts(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [{ _id: 'a1' }] });
  });

  it('returns 500 with the error message when the service throws', async () => {
    vi.spyOn(temperatureService, 'getActiveAlerts').mockRejectedValue(new Error('boom'));
    const req = { app: { locals: { db: {} } } };
    const res = buildRes();

    await temperatureController.getAlerts(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Erro ao buscar alertas',
      message: 'boom',
    });
  });
});

describe('temperature.controller.getAll', () => {
  it('returns 503 when req.app.locals.db is falsy', async () => {
    const req = { app: { locals: { db: null } }, query: {} };
    const res = buildRes();

    await temperatureController.getAll(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('defaults limit/skip to 100/0 and delegates to getTemperatureHistory', async () => {
    vi.spyOn(temperatureService, 'getTemperatureHistory').mockResolvedValue({ items: [] });
    const req = { app: { locals: { db: {} } }, query: { sensorId: 'sensor-1' } };
    const res = buildRes();

    await temperatureController.getAll(req, res);

    expect(temperatureService.getTemperatureHistory).toHaveBeenCalledWith(req.app.locals.db, {
      sensorId: 'sensor-1',
      limit: 100,
      skip: 0,
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 500 with the error message when the service throws', async () => {
    vi.spyOn(temperatureService, 'getTemperatureHistory').mockRejectedValue(new Error('boom'));
    const req = { app: { locals: { db: {} } }, query: {} };
    const res = buildRes();

    await temperatureController.getAll(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Erro ao listar leituras',
      message: 'boom',
    });
  });

  it('passes req.organizationScope through to getTemperatureHistory', async () => {
    vi.spyOn(temperatureService, 'getTemperatureHistory').mockResolvedValue({ items: [] });
    const scope = { scope: 'organization', organizationIds: ['org-1'] };
    const req = { app: { locals: { db: {} } }, query: {}, organizationScope: scope };
    const res = buildRes();

    await temperatureController.getAll(req, res);

    expect(temperatureService.getTemperatureHistory).toHaveBeenCalledWith(
      req.app.locals.db,
      expect.objectContaining({ organizationScope: scope })
    );
  });
});

// #1391 (RF009 AC1): the reading is read from InfluxDB by its
// telemetryReadingId (a uuid), through temperatureService.getReadingById.
describe('temperature.controller.getById', () => {
  const READING_ID = '0b6f7e2c-4a1d-4c3e-9f0a-1b2c3d4e5f60';
  const ORG_SCOPE = { scope: 'organization', organizationIds: ['org-1'] };

  function buildReq(id = READING_ID) {
    return { app: { locals: { db: {} } }, params: { id }, organizationScope: ORG_SCOPE };
  }

  it('returns 503 when req.app.locals.db is falsy', async () => {
    const req = { app: { locals: { db: null } }, params: { id: READING_ID } };
    const res = buildRes();

    await temperatureController.getById(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
  });

  // An old Mongo ObjectId, or a shadowed `control`, is no reading id.
  it.each(['507f1f77bcf86cd799439011', 'control', 'not-a-uuid'])('returns 404 for the non-uuid id %s without a read', async (id) => {
    const byId = vi.spyOn(temperatureService, 'getReadingById');
    const res = buildRes();

    await temperatureController.getById(buildReq(id), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Leitura não encontrada' });
    expect(byId).not.toHaveBeenCalled();
  });

  it('returns 404 when no reading has that id', async () => {
    vi.spyOn(temperatureService, 'getReadingById').mockResolvedValue(null);
    const res = buildRes();

    await temperatureController.getById(buildReq(), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Leitura não encontrada' });
  });

  it('returns 200 with the reading when it is within the caller organizationScope', async () => {
    const reading = { telemetryReadingId: READING_ID, sensorId: 'S-org1', temperatureValue: 4.2 };
    const byId = vi.spyOn(temperatureService, 'getReadingById').mockResolvedValue({ reading, inScope: true });
    const req = buildReq();
    const res = buildRes();

    await temperatureController.getById(req, res);

    expect(byId).toHaveBeenCalledWith(req.app.locals.db, READING_ID, ORG_SCOPE);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: reading });
  });

  // #636 (F3-G09): mirrors sensor.controller.js's own out-of-scope 403
  // pattern -- an org-scoped caller fetching a reading of a sensor outside
  // their organizations gets 403, not the reading's data.
  it('returns 403 when the reading is outside the caller organizationScope', async () => {
    vi.spyOn(temperatureService, 'getReadingById').mockResolvedValue({
      reading: { telemetryReadingId: READING_ID, sensorId: 'S-org2' },
      inScope: false,
    });
    const res = buildRes();

    await temperatureController.getById(buildReq(), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Acesso negado',
      message: 'Esta leitura pertence a outra organização'
    });
  });

  it('returns 500 with the error message when the read throws', async () => {
    vi.spyOn(temperatureService, 'getReadingById').mockRejectedValue(new Error('influx down'));
    const res = buildRes();

    await temperatureController.getById(buildReq(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].success).toBe(false);
    expect(res.json.mock.calls[0][0].error).toBe('Erro ao buscar leitura');
    expect(res.json.mock.calls[0][0].message).toBe('influx down');
  });
});

describe('temperature.controller.getControl', () => {
  it('returns 503 when req.app.locals.db is falsy, using req.t translation when available', async () => {
    const req = { app: { locals: { db: null } }, query: {}, t: vi.fn().mockReturnValue('translated unavailable') };
    const res = buildRes();

    await temperatureController.getControl(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'translated unavailable' });
    expect(req.t).toHaveBeenCalledWith('errors.databaseUnavailable');
  });

  it('falls back to the Portuguese message when req.t is absent', async () => {
    const req = { app: { locals: { db: null } }, query: {} };
    const res = buildRes();

    await temperatureController.getControl(req, res);

    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Banco de dados não disponível' });
  });

  it('strips undefined filters and defaults limit to 1000 when delegating', async () => {
    vi.spyOn(temperatureService, 'getTemperatureHistory').mockResolvedValue({ temperatures: [{ _id: 't1' }] });
    const req = { app: { locals: { db: {} } }, query: { sensorID: 'sensor-1' } };
    const res = buildRes();

    await temperatureController.getControl(req, res);

    expect(temperatureService.getTemperatureHistory).toHaveBeenCalledWith(req.app.locals.db, {
      sensorID: 'sensor-1',
      sensorId: 'sensor-1',
      limit: 1000,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [{ _id: 't1' }] });
  });

  it('falls back through result.data then result then [] when result.temperatures is absent', async () => {
    vi.spyOn(temperatureService, 'getTemperatureHistory').mockResolvedValue({ data: [{ _id: 't2' }] });
    const req = { app: { locals: { db: {} } }, query: {} };
    const res = buildRes();

    await temperatureController.getControl(req, res);

    expect(res.json).toHaveBeenCalledWith({ success: true, data: [{ _id: 't2' }] });
  });

  it('returns 500 with the translated error message when the service throws', async () => {
    vi.spyOn(temperatureService, 'getTemperatureHistory').mockRejectedValue(new Error('boom'));
    const req = { app: { locals: { db: {} } }, query: {}, t: vi.fn().mockReturnValue('translated server error') };
    const res = buildRes();

    await temperatureController.getControl(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'translated server error',
      message: 'boom',
    });
    expect(req.t).toHaveBeenCalledWith('errors.serverError');
  });

  it('passes req.organizationScope through to getTemperatureHistory', async () => {
    vi.spyOn(temperatureService, 'getTemperatureHistory').mockResolvedValue({ temperatures: [] });
    const scope = { scope: 'organization', organizationIds: ['org-1'] };
    const req = { app: { locals: { db: {} } }, query: {}, organizationScope: scope };
    const res = buildRes();

    await temperatureController.getControl(req, res);

    expect(temperatureService.getTemperatureHistory).toHaveBeenCalledWith(
      req.app.locals.db,
      expect.objectContaining({ organizationScope: scope })
    );
  });
});
