import { MongoClient, Db, ObjectId } from 'mongodb';

/**
 * RF009 (#289) fixture: seeds a real TemperaturePolicy + SensorMetadata
 * pair directly against the test stack's Mongo — no API seed path exists
 * for either collection, only the manual dev script pattern already noted
 * in seedParticipant.ts. Shares the same connection env vars/convention.
 */

// directConnection=true (#297): see seedParticipant.ts — mongodb-test is
// now a single-node replica set, so a plain localhost URI would trigger
// topology discovery against a hostname the host machine can't resolve.
const mongoUri = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true';
const mongoDbName = process.env.E2E_MONGO_DB || 'bioavanced_test';

let client: MongoClient | null = null;

async function getDb(): Promise<Db> {
  if (!client) {
    client = new MongoClient(mongoUri);
    await client.connect();
  }
  return client.db(mongoDbName);
}

/** Closes the shared Mongo connection — call once from a suite's afterAll. */
export async function closeSeedSensorDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}

export interface SeededSensor {
  sensorId: string;
  policyId: string;
  minTemp: number;
  maxTemp: number;
  deviceId: string;
}

/**
 * Seeds a TemperaturePolicy, a Device, and a SensorMetadata doc bound to
 * both, so a POST /api/iot/telemetry reading for `sensorId` resolves a real
 * policy (and device) in iot.controller.js's resolveTemperaturePolicy
 * (bypassing its NODE_ENV=test hardcoded 'sensor-1' shortcut, which this
 * deliberately avoids using so the out-of-range/incident/excursion path is
 * proven against real seeded data).
 */
