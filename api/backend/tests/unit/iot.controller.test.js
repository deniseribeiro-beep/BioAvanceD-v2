import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// #1093: the controller lazily requires this singleton, and both sides resolve
// through Node's own require cache (createRequire), which vi.resetModules()
// does not clear -- so a spy installed here is the one the controller calls.
const auditLogger = require('../../src/utils/auditLogger');
const { createFakeCollection } = require('./ingestion/testHelpers');

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


// #1207: an active incident whose excursion has already outlasted the 2-hour
// TELEMETRY_CRITICAL_DURATION_HOURS fallback, for tests about what happens
// once the quarantine does fire.
function sustainedIncident(overrides = {}) {
  return {
    _id: 'incident-1',
    sensorKey: 'sensor-1',
    maxTemperature: 10,
    minTemperature: 9,
    samplesOutOfRange: 2,
    status: 'open',
    excursionStartedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
    ...overrides,
  };
}

function createResponse() {
  return {
    // Express always supplies res.locals; #1120's audit reason is written there.
    locals: {},
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
  let idempotencyKeysCollection;
  // #1317: null unless a case binds the reading to a datastream.
  let datastreamsCollection;
  let temperaturePoliciesCollection;
  // #1392: null unless a case reads the excursion's equipment key.
  let excursionsCollection;

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

    idempotencyKeysCollection = createFakeCollection([]);
    datastreamsCollection = null;
    temperaturePoliciesCollection = null;
    excursionsCollection = null;

    const fakeConnection = {
      collection: vi.fn().mockImplementation((name) => {
        if (name === 'ingestionIdempotencyKeys') return idempotencyKeysCollection;
        if (name === 'temperatureIncidents') return temperatureIncidentsCollection;
        if (name === 'users') return usersCollection;
        if (name === 'roles') return rolesCollection;
        if (name === 'userRoleAssignments') return assignmentsCollection;
        if (name === 'telemetryDatastreams' && datastreamsCollection) return datastreamsCollection;
        if (name === 'temperaturePolicies' && temperaturePoliciesCollection) return temperaturePoliciesCollection;
        if (name === 'environmentalExcursions' && excursionsCollection) return excursionsCollection;
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
    expect(res.body).toEqual(expect.objectContaining({ success: true, accepted: true, telemetryReadingId: expect.any(String), clockStatus: expect.any(String) }));
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

  // Deliberate: only the ACCEPTED ingest is audited by THIS CONTROLLER,
  // matching the #1080 sibling. The assertion below is about the controller
  // and is correct as written.
  //
  // CORRECTED (#1095, closed premise-corrected). This comment used to say
  // "If #1095 is resolved in favour of auditing rejections, THIS TEST
  // INVERTS". It does not, and the prediction was wrong for a reason worth
  // keeping: #1095 assumed a rejected submission left no record at all, and
  // it always did. app.js:194 mounts audit.middleware.js#auditRequest
  // globally, before every route, and it wraps res.send -- so the 400 below
  // already produces a CREATE_FAILED row, and the machine-ingest gate's 403
  // produces a FORBIDDEN one before this controller is even reached.
  //
  // This test cannot see either, because it calls ingestTelemetry directly
  // and never mounts the middleware. That is exactly why it stays green and
  // must not be "fixed": auditLogSpy is the CONTROLLER's audit call, not
  // the request's. The composition is pinned in
  // tests/integration/machineIngestRejectionAudit.api.test.js.
  //
  // What actually survives of #1095 is #1120: the middleware row carries no
  // `reason`, so one 400 covers both an empty sensorId and a non-finite
  // temperature, where MQTT names three reasons.
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
    expect(res.body).toEqual(expect.objectContaining({ success: true, accepted: true, telemetryReadingId: expect.any(String), clockStatus: expect.any(String) }));
    expect(saveTelemetryPointMock).toHaveBeenCalledWith('sensor-2', 5, expect.any(Date), expect.objectContaining({ telemetryReadingId: expect.any(String) }));
    expect(sendCriticalAlertEmailMock).not.toHaveBeenCalled();
  }, 15000);

  // RF009 AC8, RNF004 C7 (#1540): a body field outside the reading contract
  // is stripped before the reading is hashed or stored; the reading is
  // accepted and flagged by a personal_data_stripped issue, never refused.
  it('accepts a reading that carries personal data, strips it and flags the reading', async () => {
    const { createHash } = require('crypto');
    const { canonicalJson } = require('../../src/services/telemetryReadingContract');
    const base = await connectMongoDBMock();
    const events = [];
    const issues = [];
    connectMongoDBMock.mockResolvedValue({
      collection: (name) => {
        if (name === 'telemetryIngestionEvents') return { insertOne: async (doc) => { events.push(doc); return {}; } };
        if (name === 'telemetryValidationIssues') return { insertMany: async (docs) => { issues.push(...docs); return {}; } };
        return base.collection(name);
      },
    });
    const req = { body: { sensorId: 'sensor-2', temperature: 5, patientName: 'Maria da Silva', cpf: '12345678909' } };
    const res = createResponse();

    await ingestTelemetry(req, res);

    expect(res.statusCode).toBe(200);
    const identity = saveTelemetryPointMock.mock.calls[0][3];
    expect(identity.payloadHash).toBe(createHash('sha256').update(canonicalJson({ sensorId: 'sensor-2', temperature: 5 })).digest('hex'));
    expect(issues.filter((issue) => issue.issueCode === 'personal_data_stripped'))
      .toEqual([expect.objectContaining({ fieldPath: 'cpf,patientName', disposition: 'quarantined' })]);
    expect(events).toEqual([expect.objectContaining({ validationStatus: 'quarantined', telemetryReadingId: res.body.telemetryReadingId })]);
    expect(JSON.stringify([events, issues, saveTelemetryPointMock.mock.calls])).not.toContain('Maria');
  }, 15000);

  // RNF004 C4 (#1521): a client payloadHash is checked against the hash of
  // the canonical contract fields received. A mismatch is a corrupted
  // message, refused 422 and recorded, never stored; a match is accepted and
  // the payloadHash field is neither hashed nor stripped.
  describe('client payloadHash (#1521, RNF004 C4)', () => {
    const { createHash } = require('crypto');
    const { canonicalJson } = require('../../src/services/telemetryReadingContract');
    const reading = { sensorId: 'sensor-2', temperature: 5, idempotencyKey: 'k-1521' };
    const readingHash = createHash('sha256').update(canonicalJson(reading)).digest('hex');

    async function captureWrites() {
      const base = await connectMongoDBMock();
      const events = [];
      const issues = [];
      connectMongoDBMock.mockResolvedValue({
        collection: (name) => {
          if (name === 'telemetryIngestionEvents') return { insertOne: async (doc) => { events.push(doc); return {}; } };
          if (name === 'telemetryValidationIssues') return { insertMany: async (docs) => { issues.push(...docs); return {}; } };
          return base.collection(name);
        },
      });
      return { events, issues };
    }

    it('refuses a reading whose payloadHash does not match with 422, records it as corrupted and stores nothing', async () => {
      const { events, issues } = await captureWrites();
      const req = { body: { ...reading, payloadHash: '0'.repeat(64) } };
      const res = createResponse();

      await ingestTelemetry(req, res);

      expect(res.statusCode).toBe(422);
      expect(res.body).toEqual(expect.objectContaining({ success: false, error: expect.stringMatching(/corrompida/) }));
      expect(res.locals.auditReason).toBe('payload_hash_mismatch');
      expect(saveTelemetryPointMock).not.toHaveBeenCalled();
      expect(events).toEqual([expect.objectContaining({ validationStatus: 'rejected', telemetryReadingId: null, payloadHash: readingHash })]);
      expect(issues.map((issue) => issue.issueCode)).toEqual(['payload_hash_mismatch']);
    }, 15000);

    it('a corrupted resend of an accepted client key is refused 422, never answered as a replay', async () => {
      const first = createResponse();
      const second = createResponse();

      await ingestTelemetry({ body: { ...reading } }, first);
      await ingestTelemetry({ body: { ...reading, payloadHash: '0'.repeat(64) } }, second);

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(422);
      expect(second.body.replayed).toBeUndefined();
      expect(saveTelemetryPointMock).toHaveBeenCalledTimes(1);
    }, 15000);

    it('control: a matching payloadHash is accepted, hashed out of the reading and not stripped', async () => {
      const { events, issues } = await captureWrites();
      const req = { body: { ...reading, payloadHash: readingHash } };
      const res = createResponse();

      await ingestTelemetry(req, res);

      expect(res.statusCode).toBe(200);
      expect(saveTelemetryPointMock.mock.calls[0][3].payloadHash).toBe(readingHash);
      expect(events).toEqual([]);
      expect(issues).toEqual([]);
    }, 15000);
  });

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
    expect(res.body).toEqual(expect.objectContaining({ success: true, accepted: true, telemetryReadingId: expect.any(String), clockStatus: expect.any(String) }));
    expect(sendCriticalAlertEmailMock).not.toHaveBeenCalled();
  }, 15000);

  // #1317: an unparseable timestamp used to reach toISOString and answer 500;
  // the reading contract refuses it first, with nothing written.
  it('recusa com 422 um timestamp que não é data, sem gravar nada', async () => {
    const req = {
      body: {
        sensorId: 'sensor-2',
        temperature: 12.5,
        timestamp: 'not-a-valid-date',
      },
    };
    const res = createResponse();

    await ingestTelemetry(req, res);

    expect(res.statusCode).toBe(422);
    expect(res.body).toMatchObject({ success: false });
    expect(saveTelemetryPointMock).not.toHaveBeenCalled();
  }, 15000);

  it('atualiza um incidente de temperatura existente em vez de criar um novo', async () => {
    // #1207: an excursion already past the 2-hour fallback, so the
    // quarantine this test expects is the sustained one.
    temperatureIncidentsCollection.findOne.mockResolvedValue({
      _id: 'incident-1',
      maxTemperature: 10,
      minTemperature: 9,
      samplesOutOfRange: 2,
      status: 'open',
      excursionStartedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
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
    temperatureIncidentsCollection.findOne.mockResolvedValue(sustainedIncident());
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
    temperatureIncidentsCollection.findOne.mockResolvedValue(sustainedIncident());
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

  // #1207: the first out-of-range reading used to quarantine every sample
  // under the sensor at once. The policy's minimumDuration -- the time half
  // of ISBER's "critical limits (temperatures and time)", and v2.0.0
  // ELM-0368's "primeira medição fora do limite conforme a regra" -- was read
  // only by TelemetryMonitor, for the Neo4j COMPROMISED mark. The alarm stays
  // immediate; the quarantine now waits until the excursion has lasted
  // minimumDuration, measured from the first reading of an unbroken
  // out-of-range run.
  describe('#1207: the cold-chain quarantine waits for the policy minimumDuration', () => {
    const READING_AT = '2026-04-08T12:00:00.000Z';
    const minutesBefore = (minutes) => new Date(Date.parse(READING_AT) - minutes * 60 * 1000);
    // The quarantine runs fire-and-forget after the incident write, so a
    // "was not called" assertion needs the chain to have had its turn.
    const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

    function policyWith(minimumDuration) {
      return {
        sensorId: 'sensor-2',
        alertEmail: 'alerts@example.test',
        sensorName: 'sensor-2',
        temperaturePolicy: { _id: 'policy-1', minTemp: 2, maxTemp: 8, minimumDuration },
      };
    }

    async function ingest(temperature) {
      const res = createResponse();
      await ingestTelemetry({ body: { sensorId: 'sensor-2', temperature, timestamp: READING_AT } }, res);
      expect(res.statusCode).toBe(200);
    }

    beforeEach(() => {
      sensorMetadataLeanMock.mockResolvedValue(policyWith(30));
    });

    it('the first out-of-range reading opens the incident and starts the excursion clock, but quarantines nothing', async () => {
      temperatureIncidentCreateMock.mockImplementation((payload) => ({ _id: 'incident-1', ...payload }));
      usersCollection.find.mockReturnValue({
        project: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([{ email: 'admin@example.test' }]),
        }),
      });

      await ingest(12.5);

      // The incident alert is sent after the point where the quarantine ran.
      await vi.waitFor(() => {
        expect(sendIncidentAlertEmailMock).toHaveBeenCalled();
      });
      expect(temperatureIncidentsCollection.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({ excursionStartedAt: new Date(READING_AT) })
      );
      expect(quarantineByColdChainIncidentMock).not.toHaveBeenCalled();
      // The alarm itself is not delayed.
      expect(sendCriticalAlertEmailMock).toHaveBeenCalledTimes(1);
    }, 15000);

    it('a reading inside minimumDuration of the excursion start does not quarantine, and keeps the clock', async () => {
      temperatureIncidentsCollection.findOne.mockResolvedValue(
        sustainedIncident({ sensorKey: 'sensor-2', excursionStartedAt: minutesBefore(29) })
      );

      await ingest(12.5);

      await vi.waitFor(() => {
        expect(temperatureIncidentsCollection.updateOne).toHaveBeenCalled();
      });
      await settle();
      expect(temperatureIncidentsCollection.updateOne.mock.calls[0][1].$set.excursionStartedAt).toEqual(minutesBefore(29));
      expect(quarantineByColdChainIncidentMock).not.toHaveBeenCalled();
    }, 15000);

    it('CONTROL: a reading minimumDuration after the excursion start quarantines', async () => {
      temperatureIncidentsCollection.findOne.mockResolvedValue(
        sustainedIncident({ sensorKey: 'sensor-2', excursionStartedAt: minutesBefore(30) })
      );

      await ingest(12.5);

      await vi.waitFor(() => {
        expect(quarantineByColdChainIncidentMock).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ _id: 'incident-1', sensorKey: 'sensor-2' })
        );
      });
    }, 15000);

    it('without a usable minimumDuration the 2-hour fallback governs: 60 minutes in, nothing is quarantined', async () => {
      sensorMetadataLeanMock.mockResolvedValue(policyWith(null));
      temperatureIncidentsCollection.findOne.mockResolvedValue(
        sustainedIncident({ sensorKey: 'sensor-2', excursionStartedAt: minutesBefore(60) })
      );

      await ingest(12.5);

      await vi.waitFor(() => {
        expect(temperatureIncidentsCollection.updateOne).toHaveBeenCalled();
      });
      await settle();
      expect(quarantineByColdChainIncidentMock).not.toHaveBeenCalled();
    }, 15000);

    it('CONTROL: without a usable minimumDuration, 120 minutes in, the quarantine fires', async () => {
      sensorMetadataLeanMock.mockResolvedValue(policyWith(null));
      temperatureIncidentsCollection.findOne.mockResolvedValue(
        sustainedIncident({ sensorKey: 'sensor-2', excursionStartedAt: minutesBefore(120) })
      );

      await ingest(12.5);

      await vi.waitFor(() => {
        expect(quarantineByColdChainIncidentMock).toHaveBeenCalled();
      });
    }, 15000);

    it('an active incident with no excursion clock restarts it at this reading and does not quarantine', async () => {
      // The temperature came back in range since the incident opened (which
      // stopped the clock), or the incident predates #1207. Its openedAt is
      // not when this excursion began.
      temperatureIncidentsCollection.findOne.mockResolvedValue(
        sustainedIncident({ sensorKey: 'sensor-2', openedAt: minutesBefore(180), excursionStartedAt: null })
      );

      await ingest(12.5);

      await vi.waitFor(() => {
        expect(temperatureIncidentsCollection.updateOne).toHaveBeenCalled();
      });
      await settle();
      expect(temperatureIncidentsCollection.updateOne.mock.calls[0][1].$set.excursionStartedAt).toEqual(new Date(READING_AT));
      expect(quarantineByColdChainIncidentMock).not.toHaveBeenCalled();
    }, 15000);

    it('an in-range reading stops the excursion clock on the sensor\'s active incident', async () => {
      await ingest(5);

      await vi.waitFor(() => {
        expect(temperatureIncidentsCollection.updateOne).toHaveBeenCalledWith(
          {
            sensorKey: 'sensor-2',
            status: { $in: ['open', 'acknowledged', 'escalated'] },
            excursionStartedAt: { $ne: null },
          },
          { $set: expect.objectContaining({ excursionStartedAt: null }) }
        );
      });
      expect(quarantineByColdChainIncidentMock).not.toHaveBeenCalled();
      expect(sendCriticalAlertEmailMock).not.toHaveBeenCalled();
    }, 15000);
  });

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

  // #1317 (RF009 AC1, RNF016 C3): this case asserted the reverse, a reading
  // accepted although InfluxDB never held it. InfluxDB is the authority now.
  it('answers 503 when InfluxDB does not persist the reading, but still evaluates the policy', async () => {
    const loggerModule = require('../../src/utils/logger');
    const errorSpy = vi.spyOn(loggerModule, 'error').mockImplementation(() => undefined);
    saveTelemetryPointMock.mockRejectedValue(new Error('influx boom'));

    const req = { body: { sensorId: 'sensor-2', temperature: 5 } };
    const res = createResponse();

    await ingestTelemetry(req, res);

    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ success: false, code: 'TELEMETRY_NOT_PERSISTED' });
    expect(sensorMetadataLeanMock).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith('[ISO20387][IOT] Falha ao persistir telemetria no InfluxDB:', 'influx boom');
    errorSpy.mockRestore();
  }, 15000);

  it('control: a persisted reading answers 200 with its identity, the point carrying it', async () => {
    saveTelemetryPointMock.mockResolvedValue(true);
    const req = { body: { sensorId: 'sensor-2', temperature: 5, timestamp: new Date().toISOString() } };
    const res = createResponse();

    await ingestTelemetry(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ clockStatus: 'synchronized' });
    expect(res.body.persistedAt).toBeInstanceOf(Date);
    expect(saveTelemetryPointMock.mock.calls[0][3]).toMatchObject({ telemetryReadingId: res.body.telemetryReadingId, ingestionService: 'iot-api' });
  }, 15000);

  // RF009 AC7 (#1317): a client idempotencyKey replays here as on the
  // temperature route, from RF029's key store, once InfluxDB holds the reading.
  it('a second send of one client key answers 200 replayed with the first reading, written and audited once', async () => {
    const body = { sensorId: 'sensor-2', temperature: 5, idempotencyKey: 'k-1' };
    const first = createResponse();
    const second = createResponse();

    await ingestTelemetry({ body }, first);
    await ingestTelemetry({ body: { ...body } }, second);

    expect(first.statusCode).toBe(200);
    expect(first.body.replayed).toBeUndefined();
    expect(second.statusCode).toBe(200);
    expect(second.body).toMatchObject({ success: true, accepted: true, replayed: true, telemetryReadingId: first.body.telemetryReadingId });
    expect(saveTelemetryPointMock).toHaveBeenCalledTimes(1);
    expect(auditLogSpy.mock.calls.filter(([entry]) => entry.action === 'CREATE')).toHaveLength(1);
  }, 15000);

  it('control: the same client key on another sensor is not a replay', async () => {
    const first = createResponse();
    const second = createResponse();

    await ingestTelemetry({ body: { sensorId: 'sensor-2', temperature: 5, idempotencyKey: 'k-1' } }, first);
    await ingestTelemetry({ body: { sensorId: 'sensor-3', temperature: 5, idempotencyKey: 'k-1' } }, second);

    expect(second.statusCode).toBe(200);
    expect(second.body.replayed).toBeUndefined();
    expect(second.body.telemetryReadingId).not.toBe(first.body.telemetryReadingId);
    expect(saveTelemetryPointMock).toHaveBeenCalledTimes(2);
  }, 15000);

  it('a first send that answers 503 records no key, so its retry is written and recorded', async () => {
    const errorSpy = vi.spyOn(require('../../src/utils/logger'), 'error').mockImplementation(() => undefined);
    saveTelemetryPointMock.mockRejectedValueOnce(new Error('influx boom'));
    const body = { sensorId: 'sensor-2', temperature: 5, idempotencyKey: 'k-503' };
    const first = createResponse();
    const retry = createResponse();

    await ingestTelemetry({ body }, first);
    expect(first.statusCode).toBe(503);
    expect(idempotencyKeysCollection.docs).toHaveLength(0);

    await ingestTelemetry({ body: { ...body } }, retry);
    expect(retry.statusCode).toBe(200);
    expect(retry.body.replayed).toBeUndefined();
    expect(saveTelemetryPointMock).toHaveBeenCalledTimes(2);
    expect(idempotencyKeysCollection.docs).toEqual([
      expect.objectContaining({
        idempotencyKey: 'k-503',
        scope: 'TelemetryReading:sensor-2',
        status: 'completed',
        resultRef: expect.objectContaining({ telemetryReadingId: retry.body.telemetryReadingId }),
      }),
    ]);
    errorSpy.mockRestore();
  }, 15000);

  it('a key store that cannot be read is logged, and the reading is accepted', async () => {
    const errorSpy = vi.spyOn(require('../../src/utils/logger'), 'error').mockImplementation(() => undefined);
    idempotencyKeysCollection.findOne = vi.fn().mockRejectedValue(new Error('key store down'));
    const res = createResponse();

    await ingestTelemetry({ body: { sensorId: 'sensor-2', temperature: 5, idempotencyKey: 'k-down' } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, accepted: true });
    expect(saveTelemetryPointMock).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith('[ISO20387][IOT] Falha ao consultar idempotencyKey da telemetria:', 'key store down');
    errorSpy.mockRestore();
  }, 15000);

  it('control: a reading without a client key never touches the key store', async () => {
    const findSpy = vi.spyOn(idempotencyKeysCollection, 'findOne');
    const updateSpy = vi.spyOn(idempotencyKeysCollection, 'updateOne');
    const res = createResponse();

    await ingestTelemetry({ body: { sensorId: 'sensor-2', temperature: 5 } }, res);

    expect(res.statusCode).toBe(200);
    expect(idempotencyKeysCollection.docs).toHaveLength(0);
    expect(findSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
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

  // RF009 AC4, V2E-0569 (#1317): a reading bound to a datastream is judged
  // against the TemperaturePolicy its thresholdProfileId names; the
  // SensorMetadata policy (2..8 here) is the fallback. The readings carry no
  // timestamp, so observedAt is now, inside the stream's validity.
  describe('#1317: the threshold profile of the datastream valid at observedAt', () => {
    const mongoose = require('mongoose');
    const HEX_PROFILE_ID = '64b7f0c2a1b2c3d4e5f60718';
    let stream;

    function bindTo(thresholdProfileId) {
      stream = {
        telemetryDatastreamId: 'ds-1',
        sensorId: 'sensor-2',
        observedProperty: 'temperature',
        storageLocationId: 'loc-1',
        validityPeriod: { start: new Date('2026-01-01'), end: null },
        thresholdProfileId,
      };
      datastreamsCollection = {
        find: vi.fn(() => ({ toArray: async () => [stream] })),
        findOne: vi.fn(async (filter) => (filter.telemetryDatastreamId === stream.telemetryDatastreamId ? stream : null)),
      };
    }

    function policies(byId) {
      temperaturePoliciesCollection = {
        findOne: vi.fn(async (filter) => byId[filter._id] || null),
      };
    }

    it('a reading inside the datastream profile opens no excursion, though it is outside the sensor policy', async () => {
      bindTo('policy-ds');
      policies({ 'policy-ds': { _id: 'policy-ds', minTemp: 0, maxTemp: 20 } });

      const res = createResponse();
      await ingestTelemetry({ body: { sensorId: 'sensor-2', temperature: 12.5 } }, res);

      expect(res.statusCode).toBe(200);
      expect(sendCriticalAlertEmailMock).not.toHaveBeenCalled();
      // The in-range path's detached clock stop has run, so an incident
      // insert would have run by now too.
      await vi.waitFor(() => {
        expect(temperatureIncidentsCollection.updateOne).toHaveBeenCalled();
      });
      expect(temperatureIncidentsCollection.insertOne).not.toHaveBeenCalled();
    }, 15000);

    it('CONTROL: the same reading with no datastream fires against the sensor policy', async () => {
      const res = createResponse();
      await ingestTelemetry({ body: { sensorId: 'sensor-2', temperature: 12.5 } }, res);

      expect(res.statusCode).toBe(200);
      expect(sendCriticalAlertEmailMock).toHaveBeenCalledWith('sensor-2', 12.5, 8, 'alerts@example.test');
    }, 15000);

    it('a reading inside the sensor policy fires when it is outside the datastream profile', async () => {
      bindTo('policy-ds');
      policies({ 'policy-ds': { _id: 'policy-ds', minTemp: -90, maxTemp: -70 } });

      await ingestTelemetry({ body: { sensorId: 'sensor-2', temperature: 5 } }, createResponse());

      expect(sendCriticalAlertEmailMock).toHaveBeenCalledWith('sensor-2', 5, -70, 'alerts@example.test');
      const alertLine = consoleLogSpy.mock.calls.find(([tag]) => tag === '[ALERTA][IOT] Temperatura fora da política');
      expect(JSON.parse(alertLine[1])).toMatchObject({ policyId: 'policy-ds', minTemp: -90, maxTemp: -70 });
    }, 15000);

    it('a profile that names no policy falls back to the sensor policy, with a warning', async () => {
      const warnSpy = vi.spyOn(require('../../src/utils/logger'), 'warn').mockImplementation(() => undefined);
      bindTo('policy-missing');
      policies({});

      await ingestTelemetry({ body: { sensorId: 'sensor-2', temperature: 12.5 } }, createResponse());

      expect(sendCriticalAlertEmailMock).toHaveBeenCalledWith('sensor-2', 12.5, 8, 'alerts@example.test');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('TelemetryDatastream'),
        expect.objectContaining({ datastreamId: 'ds-1', thresholdProfileId: 'policy-missing' })
      );
      warnSpy.mockRestore();
    }, 15000);

    it('a 24-hex profile id is looked up as an ObjectId and as the raw string', async () => {
      bindTo(HEX_PROFILE_ID);
      policies({});

      await ingestTelemetry({ body: { sensorId: 'sensor-2', temperature: 5 } }, createResponse());

      expect(temperaturePoliciesCollection.findOne).toHaveBeenCalledTimes(1);
      const [filter] = temperaturePoliciesCollection.findOne.mock.calls[0];
      expect(filter._id.$in).toHaveLength(2);
      expect(filter._id.$in[0]).toBeInstanceOf(mongoose.Types.ObjectId);
      expect(filter._id.$in[0].toHexString()).toBe(HEX_PROFILE_ID);
      expect(filter._id.$in[1]).toBe(HEX_PROFILE_ID);
    }, 15000);

    it('a 24-hex profile id resolves the policy whose _id is that ObjectId', async () => {
      bindTo(HEX_PROFILE_ID);
      const policy = { _id: new mongoose.Types.ObjectId(HEX_PROFILE_ID), minTemp: -90, maxTemp: -70 };
      // Matches as MongoDB does through the mongoose connection: only an
      // ObjectId of mongoose's own bson equals the stored _id (#651).
      temperaturePoliciesCollection = {
        findOne: vi.fn(async (filter) => {
          const candidates = filter._id?.$in || [filter._id];
          return candidates.some((id) => id instanceof mongoose.Types.ObjectId && id.equals(policy._id)) ? policy : null;
        }),
      };

      await ingestTelemetry({ body: { sensorId: 'sensor-2', temperature: 5 } }, createResponse());

      expect(sendCriticalAlertEmailMock).toHaveBeenCalledWith('sensor-2', 5, -70, 'alerts@example.test');
    }, 15000);

    it('a bound reading leaves the cached sensor policy as it was for the next unbound reading', async () => {
      bindTo('policy-ds');
      policies({ 'policy-ds': { _id: 'policy-ds', minTemp: 0, maxTemp: 20 } });

      await ingestTelemetry({ body: { sensorId: 'sensor-2', temperature: 12.5 } }, createResponse());
      expect(sendCriticalAlertEmailMock).not.toHaveBeenCalled();

      // The default collection has no find, so the binding fails and, under
      // `record`, the reading goes on unbound; its policy is the cached one.
      datastreamsCollection = null;
      await ingestTelemetry({ body: { sensorId: 'sensor-2', temperature: 12.5 } }, createResponse());

      expect(sensorMetadataFindOneMock).toHaveBeenCalledTimes(1);
      expect(sendCriticalAlertEmailMock).toHaveBeenCalledWith('sensor-2', 12.5, 8, 'alerts@example.test');
    }, 15000);
  });

  // #1392: the excursion is keyed by the equipmentId of the sensor's
  // temperature datastream valid now; SensorMetadata's device is the
  // fallback for an unbound sensor.
  describe('#1392: the excursion equipment key', () => {
    beforeEach(() => {
      sensorMetadataLeanMock.mockResolvedValue({
        sensorId: 'sensor-2',
        alertEmail: 'alerts@example.test',
        sensorName: 'sensor-2',
        device: { _id: 'device-oid-1', deviceId: 'device-1' },
        temperaturePolicy: { _id: 'policy-1', minTemp: 2, maxTemp: 8 },
      });
      excursionsCollection = {
        findOne: vi.fn().mockResolvedValue(null),
        updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'excursion-1' }),
      };
    });

    it('a bound sensor opens its excursion under the equipmentId of its datastream (#1392)', async () => {
      const stream = {
        telemetryDatastreamId: 'ds-1',
        sensorId: 'sensor-2',
        equipmentId: 'equip-ds',
        observedProperty: 'temperature',
        storageLocationId: 'loc-1',
        validityPeriod: { start: new Date('2026-01-01'), end: null },
        thresholdProfileId: 'policy-ds',
      };
      datastreamsCollection = {
        find: vi.fn(() => ({ toArray: async () => [stream] })),
        findOne: vi.fn(async (filter) => (filter.telemetryDatastreamId === stream.telemetryDatastreamId ? stream : null)),
      };
      temperaturePoliciesCollection = {
        findOne: vi.fn(async (filter) => (filter._id === 'policy-ds' ? { _id: 'policy-ds', minTemp: 2, maxTemp: 8 } : null)),
      };

      await ingestTelemetry({ body: { sensorId: 'sensor-2', temperature: 12.5 } }, createResponse());

      await vi.waitFor(() => {
        expect(excursionsCollection.insertOne).toHaveBeenCalled();
      });
      expect(excursionsCollection.findOne).toHaveBeenCalledWith({
        equipmentId: 'equip-ds',
        excursionStatus: { $in: ['open', 'under_assessment'] },
      });
      expect(excursionsCollection.insertOne.mock.calls[0][0].equipmentId).toBe('equip-ds');
      await vi.waitFor(() => {
        expect(dispatchNotificationMock).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            eventType: 'environmental_excursion',
            payload: expect.objectContaining({ sensorId: 'sensor-2', equipmentId: 'equip-ds', deviceId: 'device-1' }),
          })
        );
      });
    }, 15000);

    it('an unbound sensor keeps the deviceId of its SensorMetadata device as the key (#1392)', async () => {
      const warnSpy = vi.spyOn(require('../../src/utils/logger'), 'warn').mockImplementation(() => undefined);

      await ingestTelemetry({ body: { sensorId: 'sensor-2', temperature: 12.5 } }, createResponse());

      await vi.waitFor(() => {
        expect(excursionsCollection.insertOne).toHaveBeenCalled();
      });
      expect(excursionsCollection.findOne).toHaveBeenCalledWith({
        equipmentId: 'device-1',
        excursionStatus: { $in: ['open', 'under_assessment'] },
      });
      expect(excursionsCollection.insertOne.mock.calls[0][0].equipmentId).toBe('device-1');
      await vi.waitFor(() => {
        expect(dispatchNotificationMock).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ payload: expect.objectContaining({ equipmentId: 'device-1', deviceId: 'device-1' }) })
        );
      });
      warnSpy.mockRestore();
    }, 15000);
  });

  // RULE-025 (#1582): a trustworthy reading sent with non-contract fields is
  // kept, its extra fields are stripped before hash, screen and store, it is
  // flagged, and one security audit names the fields, never a value. A body
  // refused for its own fault is still audited, and a contract-only body is
  // not.
  describe('RULE-025 on POST /api/iot/telemetry (#1582)', () => {
    const extras = { patientName: 'Maria da Silva 123.456.789-09', cpf: '12345678909' };

    async function captureWrites() {
      const base = await connectMongoDBMock();
      const events = [];
      const issues = [];
      connectMongoDBMock.mockResolvedValue({
        collection: (name) => {
          if (name === 'telemetryIngestionEvents') return { insertOne: async (doc) => { events.push(doc); return {}; } };
          if (name === 'telemetryValidationIssues') return { insertMany: async (docs) => { issues.push(...docs); return {}; } };
          return base.collection(name);
        },
      });
      return { events, issues };
    }

    const strippedAudits = () => auditLogSpy.mock.calls
      .map(([entry]) => entry)
      .filter((entry) => entry && entry.action === 'TELEMETRY_PII_STRIPPED');

    it('(a) stores a valid reading with extra fields and writes one security audit', async () => {
      const { issues } = await captureWrites();
      const res = createResponse();

      await ingestTelemetry({ body: { sensorId: 'sensor-2', temperature: 5, ...extras } }, res);

      expect(res.statusCode).toBe(200);
      expect(saveTelemetryPointMock).toHaveBeenCalledTimes(1);
      expect(strippedAudits()).toEqual([expect.objectContaining({
        resourceType: 'TelemetryReading',
        resourceId: 'sensor-2',
        severity: 'warning',
        source: 'api',
        payload: { ingestionService: 'iot-api', fieldNames: ['cpf', 'patientName'], unlistedFieldCount: 0 },
      })]);
      expect(issues.filter((issue) => issue.issueCode === 'personal_data_stripped'))
        .toEqual([expect.objectContaining({ disposition: 'quarantined' })]);
    }, 15000);

    it('(b) refuses an implausible reading whole and still audits its extra fields', async () => {
      await captureWrites();
      const res = createResponse();

      await ingestTelemetry({ body: { sensorId: 'sensor-2', temperature: 900, ...extras } }, res);

      expect(res.statusCode).toBe(422);
      expect(saveTelemetryPointMock).not.toHaveBeenCalled();
      expect(strippedAudits()).toHaveLength(1);
    }, 15000);

    it('(b) a body refused 400 for a missing sensorId still audits its extra fields', async () => {
      await captureWrites();
      const res = createResponse();

      await ingestTelemetry({ body: { temperature: 5, ...extras } }, res);

      expect(res.statusCode).toBe(400);
      expect(saveTelemetryPointMock).not.toHaveBeenCalled();
      expect(strippedAudits()).toHaveLength(1);
    }, 15000);

    it('(c) a contract-only reading writes no security audit and no personal_data_stripped issue', async () => {
      const { issues } = await captureWrites();
      const res = createResponse();

      await ingestTelemetry({ body: { sensorId: 'sensor-2', temperature: 5 } }, res);

      expect(res.statusCode).toBe(200);
      expect(strippedAudits()).toEqual([]);
      expect(issues.filter((issue) => issue.issueCode === 'personal_data_stripped')).toEqual([]);
    }, 15000);

    it('(d) no extra field value reaches a log or an issue or an audit or the stored point', async () => {
      const loggerModule = require('../../src/utils/logger');
      const spies = Object.keys(loggerModule)
        .filter((key) => typeof loggerModule[key] === 'function')
        .map((key) => vi.spyOn(loggerModule, key).mockImplementation(() => undefined));
      consoleLogSpy.mockClear();
      const consoleSpies = [
        consoleLogSpy,
        vi.spyOn(console, 'error').mockImplementation(() => undefined),
        vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      ];
      try {
        const { events, issues } = await captureWrites();
        const res = createResponse();

        await ingestTelemetry({ body: { sensorId: 'sensor-2', temperature: 5, ...extras } }, res);

        expect(res.statusCode).toBe(200);
        // The route's CREATE audit row passes the request itself; auditLogger
        // keeps only what extractRequestInfo reads from it, never its body.
        const auditEntries = auditLogSpy.mock.calls.map(([entry]) => (
          entry && entry.req ? { ...entry, req: auditLogger.extractRequestInfo(entry.req) } : entry
        ));
        const seen = JSON.stringify([
          [...spies, ...consoleSpies].map((spy) => spy.mock.calls),
          auditEntries,
          issues,
          events,
          saveTelemetryPointMock.mock.calls,
          res.body,
        ]);
        expect(seen).not.toContain('Maria');
        expect(seen).not.toContain('12345678909');
      } finally {
        spies.forEach((spy) => spy.mockRestore());
        consoleSpies.slice(1).forEach((spy) => spy.mockRestore());
      }
    }, 15000);
  });
});
