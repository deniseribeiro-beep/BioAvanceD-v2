import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const logger = require('../../../src/utils/logger');
const {
  TEMPERATURE_PROPERTY,
  currentDatastreamsBySensor,
  datastreamEquipmentIdsBySensor,
  policiesByProfileId,
  freezerContainerIdOf,
  resolveTemperatureBinding,
  assertStoredSamplingPolicy,
} = require('../../../src/services/sensorDatastream.service');

// #1392: the fakes apply no query, so each case proves the JS re-filter.
function fakeDb(docs = {}, { throwOn = [] } = {}) {
  const calls = [];
  return {
    calls,
    collection: vi.fn((name) => ({
      find: vi.fn((query) => {
        calls.push({ name, query });
        if (throwOn.includes(name)) throw new Error(`${name} down`);
        return { toArray: async () => docs[name] || [] };
      }),
      findOne: vi.fn(async (query) => {
        calls.push({ name, query });
        if (throwOn.includes(name)) throw new Error(`${name} down`);
        return (docs[name] || []).find((doc) => Object.entries(query).every(([key, value]) => doc[key] === value)) || null;
      }),
    })),
  };
}

// An ObjectId-like value: a distinct object whose String() is its hex.
function objectIdLike(hex) {
  return { toString: () => hex };
}

const NOW = new Date('2026-10-21T12:00:00Z');

function stream(overrides = {}) {
  return {
    telemetryDatastreamId: 'ds-1',
    sensorId: 'sensor-A',
    equipmentId: 'eq-1',
    storageLocationId: 'loc-1',
    observedProperty: TEMPERATURE_PROPERTY,
    thresholdProfileId: 'policy-1',
    validityPeriod: { start: new Date('2026-10-21T11:00:00Z'), end: null },
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('currentDatastreamsBySensor (#1392)', () => {
  it('picks the temperature datastream valid now', async () => {
    const db = fakeDb({ telemetryDatastreams: [stream()] });

    const result = await currentDatastreamsBySensor(db, ['sensor-A'], NOW);

    expect([...result.keys()]).toEqual(['sensor-A']);
    expect(result.get('sensor-A').telemetryDatastreamId).toBe('ds-1');
    expect(db.calls[0]).toEqual({
      name: 'telemetryDatastreams',
      query: { observedProperty: 'temperature', 'validityPeriod.start': { $lte: NOW }, sensorId: { $in: ['sensor-A'] } },
    });
  });

  it('does not pick an ended datastream, a future one, another property or another sensor', async () => {
    const db = fakeDb({
      telemetryDatastreams: [
        stream({ telemetryDatastreamId: 'ended', validityPeriod: { start: new Date('2026-10-20T00:00:00Z'), end: new Date('2026-10-21T11:00:00Z') } }),
        stream({ telemetryDatastreamId: 'future', validityPeriod: { start: new Date('2026-10-21T13:00:00Z'), end: null } }),
        stream({ telemetryDatastreamId: 'humidity', observedProperty: 'humidity' }),
        stream({ telemetryDatastreamId: 'other', sensorId: 'sensor-B' }),
      ],
    });

    const result = await currentDatastreamsBySensor(db, ['sensor-A'], NOW);

    expect(result.size).toBe(0);
  });

  it('keeps the first of two valid streams for one sensor, as resolveReadingBinding does', async () => {
    const db = fakeDb({
      telemetryDatastreams: [
        stream({ telemetryDatastreamId: 'ds-first', validityPeriod: { start: new Date('2026-10-21T10:00:00Z'), end: null } }),
        stream({ telemetryDatastreamId: 'ds-second', validityPeriod: { start: new Date('2026-10-21T11:00:00Z'), end: null } }),
      ],
    });

    const result = await currentDatastreamsBySensor(db, ['sensor-A'], NOW);

    expect(result.get('sensor-A').telemetryDatastreamId).toBe('ds-first');
  });

  it('reads every sensor when sensorIds is null', async () => {
    const db = fakeDb({ telemetryDatastreams: [stream(), stream({ telemetryDatastreamId: 'ds-2', sensorId: 'sensor-B' })] });

    const result = await currentDatastreamsBySensor(db, null, NOW);

    expect([...result.keys()].sort()).toEqual(['sensor-A', 'sensor-B']);
    expect(db.calls[0].query).not.toHaveProperty('sensorId');
  });

  it('gives an empty Map when the lookup throws', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const db = fakeDb({}, { throwOn: ['telemetryDatastreams'] });

    const result = await currentDatastreamsBySensor(db, ['sensor-A'], NOW);

    expect(result.size).toBe(0);
    expect(warn).toHaveBeenCalled();
  });
});

describe('datastreamEquipmentIdsBySensor (#1392)', () => {
  it('maps a sensor to the equipmentId of its datastream valid now (#1392)', async () => {
    const db = fakeDb({ telemetryDatastreams: [stream({ equipmentId: 'equip-ds' })] });

    const result = await datastreamEquipmentIdsBySensor(db, ['sensor-A'], NOW);

    expect([...result.entries()]).toEqual([['sensor-A', 'equip-ds']]);
  });

  it('skips a datastream with a null or empty equipmentId (#1392)', async () => {
    const db = fakeDb({
      telemetryDatastreams: [
        stream({ equipmentId: null }),
        stream({ telemetryDatastreamId: 'ds-2', sensorId: 'sensor-B', equipmentId: '' }),
        stream({ telemetryDatastreamId: 'ds-3', sensorId: 'sensor-C', equipmentId: undefined }),
      ],
    });

    const result = await datastreamEquipmentIdsBySensor(db, ['sensor-A', 'sensor-B', 'sensor-C'], NOW);

    expect(result.size).toBe(0);
  });

  it('skips an ended datastream (#1392)', async () => {
    const db = fakeDb({
      telemetryDatastreams: [
        stream({ validityPeriod: { start: new Date('2026-10-20T00:00:00Z'), end: new Date('2026-10-21T11:00:00Z') } }),
      ],
    });

    expect((await datastreamEquipmentIdsBySensor(db, ['sensor-A'], NOW)).size).toBe(0);
  });

  it('gives an empty Map when the lookup throws (#1392)', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const db = fakeDb({}, { throwOn: ['telemetryDatastreams'] });

    expect((await datastreamEquipmentIdsBySensor(db, ['sensor-A'], NOW)).size).toBe(0);
  });
});

