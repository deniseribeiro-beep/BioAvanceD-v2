import { describe, it, expect, vi, afterEach } from 'vitest';

const temperatureController = require('../../src/controllers/temperature.controller');
const temperatureService = require('../../src/services/temperature.service');

function buildRes() {
  const res = {};
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
});
