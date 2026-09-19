import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

vi.mock('../../src/infrastructure/database/mongodb/connection', () => ({
  connectMongoDB: connectMongoDBMock,
}));

vi.mock('../../src/models/SensorMetadata.schema', () => ({
  default: { findOne: sensorMetadataFindOneMock },
  findOne: sensorMetadataFindOneMock,
}));

vi.mock('../../src/models/TemperaturePolicy.schema', () => ({}));
vi.mock('../../src/models/Device.schema', () => ({}));

vi.mock('../../src/models/EnvironmentalExcursion', () => ({
  default: { create: excursionCreateMock },
  create: excursionCreateMock,
}));

vi.mock('../../src/models/TemperatureIncident', () => ({
  default: { create: vi.fn((payload) => payload) },
  create: vi.fn((payload) => payload),
}));

vi.mock('../../src/services/notificationDispatch.service', () => ({
  dispatchNotification: dispatchNotificationMock,
}));

vi.mock('../../src/services/saveTelemetryPoint', () => ({
  saveTelemetryPoint: saveTelemetryPointMock,
}));

vi.mock('../../src/services/sendCriticalAlertEmail', () => ({
  sendCriticalAlertEmail: sendCriticalAlertEmailMock,
}));

vi.mock('../../src/services/equipment-sensor-quarantine.service', () => ({
  quarantineByColdChainIncident: quarantineByColdChainIncidentMock,
}));

vi.mock('../../src/utils/auditLogger', () => ({
  init: auditInitMock,
  log: auditLogMock,
}));

vi.mock('../../src/utils/logger', () => ({
  error: loggerErrorMock,
  warn: loggerWarnMock,
  info: vi.fn(),
  debug: vi.fn(),
}));

const {
  ingestTelemetry,
  sensorPolicyCache,
  upsertEnvironmentalExcursion,
} = require('../../src/controllers/iot.controller');

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
