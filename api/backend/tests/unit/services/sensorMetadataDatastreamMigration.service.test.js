import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ObjectId } = require('mongodb');
const { migrateSensorMetadataToDatastreams } = require('../../../src/services/sensorMetadataDatastreamMigration.service');

// #1392: a query-matching fake, as in facilityRoomLocationMigration.service.test.js.
// Equality (ObjectIds by hex), `null` as missing-or-null, and the
// `$expr: { $eq: [{ $toString: '$_id' }, id] }` the container lookup sends.
// Every write is recorded.
function same(a, b) {
  if (a === b) return true;
  if (a instanceof Date || b instanceof Date) return a != null && b != null && new Date(a).getTime() === new Date(b).getTime();
  if (a && b && typeof a === 'object' && typeof b === 'object') return String(a) === String(b);
  return false;
}

function matches(doc, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$expr') return String(doc._id) === value.$eq[1];
    if (value === null) return doc[key] === null || doc[key] === undefined;
    return same(doc[key], value);
  });
}

function createFakeCollection(name, writes) {
  const docs = [];
  return {
    docs,
    async createIndex() {},
    async insertOne(doc, options) {
      writes.push({ collection: name, op: 'insertOne', options });
      docs.push({ ...doc });
      return { insertedId: docs.length };
    },
    async updateOne(filter, update, options) {
      writes.push({ collection: name, op: 'updateOne', options });
      return { matchedCount: 0 };
    },
    async findOne(filter) { return docs.find((doc) => matches(doc, filter)) || null; },
    find(filter = {}) { return { toArray: async () => docs.filter((doc) => matches(doc, filter)) }; },
  };
}

function createFakeDb(seed = {}) {
  const collections = {};
  const writes = [];
  const db = {
    collections,
    writes,
    collection(name) {
      collections[name] = collections[name] || createFakeCollection(name, writes);
      return collections[name];
    },
  };
  for (const [name, docs] of Object.entries(seed)) db.collection(name).docs.push(...docs);
  return db;
}

const NOW = new Date('2026-10-21T12:00:00.000Z');
const FREEZER_ID = new ObjectId('64e000000000000000000001');
const POLICY_ID = new ObjectId('64f000000000000000000001');
const EQUIPMENT_ID = new ObjectId('650000000000000000000001');

function sensor(overrides = {}) {
  return { sensorId: 'S-1', macAddress: 'AA:BB', equipment: null, device: null, storageContainer: FREEZER_ID, temperaturePolicy: POLICY_ID, ...overrides };
}

// One registered sensor on a mirrored freezer whose Equipment is 4201.
function topology({ sensorMetadata = [sensor()], storageContainers, storageLocations } = {}) {
  return {
    configurationProfiles: [{ profileId: 'sampling-1' }],
    sensorMetadata,
    storageContainers: storageContainers || [{ _id: FREEZER_ID, containerType: 'FREEZER', containerID: 4201, name: 'Freezer 1' }],
    storageLocations: storageLocations || [{ storageLocationId: 'loc-1', code: `legacy-storage-container:${FREEZER_ID}` }],
  };
}

const streamsOf = (db) => db.collection('telemetryDatastreams').docs;
const writesOf = (db) => db.writes.filter((write) => write.op === 'insertOne' || write.op === 'updateOne');