describe('policiesByProfileId (#1392)', () => {
  it('matches a string _id and an ObjectId-like _id by String()', async () => {
    const hex = '64b000000000000000000001';
    const db = fakeDb({
      temperaturePolicies: [
        { _id: 'policy-1', minTemp: 2, maxTemp: 8 },
        { _id: objectIdLike(hex), minTemp: -90, maxTemp: -60 },
        { _id: 'unrelated', minTemp: 0, maxTemp: 1 },
      ],
    });

    const result = await policiesByProfileId(db, ['policy-1', hex, 'policy-1', null]);

    expect([...result.keys()].sort()).toEqual([hex, 'policy-1'].sort());
    expect(result.get(hex).minTemp).toBe(-90);
    expect(db.calls[0].query).toEqual({ $expr: { $in: [{ $toString: '$_id' }, ['policy-1', hex]] } });
  });

  it('makes no query with no ids', async () => {
    const db = fakeDb();

    const result = await policiesByProfileId(db, [null, undefined, '']);

    expect(result.size).toBe(0);
    expect(db.collection).not.toHaveBeenCalled();
  });

  it('gives an empty Map when the lookup throws', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const db = fakeDb({}, { throwOn: ['temperaturePolicies'] });

    expect((await policiesByProfileId(db, ['policy-1'])).size).toBe(0);
  });
});

