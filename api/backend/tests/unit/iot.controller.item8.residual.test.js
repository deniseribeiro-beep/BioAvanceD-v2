import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const {
  connectMongoDBMock,
  sensorMetadataFindOneMock,
  excursionCreateMock,
  dispatchNotificationMock,
  saveTelemetryPointMock,
  sendCriticalAlertEmailMock,
  sendIncidentAlertEmailMock,
  quarantineByColdChainIncidentMock,
  findUserAccountIdsByRoleCodesMock,
  auditInitMock,
  auditLogMock,
  loggerErrorMock,
  loggerWarnMock,
} = vi.hoisted(() => ({
  connectMongoDBMock: vi.fn(),
  sensorMetadataFindOneMock: vi.fn(),
  excursionCreateMock: vi.fn(),
  dispatchNotificationMock: vi.fn(),
  saveTelemetryPointMock: vi.fn(),
  sendCriticalAlertEmailMock: vi.fn(),
  sendIncidentAlertEmailMock: vi.fn(),
  quarantineByColdChainIncidentMock: vi.fn(),
  findUserAccountIdsByRoleCodesMock: vi.fn(),
  auditInitMock: vi.fn(),
  auditLogMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  loggerWarnMock: vi.fn(),
}));

// iot.controller.js is CommonJS and captures several dependencies at
// require-time. Patch the live exports before loading it so this residual
// suite exercises controller branches rather than Vitest's ESM mock boundary.
const mongodbConnection = require('../../src/infrastructure/database/mongodb/connection');
const SensorMetadata = require('../../src/models/SensorMetadata.schema');
require('../../src/models/TemperaturePolicy.schema');
require('../../src/models/Device.schema');
const EnvironmentalExcursion = require('../../src/models/EnvironmentalExcursion');
const notificationDispatchService = require('../../src/services/notificationDispatch.service');
const telemetryPointService = require('../../src/services/saveTelemetryPoint');
const criticalAlertService = require('../../src/services/sendCriticalAlertEmail');
const quarantineService = require('../../src/services/equipment-sensor-quarantine.service');
const rbacAssignmentService = require('../../src/services/rbac-assignment.service');
const auditLogger = require('../../src/utils/auditLogger');
const logger = require('../../src/utils/logger');

const sendIncidentAlertEmailPath = require.resolve('../../src/services/sendIncidentAlertEmail');
const originalSendIncidentCache = require.cache[sendIncidentAlertEmailPath];
require.cache[sendIncidentAlertEmailPath] = {
  id: sendIncidentAlertEmailPath,
  filename: sendIncidentAlertEmailPath,
  loaded: true,
  exports: { sendIncidentAlertEmail: sendIncidentAlertEmailMock },
};

const originals = {
  connectMongoDB: mongodbConnection.connectMongoDB,
  sensorFindOne: SensorMetadata.findOne,
  excursionCreate: EnvironmentalExcursion.create,
  dispatchNotification: notificationDispatchService.dispatchNotification,
  saveTelemetryPoint: telemetryPointService.saveTelemetryPoint,
  sendCriticalAlertEmail: criticalAlertService.sendCriticalAlertEmail,
  quarantineByColdChainIncident: quarantineService.quarantineByColdChainIncident,
  findUserAccountIdsByRoleCodes: rbacAssignmentService.findUserAccountIdsByRoleCodes,
  auditInit: auditLogger.init,
  auditLog: auditLogger.log,
  loggerError: logger.error,
  loggerWarn: logger.warn,
};

mongodbConnection.connectMongoDB = connectMongoDBMock;
SensorMetadata.findOne = sensorMetadataFindOneMock;
EnvironmentalExcursion.create = excursionCreateMock;
notificationDispatchService.dispatchNotification = dispatchNotificationMock;
telemetryPointService.saveTelemetryPoint = saveTelemetryPointMock;
criticalAlertService.sendCriticalAlertEmail = sendCriticalAlertEmailMock;
quarantineService.quarantineByColdChainIncident = quarantineByColdChainIncidentMock;
rbacAssignmentService.findUserAccountIdsByRoleCodes = findUserAccountIdsByRoleCodesMock;
auditLogger.init = auditInitMock;
auditLogger.log = auditLogMock;
logger.error = loggerErrorMock;
logger.warn = loggerWarnMock;

const {
  ingestTelemetry,
  sensorPolicyCache,
  upsertEnvironmentalExcursion,
} = require('../../src/controllers/iot.controller');

