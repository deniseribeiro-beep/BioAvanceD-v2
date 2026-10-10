import { describe, it, expect, vi, afterEach } from 'vitest';

const temperatureController = require('../../src/controllers/temperature.controller');
const temperatureService = require('../../src/services/temperature.service');
const auditLogger = require('../../src/utils/auditLogger');

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
    const fakeReading = { _id: { toString: () => 'r1' }, temperatureValue: 4.2, temperatureUnit: 'C' };
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
    const stored = { _id: { toString: () => 'r0' }, temperatureValue: 4.2, replayed: true };
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
    const fakeReading = { _id: { toString: () => 'r1' }, temperatureValue: 4.2, temperatureUnit: 'C' };
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

  it('#1080: writes an audit row for the machine caller, which has no req.user', async () => {
    const { logSpy, req, res } = machineIngestSetup(
      { sensorId: 's-1', organizationId: 'org-real' },
      { sensorId: 's-1', value: 4.2 }
    );

    await temperatureController.createReading(req, res);

    expect(logSpy).toHaveBeenCalled();
    const entry = logSpy.mock.calls[0][0];
    expect(entry.action).toBe('CREATE');
    expect(entry.resourceType).toBe('Temperature');
  });

  // CONTROL: the authenticated path behaves identically before and after
  // #1080, so a red here in the pre-fix run means the setup is wrong rather
  // than the bug being present.
  it('CONTROL: the authenticated path stamps from the caller scope and looks up no sensor', async () => {
    const fakeReading = { _id: { toString: () => 'r1' }, temperatureValue: 4.2, temperatureUnit: 'C' };
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

describe('temperature.controller.getById', () => {
  it('returns 503 when req.app.locals.db is falsy', async () => {
    const req = { app: { locals: { db: null } }, params: { id: '507f1f77bcf86cd799439011' } };
    const res = buildRes();

    await temperatureController.getById(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('returns 404 when no reading is found', async () => {
    const findOne = vi.fn().mockResolvedValue(null);
    const db = { collection: vi.fn().mockReturnValue({ findOne }) };
    const req = { app: { locals: { db } }, params: { id: '507f1f77bcf86cd799439011' } };
    const res = buildRes();

    await temperatureController.getById(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Leitura não encontrada' });
  });

  it('returns 200 with the reading when found', async () => {
    const fakeReading = { _id: '507f1f77bcf86cd799439011', temperatureValue: 4.2 };
    const findOne = vi.fn().mockResolvedValue(fakeReading);
    const db = { collection: vi.fn().mockReturnValue({ findOne }) };
    const req = { app: { locals: { db } }, params: { id: '507f1f77bcf86cd799439011' } };
    const res = buildRes();

    await temperatureController.getById(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: fakeReading });
  });

  it('returns 500 with the error message when the lookup throws (e.g. invalid ObjectId)', async () => {
    const db = { collection: vi.fn().mockReturnValue({ findOne: vi.fn() }) };
    const req = { app: { locals: { db } }, params: { id: 'not-a-valid-object-id' } };
    const res = buildRes();

    await temperatureController.getById(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].success).toBe(false);
    expect(res.json.mock.calls[0][0].error).toBe('Erro ao buscar leitura');
  });

  // #636 (F3-G09): mirrors sensor.controller.js's own out-of-scope 403
  // pattern -- an org-scoped caller fetching a reading outside their
  // scoped organizations (including organizationId:null, unscoped/
  // legacy) gets 403, not the reading's data.
  it('returns 403 when the reading is outside the caller organizationScope', async () => {
    const fakeReading = { _id: '507f1f77bcf86cd799439011', organizationId: 'org-other' };
    const findOne = vi.fn().mockResolvedValue(fakeReading);
    const db = { collection: vi.fn().mockReturnValue({ findOne }) };
    const req = {
      app: { locals: { db } },
      params: { id: '507f1f77bcf86cd799439011' },
      organizationScope: { scope: 'organization', organizationIds: ['org-1'] },
    };
    const res = buildRes();

    await temperatureController.getById(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns the reading when it is within the caller organizationScope', async () => {
    const fakeReading = { _id: '507f1f77bcf86cd799439011', organizationId: 'org-1' };
    const findOne = vi.fn().mockResolvedValue(fakeReading);
    const db = { collection: vi.fn().mockReturnValue({ findOne }) };
    const req = {
      app: { locals: { db } },
      params: { id: '507f1f77bcf86cd799439011' },
      organizationScope: { scope: 'organization', organizationIds: ['org-1'] },
    };
    const res = buildRes();

    await temperatureController.getById(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: fakeReading });
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