export async function seedSensorWithPolicy(
  minTemp: number,
  maxTemp: number
): Promise<SeededSensor> {
  const db = await getDb();
  const suffix = Date.now();
  const sensorId = `rf009-e2e-sensor-${suffix}`;
  const deviceId = `rf009-e2e-device-${suffix}`;

  const policyResult = await db.collection('temperaturePolicies').insertOne({
    name: `RF009 e2e policy ${suffix}`,
    targetTemp: (minTemp + maxTemp) / 2,
    minTemp,
    maxTemp,
    hysteresis: 0.5,
    // #678 dict-02 ThresholdProfile alignment -- inserted via raw driver
    // (no API/Mongoose write path for this collection exists), so these
    // don't come from TemperaturePolicy.schema.js's own defaults and must
    // be set explicitly here to keep e2e-seeded policies dict-02-complete.
    metricType: 'temperature',
    ruleVersion: '1.0.0',
    effectivePeriod: { start: new Date(), end: null },
    minimumDuration: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const deviceResult = await db.collection('devices').insertOne({
    deviceId,
    deviceType: 'freezer',
    qualificationStatus: 'qualified',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // #984: derive all three variable MAC octets from the full millisecond
  // suffix (not suffix % 100, which wrapped every 100ms and let two seeds
  // produce a byte-identical macAddress once SensorMetadata's unique index
  // is actually built — see SensorMetadata.schema.js's macAddress index).
  const macSuffix = suffix.toString(16).padStart(6, '0').slice(-6);

  await db.collection('sensorMetadata').insertOne({
    sensorId,
    macAddress: `AA:BB:CC:${macSuffix.slice(0, 2)}:${macSuffix.slice(2, 4)}:${macSuffix.slice(4, 6)}`,
    equipment: null,
    device: deviceResult.insertedId,
    temperaturePolicy: policyResult.insertedId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return { sensorId, policyId: policyResult.insertedId.toString(), minTemp, maxTemp, deviceId };
}

/** Reads back the TemperatureIncident (if any) opened for a given sensor. */
export async function findTemperatureIncident(sensorId: string): Promise<any | null> {
  const db = await getDb();
  return db.collection('temperatureIncidents').findOne({ sensorKey: sensorId });
}

/** Reads back the EnvironmentalExcursion (if any) opened for a given device. */
export async function findEnvironmentalExcursion(deviceId: string): Promise<any | null> {
  const db = await getDb();
  return db.collection('environmentalExcursions').findOne({ equipmentId: deviceId });
}

/** Counts EnvironmentalExcursion docs of a given type for a device — used to prove upsert (not duplicate-insert) behavior. */
export async function countEnvironmentalExcursions(deviceId: string, excursionType: string): Promise<number> {
  const db = await getDb();
  return db.collection('environmentalExcursions').countDocuments({ equipmentId: deviceId, excursionType });
}

/** Seeds a bare FREEZER-type StorageContainer (collection storageContainers per StorageContainer.js) for #311 registration-flow specs. */
export async function seedFreezerContainer(): Promise<string> {
  const db = await getDb();
  const result = await db.collection('storageContainers').insertOne({
    name: `RF009 e2e freezer ${Date.now()}`,
    containerType: 'FREEZER',
    parent_id: null,
    temperature: -80,
    temperatureUnit: 'CELSIUS',
    status: 'OPERATIONAL',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  });
  return result.insertedId.toString();
}

/** Reads back a sensorMetadata doc by sensorId (raw, no Mongoose) for assertions against a real API-created sensor. */
export async function findSensorMetadata(sensorId: string): Promise<any | null> {
  const db = await getDb();
  return db.collection('sensorMetadata').findOne({ sensorId });
}

export interface SeededFreezerSample {
  sensorId: string;
  deviceId: string;
  policyId: string;
  freezerId: string;
  shelfId: string;
  rackId: string;
  boxId: string;
  rootSampleId: string;
}

/**
 * RF009 (#304) fixture: seeds a full FREEZER -> SHELF -> RACK -> StorageBox
 * hierarchy (per TelemetryMonitor.resolveBoxIdsUnderFreezer) plus a real
 * sensorMetadata doc bound to the freezer container and one Sample doc
 * whose storageLocation.boxId matches, so findCriticalFreezers'
 * resolveRootSamples() resolves a real rootSampleId instead of the []
 * the plain seedSensorWithPolicy fixture produces (no storageContainer
 * link).
 */
export async function seedSensorWithFreezerSample(
  minTemp: number,
  maxTemp: number
): Promise<SeededFreezerSample> {
  const db = await getDb();
  const suffix = Date.now();
  const sensorId = `rf009-e2e-propagate-sensor-${suffix}`;
  const deviceId = `rf009-e2e-propagate-device-${suffix}`;

  const policyResult = await db.collection('temperaturePolicies').insertOne({
    name: `RF009 propagate e2e policy ${suffix}`,
    targetTemp: (minTemp + maxTemp) / 2,
    minTemp,
    maxTemp,
    hysteresis: 0.5,
    // #678 dict-02 ThresholdProfile alignment -- see seedSensorWithPolicy's
    // own comment above for why these are set explicitly here.
    metricType: 'temperature',
    ruleVersion: '1.0.0',
    effectivePeriod: { start: new Date(), end: null },
    minimumDuration: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const deviceResult = await db.collection('devices').insertOne({
    deviceId,
    deviceType: 'freezer',
    qualificationStatus: 'qualified',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const freezerResult = await db.collection('storageContainers').insertOne({
    name: `RF009 e2e freezer ${suffix}`,
    containerType: 'FREEZER',
    parent_id: null,
    temperature: minTemp,
    temperatureUnit: 'CELSIUS',
    status: 'OPERATIONAL',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  });
  const shelfResult = await db.collection('storageContainers').insertOne({
    name: `RF009 e2e shelf ${suffix}`,
    containerType: 'SHELF',
    parent_id: freezerResult.insertedId,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  });
  const rackResult = await db.collection('storageContainers').insertOne({
    name: `RF009 e2e rack ${suffix}`,
    containerType: 'RACK',
    parent_id: shelfResult.insertedId,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  });
  const boxResult = await db.collection('storageBoxes').insertOne({
    name: `RF009 e2e box ${suffix}`,
    parent_id: rackResult.insertedId,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  });

  const sampleResult = await db.collection('samples').insertOne({
    sampleType: 'plasma',
    status: 'stored',
    storageLocation: { boxId: boxResult.insertedId },
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // #984: see seedSensorWithPolicy's own comment above — same fix, same
  // shared 24-bit space (deliberately not partitioned by function, since
  // the unique index is on the whole sensorMetadata collection).
  const macSuffix = suffix.toString(16).padStart(6, '0').slice(-6);

  await db.collection('sensorMetadata').insertOne({
    sensorId,
    macAddress: `AA:BB:CC:${macSuffix.slice(0, 2)}:${macSuffix.slice(2, 4)}:${macSuffix.slice(4, 6)}`,
    equipment: null,
    device: deviceResult.insertedId,
    temperaturePolicy: policyResult.insertedId,
    storageContainer: freezerResult.insertedId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return {
    sensorId,
    deviceId,
    policyId: policyResult.insertedId.toString(),
    freezerId: freezerResult.insertedId.toString(),
    shelfId: shelfResult.insertedId.toString(),
    rackId: rackResult.insertedId.toString(),
    boxId: boxResult.insertedId.toString(),
    rootSampleId: sampleResult.insertedId.toString(),
  };
}

/** Deletes everything seedSensorWithFreezerSample created (sensor, device, policy, storage hierarchy, sample, and any excursion/incident it triggered). */
export async function removeSeededFreezerSample(sensor: SeededFreezerSample): Promise<void> {
  const db = await getDb();
  await Promise.all([
    db.collection('sensorMetadata').deleteMany({ sensorId: sensor.sensorId }),
    db.collection('devices').deleteMany({ deviceId: sensor.deviceId }),
    db.collection('temperaturePolicies').deleteMany({ _id: new ObjectId(sensor.policyId) }),
    db.collection('environmentalExcursions').deleteMany({ equipmentId: sensor.deviceId }),
    db.collection('temperatureIncidents').deleteMany({ sensorKey: sensor.sensorId }),
    db.collection('samples').deleteMany({ _id: new ObjectId(sensor.rootSampleId) }),
    db.collection('storageBoxes').deleteMany({ _id: new ObjectId(sensor.boxId) }),
    db.collection('storageContainers').deleteMany({
      _id: { $in: [new ObjectId(sensor.rackId), new ObjectId(sensor.shelfId), new ObjectId(sensor.freezerId)] },
    }),
  ]);
}

/** Deletes one temperaturePolicies document by _id (e.g. one created through the API). */
export async function removeTemperaturePolicy(policyId: string): Promise<void> {
  const db = await getDb();
  await db.collection('temperaturePolicies').deleteOne({ _id: new ObjectId(policyId) });
}

/** Deletes a seeded freezer container and its linked sensorMetadata/sensors docs. */
export async function removeSensorRegistration(sensorId: string, freezerId: string): Promise<void> {
  const db = await getDb();
  await Promise.all([
    db.collection('sensors').deleteMany({ sensorId }),
    db.collection('sensorMetadata').deleteMany({ sensorId }),
    db.collection('storageContainers').deleteOne({ _id: new ObjectId(freezerId) }),
  ]);
}

/**
 * Deletes everything seedSensorWithPolicy created for one sensor, plus any
 * excursion/incident it triggered. TelemetryMonitor's missing-reading
 * detection (#299) scans every sensorMetadata doc every cycle, unlike the
 * ingestion-path tests above — without this, fixtures from every past e2e
 * run accumulate in the persistent mongodb-test-data volume and each one
 * adds a real quarantine-evaluation lookup to every future run-cycle call,
 * slowing (and eventually timing out) any test that triggers one.
 */
export async function removeSeededSensor(sensor: SeededSensor): Promise<void> {
  const db = await getDb();
  await Promise.all([
    db.collection('sensorMetadata').deleteMany({ sensorId: sensor.sensorId }),
    db.collection('devices').deleteMany({ deviceId: sensor.deviceId }),
    db.collection('temperaturePolicies').deleteMany({ _id: new ObjectId(sensor.policyId) }),
    db.collection('environmentalExcursions').deleteMany({ equipmentId: sensor.deviceId }),
    db.collection('temperatureIncidents').deleteMany({ sensorKey: sensor.sensorId }),
  ]);
}