afterAll(() => {
  mongodbConnection.connectMongoDB = originals.connectMongoDB;
  SensorMetadata.findOne = originals.sensorFindOne;
  EnvironmentalExcursion.create = originals.excursionCreate;
  notificationDispatchService.dispatchNotification = originals.dispatchNotification;
  telemetryPointService.saveTelemetryPoint = originals.saveTelemetryPoint;
  criticalAlertService.sendCriticalAlertEmail = originals.sendCriticalAlertEmail;
  quarantineService.quarantineByColdChainIncident = originals.quarantineByColdChainIncident;
  rbacAssignmentService.findUserAccountIdsByRoleCodes = originals.findUserAccountIdsByRoleCodes;
  auditLogger.init = originals.auditInit;
  auditLogger.log = originals.auditLog;
  logger.error = originals.loggerError;
  logger.warn = originals.loggerWarn;
  if (originalSendIncidentCache) require.cache[sendIncidentAlertEmailPath] = originalSendIncidentCache;
  else delete require.cache[sendIncidentAlertEmailPath];
});

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

function excursionDb(existing = null) {
  const collection = {
    findOne: vi.fn().mockResolvedValue(existing),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'exc-new' }),
  };
  return {
    db: {
      collection: vi.fn((name) => {
        expect(name).toBe('environmentalExcursions');
        return collection;
      }),
    },
    collection,
  };
}

