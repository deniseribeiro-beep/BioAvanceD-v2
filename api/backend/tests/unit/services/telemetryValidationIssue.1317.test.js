import { describe, it, expect, vi, afterEach } from 'vitest';

const {
  readingIdentityOf, validationIssuesOf, screenReading, CLOCK_SKEW_TOLERANCE_MS,
} = require('../../../src/services/telemetryReadingContract');
const influxTelemetryWriteRepository = require('../../../src/infrastructure/persistence/influxdb/InfluxTelemetryWriteRepository');
const temperatureService = require('../../../src/services/temperature.service');
const iotStreamingService = require('../../../src/services/iot-streaming.service');
const TelemetryValidationIssueModel = require('../../../src/models/TelemetryValidationIssue');
const TelemetryIngestionEventModel = require('../../../src/models/TelemetryIngestionEvent');
const logger = require('../../../src/utils/logger');

// #1317 (RF009 AC7): a clock drift and an invalid value are recorded as a
// TelemetryValidationIssue against the TelemetryIngestionEvent that received
// the reading. A drifted reading is quarantined: still stored, its excursion
// check still run. An invalid value is rejected with 422 and never stored.

afterEach(() => { vi.restoreAllMocks(); });

const RECEIVED = new Date('2026-10-10T12:00:00.000Z');
const SYNCED = new Date(RECEIVED.getTime() - 60 * 1000).toISOString();
const DRIFTED = new Date(RECEIVED.getTime() - CLOCK_SKEW_TOLERANCE_MS - 1).toISOString();

// Sensor s1 is bound (RF009 AC4): a datastream valid at every reading here
// and an active registration, and it is a homologated, unretired Device
// (RF017 AC8), so these cases see only the value checks.
// Binding itself is covered in telemetryBinding.1317.test.js.
const S1_DATASTREAM = {
  telemetryDatastreamId: 'ds-s1', sensorId: 's1', observedProperty: 'temperature', validityPeriod: { start: new Date('2020-01-01T00:00:00.000Z'), end: null },
};
const S1_REGISTRATION = { deviceRegistrationId: 'reg-s1', deviceId: 's1', status: 'active' };
const S1_DEVICE = { deviceId: 's1', deviceType: 'sensor', qualificationStatus: 'qualified', retiredAt: null };

function fakeDb() {
  const collections = {};
  const collectionOf = (name) => {
    collections[name] = collections[name] || {
      collectionName: name,
      createIndex: vi.fn().mockResolvedValue('ok'),
      findOne: vi.fn().mockResolvedValue({ deviceRegistrations: S1_REGISTRATION, devices: S1_DEVICE }[name] || null),
      find: vi.fn(() => ({ toArray: async () => (name === 'telemetryDatastreams' ? [S1_DATASTREAM] : []) })),
      insertOne: vi.fn().mockResolvedValue({ insertedId: `${name}-id` }),
      insertMany: vi.fn().mockResolvedValue({ insertedCount: 1 }),
    };
    return collections[name];
  };
  return { db: { collection: vi.fn(collectionOf) }, collectionOf };
}

describe('validationIssuesOf', () => {
  it('a synchronized reading with a plausible value has no issue', () => {
    const identity = readingIdentityOf({ sensorId: 's1', temperatureValue: -80, timestamp: SYNCED }, RECEIVED);
    expect(validationIssuesOf(identity, { temperatureValue: -80 })).toEqual([]);
  });

  it('a drifted clock is a quarantined clock_drift on observedAt', () => {
    const identity = readingIdentityOf({ sensorId: 's1', temperatureValue: 4, timestamp: DRIFTED }, RECEIVED);
    expect(validationIssuesOf(identity, { temperatureValue: 4 })).toEqual([
      expect.objectContaining({ issueCode: 'clock_drift', severity: 'error', fieldPath: 'observedAt', disposition: 'quarantined' }),
    ]);
  });

  it.each([
    ['below absolute zero', { temperatureValue: -300 }, 'temperatureValue'],
    ['above the plausible ceiling', { temperatureValue: 500 }, 'temperatureValue'],
    ['above the ceiling in kelvin', { temperatureValue: 600, temperatureUnit: 'K' }, 'temperatureValue'],
    ['not a number', { temperature: 'abc' }, 'temperature'],
    ['infinite', { temperatureValue: Infinity }, 'temperatureValue'],
  ])('a value %s is a rejected invalid_value', (_label, payload, fieldPath) => {
    const identity = readingIdentityOf({ sensorId: 's1', timestamp: SYNCED }, RECEIVED);
    expect(validationIssuesOf(identity, payload)).toEqual([
      expect.objectContaining({ issueCode: 'invalid_value', severity: 'error', fieldPath, disposition: 'rejected' }),
    ]);
  });

  it.each([
    ['liquid nitrogen in Fahrenheit', { temperatureValue: -320.8, temperatureUnit: '°F' }],
    ['liquid nitrogen in kelvin', { temperatureValue: 77, temperatureUnit: 'K' }],
    ['an incubator', { temperature: '37' }],
  ])('control: %s is plausible', (_label, payload) => {
    const identity = readingIdentityOf({ sensorId: 's1', timestamp: SYNCED }, RECEIVED);
    expect(validationIssuesOf(identity, payload)).toEqual([]);
  });
});

