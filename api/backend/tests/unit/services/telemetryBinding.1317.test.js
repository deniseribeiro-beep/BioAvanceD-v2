import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const env = require('../../../src/config/env');
const { readingIdentityOf, screenReading } = require('../../../src/services/telemetryReadingContract');
const binding = require('../../../src/services/telemetryBinding.service');
const influxTelemetryWriteRepository = require('../../../src/infrastructure/persistence/influxdb/InfluxTelemetryWriteRepository');
const logger = require('../../../src/utils/logger');

// #1317, RF009 AC4 and RF017 AC5: a reading is bound to the
// TelemetryDatastream of its sensor valid at its observedAt, over [start,
// end), and its sensor must hold an active DeviceRegistration. Under
// TELEMETRY_BINDING_MODE `enforce`, the default, a reading missing either is
// refused with 422; under `record` it is stored and the gap recorded.

function valueAt(doc, path) {
  return path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), doc);
}

function matches(doc, filter) {
  return Object.entries(filter).every(([path, expected]) => {
    const actual = valueAt(doc, path);
    if (expected && typeof expected === 'object' && '$lte' in expected) return actual != null && new Date(actual) <= new Date(expected.$lte);
    if (expected === null) return actual == null;
    return actual === expected;
  });
}

function setPath(doc, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const parent = keys.reduce((node, key) => { node[key] = node[key] || {}; return node[key]; }, doc);
  parent[last] = value;
}

function fakeDb() {
  const collections = {};
  const collectionOf = (name) => {
    if (!collections[name]) {
      const docs = [];
      collections[name] = {
        docs,
        createIndex: vi.fn().mockResolvedValue('ok'),
        insertOne: vi.fn(async (doc) => { docs.push(structuredClone(doc)); return { insertedId: docs.length }; }),
        insertMany: vi.fn(async (rows) => { docs.push(...rows.map((row) => structuredClone(row))); return { insertedCount: rows.length }; }),
        findOne: vi.fn(async (filter) => docs.find((doc) => matches(doc, filter)) || null),
        find: vi.fn((filter = {}) => ({ toArray: async () => docs.filter((doc) => matches(doc, filter)) })),
        updateOne: vi.fn(async (filter, update) => {
          const doc = docs.find((row) => matches(row, filter));
          if (doc) Object.entries(update.$set).forEach(([path, value]) => setPath(doc, path, value));
          return { matchedCount: doc ? 1 : 0 };
        }),
      };
    }
    return collections[name];
  };
  return { db: { collection: vi.fn(collectionOf) }, collectionOf };
}

const START = '2026-10-01T00:00:00.000Z';
const END = '2026-10-05T00:00:00.000Z';
const STREAM = {
  sensorId: 'sensor-1', equipmentId: 'freezer-1', storageLocationId: 'loc-1', observedProperty: 'temperature', unit: 'Cel',
  samplingPolicyId: 'sampling-1', thresholdProfileId: 'threshold-1', validityPeriod: { start: START },
};
const REGISTRATION = { deviceId: 'sensor-1', communicationProfileId: 'mqtt-profile-1', credentialReference: 'secret-manager:device/sensor-1' };
// RF017 AC8: the sensor is also a registered, homologated, unretired Device.
const DEVICE = { deviceId: 'sensor-1', deviceType: 'sensor', qualificationStatus: 'qualified', retiredAt: null };

let previousMode;
beforeEach(() => { previousMode = env.TELEMETRY_BINDING_MODE; });
afterEach(() => {
  env.TELEMETRY_BINDING_MODE = previousMode;
  vi.restoreAllMocks();
});

// A reading observed at `at`, received at the same instant (no clock drift).
function reading(at, sensorId = 'sensor-1') {
  const payload = { sensorId, temperatureValue: -80, timestamp: at };
  return { payload, identity: readingIdentityOf(payload, new Date(at)) };
}