describe('iot.controller.js item 8 residual branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sensorPolicyCache.clear();
    process.env.NODE_ENV = 'test';
    saveTelemetryPointMock.mockResolvedValue(true);
    sendCriticalAlertEmailMock.mockResolvedValue({ id: 'mail-1' });
    sendIncidentAlertEmailMock.mockResolvedValue({ id: 'incident-mail-1' });
    quarantineByColdChainIncidentMock.mockResolvedValue({ triggered: false });
    findUserAccountIdsByRoleCodesMock.mockResolvedValue(['user-account-1']);
    dispatchNotificationMock.mockResolvedValue(null);
    auditLogMock.mockResolvedValue(undefined);
    excursionCreateMock.mockImplementation((payload) => ({ ...payload }));
  });

  afterEach(() => {
    sensorPolicyCache.clear();
  });

  it('updates an open environmental excursion and preserves its id as the notification source', async () => {
    const existing = {
      _id: 'exc-existing',
      minimumValue: 4,
      maximumValue: 7,
      quarantineActionId: 'qa-old',
    };
    const { db, collection } = excursionDb(existing);

    await upsertEnvironmentalExcursion(
      { db, sensorMetadata: { device: { deviceId: 'DEV-1' } } },
      { _id: 'policy-1' },
      'sensor-42',
      12,
      new Date('2026-09-19T12:00:00Z'),
      { triggered: true, incidentId: 'qa-new' }
    );

    expect(collection.updateOne).toHaveBeenCalledWith(
      { _id: 'exc-existing' },
      {
        $set: expect.objectContaining({
          minimumValue: 4,
          maximumValue: 12,
          quarantineActionId: 'qa-new',
        }),
      }
    );
    expect(collection.insertOne).not.toHaveBeenCalled();
    expect(dispatchNotificationMock).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        eventType: 'environmental_excursion',
        sourceEventId: 'exc-existing',
        payload: expect.objectContaining({
          sensorId: 'sensor-42',
          deviceId: 'DEV-1',
        }),
      })
    );
  });

  it('uses the policy id compatibility alias when creating a new environmental excursion', async () => {
    const { db, collection } = excursionDb(null);

    await upsertEnvironmentalExcursion(
      { db, sensorMetadata: { device: { deviceId: 'DEV-2' } } },
      { id: 'policy-alias-2' },
      'sensor-43',
      -90,
      new Date('2026-09-19T13:00:00Z'),
      { triggered: false }
    );

    expect(excursionCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        equipmentId: 'DEV-2',
        triggeringPolicyId: 'policy-alias-2',
        quarantineActionId: null,
      })
    );
    expect(collection.insertOne).toHaveBeenCalled();
  });

  it('keeps triggeringPolicyId empty when neither policy identifier is available', async () => {
    const { db } = excursionDb(null);

    await upsertEnvironmentalExcursion(
      { db, sensorMetadata: {} },
      {},
      'sensor-44',
      9,
      new Date('2026-09-19T14:00:00Z'),
      null
    );

    expect(excursionCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        equipmentId: null,
        triggeringPolicyId: '',
        quarantineActionId: null,
      })
    );
  });

  it('keeps an accepted telemetry ingest at 200 when the audit database lookup throws an Error', async () => {
    const policyDb = {};
    connectMongoDBMock
      .mockResolvedValueOnce(policyDb)
      .mockRejectedValueOnce(new Error('audit database unavailable'));
    sensorMetadataFindOneMock.mockImplementationOnce(() => {
      throw new Error('policy lookup unavailable');
    });

    const req = { body: { sensorId: 'sensor-audit-error', temperature: 5 } };
    const res = createResponse();

    await ingestTelemetry(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, accepted: true });
    expect(auditInitMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      '[ISO20387][IOT] Falha ao registrar trilha de auditoria da telemetria:',
      'audit database unavailable'
    );
  });

  it('uses the raw rejection value in the audit fail-open log when no error.message exists', async () => {
    connectMongoDBMock
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce('audit raw failure');
    sensorMetadataFindOneMock.mockImplementationOnce(() => {
      throw new Error('policy lookup unavailable');
    });

    const req = { body: { sensorId: 'sensor-audit-raw', temperature: 5 } };
    const res = createResponse();

    await ingestTelemetry(req, res);

    expect(res.statusCode).toBe(200);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      '[ISO20387][IOT] Falha ao registrar trilha de auditoria da telemetria:',
      'audit raw failure'
    );
  });

  function outOfRangeDb({ usersCursor, excursionsFindOne = null } = {}) {
    const temperatureIncidents = {
      findOne: vi.fn().mockResolvedValue(null),
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'incident-new' }),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const environmentalExcursions = {
      findOne: typeof excursionsFindOne === 'function'
        ? excursionsFindOne
        : vi.fn().mockResolvedValue(excursionsFindOne),
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'exc-new' }),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const userAccounts = {
      find: vi.fn().mockReturnValue(usersCursor),
    };
    return {
      db: {
        collection: vi.fn((name) => {
          if (name === 'temperatureIncidents') return temperatureIncidents;
          if (name === 'environmentalExcursions') return environmentalExcursions;
          if (name === 'userAccounts') return userAccounts;
          return {
            findOne: vi.fn().mockResolvedValue(null),
            insertOne: vi.fn().mockResolvedValue({ insertedId: 'x' }),
            updateOne: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
            find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
          };
        }),
      },
      temperatureIncidents,
      environmentalExcursions,
      userAccounts,
    };
  }

  it('creates a new temperature incident and emails recipients when the users cursor has no .project', async () => {
    const { db, temperatureIncidents, userAccounts } = outOfRangeDb({
      usersCursor: {
        toArray: vi.fn().mockResolvedValue([
          { email: 'tech@example.test' },
          { email: null },
          { email: 'coord@example.test' },
        ]),
      },
    });
    connectMongoDBMock.mockResolvedValue(db);

    const res = createResponse();
    await ingestTelemetry({ body: { sensorId: 'sensor-1', temperature: 12.5 } }, res);

    expect(res.statusCode).toBe(200);
    await vi.waitFor(() => {
      expect(sendIncidentAlertEmailMock).toHaveBeenCalledWith(
        expect.objectContaining({ _id: 'incident-new' }),
        ['tech@example.test', 'coord@example.test'],
        0
      );
    });
    expect(userAccounts.find).toHaveBeenCalled();
    expect(temperatureIncidents.insertOne).toHaveBeenCalled();
  });

  it('logs IOT_EXCURSION failures with and without error.message', async () => {
    const { db } = outOfRangeDb({
      usersCursor: { toArray: vi.fn().mockResolvedValue([]) },
      excursionsFindOne: vi.fn()
        .mockRejectedValueOnce(new Error('excursion persistence failed'))
        .mockRejectedValueOnce('raw excursion failure'),
    });
    connectMongoDBMock.mockResolvedValue(db);
    findUserAccountIdsByRoleCodesMock.mockResolvedValue([]);

    await ingestTelemetry({ body: { sensorId: 'sensor-1', temperature: 12.5 } }, createResponse());
    await vi.waitFor(() => {
      expect(loggerErrorMock).toHaveBeenCalledWith(
        '[IOT_EXCURSION] Falha ao registrar excursão ambiental:',
        'excursion persistence failed'
      );
    });

    sensorPolicyCache.clear();
    await ingestTelemetry({ body: { sensorId: 'sensor-1', temperature: 12.5 } }, createResponse());
    await vi.waitFor(() => {
      expect(loggerErrorMock).toHaveBeenCalledWith(
        '[IOT_EXCURSION] Falha ao registrar excursão ambiental:',
        'raw excursion failure'
      );
    });
  });

  it('logs critical alert email failures with and without error.message', async () => {
    const { db } = outOfRangeDb({
      usersCursor: { toArray: vi.fn().mockResolvedValue([]) },
    });
    connectMongoDBMock.mockResolvedValue(db);
    findUserAccountIdsByRoleCodesMock.mockResolvedValue([]);
    sendCriticalAlertEmailMock
      .mockRejectedValueOnce(new Error('resend unavailable'))
      .mockRejectedValueOnce('raw resend failure');

    await ingestTelemetry({ body: { sensorId: 'sensor-1', temperature: 12.5 } }, createResponse());
    await vi.waitFor(() => {
      expect(loggerErrorMock).toHaveBeenCalledWith(
        '[ISO20387][IOT] Falha ao enviar e-mail crítico via Resend:',
        'resend unavailable'
      );
    });

    sensorPolicyCache.clear();
    await ingestTelemetry({ body: { sensorId: 'sensor-1', temperature: 12.5 } }, createResponse());
    await vi.waitFor(() => {
      expect(loggerErrorMock).toHaveBeenCalledWith(
        '[ISO20387][IOT] Falha ao enviar e-mail crítico via Resend:',
        'raw resend failure'
      );
    });
  });
});
