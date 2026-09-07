import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// #1093: the controller lazily requires this singleton, and both sides resolve
// through Node's own require cache (createRequire), which vi.resetModules()
// does not clear -- so a spy installed here is the one the controller calls.
const auditLogger = require('../../src/utils/auditLogger');

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
  dispatchNotificationMock,
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
  dispatchNotificationMock: vi.fn(),
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
  let auditLogSpy;
  let auditInitSpy;
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
    dispatchNotificationMock.mockResolvedValue(null);

    const telemetryPath = require.resolve('../../src/services/saveTelemetryPoint.js');
    const alertPath = require.resolve('../../src/services/sendCriticalAlertEmail.js');
    const mongoConnectionPath = require.resolve('../../src/infrastructure/database/mongodb/connection.js');
    const sensorMetadataPath = require.resolve('../../src/models/SensorMetadata.schema.js');
    const sendIncidentAlertEmailPath = require.resolve('../../src/services/sendIncidentAlertEmail.js');
    const temperatureIncidentPath = require.resolve('../../src/models/TemperatureIncident.js');
    const quarantineServicePath = require.resolve('../../src/services/equipment-sensor-quarantine.service.js');
    const notificationDispatchPath = require.resolve('../../src/services/notificationDispatch.service.js');
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
    require.cache[notificationDispatchPath] = {
      id: notificationDispatchPath,
      filename: notificationDispatchPath,
      loaded: true,
      exports: { dispatchNotification: dispatchNotificationMock },
    };

    const controllerModule = require('../../src/controllers/iot.controller.js');
    ingestTelemetry = controllerModule.ingestTelemetry;
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    auditInitSpy = vi.spyOn(auditLogger, 'init').mockImplementation(() => undefined);
    auditLogSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleLogSpy?.mockRestore();
    auditInitSpy?.mockRestore();
    auditLogSpy?.mockRestore();
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

    // #646 Wave 3 (RF015/RNF026) - upsertEnvironmentalExcursion also fires
    // the rule-driven notification engine, alongside the legacy
    // sendCriticalAlertEmail call this file already covers below.
    await vi.waitFor(() => {
      expect(dispatchNotificationMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          eventType: 'environmental_excursion',
          sourceEventType: 'EnvironmentalExcursion',
          payload: expect.objectContaining({ sensorId: 'sensor-1', temperatureValue: 12.5 }),
        })
      );
    });
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

  // #1093: POST /api/iot/telemetry is the second HTTP machine-ingest route --
  // the first, POST /api/temperature/system/reading, was fixed in #1080 -- and
  // it wrote no audit row at all: not guarded on req.user like its sibling,
  // simply absent. It was outside the MQTT hash-chained trail too
  // (mqtt-ingestion-audit.service.js, source: 'mqtt'), so it reached neither.
  //
  // dict-02 P1X-0331 decides which of the two it belongs in: AuditEvent.source
  // is ONE 1..1 Core field over "api, frontend, worker, mqtt, scheduler ou
  // system", so the canonical model treats the transports as a single audit
  // surface discriminated by source, not as two trails.
  it('#1093: writes an audit row for the machine caller, which has no req.user', async () => {
    const req = { body: { sensorId: 'sensor-2', temperature: 5, timestamp: '2026-04-08T12:00:00.000Z' } };
    const res = createResponse();

    await ingestTelemetry(req, res);

    expect(res.statusCode).toBe(200);
    expect(auditInitSpy).toHaveBeenCalled();
    expect(auditLogSpy).toHaveBeenCalled();

    const entry = auditLogSpy.mock.calls[0][0];
    expect(entry.action).toBe('CREATE');
    // The canonical entity for this body is TelemetryReading (ELM-0357..0365),
    // not the sibling route's 'Temperature'.
    expect(entry.resourceType).toBe('TelemetryReading');
    expect(entry.resourceId).toBe('sensor-2');
    expect(entry.status).toBe('success');
    // req is passed through so auditLogger captures IP, user-agent and path.
    expect(entry.req).toBe(req);
  }, 15000);

  // The audit row records that a machine submitted a reading, which is true
  // whether or not the sensor's policy could be resolved -- so it must not sit
  // behind the policy lookup.
  it('#1093: still audits when the sensor policy cannot be resolved', async () => {
    sensorMetadataLeanMock.mockRejectedValueOnce(new Error('mongo indisponível'));

    const req = { body: { sensorId: 'sensor-2', temperature: 5 } };
    const res = createResponse();

    await ingestTelemetry(req, res);

    expect(res.statusCode).toBe(200);
    expect(auditLogSpy).toHaveBeenCalled();
    expect(auditLogSpy.mock.calls[0][0].resourceType).toBe('TelemetryReading');
  }, 15000);

  // Deliberate: only the ACCEPTED ingest is audited, matching the #1080 sibling.
  // The MQTT transport does audit its three rejection reasons into the hash
  // chain, so both HTTP machine routes diverge from it there -- that gap is
  // #1095, filed rather than widened into this fix. If #1095 is resolved in
  // favour of auditing rejections, THIS TEST INVERTS: that is the intended
  // signal, not an oversight.
  it('#1093: an invalid payload is refused before anything is audited', async () => {
    const req = { body: { sensorId: '', temperature: 'abc' } };
    const res = createResponse();

    await ingestTelemetry(req, res);

    expect(res.statusCode).toBe(400);
    expect(auditLogSpy).not.toHaveBeenCalled();
  });

  // CONTROL: this path behaves identically before and after #1093, so a red
  // here in the pre-fix run means the spy setup above is wrong rather than the
  // bug being present.
  it('CONTROL: an in-policy reading is still accepted and still persisted', async () => {
    const req = { body: { sensorId: 'sensor-2', temperature: 5 } };
    const res = createResponse();

    await ingestTelemetry(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, accepted: true });
    expect(saveTelemetryPointMock).toHaveBeenCalledWith('sensor-2', 5, expect.any(Date));
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

  it('#651: resolve destinatários via mongoose.Types.ObjectId sem lançar o erro de BSON estrangeiro no UserCollection.find (db mongoose-backed)', async () => {
    const { createForeignBsonGuardCollectionMock } = require('../factories/db.factory');
    const loggerModule = require('../../src/utils/logger');
    const errorSpy = vi.spyOn(loggerModule, 'error').mockImplementation(() => undefined);

    // Guarded find rejects any foreign `require('mongodb').ObjectId` instance
    // in the filter (mirroring mongoose's bson 7 codec), the way the real
    // mongoose-backed `users` collection would. If the controller still
    // builds ObjectId from the top-level `mongodb` package, this throws and
    // gets caught/logged instead of resolving recipients.
    const guardedUsers = createForeignBsonGuardCollectionMock({
      find: vi.fn().mockReturnValue({
        project: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([{ email: 'guarded@x.com' }]),
        }),
      }),
    });
    usersCollection.find = guardedUsers.find;

    const req = { body: { sensorId: 'sensor-1', temperature: 12.5 } };
    const res = createResponse();

    await ingestTelemetry(req, res);

    await vi.waitFor(() => {
      const foreignBsonCall = errorSpy.mock.calls.find(
        ([, message]) => message === 'Unsupported BSON version, bson types must be from bson 7.x.x'
      );
      // Fail loudly with the real production error string, not with a
      // silent "0 recipients" side effect -- that silence is exactly what
      // let #651 survive undetected.
      expect(foreignBsonCall).toBeUndefined();
      expect(sendIncidentAlertEmailMock).toHaveBeenCalledWith(
        expect.objectContaining({ _id: 'incident-1' }),
        ['guarded@x.com'],
        0
      );
    });

    errorSpy.mockRestore();
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
