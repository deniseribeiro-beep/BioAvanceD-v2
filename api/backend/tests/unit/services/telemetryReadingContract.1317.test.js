import { describe, it, expect, vi, afterEach } from 'vitest';

const { readingIdentityOf, canonicalJson, CLOCK_SKEW_TOLERANCE_MS, clientContractFieldsOf, clientReplayFilterOf } = require('../../../src/services/telemetryReadingContract');
const influxTelemetryWriteRepository = require('../../../src/infrastructure/persistence/influxdb/InfluxTelemetryWriteRepository');
const temperatureService = require('../../../src/services/temperature.service');
const logger = require('../../../src/utils/logger');

// #1317 (RF009 AC2/AC3/AC7): a reading carries its TelemetryReading identity
// and time from the ingestion boundary, and a client idempotencyKey replays
// the stored reading instead of writing a second one.

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

function temperaturesCollection(stored = null) {
  return {
    collectionName: 'temperatures',
    createIndex: vi.fn().mockResolvedValue('ok'),
    findOne: vi.fn().mockResolvedValue(stored),
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'new-id' }),
  };
}

describe('createTemperatureReading stores the identity and replays a client key', () => {
  it('stores the v4 identity fields with the reading', async () => {
    vi.spyOn(influxTelemetryWriteRepository, 'writeTemperatureReadingNow').mockResolvedValue(new Date('2026-10-10T12:00:01.000Z'));
    const temperatures = temperaturesCollection();
    const db = { collection: vi.fn(() => temperatures) };
    const result = await temperatureService.createTemperatureReading(db, { sensorId: 's1', temperatureValue: 4 });
    const written = temperatures.insertOne.mock.calls[0][0];
    expect(written).toMatchObject({ clockStatus: 'unknown', idempotencyKeySource: 'derived' });
    for (const field of ['telemetryReadingId', 'observedAt', 'receivedAt', 'persistedAt', 'payloadHash', 'idempotencyKey']) {
      expect(written[field], field).toBeTruthy();
    }
    expect(result.replayed).toBeUndefined();
    expect(temperatures.findOne).not.toHaveBeenCalled();
  });

  it('a stored client key for the sensor replays the stored reading and writes nothing', async () => {
    const write = vi.spyOn(influxTelemetryWriteRepository, 'writeTemperatureReadingNow').mockResolvedValue(new Date('2026-10-10T12:00:01.000Z'));
    const temperatures = temperaturesCollection({ _id: 'old-id', sensorId: 's1', idempotencyKey: 'k-1', temperatureValue: 4 });
    const db = { collection: vi.fn(() => temperatures) };
    const result = await temperatureService.createTemperatureReading(db, { sensorId: 's1', temperatureValue: 4, idempotencyKey: 'k-1' });
    expect(result).toMatchObject({ _id: 'old-id', replayed: true });
    expect(temperatures.findOne).toHaveBeenCalledWith({ sensorId: 's1', idempotencyKey: 'k-1', idempotencyKeySource: 'client' });
    expect(temperatures.insertOne).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('a reading stored before the two names replays its datastream as datastreamId', async () => {
    vi.spyOn(influxTelemetryWriteRepository, 'writeTemperatureReadingNow').mockResolvedValue(new Date('2026-10-10T12:00:01.000Z'));
    const temperatures = temperaturesCollection({ _id: 'old-id', sensorId: 's1', idempotencyKey: 'k-old', telemetryDatastreamId: 'ds-old' });
    const db = { collection: vi.fn(() => temperatures) };
    const result = await temperatureService.createTemperatureReading(db, { sensorId: 's1', temperatureValue: 4, idempotencyKey: 'k-old' });
    expect(result).toMatchObject({ _id: 'old-id', datastreamId: 'ds-old', replayed: true });
    expect(result).not.toHaveProperty('storageLocationId');
  });

  it('control: a new client key is stored once', async () => {
    vi.spyOn(influxTelemetryWriteRepository, 'writeTemperatureReadingNow').mockResolvedValue(new Date('2026-10-10T12:00:01.000Z'));
    const temperatures = temperaturesCollection(null);
    const db = { collection: vi.fn(() => temperatures) };
    const result = await temperatureService.createTemperatureReading(db, { sensorId: 's1', temperatureValue: 4, idempotencyKey: 'k-2' });
    expect(result.replayed).toBeUndefined();
    expect(temperatures.insertOne).toHaveBeenCalledTimes(1);
    expect(temperatures.insertOne.mock.calls[0][0]).toMatchObject({ idempotencyKey: 'k-2', idempotencyKeySource: 'client' });
  });

  it('a concurrent send that loses the unique index race replays the winner', async () => {
    vi.spyOn(influxTelemetryWriteRepository, 'writeTemperatureReadingNow').mockResolvedValue(new Date('2026-10-10T12:00:01.000Z'));
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const temperatures = temperaturesCollection(null);
    temperatures.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ _id: 'winner', idempotencyKey: 'k-3' });
    temperatures.insertOne.mockRejectedValue(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));
    const db = { collection: vi.fn(() => temperatures) };
    const result = await temperatureService.createTemperatureReading(db, { sensorId: 's1', temperatureValue: 4, idempotencyKey: 'k-3' });
    expect(result).toMatchObject({ _id: 'winner', replayed: true });
  });

  it('control: a duplicate-key error without a client key still fails', async () => {
    vi.spyOn(influxTelemetryWriteRepository, 'writeTemperatureReadingNow').mockResolvedValue(new Date('2026-10-10T12:00:01.000Z'));
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const temperatures = temperaturesCollection(null);
    temperatures.insertOne.mockRejectedValue(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));
    const db = { collection: vi.fn(() => temperatures) };
    await expect(temperatureService.createTemperatureReading(db, { sensorId: 's1', temperatureValue: 4 })).rejects.toThrow(/E11000/);
  });

  it('builds the per-sensor unique client-key index before the replay lookup', async () => {
    vi.spyOn(influxTelemetryWriteRepository, 'writeTemperatureReadingNow').mockResolvedValue(new Date('2026-10-10T12:00:01.000Z'));
    const temperatures = { ...temperaturesCollection(null), collectionName: 'temperatures_index_case' };
    const db = { collection: vi.fn(() => temperatures) };
    await temperatureService.createTemperatureReading(db, { sensorId: 's1', temperatureValue: 4, idempotencyKey: 'k-4' });
    expect(temperatures.createIndex).toHaveBeenCalledWith(
      { sensorId: 1, idempotencyKey: 1 },
      expect.objectContaining({ unique: true, partialFilterExpression: { idempotencyKeySource: 'client' } })
    );
  });
});

// RF009 AC7 (#1317): MQTT and the queue pass the client's contract fields on,
// so its idempotencyKey replays on every path.
describe('clientContractFieldsOf and clientReplayFilterOf', () => {
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

  it('a client key gives the per-sensor replay filter, a derived key none', () => {
    const payload = { sensorId: 's1', temperatureValue: 4 };
    expect(clientReplayFilterOf(readingIdentityOf({ ...payload, idempotencyKey: 'k-1' }, RECEIVED), { ...payload, idempotencyKey: 'k-1' }))
      .toEqual({ sensorId: 's1', idempotencyKey: 'k-1', idempotencyKeySource: 'client' });
    expect(clientReplayFilterOf(readingIdentityOf(payload, RECEIVED), payload)).toBeNull();
  });
});
