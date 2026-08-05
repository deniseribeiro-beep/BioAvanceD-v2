import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const {
  saveTelemetryPointMock,
  sendCriticalAlertEmailMock,
  connectMongoDBMock,
  sensorMetadataFindOneMock,
  sensorMetadataPopulateMock,
  sensorMetadataLeanMock,
  sendIncidentAlertEmailMock,
  temperatureIncidentCreateMock,
  quarantineByColdChainIncidentMock,
} = vi.hoisted(() => ({
  saveTelemetryPointMock: vi.fn(),
  sendCriticalAlertEmailMock: vi.fn(),
  connectMongoDBMock: vi.fn(),
  sensorMetadataFindOneMock: vi.fn(),
  sensorMetadataPopulateMock: vi.fn(),
  sensorMetadataLeanMock: vi.fn(),
  sendIncidentAlertEmailMock: vi.fn(),
  temperatureIncidentCreateMock: vi.fn(),
  quarantineByColdChainIncidentMock: vi.fn(),
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

vi.mock('../../src/services/saveTelemetryPoint', () => ({
  saveTelemetryPoint: saveTelemetryPointMock,
}));

vi.mock('../../src/services/sendCriticalAlertEmail', () => ({
  sendCriticalAlertEmail: sendCriticalAlertEmailMock,
}));

vi.mock('../../src/infrastructure/database/mongodb/connection', () => ({
  connectMongoDB: connectMongoDBMock,
}));

vi.mock('../../src/services/equipment-sensor-quarantine.service', () => ({
  default: { quarantineByColdChainIncident: quarantineByColdChainIncidentMock },
  quarantineByColdChainIncident: quarantineByColdChainIncidentMock,
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
  let temperatureIncidentsCollection;
  let usersCollection;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    process.env.RESEND_API_KEY = 're_test_dummy_key';
    process.env.ALERT_EMAIL_TO = 'alerts@example.test';
    process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/test';
    process.env.MONGO_DB = 'test';

    const mongooseModule = await import('mongoose');
    const mongoose = mongooseModule.default || mongooseModule;
    temperatureIncidentsCollection = {
      findOne: vi.fn().mockResolvedValue(null),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'incident-1' }),
    };

    usersCollection = {
      find: vi.fn().mockReturnValue({
        project: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([]),
        }),
      }),
    };

    // #426: notification-recipient resolution now goes through
    // UserRoleAssignment -> Role instead of an accessType $in query on
    // `users` directly. Grant NOTIFIABLE_USER_ID (a valid ObjectId hex
    // string) an active `technician` assignment by default so tests that
    // only configure `usersCollection.find` (the final email projection)
    // keep exercising the recipient-notification path unchanged.
    const NOTIFIABLE_USER_ID = '507f1f77bcf86cd799439011';
    const rolesCollection = {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ roleId: 'role-tech', roleCode: 'technician', roleStatus: 'active' }]),
      }),
    };
    const assignmentsCollection = {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { userAccountId: NOTIFIABLE_USER_ID, roleId: 'role-tech', assignmentStatus: 'active', validUntil: null },
        ]),
      }),
    };

    const fakeConnection = {
      collection: vi.fn().mockImplementation((name) => {
        if (name === 'temperatureIncidents') return temperatureIncidentsCollection;
        if (name === 'users') return usersCollection;
        if (name === 'roles') return rolesCollection;
        if (name === 'userRoleAssignments') return assignmentsCollection;
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
    connectMongoDBMock.mockResolvedValue(fakeConnection);
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
    quarantineByColdChainIncidentMock.mockResolvedValue({ triggered: false });
    sendIncidentAlertEmailMock.mockResolvedValue(true);

    const telemetryPath = require.resolve('../../src/services/saveTelemetryPoint.js');
    const alertPath = require.resolve('../../src/services/sendCriticalAlertEmail.js');
    const mongoConnectionPath = require.resolve('../../src/infrastructure/database/mongodb/connection.js');
    const sensorMetadataPath = require.resolve('../../src/models/SensorMetadata.schema.js');
    const sendIncidentAlertEmailPath = require.resolve('../../src/services/sendIncidentAlertEmail.js');
    const temperatureIncidentPath = require.resolve('../../src/models/TemperatureIncident.js');
    const quarantineServicePath = require.resolve('../../src/services/equipment-sensor-quarantine.service.js');
    const controllerPath = require.resolve('../../src/controllers/iot.controller.js');

    delete require.cache[controllerPath];
    require.cache[telemetryPath] = {
      id: telemetryPath,
      filename: telemetryPath,
      loaded: true,
      exports: { saveTelemetryPoint: saveTelemetryPointMock },
    };
    require.cache[alertPath] = {
      id: alertPath,
      filename: alertPath,
      loaded: true,
      exports: { sendCriticalAlertEmail: sendCriticalAlertEmailMock },
    };
    require.cache[mongoConnectionPath] = {
      id: mongoConnectionPath,
      filename: mongoConnectionPath,
      loaded: true,
      exports: { connectMongoDB: connectMongoDBMock },
    };
    require.cache[sensorMetadataPath] = {
      id: sensorMetadataPath,
      filename: sensorMetadataPath,
      loaded: true,
      exports: { findOne: sensorMetadataFindOneMock },
    };
    require.cache[sendIncidentAlertEmailPath] = {
      id: sendIncidentAlertEmailPath,
      filename: sendIncidentAlertEmailPath,
      loaded: true,
      exports: { sendIncidentAlertEmail: sendIncidentAlertEmailMock },
    };
    require.cache[temperatureIncidentPath] = {
      id: temperatureIncidentPath,
      filename: temperatureIncidentPath,
      loaded: true,
      exports: { create: temperatureIncidentCreateMock },
    };
    require.cache[quarantineServicePath] = {
      id: quarantineServicePath,
      filename: quarantineServicePath,
      loaded: true,
      exports: { quarantineByColdChainIncident: quarantineByColdChainIncidentMock },
    };

    const controllerModule = require('../../src/controllers/iot.controller.js');
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

    await ingestTelemetry(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, accepted: true });
    expect(saveTelemetryPointMock).toHaveBeenCalled();
    expect(connectMongoDBMock).toHaveBeenCalled();
  }, 15000);

  it('não dispara alerta quando não há política de temperatura para o sensor', async () => {
    sensorMetadataLeanMock.mockResolvedValueOnce({
      sensorId: 'sensor-2',
      sensorName: 'sensor-2',
      temperaturePolicy: null,
    });

    const req = { body: { sensorId: 'sensor-2', temperature: 12.5 } };
    const res = createResponse();

    await ingestTelemetry(req, res);

    expect(res.statusCode).toBe(200);
    expect(sendCriticalAlertEmailMock).not.toHaveBeenCalled();
  }, 15000);

  it('não dispara alerta quando a temperatura está dentro da política', async () => {
    const req = { body: { sensorId: 'sensor-2', temperature: 5 } };
    const res = createResponse();

    await ingestTelemetry(req, res);

    expect(res.statusCode).toBe(200);
    expect(sendCriticalAlertEmailMock).not.toHaveBeenCalled();
  }, 15000);

  it('usa notificationEmail como fallback quando alertEmail não está presente', async () => {
    sensorMetadataLeanMock.mockResolvedValueOnce({
      sensorId: 'sensor-2',
      sensorName: 'sensor-2',
      notificationEmail: 'notify@example.test',
      temperaturePolicy: { _id: 'policy-1', minTemp: 2, maxTemp: 8 },
    });

    const req = { body: { sensorId: 'sensor-2', temperature: 12.5 } };
    const res = createResponse();

    await ingestTelemetry(req, res);

    await vi.waitFor(() => {
      expect(sendCriticalAlertEmailMock).toHaveBeenCalledWith(
        'sensor-2',
        12.5,
        8,
        'notify@example.test'
      );
    });
  }, 15000);

  it('cai para o e-mail de ambiente quando não há e-mail no metadata do sensor', async () => {
    sensorMetadataLeanMock.mockResolvedValueOnce({
      sensorId: 'sensor-2',
      sensorName: 'sensor-2',
      temperaturePolicy: { _id: 'policy-1', minTemp: 2, maxTemp: 8 },
    });

    const req = { body: { sensorId: 'sensor-2', temperature: 12.5 } };
    const res = createResponse();

    await ingestTelemetry(req, res);

    await vi.waitFor(() => {
      expect(sendCriticalAlertEmailMock).toHaveBeenCalledWith(
        'sensor-2',
        12.5,
        8,
        'alerts@example.test'
      );
    });
  }, 15000);

  it('não envia e-mail crítico quando nenhum destinatário está disponível', async () => {
    delete process.env.ALERT_EMAIL_TO;
    delete process.env.ADMIN_EMAIL;
    sensorMetadataLeanMock.mockResolvedValueOnce({
      sensorId: 'sensor-2',
      sensorName: 'sensor-2',
      temperaturePolicy: { _id: 'policy-1', minTemp: 2, maxTemp: 8 },
    });

    const req = { body: { sensorId: 'sensor-2', temperature: 12.5 } };
    const res = createResponse();

    await ingestTelemetry(req, res);

    expect(res.statusCode).toBe(200);
    expect(sendCriticalAlertEmailMock).not.toHaveBeenCalled();
  }, 15000);

  it('reutiliza a política em cache dentro do TTL sem consultar o banco novamente', async () => {
    const req1 = { body: { sensorId: 'sensor-2', temperature: 12.5 } };
    const req2 = { body: { sensorId: 'sensor-2', temperature: 3 } };

    await ingestTelemetry(req1, createResponse());
    await ingestTelemetry(req2, createResponse());

    expect(sensorMetadataFindOneMock).toHaveBeenCalledTimes(1);
  }, 15000);

  it('continua com política nula quando a resolução da política falha', async () => {
    sensorMetadataFindOneMock.mockImplementationOnce(() => {
      throw new Error('boom');
    });

    const req = { body: { sensorId: 'sensor-2', temperature: 12.5 } };
    const res = createResponse();

    await ingestTelemetry(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, accepted: true });
    expect(sendCriticalAlertEmailMock).not.toHaveBeenCalled();
  }, 15000);

  it('retorna 500 quando ocorre um erro inesperado no processamento', async () => {
    const req = {
      body: {
        sensorId: 'sensor-2',
        temperature: 12.5,
        timestamp: 'not-a-valid-date',
      },
    };
    const res = createResponse();

    await ingestTelemetry(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({
      success: false,
      error: 'Erro ao processar telemetria',
    });
  }, 15000);

  it('atualiza um incidente de temperatura existente em vez de criar um novo', async () => {
    temperatureIncidentsCollection.findOne.mockResolvedValue({
      _id: 'incident-1',
      maxTemperature: 10,
      minTemperature: 9,
      samplesOutOfRange: 2,
      status: 'open',
    });

    const req = { body: { sensorId: 'sensor-1', temperature: 12.5 } };
    const res = createResponse();

    await ingestTelemetry(req, res);

    await vi.waitFor(() => {
      expect(temperatureIncidentsCollection.updateOne).toHaveBeenCalled();
    });
    expect(temperatureIncidentsCollection.insertOne).not.toHaveBeenCalled();
    expect(quarantineByColdChainIncidentMock).toHaveBeenCalled();
  }, 15000);

  it('cria um novo incidente e notifica destinatários quando não há incidente aberto', async () => {
    usersCollection.find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ email: 'admin@example.test' }, { email: null }]),
      }),
    });

    const req = { body: { sensorId: 'sensor-1', temperature: 12.5 } };
    const res = createResponse();

    await ingestTelemetry(req, res);

    await vi.waitFor(() => {
      expect(temperatureIncidentsCollection.insertOne).toHaveBeenCalled();
    });
    await vi.waitFor(() => {
      expect(sendIncidentAlertEmailMock).toHaveBeenCalledWith(
        expect.objectContaining({ _id: 'incident-1' }),
        ['admin@example.test'],
        0
      );
    });
  }, 15000);

  it('não notifica destinatários quando não há usuários ativos com e-mail', async () => {
    usersCollection.find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ email: null }]),
      }),
    });

    const req = { body: { sensorId: 'sensor-1', temperature: 12.5 } };
    const res = createResponse();

    await ingestTelemetry(req, res);

    await vi.waitFor(() => {
      expect(temperatureIncidentsCollection.insertOne).toHaveBeenCalled();
    });
    expect(sendIncidentAlertEmailMock).not.toHaveBeenCalled();
  }, 15000);

  it('loga aviso quando a quarentena de cadeia fria é acionada', async () => {
    const loggerModule = require('../../src/utils/logger');
    const warnSpy = vi.spyOn(loggerModule, 'warn').mockImplementation(() => undefined);
    quarantineByColdChainIncidentMock.mockResolvedValue({
      triggered: true,
      incidentId: 'incident-1',
      sensorKey: 'sensor-1',
      matched: 2,
      quarantined: 2,
      movements: ['m1'],
    });

    const req = { body: { sensorId: 'sensor-1', temperature: 12.5 } };
    const res = createResponse();

    await ingestTelemetry(req, res);

    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(
        '[IOT_INCIDENT] Quarentena de cadeia fria aplicada',
        expect.objectContaining({ incidentId: 'incident-1', sensorKey: 'sensor-1' })
      );
    });
    warnSpy.mockRestore();
  }, 15000);

  it('loga erro quando a aplicação da quarentena de cadeia fria falha', async () => {
    const loggerModule = require('../../src/utils/logger');
    const errorSpy = vi.spyOn(loggerModule, 'error').mockImplementation(() => undefined);
    quarantineByColdChainIncidentMock.mockRejectedValue(new Error('quarantine boom'));

    const req = { body: { sensorId: 'sensor-1', temperature: 12.5 } };
    const res = createResponse();

    await ingestTelemetry(req, res);

    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        '[IOT_INCIDENT] Falha ao aplicar quarentena de cadeia fria:',
        'quarantine boom'
      );
    });
    errorSpy.mockRestore();
  }, 15000);

  it('usa sensorId como sensorName de fallback quando metadata não possui sensorName', async () => {
    temperatureIncidentCreateMock.mockImplementation((payload) => payload);
    sensorMetadataLeanMock.mockResolvedValueOnce({
      sensorId: 'sensor-3',
      temperaturePolicy: { _id: 'policy-1', minTemp: 2, maxTemp: 8 },
    });

    const req = { body: { sensorId: 'sensor-3', temperature: 12.5 } };
    const res = createResponse();

    await ingestTelemetry(req, res);

    await vi.waitFor(() => {
      expect(temperatureIncidentCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({ sensorKey: 'sensor-3', sensorName: 'sensor-3' })
      );
    });
  }, 15000);

  it('continua processamento quando saveTelemetryPoint falha ao persistir no InfluxDB', async () => {
    const loggerModule = require('../../src/utils/logger');
    const errorSpy = vi.spyOn(loggerModule, 'error').mockImplementation(() => undefined);
    saveTelemetryPointMock.mockRejectedValue(new Error('influx boom'));

    const req = { body: { sensorId: 'sensor-2', temperature: 5 } };
    const res = createResponse();

    await ingestTelemetry(req, res);

    expect(res.statusCode).toBe(200);
    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        '[ISO20387][IOT] Falha ao persistir telemetria no InfluxDB:',
        'influx boom'
      );
    });
    errorSpy.mockRestore();
  }, 15000);

  it('não dispara alerta quando a política de temperatura tem limites não numéricos', async () => {
    sensorMetadataLeanMock.mockResolvedValueOnce({
      sensorId: 'sensor-2',
      sensorName: 'sensor-2',
      temperaturePolicy: { _id: 'policy-1', minTemp: 'not-a-number', maxTemp: 8 },
    });

    const req = { body: { sensorId: 'sensor-2', temperature: 12.5 } };
    const res = createResponse();

    await ingestTelemetry(req, res);

    expect(res.statusCode).toBe(200);
    expect(sendCriticalAlertEmailMock).not.toHaveBeenCalled();
  }, 15000);
});