describe('resolveReadingBinding: the datastream valid at observedAt, [start, end)', () => {
  async function boundedStream() {
    const { db } = fakeDb();
    const stream = await binding.createDatastream(db, STREAM);
    await binding.endDatastreamValidity(db, stream.telemetryDatastreamId, { end: END });
    return { db, stream };
  }

  it('before start: no datastream', async () => {
    const { db } = await boundedStream();
    const { datastream } = await binding.resolveReadingBinding(db, { sensorId: 'sensor-1', observedProperty: 'temperature', observedAt: new Date('2026-09-30T23:59:59.999Z') });
    expect(datastream).toBeNull();
  });

  it('at start and inside: the datastream', async () => {
    const { db, stream } = await boundedStream();
    for (const at of [START, '2026-10-03T12:00:00.000Z', '2026-10-04T23:59:59.999Z']) {
      const { datastream } = await binding.resolveReadingBinding(db, { sensorId: 'sensor-1', observedProperty: 'temperature', observedAt: new Date(at) });
      expect(datastream?.telemetryDatastreamId).toBe(stream.telemetryDatastreamId);
    }
  });

  it('at end: no datastream, the end is exclusive', async () => {
    const { db } = await boundedStream();
    const { datastream } = await binding.resolveReadingBinding(db, { sensorId: 'sensor-1', observedProperty: 'temperature', observedAt: new Date(END) });
    expect(datastream).toBeNull();
  });

  it('a successor starting at the old end binds the readings from that instant', async () => {
    const { db, stream } = await boundedStream();
    const successor = await binding.createDatastream(db, { ...STREAM, equipmentId: 'freezer-2', validityPeriod: { start: END } });
    const at = (iso) => binding.resolveReadingBinding(db, { sensorId: 'sensor-1', observedProperty: 'temperature', observedAt: new Date(iso) });
    expect((await at('2026-10-04T23:59:59.999Z')).datastream.telemetryDatastreamId).toBe(stream.telemetryDatastreamId);
    expect((await at(END)).datastream.telemetryDatastreamId).toBe(successor.telemetryDatastreamId);
  });

  it('only an active registration counts', async () => {
    const { db } = fakeDb();
    const registration = await binding.createRegistration(db, REGISTRATION);
    const query = { sensorId: 'sensor-1', observedProperty: 'temperature', observedAt: new Date(START) };
    expect((await binding.resolveReadingBinding(db, query)).registration?.deviceRegistrationId).toBe(registration.deviceRegistrationId);
    await binding.deactivateRegistration(db, registration.deviceRegistrationId, { status: 'suspended' });
    expect((await binding.resolveReadingBinding(db, query)).registration).toBeNull();
  });
});

describe('datastreams and registrations are never rewritten in place', () => {
  it('a datastream overlapping an open one of the same sensor and property is a 409', async () => {
    const { db } = fakeDb();
    await binding.createDatastream(db, STREAM);
    await expect(binding.createDatastream(db, { ...STREAM, validityPeriod: { start: END } })).rejects.toMatchObject({ statusCode: 409, code: 'DATASTREAM_OVERLAP' });
  });

  it('ending a validity twice is a 409, and an end not after start a 422', async () => {
    const { db } = fakeDb();
    const stream = await binding.createDatastream(db, STREAM);
    await expect(binding.endDatastreamValidity(db, stream.telemetryDatastreamId, { end: START })).rejects.toMatchObject({ statusCode: 422 });
    await binding.endDatastreamValidity(db, stream.telemetryDatastreamId, { end: END });
    await expect(binding.endDatastreamValidity(db, stream.telemetryDatastreamId, { end: END })).rejects.toMatchObject({ statusCode: 409, code: 'DATASTREAM_ENDED' });
  });

  it('a registration carrying a credential is a 422 and nothing is stored', async () => {
    const { db, collectionOf } = fakeDb();
    await expect(binding.createRegistration(db, { ...REGISTRATION, token: 'eyJhbGciOi' })).rejects.toMatchObject({ statusCode: 422 });
    expect(collectionOf('deviceRegistrations').docs).toHaveLength(0);
  });
});

