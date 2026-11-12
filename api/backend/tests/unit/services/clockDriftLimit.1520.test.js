import { describe, it, expect, vi, afterEach } from 'vitest';

const { clockDriftLimitMsOf, resolveClockDriftLimitMs } = require('../../../src/services/clockDriftLimit');
const { readingIdentityOf, screenReading } = require('../../../src/services/telemetryReadingContract');
const logger = require('../../../src/utils/logger');

// #1520 (RNF025 AC6): the clock-drift limit is the security configuration's
// telemetry.clockDriftLimitMinutes, changed through a ConfigurationRelease,
// and telemetry screening reads it.

afterEach(() => { vi.restoreAllMocks(); });

const RECEIVED = new Date('2026-10-10T12:00:00.000Z');
const minutesBefore = (minutes) => new Date(RECEIVED.getTime() - minutes * 60 * 1000).toISOString();

// Sensor s1 is bound, registered and a usable Device, as in
// telemetryValidationIssue.1317.test.js, so these cases see only the clock.
const S1_DATASTREAM = {
  telemetryDatastreamId: 'ds-s1', sensorId: 's1', observedProperty: 'temperature', validityPeriod: { start: new Date('2020-01-01T00:00:00.000Z'), end: null },
};
const S1_REGISTRATION = { deviceRegistrationId: 'reg-s1', deviceId: 's1', status: 'active' };
const S1_DEVICE = { deviceId: 's1', deviceType: 'sensor', qualificationStatus: 'qualified', retiredAt: null };

function fakeDb(securityConfig = null) {
  const collections = {};
  const collectionOf = (name) => {
    collections[name] = collections[name] || {
      collectionName: name,
      createIndex: vi.fn().mockResolvedValue('ok'),
      findOne: vi.fn().mockResolvedValue({ deviceRegistrations: S1_REGISTRATION, devices: S1_DEVICE, security_config: securityConfig }[name] || null),
      find: vi.fn(() => ({ toArray: async () => (name === 'telemetryDatastreams' ? [S1_DATASTREAM] : []) })),
      insertOne: vi.fn().mockResolvedValue({ insertedId: `${name}-id` }),
      insertMany: vi.fn().mockResolvedValue({ insertedCount: 1 }),
    };
    return collections[name];
  };
  return { db: { collection: vi.fn(collectionOf) }, collectionOf };
}

const configWithLimit = (minutes) => ({ _id: 'main', telemetry: { clockDriftLimitMinutes: minutes } });

describe('clockDriftLimit', () => {
  it('reads the limit from telemetry.clockDriftLimitMinutes', async () => {
    expect(clockDriftLimitMsOf({ telemetry: { clockDriftLimitMinutes: 1 } })).toBe(60000);
    const { db } = fakeDb(configWithLimit(1));
    await expect(resolveClockDriftLimitMs(db)).resolves.toBe(60000);
    await expect(resolveClockDriftLimitMs(async () => db)).resolves.toBe(60000);
    expect(db.collection).toHaveBeenCalledWith('security_config');
  });

  it('falls back to five minutes when the setting is absent, not a positive number, or unreadable', async () => {
    for (const config of [null, {}, { telemetry: { clockDriftLimitMinutes: 0 } }, { telemetry: { clockDriftLimitMinutes: '3' } }]) {
      await expect(resolveClockDriftLimitMs(fakeDb(config).db)).resolves.toBe(300000);
    }
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const { db, collectionOf } = fakeDb();
    collectionOf('security_config').findOne.mockRejectedValue(new Error('mongo down'));
    await expect(resolveClockDriftLimitMs(db)).resolves.toBe(300000);
    await expect(resolveClockDriftLimitMs(() => Promise.reject(new Error('no connection')))).resolves.toBe(300000);
  });
});

describe('clockDriftLimit, the catalog range', () => {
  it('falls back to five minutes for a stored value outside the catalog range of integers 1..1440', () => {
    // A value only a direct write can store, since configFindings refuses each.
    for (const minutes of [1e-12, 2.5, 1441, Number.MAX_VALUE]) {
      expect(clockDriftLimitMsOf({ telemetry: { clockDriftLimitMinutes: minutes } })).toBe(300000);
    }
    // Control: the catalog's own bounds are kept.
    expect(clockDriftLimitMsOf({ telemetry: { clockDriftLimitMinutes: 1 } })).toBe(60000);
    expect(clockDriftLimitMsOf({ telemetry: { clockDriftLimitMinutes: 1440 } })).toBe(86400000);
  });
});

describe('screenReading under the configured limit', () => {
  it('a configured limit of 1 minute turns a reading 3 minutes behind into drift with a clock_drift issue', async () => {
    const payload = { sensorId: 's1', temperatureValue: 4, timestamp: minutesBefore(3) };
    const identity = readingIdentityOf(payload, RECEIVED);
    const issues = await screenReading(fakeDb(configWithLimit(1)).db, identity, payload);
    expect(issues).toEqual([expect.objectContaining({ issueCode: 'clock_drift', disposition: 'quarantined' })]);
    expect(issues[0].details).toContain('1 minutos');
    expect(identity.clockStatus).toBe('drift');

    // Control: no configuration document, so the 5-minute default holds.
    const control = readingIdentityOf(payload, RECEIVED);
    await expect(screenReading(fakeDb().db, control, payload)).resolves.toEqual([]);
    expect(control.clockStatus).toBe('synchronized');
  });

  it('a configured limit of 10 minutes keeps a reading 7 minutes behind synchronized', async () => {
    const payload = { sensorId: 's1', temperatureValue: 4, timestamp: minutesBefore(7) };
    const identity = readingIdentityOf(payload, RECEIVED);
    await expect(screenReading(fakeDb(configWithLimit(10)).db, identity, payload)).resolves.toEqual([]);
    expect(identity.clockStatus).toBe('synchronized');
  });

  it('a reading with no device time stays unknown and reads no configuration', async () => {
    const payload = { sensorId: 's1', temperatureValue: 4 };
    const identity = readingIdentityOf(payload, RECEIVED);
    const { db } = fakeDb(configWithLimit(1));
    await expect(screenReading(db, identity, payload)).resolves.toEqual([]);
    expect(identity.clockStatus).toBe('unknown');
    expect(db.collection).not.toHaveBeenCalledWith('security_config');
  });
});