describe('screenReading', () => {
  it('a synchronized reading of a bound sensor writes nothing', async () => {
    const { db, collectionOf } = fakeDb();
    const identity = readingIdentityOf({ sensorId: 's1', temperatureValue: 4, timestamp: SYNCED }, RECEIVED);
    await expect(screenReading(db, identity, { sensorId: 's1', temperatureValue: 4 })).resolves.toEqual([]);
    expect(collectionOf('telemetryIngestionEvents').insertOne).not.toHaveBeenCalled();
    expect(collectionOf('telemetryValidationIssues').insertMany).not.toHaveBeenCalled();
  });

  it('a drifted reading records its issue and ingestion event, and is accepted', async () => {
    const { db, collectionOf } = fakeDb();
    const identity = readingIdentityOf({ sensorId: 's1', temperatureValue: 4, timestamp: DRIFTED }, RECEIVED, { ingestionService: 'mqtt' });
    const issues = await screenReading(db, identity, { sensorId: 's1', temperatureValue: 4 });

    const event = collectionOf('telemetryIngestionEvents').insertOne.mock.calls[0][0];
    const written = collectionOf('telemetryValidationIssues').insertMany.mock.calls[0][0];
    expect(written).toEqual(issues);
    expect(written).toEqual([expect.objectContaining({ issueCode: 'clock_drift', disposition: 'quarantined', ingestionEventId: event.telemetryIngestionEventId })]);
    expect(event).toMatchObject({
      protocol: 'mqtt',
      validationStatus: 'quarantined',
      telemetryReadingId: identity.telemetryReadingId,
      sourceEventId: identity.sourceEventId,
      payloadHash: identity.payloadHash,
      issueIds: [written[0].telemetryValidationIssueId],
    });
    expect(Object.keys(written[0]).sort()).toEqual(Object.keys(TelemetryValidationIssueModel.fieldsOf()).sort());
    expect(Object.keys(event).sort()).toEqual(Object.keys(TelemetryIngestionEventModel.fieldsOf()).sort());
  });

  it('an implausible value records its issue, then is rejected with 422 and no reading id', async () => {
    const { db, collectionOf } = fakeDb();
    const identity = readingIdentityOf({ sensorId: 's1', temperatureValue: 900, timestamp: SYNCED }, RECEIVED, { ingestionService: 'iot-api' });
    await expect(screenReading(db, identity, { sensorId: 's1', temperatureValue: 900 }))
      .rejects.toMatchObject({ statusCode: 422, auditReason: 'invalid_value', details: [expect.stringContaining('temperatureValue')] });
    expect(collectionOf('telemetryValidationIssues').insertMany.mock.calls[0][0]).toEqual([
      expect.objectContaining({ issueCode: 'invalid_value', disposition: 'rejected', fieldPath: 'temperatureValue' }),
    ]);
    expect(collectionOf('telemetryIngestionEvents').insertOne.mock.calls[0][0]).toMatchObject({ protocol: 'https', validationStatus: 'rejected', telemetryReadingId: null });
  });

  it('a failed issue write is logged and does not refuse a drifted reading', async () => {
    const { db, collectionOf } = fakeDb();
    collectionOf('telemetryIngestionEvents').insertOne.mockRejectedValue(new Error('mongo down'));
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const identity = readingIdentityOf({ sensorId: 's1', temperatureValue: 4, timestamp: DRIFTED }, RECEIVED);
    await expect(screenReading(db, identity, { sensorId: 's1', temperatureValue: 4 })).resolves.toHaveLength(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('mongo down'));
  });

  it('resolves a lazy db once per reading, for its binding and any issue', async () => {
    const { db } = fakeDb();
    const lazy = vi.fn().mockResolvedValue(db);
    const synced = readingIdentityOf({ sensorId: 's1', temperatureValue: 4, timestamp: SYNCED }, RECEIVED);
    await screenReading(lazy, synced, { sensorId: 's1', temperatureValue: 4 });
    expect(lazy).toHaveBeenCalledTimes(1);
    const drifted = readingIdentityOf({ sensorId: 's1', temperatureValue: 4, timestamp: DRIFTED }, RECEIVED);
    await screenReading(lazy, drifted, { sensorId: 's1', temperatureValue: 4 });
    expect(lazy).toHaveBeenCalledTimes(2);
  });
});

