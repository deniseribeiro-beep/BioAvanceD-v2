import { describe, it, expect, vi, afterEach } from 'vitest';

const { createHash } = require('crypto');
const {
  readingIdentityOf, screenReading, payloadHashCheckOf, canonicalJson,
} = require('../../../src/services/telemetryReadingContract');

// RNF004 C4 (#1521): a client payloadHash that does not match the SHA-256 of
// the canonical contract fields received is a corrupted message. It is
// recorded as a rejected TelemetryIngestionEvent with a payload_hash_mismatch
// TelemetryValidationIssue and refused 422; a reading with no payloadHash, or
// a matching one, is screened as before.

afterEach(() => { vi.restoreAllMocks(); });

const RECEIVED = new Date('2026-10-10T12:00:00.000Z');
const SYNCED = new Date(RECEIVED.getTime() - 60 * 1000).toISOString();

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

const READING = { sensorId: 's1', temperature: 4, timestamp: SYNCED, sourceEventId: 'e-1' };
const READING_HASH = createHash('sha256').update(canonicalJson(READING)).digest('hex');

describe('payloadHashCheckOf', () => {
  const identity = readingIdentityOf(READING, RECEIVED, { ingestionService: 'iot-api' });

  it('the reading hash is the SHA-256 of its canonical contract fields', () => {
    expect(identity.payloadHash).toBe(READING_HASH);
  });

  it.each([[undefined], [null]])('a payloadHash of %j is absent', (value) => {
    expect(payloadHashCheckOf(value, identity)).toBe('absent');
  });

  it('the reading hash, as sent or upper-cased and padded, matches', () => {
    expect(payloadHashCheckOf(READING_HASH, identity)).toBe('match');
    expect(payloadHashCheckOf(` ${READING_HASH.toUpperCase()} `, identity)).toBe('match');
  });

  it.each([['0'.repeat(64)], [''], [42], [{ hash: 'x' }], [READING_HASH.slice(1)]])('any other value (%j) mismatches', (value) => {
    expect(payloadHashCheckOf(value, identity)).toBe('mismatch');
  });
});

describe('screenReading with a payloadHash check', () => {
  it('refuses a mismatch 422 and records a rejected event with one payload_hash_mismatch issue', async () => {
    const { db, collectionOf } = fakeDb();
    const identity = readingIdentityOf(READING, RECEIVED, { ingestionService: 'iot-api' });

    const error = await screenReading(db, identity, READING, { payloadHashCheck: 'mismatch' }).catch((caught) => caught);

    expect(error).toMatchObject({ statusCode: 422, auditReason: 'payload_hash_mismatch' });
    expect(error.message).toMatch(/corrompida/);
    const event = collectionOf('telemetryIngestionEvents').insertOne.mock.calls[0][0];
    expect(event).toMatchObject({ validationStatus: 'rejected', telemetryReadingId: null, payloadHash: READING_HASH });
    const issues = collectionOf('telemetryValidationIssues').insertMany.mock.calls[0][0];
    expect(issues).toEqual([expect.objectContaining({
      issueCode: 'payload_hash_mismatch', severity: 'error', fieldPath: 'payloadHash', disposition: 'rejected', ingestionEventId: event.telemetryIngestionEventId,
    })]);
  });

  it.each([['absent'], ['match']])('control: a %s check adds no issue and writes nothing', async (payloadHashCheck) => {
    const { db, collectionOf } = fakeDb();
    const identity = readingIdentityOf(READING, RECEIVED, { ingestionService: 'iot-api' });

    await expect(screenReading(db, identity, READING, { payloadHashCheck })).resolves.toEqual([]);
    expect(collectionOf('telemetryIngestionEvents').insertOne).not.toHaveBeenCalled();
  });

  it('fails closed: a check value other than absent or match is refused', async () => {
    const { db } = fakeDb();
    const identity = readingIdentityOf(READING, RECEIVED, { ingestionService: 'iot-api' });

    await expect(screenReading(db, identity, READING, { payloadHashCheck: 'unknown' })).rejects.toMatchObject({ statusCode: 422, auditReason: 'payload_hash_mismatch' });
  });
});