describe('migrateSensorMetadataToDatastreams (#1392)', () => {
  it('a dry run counts the row in wouldCreate and writes nothing', async () => {
    const db = createFakeDb(topology());

    const summary = await migrateSensorMetadataToDatastreams(db, { dryRun: true, samplingPolicyId: 'sampling-1', now: NOW });

    expect(summary).toEqual({
      mode: 'dry-run', samplingPolicyId: 'sampling-1', scanned: 1, created: 0, wouldCreate: 1, alreadyBound: 0, unresolved: [],
    });
    expect(writesOf(db)).toEqual([]);
  });

  it('a dry run without a sampling policy still counts, and notes samplingPolicyId null', async () => {
    const db = createFakeDb(topology());

    const summary = await migrateSensorMetadataToDatastreams(db, { dryRun: true, now: NOW });

    expect(summary).toMatchObject({ mode: 'dry-run', samplingPolicyId: null, wouldCreate: 1 });
    expect(writesOf(db)).toEqual([]);
  });

  it('an applied run creates one temperature datastream with the resolved binding, valid from the run', async () => {
    const db = createFakeDb(topology());

    const summary = await migrateSensorMetadataToDatastreams(db, { samplingPolicyId: 'sampling-1', now: NOW });

    expect(summary).toMatchObject({ mode: 'apply', scanned: 1, created: 1, wouldCreate: 0, alreadyBound: 0, unresolved: [] });
    expect(streamsOf(db)).toHaveLength(1);
    expect(streamsOf(db)[0]).toMatchObject({
      sensorId: 'S-1',
      equipmentId: '4201',
      storageLocationId: 'loc-1',
      observedProperty: 'temperature',
      unit: 'Cel',
      samplingPolicyId: 'sampling-1',
      thresholdProfileId: String(POLICY_ID),
      status: 'active',
    });
    expect(streamsOf(db)[0].validityPeriod.start.getTime()).toBe(NOW.getTime());
    expect(streamsOf(db)[0].validityPeriod.end).toBeNull();
    expect(writesOf(db).map((write) => write.collection)).toEqual(['telemetryDatastreams']);
  });

  it('matches a string storageContainer id, and takes the row equipment when the freezer has no containerID', async () => {
    const db = createFakeDb(topology({
      sensorMetadata: [sensor({ storageContainer: 'F-string', equipment: EQUIPMENT_ID })],
      storageContainers: [{ _id: 'F-string', containerType: 'FREEZER', name: 'Freezer 2' }],
      storageLocations: [{ storageLocationId: 'loc-2', code: 'legacy-storage-container:F-string' }],
    }));

    const summary = await migrateSensorMetadataToDatastreams(db, { samplingPolicyId: 'sampling-1', now: NOW });

    expect(summary.created).toBe(1);
    expect(streamsOf(db)[0]).toMatchObject({ equipmentId: String(EQUIPMENT_ID), storageLocationId: 'loc-2' });
  });

  it('a second run counts the sensor in alreadyBound and creates nothing, applied or dry', async () => {
    const db = createFakeDb(topology());
    await migrateSensorMetadataToDatastreams(db, { samplingPolicyId: 'sampling-1', now: NOW });
    const later = new Date('2026-10-22T12:00:00.000Z');

    const again = await migrateSensorMetadataToDatastreams(db, { samplingPolicyId: 'sampling-1', now: later });
    const dry = await migrateSensorMetadataToDatastreams(db, { dryRun: true, samplingPolicyId: 'sampling-1', now: later });

    expect(again).toMatchObject({ scanned: 1, created: 0, alreadyBound: 1, unresolved: [] });
    expect(dry).toMatchObject({ scanned: 1, wouldCreate: 0, alreadyBound: 1, unresolved: [] });
    expect(streamsOf(db)).toHaveLength(1);
  });

  it('a datastream the pre-check misses but createDatastream refuses as an overlap counts in alreadyBound', async () => {
    const db = createFakeDb({
      ...topology(),
      telemetryDatastreams: [{
        telemetryDatastreamId: 'future',
        sensorId: 'S-1',
        observedProperty: 'temperature',
        validityPeriod: { start: new Date('2026-11-01T00:00:00.000Z'), end: new Date('2026-12-01T00:00:00.000Z') },
      }],
    });

    const summary = await migrateSensorMetadataToDatastreams(db, { samplingPolicyId: 'sampling-1', now: NOW });

    expect(summary).toMatchObject({ created: 0, alreadyBound: 1, unresolved: [] });
    expect(streamsOf(db)).toHaveLength(1);
  });

  it.each([
    ['freezer_not_located', 'the container is not stored', { storageContainers: [] }],
    ['freezer_not_located', 'the freezer has no mirrored location', { storageLocations: [] }],
    ['no_equipment', 'neither the freezer nor the row names an equipment', {
      storageContainers: [{ _id: FREEZER_ID, containerType: 'FREEZER', name: 'Freezer 1' }],
    }],
    ['no_policy', 'the row has no temperaturePolicy', { sensorMetadata: [sensor({ temperaturePolicy: null })] }],
  ])('lists the row as %s when %s, and writes nothing', async (reason, _when, overrides) => {
    const db = createFakeDb(topology(overrides));

    const summary = await migrateSensorMetadataToDatastreams(db, { samplingPolicyId: 'sampling-1', now: NOW });

    expect(summary).toMatchObject({ scanned: 1, created: 0, unresolved: [{ sensorId: 'S-1', reason }] });
    expect(writesOf(db)).toEqual([]);
  });

  it('refuses a sampling policy that is not a stored ConfigurationProfile, and writes nothing', async () => {
    const db = createFakeDb(topology());

    await expect(migrateSensorMetadataToDatastreams(db, { samplingPolicyId: 'missing', now: NOW }))
      .rejects.toThrow('ConfigurationProfile missing não encontrado');
    expect(writesOf(db)).toEqual([]);
  });

  it('refuses an applied run without a sampling policy, and writes nothing', async () => {
    const db = createFakeDb(topology());

    await expect(migrateSensorMetadataToDatastreams(db, { now: NOW }))
      .rejects.toThrow('--sampling-policy-id é obrigatório para gravar');
    expect(writesOf(db)).toEqual([]);
  });
});