describe('screenReading binds every reading (RF009 AC4)', () => {
  async function boundDb() {
    const fake = fakeDb();
    const stream = await binding.createDatastream(fake.db, STREAM);
    await binding.createRegistration(fake.db, REGISTRATION);
    await fake.collectionOf('devices').insertOne(DEVICE);
    return { ...fake, stream };
  }

  it('a bound reading is stamped with its datastream and its location and records nothing', async () => {
    env.TELEMETRY_BINDING_MODE = 'enforce';
    const { db, collectionOf, stream } = await boundDb();
    const { payload, identity } = reading('2026-10-02T00:00:00.000Z');
    await expect(screenReading(db, identity, payload)).resolves.toEqual([]);
    expect(identity.datastreamId).toBe(stream.telemetryDatastreamId);
    expect(identity.storageLocationId).toBe(STREAM.storageLocationId);
    expect(collectionOf('telemetryValidationIssues').docs).toHaveLength(0);
  });

  it('enforce: a reading with no datastream valid at observedAt is a 422 and records a rejected unbound_datastream', async () => {
    env.TELEMETRY_BINDING_MODE = 'enforce';
    const { db, collectionOf } = await boundDb();
    const { payload, identity } = reading('2026-09-30T00:00:00.000Z');
    await expect(screenReading(db, identity, payload)).rejects.toMatchObject({ statusCode: 422, auditReason: 'unbound_datastream' });
    expect(collectionOf('telemetryValidationIssues').docs).toEqual([
      expect.objectContaining({ issueCode: 'unbound_datastream', disposition: 'rejected', fieldPath: 'sensorId' }),
    ]);
    expect(collectionOf('telemetryIngestionEvents').docs).toEqual([expect.objectContaining({ validationStatus: 'rejected', telemetryReadingId: null })]);
  });

  it('enforce: a sensor with no active registration is a 422 and records a rejected device_not_registered', async () => {
    env.TELEMETRY_BINDING_MODE = 'enforce';
    const { db, collectionOf } = fakeDb();
    await binding.createDatastream(db, STREAM);
    await collectionOf('devices').insertOne(DEVICE);
    const { payload, identity } = reading('2026-10-02T00:00:00.000Z');
    await expect(screenReading(db, identity, payload)).rejects.toMatchObject({ statusCode: 422, auditReason: 'device_not_registered' });
    expect(collectionOf('telemetryValidationIssues').docs).toEqual([
      expect.objectContaining({ issueCode: 'device_not_registered', disposition: 'rejected' }),
    ]);
  });

  it('enforce (the default): an unset mode refuses an unbound, unregistered reading with 422 and records its three issues rejected', async () => {
    env.TELEMETRY_BINDING_MODE = undefined;
    const { db, collectionOf } = fakeDb();
    const { payload, identity } = reading('2026-10-02T00:00:00.000Z', 'sensor-unbound');
    await expect(screenReading(db, identity, payload)).rejects.toMatchObject({ statusCode: 422 });
    expect(collectionOf('telemetryValidationIssues').docs.map((issue) => [issue.issueCode, issue.disposition])).toEqual([
      ['unbound_datastream', 'rejected'], ['device_not_registered', 'rejected'], ['device_unusable', 'rejected'],
    ]);
    expect(identity.datastreamId).toBeNull();
    expect(identity.storageLocationId).toBeNull();
    expect(collectionOf('telemetryIngestionEvents').docs).toEqual([expect.objectContaining({ validationStatus: 'rejected', telemetryReadingId: null })]);
  });

  it('an unknown mode value is enforce', async () => {
    env.TELEMETRY_BINDING_MODE = 'enforced';
    const { db } = fakeDb();
    const { payload, identity } = reading('2026-10-02T00:00:00.000Z', 'sensor-unbound');
    await expect(screenReading(db, identity, payload)).rejects.toMatchObject({ statusCode: 422 });
  });

  it('enforce: a binding lookup that fails refuses the reading with 503; record lets it through', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const failing = { collection: () => ({ find: () => { throw new Error('mongo down'); } }) };
    env.TELEMETRY_BINDING_MODE = 'enforce';
    const first = reading('2026-10-02T00:00:00.000Z');
    await expect(screenReading(failing, first.identity, first.payload)).rejects.toMatchObject({ statusCode: 503, code: 'TELEMETRY_BINDING_UNVERIFIABLE' });
    env.TELEMETRY_BINDING_MODE = 'record';
    const second = reading('2026-10-02T00:00:00.000Z');
    await expect(screenReading(failing, second.identity, second.payload)).resolves.toEqual([]);
    expect(second.identity.datastreamId).toBeNull();
    expect(second.identity.storageLocationId).toBeNull();
  });

  // RF017 AC8: the sensor's Device must be registered, homologated and unretired.
  it.each([
    ['absent', (docs) => { docs.length = 0; }, /não registrado/],
    ['not homologated', (docs) => { docs[0].qualificationStatus = 'pending'; }, /não homologado/],
    ['retired', (docs) => { docs[0].retiredAt = new Date(START); }, /retirado/],
  ])('enforce: a sensor whose Device is %s is a 422 and records a rejected device_unusable', async (_label, alter, details) => {
    env.TELEMETRY_BINDING_MODE = 'enforce';
    const { db, collectionOf } = await boundDb();
    alter(collectionOf('devices').docs);
    const { payload, identity } = reading('2026-10-02T00:00:00.000Z');
    await expect(screenReading(db, identity, payload)).rejects.toMatchObject({ statusCode: 422, auditReason: 'device_unusable' });
    const issues = collectionOf('telemetryValidationIssues').docs;
    expect(issues).toEqual([expect.objectContaining({ issueCode: 'device_unusable', disposition: 'rejected', fieldPath: 'sensorId' })]);
    expect(issues[0].details).toMatch(details);
  });

  it('record: a sensor whose Device is not homologated is accepted, stamped, with device_unusable quarantined', async () => {
    env.TELEMETRY_BINDING_MODE = 'record';
    const { db, collectionOf, stream } = await boundDb();
    collectionOf('devices').docs[0].qualificationStatus = 'pending';
    const { payload, identity } = reading('2026-10-02T00:00:00.000Z');
    const issues = await screenReading(db, identity, payload);
    expect(issues.map((issue) => [issue.issueCode, issue.disposition])).toEqual([['device_unusable', 'quarantined']]);
    expect(identity.datastreamId).toBe(stream.telemetryDatastreamId);
  });

  it('enforce: a Device lookup that fails refuses the reading with 503; record lets it through, still stamped', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const { db, stream } = await boundDb();
    const collection = db.collection;
    db.collection = vi.fn((name) => (name === 'devices' ? { findOne: async () => { throw new Error('mongo down'); } } : collection(name)));
    env.TELEMETRY_BINDING_MODE = 'enforce';
    const first = reading('2026-10-02T00:00:00.000Z');
    await expect(screenReading(db, first.identity, first.payload)).rejects.toMatchObject({ statusCode: 503, code: 'TELEMETRY_BINDING_UNVERIFIABLE' });
    env.TELEMETRY_BINDING_MODE = 'record';
    const second = reading('2026-10-02T00:00:00.000Z');
    await expect(screenReading(db, second.identity, second.payload)).resolves.toEqual([]);
    expect(second.identity.datastreamId).toBe(stream.telemetryDatastreamId);
    expect(error).toHaveBeenCalledTimes(2);
  });

  it('the InfluxDB point carries the datastream and the location as tags', () => {
    const point = influxTelemetryWriteRepository.toPoint({ sensorId: 'sensor-1', temperatureValue: -80, datastreamId: 'ds-1', storageLocationId: 'loc-1', observedAt: new Date(START) });
    const line = point.toLineProtocol();
    expect(line).toContain('datastreamId=ds-1');
    expect(line).toContain('storageLocationId=loc-1');
    expect(line).not.toContain('telemetryDatastreamId');
  });

  it('a reading built before the two names keeps its datastream on the point', () => {
    const point = influxTelemetryWriteRepository.toPoint({ sensorId: 'sensor-1', temperatureValue: -80, telemetryDatastreamId: 'ds-old', observedAt: new Date(START) });
    expect(point.toLineProtocol()).toContain('datastreamId=ds-old');
  });
});