describe('freezerContainerIdOf (#1392)', () => {
  it('gives the stored _id of the FREEZER a string-_id mirrored location names', async () => {
    const freezer = { _id: 'freezer-1', containerType: 'FREEZER' };
    const db = fakeDb({
      storageLocations: [{ storageLocationId: 'loc-1', code: 'legacy-storage-container:freezer-1' }],
      storageContainers: [{ _id: 'freezer-1', containerType: 'SHELF' }, freezer, { _id: 'freezer-2', containerType: 'FREEZER' }],
    });

    expect(await freezerContainerIdOf(db, 'loc-1')).toBe(freezer._id);
  });

  it('gives the stored ObjectId-like _id itself, not a rebuilt one', async () => {
    const hex = '64b000000000000000000002';
    const storedId = objectIdLike(hex);
    const db = fakeDb({
      storageLocations: [{ storageLocationId: 'loc-1', code: `legacy-storage-container:${hex}` }],
      storageContainers: [{ _id: storedId, containerType: 'FREEZER' }],
    });

    expect(await freezerContainerIdOf(db, 'loc-1')).toBe(storedId);
  });

  it('gives null when the code names no stored freezer', async () => {
    const db = fakeDb({
      storageLocations: [{ storageLocationId: 'loc-1', code: 'legacy-storage-container:gone' }],
      storageContainers: [{ _id: 'freezer-1', containerType: 'FREEZER' }],
    });

    expect(await freezerContainerIdOf(db, 'loc-1')).toBeNull();
  });

  it('gives null for any other location code', async () => {
    const db = fakeDb({
      storageLocations: [{ storageLocationId: 'loc-1', code: 'ROOM-101' }],
      storageContainers: [{ _id: 'ROOM-101', containerType: 'FREEZER' }],
    });

    expect(await freezerContainerIdOf(db, 'loc-1')).toBeNull();
    expect(db.calls.some((call) => call.name === 'storageContainers')).toBe(false);
  });
});

describe('resolveTemperatureBinding (#1392)', () => {
  const FREEZER = objectIdLike('64e000000000000000000001');
  function topology({ containerID = 4201 } = {}) {
    return {
      storageContainers: [{ _id: FREEZER, containerType: 'FREEZER', containerID }],
      storageLocations: [{ storageLocationId: 'loc-1', code: 'legacy-storage-container:64e000000000000000000001' }],
    };
  }

  it('resolves the freezer Equipment, its mirrored location and the policy', async () => {
    const db = fakeDb(topology());

    const binding = await resolveTemperatureBinding(db, { storageContainer: '64e000000000000000000001', equipment: null, temperaturePolicy: 'policy-1' });

    expect(binding).toEqual({ ok: true, equipmentId: '4201', storageLocationId: 'loc-1', thresholdProfileId: 'policy-1' });
  });

  it('falls back to `equipment` when the freezer has no containerID', async () => {
    const db = fakeDb(topology({ containerID: '' }));

    const binding = await resolveTemperatureBinding(db, { storageContainer: FREEZER, equipment: 'eq-9', temperaturePolicy: 'policy-1' });

    expect(binding).toMatchObject({ ok: true, equipmentId: 'eq-9' });
  });

  it('is freezer_not_located for an unmirrored freezer or none, before any other check', async () => {
    const unmirrored = fakeDb({ ...topology(), storageLocations: [] });

    expect(await resolveTemperatureBinding(unmirrored, { storageContainer: FREEZER, temperaturePolicy: null }))
      .toEqual({ ok: false, reason: 'freezer_not_located' });
    expect(await resolveTemperatureBinding(fakeDb(topology()), { storageContainer: null, temperaturePolicy: 'policy-1' }))
      .toEqual({ ok: false, reason: 'freezer_not_located' });
  });

  it('is no_equipment when neither the freezer nor `equipment` names one, before the policy', async () => {
    const db = fakeDb(topology({ containerID: null }));

    expect(await resolveTemperatureBinding(db, { storageContainer: FREEZER, equipment: null, temperaturePolicy: null }))
      .toEqual({ ok: false, reason: 'no_equipment' });
  });

  it('is no_policy when the freezer resolves and no policy is bound', async () => {
    const db = fakeDb(topology());

    expect(await resolveTemperatureBinding(db, { storageContainer: FREEZER, temperaturePolicy: null }))
      .toEqual({ ok: false, reason: 'no_policy' });
  });

  it('does not swallow a DB error, unlike the readers', async () => {
    const db = fakeDb(topology(), { throwOn: ['storageContainers'] });

    await expect(resolveTemperatureBinding(db, { storageContainer: FREEZER, temperaturePolicy: 'policy-1' }))
      .rejects.toThrow('storageContainers down');
  });
});

describe('assertStoredSamplingPolicy (#1392)', () => {
  it('gives the id of a stored ConfigurationProfile, null when absent, and throws for an unstored one', async () => {
    const db = fakeDb({ configurationProfiles: [{ profileId: 'sampling-1' }] });

    expect(await assertStoredSamplingPolicy(db, 'sampling-1')).toBe('sampling-1');
    expect(await assertStoredSamplingPolicy(db, null)).toBeNull();
    await expect(assertStoredSamplingPolicy(db, 'nope')).rejects.toThrow('ConfigurationProfile nope não encontrado');
  });
});
