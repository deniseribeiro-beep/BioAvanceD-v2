import { describe, it, expect, vi, afterEach } from 'vitest';

const { readingIdentityOf, canonicalJson, CLOCK_SKEW_TOLERANCE_MS, clientContractFieldsOf, clientReplayScopeOf } = require('../../../src/services/telemetryReadingContract');
const influxTelemetryWriteRepository = require('../../../src/infrastructure/persistence/influxdb/InfluxTelemetryWriteRepository');
const temperatureService = require('../../../src/services/temperature.service');
const logger = require('../../../src/utils/logger');
const { createFakeDb } = require('../ingestion/testHelpers');

// #1317 (RF009 AC2/AC3/AC7): a reading carries its TelemetryReading identity
// and time from the ingestion boundary, and a client idempotencyKey replays
// the first reading from RF029's key store (#1391) instead of writing a
// second one.

afterEach(() => { vi.restoreAllMocks(); });

const RECEIVED = new Date('2026-10-10T12:00:00.000Z');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('readingIdentityOf', () => {
  it('stamps a uuid, receipt time, and observedAt from the device timestamp', () => {
    const identity = readingIdentityOf({ sensorId: 's1', temperatureValue: 4, timestamp: '2026-10-10T11:59:00.000Z' }, RECEIVED);
    expect(identity.telemetryReadingId).toMatch(UUID);
    expect(identity.receivedAt).toBe(RECEIVED);
    expect(identity.observedAt.toISOString()).toBe('2026-10-10T11:59:00.000Z');
    expect(identity.payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps a device timestamp with an offset as its UTC instant (RNF025 C2)', () => {
    const identity = readingIdentityOf({ sensorId: 's1', temperatureValue: 4, timestamp: '2026-10-10T08:59:00.000-03:00' }, RECEIVED);
    expect(identity.observedAt.toISOString()).toBe('2026-10-10T11:59:00.000Z');
    expect(identity.receivedAt.toISOString()).toBe('2026-10-10T12:00:00.000Z');
  });

  it('without a device timestamp, observedAt is the receipt time and the clock is unknown', () => {
    const identity = readingIdentityOf({ sensorId: 's1', temperatureValue: 4 }, RECEIVED);
    expect(identity.observedAt).toBe(RECEIVED);
    expect(identity.clockStatus).toBe('unknown');
  });

  it.each([
    ['at receipt', 0, 'synchronized'],
    ['at the tolerance, behind', -CLOCK_SKEW_TOLERANCE_MS, 'synchronized'],
    ['past the tolerance, behind', -CLOCK_SKEW_TOLERANCE_MS - 1, 'drift'],
    ['past the tolerance, ahead', CLOCK_SKEW_TOLERANCE_MS + 1, 'drift'],
  ])('clockStatus %s is %s', (_label, offset, expected) => {
    const timestamp = new Date(RECEIVED.getTime() + offset).toISOString();
    expect(readingIdentityOf({ sensorId: 's1', temperatureValue: 4, timestamp }, RECEIVED).clockStatus).toBe(expected);
  });

  it('payloadHash ignores key order and the server-stamped organizationId, and changes with the value', () => {
    const a = readingIdentityOf({ sensorId: 's1', temperatureValue: 4, organizationId: 'org-a' }, RECEIVED);
    const b = readingIdentityOf({ temperatureValue: 4, sensorId: 's1', organizationId: 'org-b' }, RECEIVED);
    const c = readingIdentityOf({ sensorId: 's1', temperatureValue: 5 }, RECEIVED);
    expect(a.payloadHash).toBe(b.payloadHash);
    expect(c.payloadHash).not.toBe(a.payloadHash);
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('keeps a client idempotencyKey, and derives one otherwise', () => {
    const client = readingIdentityOf({ sensorId: 's1', temperatureValue: 4, idempotencyKey: ' k-1 ' }, RECEIVED);
    expect(client).toMatchObject({ idempotencyKey: 'k-1', idempotencyKeySource: 'client' });
    const derived = readingIdentityOf({ sensorId: 's1', temperatureValue: 4 }, RECEIVED);
    expect(derived.idempotencyKeySource).toBe('derived');
    expect(derived.idempotencyKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([['not-a-date'], [{}]])('refuses a timestamp %j that is not a date with 422', (timestamp) => {
    expect(() => readingIdentityOf({ sensorId: 's1', temperatureValue: 4, timestamp }, RECEIVED)).toThrow(expect.objectContaining({ statusCode: 422 }));
  });

  // RF009 AC2: the provenance a reading carries (V2E-0551..0560).
  it('stamps schemaVersion, the canonical release, the ingestion service and a trace', () => {
    const identity = readingIdentityOf({ sensorId: 's1', temperatureValue: 4 }, RECEIVED, { ingestionService: 'mqtt' });
    expect(identity).toMatchObject({
      schemaVersion: 'telemetry.reading.v1',
      canonicalModelReleaseId: expect.stringMatching(/^release-\d+\.\d+\.\d+$/),
      ingestionService: 'mqtt',
      deviceMessageId: null,
      sequenceNumber: null,
    });
    expect(identity.traceId).toMatch(UUID);
    expect(readingIdentityOf({ sensorId: 's1', temperatureValue: 4 }, RECEIVED).ingestionService).toBe('temperature-api');
  });

  it('sourceEventId is the client\'s, else its deviceMessageId, else the reading id', () => {
    expect(readingIdentityOf({ sensorId: 's1', temperatureValue: 4, sourceEventId: 'ev-1', deviceMessageId: 'm-1' }, RECEIVED).sourceEventId).toBe('ev-1');
    const byMessage = readingIdentityOf({ sensorId: 's1', temperatureValue: 4, deviceMessageId: 'm-1', sequenceNumber: 7, traceId: 't-1' }, RECEIVED);
    expect(byMessage).toMatchObject({ sourceEventId: 'm-1', deviceMessageId: 'm-1', sequenceNumber: 7, traceId: 't-1' });
    const bare = readingIdentityOf({ sensorId: 's1', temperatureValue: 4 }, RECEIVED);
    expect(bare.sourceEventId).toBe(bare.telemetryReadingId);
  });

  it.each([
    [{ sourceEventId: '' }], [{ deviceMessageId: 5 }], [{ traceId: ' ' }], [{ sequenceNumber: -1 }], [{ sequenceNumber: 1.5 }], [{ sequenceNumber: '3' }],
  ])('refuses provenance %j with 422', (extra) => {
    expect(() => readingIdentityOf({ sensorId: 's1', temperatureValue: 4, ...extra }, RECEIVED)).toThrow(expect.objectContaining({ statusCode: 422 }));
  });

  it.each([[''], ['   '], [42], ['x'.repeat(201)]])('refuses an idempotencyKey %j with 422', (idempotencyKey) => {
    expect(() => readingIdentityOf({ sensorId: 's1', temperatureValue: 4, idempotencyKey }, RECEIVED)).toThrow(expect.objectContaining({ statusCode: 422 }));
  });
});

// Every collection, the key store `ingestionIdempotencyKeys` among them, is
// the shared query-matching fake. InfluxDB is the reading's only store
// (RF009 AC1, #1391), so no `temperatures` copy is expected.
function readingDb(keyRows = []) {
  const fake = createFakeDb({ ingestionIdempotencyKeys: keyRows });
  const db = { collection: vi.fn((name) => fake.collection(name)) };
  return { db, keys: fake.collections.ingestionIdempotencyKeys };
}

const PERSISTED = new Date('2026-10-10T12:00:01.000Z');
const RESULT_REF_KEYS = ['clockStatus', 'observedAt', 'persistedAt', 'receivedAt', 'telemetryReadingId'];

function completedKey(idempotencyKey, telemetryReadingId, sensorId = 's1') {
  return {
    idempotencyKey,
    scope: `TelemetryReading:${sensorId}`,
    status: 'completed',
    resultRef: { telemetryReadingId, observedAt: RECEIVED, receivedAt: RECEIVED, persistedAt: PERSISTED, clockStatus: 'unknown' },
  };
}

describe('createTemperatureReading stores the identity and replays a client key', () => {
  it('stores the v4 identity fields with the reading in InfluxDB and no Mongo copy; a derived key never touches the key store', async () => {
    const write = vi.spyOn(influxTelemetryWriteRepository, 'writeTemperatureReadingNow').mockResolvedValue(PERSISTED);
    const { db, keys } = readingDb();
    const result = await temperatureService.createTemperatureReading(db, { sensorId: 's1', temperatureValue: 4 });
    const written = write.mock.calls[0][0];
    expect(written).toMatchObject({ clockStatus: 'unknown', idempotencyKeySource: 'derived' });
    for (const field of ['telemetryReadingId', 'observedAt', 'receivedAt', 'persistedAt', 'payloadHash', 'idempotencyKey']) {
      expect(written[field], field).toBeTruthy();
    }
    expect(result.replayed).toBeUndefined();
    expect(db.collection).not.toHaveBeenCalledWith('temperatures');
    expect(db.collection).not.toHaveBeenCalledWith('ingestionIdempotencyKeys');
    expect(keys.docs).toHaveLength(0);
  });

  it('a completed client key for the sensor replays its resultRef and writes nothing', async () => {
    const write = vi.spyOn(influxTelemetryWriteRepository, 'writeTemperatureReadingNow').mockResolvedValue(PERSISTED);
    const { db } = readingDb([completedKey('k-1', 'r-first')]);
    const result = await temperatureService.createTemperatureReading(db, { sensorId: 's1', temperatureValue: 4, idempotencyKey: 'k-1' });
    expect(result).toEqual({
      ...completedKey('k-1', 'r-first').resultRef,
      sensorId: 's1',
      idempotencyKey: 'k-1',
      idempotencyKeySource: 'client',
      replayed: true,
    });
    expect(result).not.toHaveProperty('temperatureValue');
    expect(db.collection).not.toHaveBeenCalledWith('temperatures');
    expect(write).not.toHaveBeenCalled();
  });

  it('control: a new client key records one key row with the five resultRef keys, and stores the reading once', async () => {
    const write = vi.spyOn(influxTelemetryWriteRepository, 'writeTemperatureReadingNow').mockResolvedValue(PERSISTED);
    const { db, keys } = readingDb();
    const result = await temperatureService.createTemperatureReading(db, { sensorId: 's1', temperatureValue: 4, idempotencyKey: 'k-2' });
    expect(result.replayed).toBeUndefined();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0]).toMatchObject({ idempotencyKey: 'k-2', idempotencyKeySource: 'client' });
    expect(keys.docs).toHaveLength(1);
    expect(keys.docs[0]).toMatchObject({ idempotencyKey: 'k-2', scope: 'TelemetryReading:s1', status: 'completed' });
    expect(Object.keys(keys.docs[0].resultRef).sort()).toEqual(RESULT_REF_KEYS);
    expect(keys.docs[0].resultRef).toMatchObject({ telemetryReadingId: result.telemetryReadingId, persistedAt: PERSISTED });
    expect(keys.docs[0].resultRef).not.toHaveProperty('temperatureValue');
  });

  it('a concurrent send that loses the key-store race answers the winner', async () => {
    const write = vi.spyOn(influxTelemetryWriteRepository, 'writeTemperatureReadingNow').mockResolvedValue(PERSISTED);
    const { db, keys } = readingDb();
    // The winner records the same key between this send's lookup and record.
    const upsert = keys.updateOne;
    keys.updateOne = async (filter, update, options) => {
      keys.docs.push(completedKey('k-3', 'r-winner'));
      return upsert(filter, update, options);
    };
    const result = await temperatureService.createTemperatureReading(db, { sensorId: 's1', temperatureValue: 4, idempotencyKey: 'k-3' });
    expect(result).toMatchObject({ telemetryReadingId: 'r-winner', sensorId: 's1', replayed: true });
    expect(db.collection).not.toHaveBeenCalledWith('temperatures');
    expect(write).toHaveBeenCalledTimes(1);
    expect(keys.docs).toHaveLength(1);
  });

  it('a failing key-store lookup is logged without the key, and the reading is stored', async () => {
    const write = vi.spyOn(influxTelemetryWriteRepository, 'writeTemperatureReadingNow').mockResolvedValue(PERSISTED);
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const { db, keys } = readingDb();
    keys.findOne = vi.fn().mockRejectedValue(new Error('key store down'));
    const result = await temperatureService.createTemperatureReading(db, { sensorId: 's1', temperatureValue: 4, idempotencyKey: 'k-secret-5' });
    expect(result.replayed).toBeUndefined();
    expect(write).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
    expect(error.mock.calls.map((args) => args.join(' ')).join(' ')).not.toContain('k-secret-5');
  });
});

// RF009 AC7 (#1317): MQTT and the queue pass the client's contract fields on,
// so its idempotencyKey replays on every path.
describe('clientContractFieldsOf and clientReplayScopeOf', () => {
  it('keeps the five contract fields a payload sends', () => {
    const sent = { idempotencyKey: 'k-1', sourceEventId: 'e-1', deviceMessageId: 'm-1', sequenceNumber: 0, traceId: 't-1' };
    expect(clientContractFieldsOf({ sensorId: 's1', temperatureValue: 4, ...sent })).toEqual(sent);
  });

  it('drops an absent or null field, and a payload with none gives {}', () => {
    expect(clientContractFieldsOf({ sensorId: 's1', idempotencyKey: null, deviceMessageId: 'm-1', traceId: undefined })).toEqual({ deviceMessageId: 'm-1' });
    expect(clientContractFieldsOf({ sensorId: 's1', temperatureValue: 4 })).toEqual({});
  });

  // A value readingIdentityOf would refuse is dropped, not forwarded: MQTT
  // and the queue have no caller to answer a 422, so the reading is stored
  // without it, as before the fields were passed on.
  it('drops a value readingIdentityOf refuses, warning with the field and sensor but never the value', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const fields = clientContractFieldsOf({
      sensorId: 's1',
      idempotencyKey: '  ',
      sourceEventId: 'x'.repeat(201),
      deviceMessageId: 12345,
      sequenceNumber: '7',
      traceId: 't-1',
    });
    expect(fields).toEqual({ traceId: 't-1' });
    expect(warn).toHaveBeenCalledTimes(4);
    const lines = warn.mock.calls.map((args) => args.join(' '));
    for (const field of ['idempotencyKey', 'sourceEventId', 'deviceMessageId', 'sequenceNumber']) {
      expect(lines.some((line) => line.includes(field) && line.includes('s1')), field).toBe(true);
    }
    expect(lines.join(' ')).not.toContain('12345');
    expect(() => readingIdentityOf({ sensorId: 's1', temperatureValue: 4, ...fields }, RECEIVED)).not.toThrow();
  });

  // #1391: POST /api/iot/telemetry's scope for the same sensor, trimmed and
  // as text, so a numeric and a text sensorId share one key.
  it.each([[101], ['101'], [' 101 ']])('a client key for sensorId %j has the scope TelemetryReading:101', (sensorId) => {
    const payload = { sensorId, temperatureValue: 4, idempotencyKey: 'k-1' };
    expect(clientReplayScopeOf(readingIdentityOf(payload, RECEIVED), payload)).toBe('TelemetryReading:101');
  });

  // #1391: the sensor the reading is stored under (Temperature's
  // `sensorId || sensorID`), so a blank sensorId falls back to sensorID.
  it('a client key with a blank sensorId and a sensorID has the sensorID scope', () => {
    const payload = { sensorId: '', sensorID: 'S1', temperatureValue: 4, idempotencyKey: 'k-1' };
    expect(clientReplayScopeOf(readingIdentityOf(payload, RECEIVED), payload)).toBe('TelemetryReading:S1');
  });

  it('a derived key, or a blank sensorId, has no scope', () => {
    const payload = { sensorId: 's1', temperatureValue: 4 };
    expect(clientReplayScopeOf(readingIdentityOf(payload, RECEIVED), payload)).toBeNull();
    const blank = { sensorID: '  ', temperatureValue: 4, idempotencyKey: 'k-1' };
    expect(clientReplayScopeOf(readingIdentityOf(blank, RECEIVED), blank)).toBeNull();
  });
});
