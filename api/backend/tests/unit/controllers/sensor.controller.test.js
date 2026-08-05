import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const sensorService = require('../../../src/services/sensor.service');
const auditLogger = require('../../../src/utils/auditLogger');
const logger = require('../../../src/utils/logger');
const sensorController = require('../../../src/controllers/sensor.controller');

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function createRequest(overrides = {}) {
  return {
    app: { locals: { db: {} } },
    params: {},
    query: {},
    body: {},
    ...overrides,
  };
}

describe('sensor.controller', () => {
  let createSensorMock;
  let listSensorsMock;
  let getSensorMock;
  let collectReadingMock;
  let updateSensorMock;
  let deleteSensorMock;
  let auditLoggerInitMock;
  let auditLoggerLogMock;
  let loggerErrorMock;

  beforeEach(() => {
    createSensorMock = vi.spyOn(sensorService, 'createSensor');
    listSensorsMock = vi.spyOn(sensorService, 'listSensors');
    getSensorMock = vi.spyOn(sensorService, 'getSensor');
    collectReadingMock = vi.spyOn(sensorService, 'collectReading');
    updateSensorMock = vi.spyOn(sensorService, 'updateSensor');
    deleteSensorMock = vi.spyOn(sensorService, 'deleteSensor');
    auditLoggerInitMock = vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    auditLoggerLogMock = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    loggerErrorMock = vi.spyOn(logger, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('create', () => {
    it('returns 503 when db is unavailable', async () => {
      const req = createRequest({ app: { locals: {} } });
      const res = createResponse();

      await sensorController.create(req, res);

      expect(res.statusCode).toBe(503);
      expect(res.body).toEqual({
        success: false,
        error: 'Banco de dados não disponível',
      });
    });

    it('creates a sensor and logs audit when req.user is present', async () => {
      const sensor = { _id: { toString: () => 'sensor-1' }, sensorId: 'S-1' };
      createSensorMock.mockResolvedValue(sensor);
      const req = createRequest({ user: { id: 'u1' }, body: { name: 'Fridge' } });
      const res = createResponse();

      await sensorController.create(req, res);

      expect(createSensorMock).toHaveBeenCalledWith(req.app.locals.db, req.body);
      expect(auditLoggerInitMock).toHaveBeenCalledWith(req.app.locals.db);
      expect(auditLoggerLogMock).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', resourceType: 'Sensor', resourceId: 'sensor-1' })
      );
      expect(res.statusCode).toBe(201);
      expect(res.body).toEqual({
        success: true,
        message: 'Sensor criado com sucesso',
        data: sensor,
      });
    });

    it('skips audit logging when req.user is absent', async () => {
      const sensor = { _id: { toString: () => 'sensor-2' }, sensorID: 'S-2' };
      createSensorMock.mockResolvedValue(sensor);
      const req = createRequest({ body: { name: 'Freezer' } });
      const res = createResponse();

      await sensorController.create(req, res);

      expect(auditLoggerLogMock).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(201);
    });

    it('falls back to sensorID in the audit message when sensorId is absent', async () => {
      const sensor = { _id: { toString: () => 'sensor-3' }, sensorID: 'S-3' };
      createSensorMock.mockResolvedValue(sensor);
      const req = createRequest({ user: { id: 'u1' }, body: { name: 'Freezer' } });
      const res = createResponse();

      await sensorController.create(req, res);

      expect(auditLoggerLogMock).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Sensor S-3 criado' })
      );
    });

    it('returns 400 when creation throws', async () => {
      createSensorMock.mockRejectedValue(new Error('boom'));
      const req = createRequest({ body: {} });
      const res = createResponse();

      await sensorController.create(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({
        success: false,
        error: 'Erro ao criar sensor',
        message: 'boom',
      });
      expect(loggerErrorMock).toHaveBeenCalledWith('Erro ao criar sensor:', 'boom');
    });
  });

  describe('list', () => {
    it('returns 503 when db is unavailable', async () => {
      const req = createRequest({ app: { locals: {} } });
      const res = createResponse();

      await sensorController.list(req, res);

      expect(res.statusCode).toBe(503);
    });

    it('lists sensors from a { sensors } result shape', async () => {
      listSensorsMock.mockResolvedValue({ sensors: [{ id: 1 }, { id: 2 }] });
      const req = createRequest({ query: { locationId: 'loc-1', limit: '10', skip: '5' } });
      const res = createResponse();

      await sensorController.list(req, res);

      expect(listSensorsMock).toHaveBeenCalledWith(req.app.locals.db, {
        locationId: 'loc-1',
        maintenanceStatus: undefined,
        limit: 10,
        skip: 5,
      });
      expect(auditLoggerLogMock).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'QUERY', payload: { total: 2, filters: expect.any(Object) } })
      );
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ success: true, data: [{ id: 1 }, { id: 2 }] });
    });

    it('falls back to an array result shape and default filters', async () => {
      listSensorsMock.mockResolvedValue([{ id: 3 }]);
      const req = createRequest({ query: { locationID: 'loc-2' } });
      const res = createResponse();

      await sensorController.list(req, res);

      expect(listSensorsMock).toHaveBeenCalledWith(req.app.locals.db, {
        locationId: 'loc-2',
        maintenanceStatus: undefined,
        limit: 50,
        skip: 0,
      });
      expect(res.body).toEqual({ success: true, data: [{ id: 3 }] });
    });

    it('falls back to an empty array when listSensors resolves null (issue #233)', async () => {
      listSensorsMock.mockResolvedValue(null);
      const req = createRequest();
      const res = createResponse();

      await sensorController.list(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ success: true, data: [] });
    });

    it('returns 500 when listing throws', async () => {
      listSensorsMock.mockRejectedValue(new Error('list failed'));
      const req = createRequest();
      const res = createResponse();

      await sensorController.list(req, res);

      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({
        success: false,
        error: 'Erro ao listar sensores',
        message: 'list failed',
      });
    });
  });

  describe('get', () => {
    it('returns 503 when db is unavailable', async () => {
      const req = createRequest({ app: { locals: {} } });
      const res = createResponse();

      await sensorController.get(req, res);

      expect(res.statusCode).toBe(503);
    });

    it('returns 404 and logs a warning when sensor is not found', async () => {
      getSensorMock.mockResolvedValue(null);
      const req = createRequest({ params: { id: 'missing-1' } });
      const res = createResponse();

      await sensorController.get(req, res);

      expect(auditLoggerLogMock).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'error', severity: 'warning' })
      );
      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ success: false, error: 'Sensor não encontrado' });
    });

    it('returns the sensor and logs a success query', async () => {
      const sensor = { id: 's1', name: 'Fridge' };
      getSensorMock.mockResolvedValue(sensor);
      const req = createRequest({ params: { id: 's1' } });
      const res = createResponse();

      await sensorController.get(req, res);

      expect(auditLoggerLogMock).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'success', resourceId: 's1' })
      );
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ success: true, data: sensor });
    });

    it('returns 500 when fetching throws', async () => {
      getSensorMock.mockRejectedValue(new Error('get failed'));
      const req = createRequest({ params: { id: 's1' } });
      const res = createResponse();

      await sensorController.get(req, res);

      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({
        success: false,
        error: 'Erro ao buscar sensor',
        message: 'get failed',
      });
    });
  });

  describe('collectReading', () => {
    it('returns 503 when db is unavailable', async () => {
      const req = createRequest({ app: { locals: {} } });
      const res = createResponse();

      await sensorController.collectReading(req, res);

      expect(res.statusCode).toBe(503);
    });

    it('collects a reading and logs audit when req.user is present', async () => {
      const reading = { temperatureValue: 4.5 };
      collectReadingMock.mockResolvedValue(reading);
      const req = createRequest({ user: { id: 'u1' }, params: { id: 's1' } });
      const res = createResponse();

      await sensorController.collectReading(req, res);

      expect(auditLoggerLogMock).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'READ', payload: { temperature: 4.5 } })
      );
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ success: true, data: reading });
    });

    it('handles a null reading without throwing and skips audit without req.user', async () => {
      collectReadingMock.mockResolvedValue(null);
      const req = createRequest({ params: { id: 's1' } });
      const res = createResponse();

      await sensorController.collectReading(req, res);

      expect(auditLoggerLogMock).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ success: true, data: null });
    });

    it('returns 500 when collection throws', async () => {
      collectReadingMock.mockRejectedValue(new Error('collect failed'));
      const req = createRequest({ params: { id: 's1' } });
      const res = createResponse();

      await sensorController.collectReading(req, res);

      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({
        success: false,
        error: 'Erro ao coletar leitura',
        message: 'collect failed',
      });
    });
  });

  describe('update', () => {
    it('returns 503 when db is unavailable', async () => {
      const req = createRequest({ app: { locals: {} } });
      const res = createResponse();

      await sensorController.update(req, res);

      expect(res.statusCode).toBe(503);
    });

    it('returns 404 when the sensor does not exist', async () => {
      updateSensorMock.mockResolvedValue(null);
      const req = createRequest({ params: { id: 's1' }, body: { name: 'x' } });
      const res = createResponse();

      await sensorController.update(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ success: false, error: 'Sensor não encontrado' });
      expect(auditLoggerLogMock).not.toHaveBeenCalled();
    });

    it('updates and logs audit when req.user is present', async () => {
      const updated = { id: 's1', name: 'Updated' };
      updateSensorMock.mockResolvedValue(updated);
      const req = createRequest({ user: { id: 'u1' }, params: { id: 's1' }, body: { name: 'Updated' } });
      const res = createResponse();

      await sensorController.update(req, res);

      expect(auditLoggerLogMock).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATE', resourceId: 's1' })
      );
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({
        success: true,
        message: 'Sensor atualizado com sucesso',
        data: updated,
      });
    });

    it('skips audit logging when req.user is absent', async () => {
      updateSensorMock.mockResolvedValue({ id: 's1' });
      const req = createRequest({ params: { id: 's1' }, body: {} });
      const res = createResponse();

      await sensorController.update(req, res);

      expect(auditLoggerLogMock).not.toHaveBeenCalled();
    });

    it('returns 400 when update throws', async () => {
      updateSensorMock.mockRejectedValue(new Error('update failed'));
      const req = createRequest({ params: { id: 's1' }, body: {} });
      const res = createResponse();

      await sensorController.update(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({
        success: false,
        error: 'Erro ao atualizar sensor',
        message: 'update failed',
      });
    });
  });

  describe('delete', () => {
    it('returns 503 when db is unavailable', async () => {
      const req = createRequest({ app: { locals: {} } });
      const res = createResponse();

      await sensorController.delete(req, res);

      expect(res.statusCode).toBe(503);
    });

    it('returns 404 when the sensor does not exist', async () => {
      deleteSensorMock.mockResolvedValue(null);
      const req = createRequest({ params: { id: 's1' } });
      const res = createResponse();

      await sensorController.delete(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ success: false, error: 'Sensor não encontrado' });
      expect(auditLoggerLogMock).not.toHaveBeenCalled();
    });

    it('deletes and logs audit when req.user is present', async () => {
      deleteSensorMock.mockResolvedValue(true);
      const req = createRequest({ user: { id: 'u1' }, params: { id: 's1' } });
      const res = createResponse();

      await sensorController.delete(req, res);

      expect(auditLoggerLogMock).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DELETE', severity: 'warning' })
      );
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ success: true, message: 'Sensor deletado com sucesso' });
    });

    it('skips audit logging when req.user is absent', async () => {
      deleteSensorMock.mockResolvedValue(true);
      const req = createRequest({ params: { id: 's1' } });
      const res = createResponse();

      await sensorController.delete(req, res);

      expect(auditLoggerLogMock).not.toHaveBeenCalled();
    });

    it('returns 400 when deletion throws', async () => {
      deleteSensorMock.mockRejectedValue(new Error('delete failed'));
      const req = createRequest({ params: { id: 's1' } });
      const res = createResponse();

      await sensorController.delete(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({
        success: false,
        error: 'Erro ao deletar sensor',
        message: 'delete failed',
      });
    });
  });
});