describe('the ingestion paths screen every reading', () => {
  it('createTemperatureReading: a drifted reading is stored in InfluxDB and records a clock_drift issue', async () => {
    vi.useFakeTimers({ now: RECEIVED, toFake: ['Date'] });
    try {
      const write = vi.spyOn(influxTelemetryWriteRepository, 'writeTemperatureReadingNow').mockResolvedValue(new Date());
      const { db, collectionOf } = fakeDb();
      const result = await temperatureService.createTemperatureReading(db, { sensorId: 's1', temperatureValue: 4, timestamp: DRIFTED });
      expect(write).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ clockStatus: 'drift', _id: 'temperatures-id' });
      expect(collectionOf('telemetryValidationIssues').insertMany.mock.calls[0][0]).toEqual([expect.objectContaining({ issueCode: 'clock_drift' })]);
      expect(collectionOf('telemetryIngestionEvents').insertOne.mock.calls[0][0].telemetryReadingId).toBe(result.telemetryReadingId);
    } finally {
      vi.useRealTimers();
    }
  });

  it('createTemperatureReading: an implausible value is a 422, records an issue, and writes nothing', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const write = vi.spyOn(influxTelemetryWriteRepository, 'writeTemperatureReadingNow').mockResolvedValue(new Date());
    const { db, collectionOf } = fakeDb();
    await expect(temperatureService.createTemperatureReading(db, { sensorId: 's1', temperatureValue: 900 }))
      .rejects.toMatchObject({ statusCode: 422, auditReason: 'invalid_value' });
    expect(write).not.toHaveBeenCalled();
    expect(collectionOf('temperatures').insertOne).not.toHaveBeenCalled();
    expect(collectionOf('telemetryValidationIssues').insertMany).toHaveBeenCalledTimes(1);
  });

  it('control: createTemperatureReading with a synchronized clock records no issue', async () => {
    vi.spyOn(influxTelemetryWriteRepository, 'writeTemperatureReadingNow').mockResolvedValue(new Date());
    const { db } = fakeDb();
    await temperatureService.createTemperatureReading(db, { sensorId: 's1', temperatureValue: 4, timestamp: new Date().toISOString() });
    expect(db.collection.mock.calls.map(([name]) => name)).not.toContain('telemetryValidationIssues');
  });

  it('processTemperatureData (MQTT and the queue): an implausible value throws 422 before InfluxDB', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const write = vi.spyOn(influxTelemetryWriteRepository, 'writeTemperatureReadingNow').mockResolvedValue(new Date());
    const { db, collectionOf } = fakeDb();
    await expect(iotStreamingService.processTemperatureData(db, { sensorId: 's1', temperatureValue: -500, source: 'mqtt' }))
      .rejects.toMatchObject({ statusCode: 422 });
    expect(write).not.toHaveBeenCalled();
    expect(collectionOf('telemetryIngestionEvents').insertOne.mock.calls[0][0]).toMatchObject({ protocol: 'mqtt', validationStatus: 'rejected' });
  });
});
