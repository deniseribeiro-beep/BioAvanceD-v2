import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  saveTelemetryPointMock,
  sendCriticalAlertEmailMock,
  connectMongoDBMock,
  sensorMetadataFindOneMock,
  sensorMetadataPopulateMock,
  sensorMetadataLeanMock,
  sendIncidentAlertEmailMock,
  temperatureIncidentCreateMock,
} = vi.hoisted(() => ({
  saveTelemetryPointMock: vi.fn(),
  sendCriticalAlertEmailMock: vi.fn(),
  connectMongoDBMock: vi.fn(),
  sensorMetadataFindOneMock: vi.fn(),
  sensorMetadataPopulateMock: vi.fn(),
  sensorMetadataLeanMock: vi.fn(),
  sendIncidentAlertEmailMock: vi.fn(),
  temperatureIncidentCreateMock: vi.fn(),
}));

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: {
      send: vi.fn().mockResolvedValue({ id: 'email-1' }),
    },
  })),
}));

vi.mock('@influxdata/influxdb-client', () => ({
  Point: vi.fn().mockImplementation(() => ({
    tag: vi.fn().mockReturnThis(),
    floatField: vi.fn().mockReturnThis(),
    timestamp: vi.fn().mockReturnThis(),
  })),
}));

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

describe('iot.controller', () => {
  let ingestTelemetry;
  let consoleLogSpy;
  let mongooseConnectSpy;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    process.env.RESEND_API_KEY = 're_test_dummy_key';
    process.env.ALERT_EMAIL_TO = 'alerts@example.test';
    process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/test';
    process.env.MONGO_DB = 'test';

    const mongooseModule = await import('mongoose');
    const mongoose = mongooseModule.default || mongooseModule;
    const temperatureIncidentsCollection = {
      findOne: vi.fn().mockResolvedValue(null),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'incident-1' }),
    };

    const usersCollection = {
      find: vi.fn().mockReturnValue({
        project: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([]),
        }),
      }),
    };

    const fakeConnection = {
      collection: vi.fn().mockImplementation((name) => {
        if (name === 'temperatureIncidents') return temperatureIncidentsCollection;
        if (name === 'users') return usersCollection;
        return {
          findOne: vi.fn().mockResolvedValue(null),
          updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
          insertOne: vi.fn().mockResolvedValue({ insertedId: 'incident-1' }),
        };
      }),
    };

    mongooseConnectSpy = vi.spyOn(mongoose, 'connect').mockResolvedValue({
      connection: fakeConnection,
    });

    vi.doMock('../../src/services/saveTelemetryPoint.js', () => ({
      saveTelemetryPoint: saveTelemetryPointMock,
    }));

    vi.doMock('../../src/services/sendCriticalAlertEmail.js', () => ({
      sendCriticalAlertEmail: sendCriticalAlertEmailMock,
    }));

    vi.doMock('../../src/infrastructure/database/mongodb/connection.js', () => ({
      connectMongoDB: connectMongoDBMock,
    }));

    vi.doMock('../../src/models/SensorMetadata.schema.js', () => ({
      default: {
        findOne: sensorMetadataFindOneMock,
      },
      findOne: sensorMetadataFindOneMock,
    }));

    vi.doMock('../../src/services/sendIncidentAlertEmail.js', () => ({
      sendIncidentAlertEmail: sendIncidentAlertEmailMock,
    }));

    vi.doMock('../../src/models/TemperatureIncident.js', () => ({
      default: {
        create: temperatureIncidentCreateMock,
      },
      create: temperatureIncidentCreateMock,
    }));

    saveTelemetryPointMock.mockResolvedValue(true);
    sendCriticalAlertEmailMock.mockResolvedValue({ id: 'email-1' });
    connectMongoDBMock.mockResolvedValue(null);
    sensorMetadataFindOneMock.mockReturnValue({
      populate: sensorMetadataPopulateMock.mockReturnThis(),
    });
    sensorMetadataPopulateMock.mockReturnValue({
      lean: sensorMetadataLeanMock,
    });
    sensorMetadataLeanMock.mockResolvedValue({
      sensorId: 'sensor-2',
      alertEmail: 'alerts@example.test',
      sensorName: 'sensor-2',
      temperaturePolicy: {
        _id: 'policy-1',
        minTemp: 2,
        maxTemp: 8,
      },
    });
    temperatureIncidentCreateMock.mockReturnValue({
      _id: 'incident-1',
      sensorKey: 'sensor-2',
    });

    const controllerModule = await import('../../src/controllers/iot.controller.js');
    ingestTelemetry = controllerModule.ingestTelemetry;
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleLogSpy?.mockRestore();
    mongooseConnectSpy?.mockRestore();
    delete process.env.RESEND_API_KEY;
    delete process.env.ALERT_EMAIL_TO;
    delete process.env.MONGO_URI;
    delete process.env.MONGO_DB;
  });

  it('deve rejeitar payload de telemetria incompleto', async () => {
    const req = { body: { sensorId: '', temperature: 'abc' } };
    const res = createResponse();

    await ingestTelemetry(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      error: 'sensorId e temperature são obrigatórios',
    });
    expect(saveTelemetryPointMock).not.toHaveBeenCalled();
  });

  it('deve gravar telemetria e disparar alerta crítico quando temperatura excede a política', async () => {
    const req = {
      body: {
        sensorId: 'sensor-1',
        temperature: 12.5,
        timestamp: '2026-04-08T12:00:00.000Z',
      },
    };
    const res = createResponse();

    const startedAt = performance.now();

    await ingestTelemetry(req, res);

    const elapsedMs = performance.now() - startedAt;

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, accepted: true });
    expect(elapsedMs).toBeLessThan(100);
    expect(mongooseConnectSpy).toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(
      '[ALERTA][IOT] Temperatura fora da política',
      expect.stringContaining('"sensorId":"sensor-1"')
    );
  });
});
