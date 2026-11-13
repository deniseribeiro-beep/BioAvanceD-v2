import { describe, it, expect, vi, afterEach } from 'vitest';

const {
  readingIdentityOf, screenReading, splitContractFields, IOT_API_READING_FIELDS,
} = require('../../../src/services/telemetryReadingContract');
const influxTelemetryWriteRepository = require('../../../src/infrastructure/persistence/influxdb/InfluxTelemetryWriteRepository');
const iotStreamingService = require('../../../src/services/iot-streaming.service');

// RF009 AC8, RNF004 C7 (#1540): a reading that carries fields outside the
// reading contract is stored with those fields stripped, and flagged by a
// quarantined personal_data_stripped TelemetryValidationIssue. It is never
// refused, and no stripped value is written anywhere.

afterEach(() => { vi.restoreAllMocks(); });

const RECEIVED = new Date('2026-10-10T12:00:00.000Z');
const SYNCED = new Date(RECEIVED.getTime() - 60 * 1000).toISOString();
const PII_VALUE = 'Maria da Silva 123.456.789-09';

// Sensor s1 is bound (RF009 AC4) and a homologated, unretired Device, so the
// only issue a synchronized, plausible reading can carry is the one here.
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

describe('splitContractFields', () => {
  it('keeps the contract fields and names the others, sorted, without their values', () => {
    const payload = {
      sensorId: 's1', temperature: 4, timestamp: SYNCED, idempotencyKey: 'k-1', patientName: PII_VALUE, cpf: '12345678909', note: null,
    };
    const { reading, strippedFields } = splitContractFields(payload, IOT_API_READING_FIELDS);
    expect(reading).toEqual({ sensorId: 's1', temperature: 4, timestamp: SYNCED, idempotencyKey: 'k-1' });
    expect(strippedFields).toEqual(['cpf', 'patientName']);
  });

  it('control: a payload of contract fields only strips nothing', () => {
    const payload = { sensorId: 's1', temperature: 4, temperatureUnit: '°C', timestamp: SYNCED, sourceEventId: 'e-1', sequenceNumber: 3 };
    expect(splitContractFields(payload, IOT_API_READING_FIELDS)).toEqual({ reading: payload, strippedFields: [] });
  });

  it.each([[null], ['text'], [42], [['sensorId']]])('a payload that is not a plain object (%j) has no fields', (payload) => {
    expect(splitContractFields(payload, IOT_API_READING_FIELDS)).toEqual({ reading: {}, strippedFields: [] });
  });
});

describe('screenReading with stripped fields', () => {
  it('records one quarantined personal_data_stripped issue and keeps the reading, with no stripped value written', async () => {
    const { db, collectionOf } = fakeDb();
    const identity = readingIdentityOf({ sensorId: 's1', temperature: 4, timestamp: SYNCED }, RECEIVED, { ingestionService: 'iot-api' });
    const issues = await screenReading(db, identity, { sensorId: 's1', temperature: 4 }, { strippedFields: ['cpf', 'patientName'] });

    const event = collectionOf('telemetryIngestionEvents').insertOne.mock.calls[0][0];
    const written = collectionOf('telemetryValidationIssues').insertMany.mock.calls[0][0];
    expect(written).toEqual(issues);
    expect(written).toEqual([expect.objectContaining({
      issueCode: 'personal_data_stripped', severity: 'error', fieldPath: 'cpf,patientName', disposition: 'quarantined', ingestionEventId: event.telemetryIngestionEventId,
    })]);
    expect(event).toMatchObject({ validationStatus: 'quarantined', telemetryReadingId: identity.telemetryReadingId, issueIds: [written[0].telemetryValidationIssueId] });
    expect(JSON.stringify([event, written])).not.toContain('Maria');
  });

  it('counts a field whose name is not listable, and never writes that name', async () => {
    const { db, collectionOf } = fakeDb();
    const identity = readingIdentityOf({ sensorId: 's1', temperature: 4, timestamp: SYNCED }, RECEIVED);
    await screenReading(db, identity, { sensorId: 's1', temperature: 4 }, { strippedFields: ['maria@example.org', 'patientName'] });

    const [issue] = collectionOf('telemetryValidationIssues').insertMany.mock.calls[0][0];
    expect(issue).toMatchObject({ issueCode: 'personal_data_stripped', fieldPath: 'patientName' });
    expect(issue.details).toContain('1 campo(s) de nome não listável');
    expect(JSON.stringify(issue)).not.toContain('maria@example.org');
  });

  it('control: no stripped field writes nothing', async () => {
    const { db, collectionOf } = fakeDb();
    const identity = readingIdentityOf({ sensorId: 's1', temperature: 4, timestamp: SYNCED }, RECEIVED);
    await expect(screenReading(db, identity, { sensorId: 's1', temperature: 4 }, { strippedFields: [] })).resolves.toEqual([]);
    expect(collectionOf('telemetryIngestionEvents').insertOne).not.toHaveBeenCalled();
  });

  it('a rejected reading still records that it carried stripped fields', async () => {
    const { db, collectionOf } = fakeDb();
    const identity = readingIdentityOf({ sensorId: 's1', temperature: 900, timestamp: SYNCED }, RECEIVED);
    await expect(screenReading(db, identity, { sensorId: 's1', temperature: 900 }, { strippedFields: ['patientName'] }))
      .rejects.toMatchObject({ statusCode: 422, auditReason: 'invalid_value' });
    expect(collectionOf('telemetryValidationIssues').insertMany.mock.calls[0][0].map((issue) => issue.issueCode))
      .toEqual(['invalid_value', 'personal_data_stripped']);
  });
});

describe('processTemperatureData (MQTT and the queue)', () => {
  it('stores the reading and flags it when the caller stripped fields', async () => {
    const write = vi.spyOn(influxTelemetryWriteRepository, 'writeTemperatureReadingNow').mockResolvedValue(new Date());
    const { db, collectionOf } = fakeDb();
    const readingId = await iotStreamingService.processTemperatureData(
      db,
      { sensorId: 's1', temperatureValue: 4, timestamp: new Date(), source: 'mqtt' },
      { strippedFields: ['patientName'] },
    );
    expect(write).toHaveBeenCalledTimes(1);
    expect(collectionOf('telemetryIngestionEvents').insertOne.mock.calls[0][0]).toMatchObject({ protocol: 'mqtt', validationStatus: 'quarantined', telemetryReadingId: readingId });
    expect(collectionOf('telemetryValidationIssues').insertMany.mock.calls[0][0]).toEqual([expect.objectContaining({ issueCode: 'personal_data_stripped' })]);
  });
});
