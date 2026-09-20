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
  quarantineByColdChainIncidentMock,
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
  quarantineByColdChainIncidentMock: vi.fn(),
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
const auditLogger = require('../../src/utils/auditLogger');
const logger = require('../../src/utils/logger');

const originals = {
  connectMongoDB: mongodbConnection.connectMongoDB,
  sensorFindOne: SensorMetadata.findOne,
  excursionCreate: EnvironmentalExcursion.create,
  dispatchNotification: notificationDispatchService.dispatchNotification,
  saveTelemetryPoint: telemetryPointService.saveTelemetryPoint,
  sendCriticalAlertEmail: criticalAlertService.sendCriticalAlertEmail,
  quarantineByColdChainIncident: quarantineService.quarantineByColdChainIncident,
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
  auditLogger.init = originals.auditInit;
  auditLogger.log = originals.auditLog;
  logger.error = originals.loggerError;
  logger.warn = originals.loggerWarn;
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
    saveTelemetryPointMock.mockResolvedValue(true);
    sendCriticalAlertEmailMock.mockResolvedValue({ id: 'mail-1' });
    quarantineByColdChainIncidentMock.mockResolvedValue({ triggered: false });
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
});
