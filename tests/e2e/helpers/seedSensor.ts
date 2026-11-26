import crypto from 'crypto';
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

export interface BindOptions {
  datastream?: boolean;
  registration?: boolean;
  device?: boolean;
  thresholdProfileId?: string;
  equipmentId?: string;
  validFrom?: Date;
  storageLocationId?: string;
}

/**
 * #1392: gives `sensorId` what TELEMETRY_BINDING_MODE=enforce asks of a
 * reading (telemetryReadingContract.js readingBindingOf): a temperature
 * TelemetryDatastream valid at its observedAt, an active DeviceRegistration
 * and a qualified, unretired Device, both under the sensorId itself. Each
 * part is on unless its option is false.
 *
 * The datastream opens 24 h back, before the oldest reading a spec posts
 * (121 min back). Its `${sensorId}-loc` storageLocationId names no mirrored
 * freezer, so TelemetryMonitor and the quarantine keep reading the
 * SensorMetadata freezer (sensorDatastream.service.js freezerContainerIdOf).
 * A thresholdProfileId that names no temperaturePolicies _id falls back to
 * the SensorMetadata policy. The datastream's equipmentId, which keys the
 * sensor's EnvironmentalExcursions (decision 5 of the 2026-10-21 record), is
 * `${sensorId}-equipment` unless `equipmentId` is given; the seeders below
 * pass their Device's deviceId, so excursions stay keyed by it.
 * `storageLocationId` places the datastream at a real StorageLocation, as
 * the exposure summary reads it (#1392); a location created through
 * `/api/physical-chain/locations` has no `legacy-storage-container:` code,
 * so TelemetryMonitor and the quarantine still read the SensorMetadata
 * freezer.
 */
export async function bindSensor(sensorId: string, options: BindOptions = {}): Promise<void> {
  const db = await getDb();
  const { datastream = true, registration = true, device = true } = options;

  if (datastream) {
    await db.collection('telemetryDatastreams').insertOne({
      telemetryDatastreamId: crypto.randomUUID(),
      sensorId,
      equipmentId: options.equipmentId ?? `${sensorId}-equipment`,
      storageLocationId: options.storageLocationId ?? `${sensorId}-loc`,
      observedProperty: 'temperature',
      unit: 'Cel',
      samplingPolicyId: 'sampling-e2e',
      thresholdProfileId: options.thresholdProfileId ?? 'threshold-e2e',
      validityPeriod: { start: options.validFrom ?? new Date(Date.now() - 24 * 60 * 60 * 1000), end: null },
      status: 'active',
      createdAt: new Date(),
    });
  }

  if (registration) {
    await db.collection('deviceRegistrations').insertOne({
      deviceRegistrationId: crypto.randomUUID(),
      deviceId: sensorId,
      communicationProfileId: 'https-e2e',
      credentialReference: `secret-manager:device/${sensorId}`,
      registeredAt: new Date(),
      status: 'active',
      createdAt: new Date(),
    });
  }

  if (device) {
    await db.collection('devices').insertOne({
      deviceId: sensorId,
      deviceType: 'sensor',
      manufacturer: null,
      modelNumber: null,
      serialNumber: null,
      firmwareVersion: null,
      softwareVersion: null,
      calibrationDate: null,
      calibrationDueDate: null,
      maintenanceRecords: [],
      qualificationStatus: 'qualified',
      currentLocationId: null,
      retiredAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
}

/** Deletes every datastream, DeviceRegistration and Device of `sensorId`, whether bindSensor or the API created it. */
export async function unbindSensor(sensorId: string): Promise<void> {
  const db = await getDb();
  await Promise.all([
    db.collection('telemetryDatastreams').deleteMany({ sensorId }),
    db.collection('deviceRegistrations').deleteMany({ deviceId: sensorId }),
    db.collection('devices').deleteMany({ deviceId: sensorId }),
  ]);
}

/** #1392: deletes the EnvironmentalExcursions keyed by a datastream's `equipmentId`, which removeSeededSensor (keyed by deviceId) leaves. */
export async function removeEnvironmentalExcursions(equipmentId: string): Promise<void> {
  const db = await getDb();
  await db.collection('environmentalExcursions').deleteMany({ equipmentId });
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
 * proven against real seeded data). It also binds the sensor (bindSensor,
 * #1392) with a datastream naming that policy, so the reading passes
 * TELEMETRY_BINDING_MODE=enforce and is judged against the same policy;
 * `bind` switches parts off or overrides them.
 */
export async function seedSensorWithPolicy(
  minTemp: number,
  maxTemp: number,
  bind: BindOptions = {}
): Promise<SeededSensor> {
  const db = await getDb();
  const suffix = Date.now();
  const sensorId = `rf009-e2e-sensor-${suffix}`;
  const deviceId = `rf009-e2e-device-${suffix}`;

  const policyResult = await db.collection('temperaturePolicies').insertOne({
    name: `RF009 e2e policy ${suffix}`,
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

  await bindSensor(sensorId, { thresholdProfileId: policyResult.insertedId.toString(), equipmentId: deviceId, ...bind });

  return { sensorId, policyId: policyResult.insertedId.toString(), minTemp, maxTemp, deviceId };
}

/** Reads back the TemperatureIncident (if any) opened for a given sensor. */
export async function findTemperatureIncident(sensorId: string): Promise<any | null> {
  const db = await getDb();
  return db.collection('temperatureIncidents').findOne({ sensorKey: sensorId });
}

/** #1516: reads back the mqtt_ingestion_audit rows the MQTT subscriber wrote for a sensor. */
export async function findMqttIngestionAudits(sensorId: string): Promise<any[]> {
  const db = await getDb();
  return db.collection('mqtt_ingestion_audit').find({ sensorId }).toArray();
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

export interface SeededDatastreamBinding {
  freezerId: string;
  equipmentId: string;
  storageLocationId: string;
  policyId: string;
  samplingPolicyId: string;
}

/**
 * #1392: what a registration needs to write its temperature
 * TelemetryDatastream (sensorDatastream.service.js resolveTemperatureBinding):
 * a FREEZER whose containerID is its Equipment, the freezer's mirrored
 * storageLocations row (#1379), a temperaturePolicies row and a sampling
 * ConfigurationProfile. Remove with removeDatastreamBinding.
 */
export async function seedDatastreamBinding(): Promise<SeededDatastreamBinding> {
  const db = await getDb();
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const equipmentId = `rf009-e2e-equipment-${suffix}`;
  const freezer = await db.collection('storageContainers').insertOne({
    name: `RF009 e2e datastream freezer ${suffix}`,
    containerType: 'FREEZER',
    containerID: equipmentId,
    parent_id: null,
    temperature: -80,
    temperatureUnit: 'CELSIUS',
    status: 'OPERATIONAL',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  });
  const freezerId = freezer.insertedId.toString();
  const storageLocationId = `rf009-e2e-location-${suffix}`;
  await db.collection('storageLocations').insertOne({
    storageLocationId,
    code: `legacy-storage-container:${freezerId}`,
    name: `RF009 e2e datastream freezer ${suffix}`,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const policy = await db.collection('temperaturePolicies').insertOne({
    name: `RF009 e2e datastream policy ${suffix}`,
    minTemp: -90,
    maxTemp: -60,
    hysteresis: 0.5,
    metricType: 'temperature',
    ruleVersion: '1.0.0',
    effectivePeriod: { start: new Date(), end: null },
    minimumDuration: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const samplingPolicyId = `rf009-e2e-sampling-${suffix}`;
  await db.collection('configurationProfiles').insertOne({ profileId: samplingPolicyId, createdAt: new Date() });
  return { freezerId, equipmentId, storageLocationId, policyId: policy.insertedId.toString(), samplingPolicyId };
}

/** Deletes each row seedDatastreamBinding wrote and, per sensorId, its sensors, sensorMetadata and (through unbindSensor) telemetryDatastreams docs. */
export async function removeDatastreamBinding(binding: SeededDatastreamBinding, sensorIds: string[]): Promise<void> {
  const db = await getDb();
  for (const sensorId of sensorIds) {
    await unbindSensor(sensorId);
    await Promise.all([
      db.collection('sensors').deleteMany({ sensorId }),
      db.collection('sensorMetadata').deleteMany({ sensorId }),
    ]);
  }
  await Promise.all([
    db.collection('storageContainers').deleteOne({ _id: new ObjectId(binding.freezerId) }),
    db.collection('storageLocations').deleteOne({ storageLocationId: binding.storageLocationId }),
    db.collection('temperaturePolicies').deleteOne({ _id: new ObjectId(binding.policyId) }),
    db.collection('configurationProfiles').deleteOne({ profileId: binding.samplingPolicyId }),
  ]);
}

/** Reads back a sensor's temperature telemetryDatastreams docs (raw, no Mongoose). */
export async function findTemperatureDatastreams(sensorId: string): Promise<any[]> {
  const db = await getDb();
  return db.collection('telemetryDatastreams').find({ sensorId, observedProperty: 'temperature' }).toArray();
}

/** Reads back a sensors doc by sensorId (raw, no Mongoose). */
export async function findSensor(sensorId: string): Promise<any | null> {
  const db = await getDb();
  return db.collection('sensors').findOne({ sensorId });
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
 * link). Binds the sensor as seedSensorWithPolicy does (#1392); `bind`
 * switches parts off or overrides them.
 */
export async function seedSensorWithFreezerSample(
  minTemp: number,
  maxTemp: number,
  bind: BindOptions = {}
): Promise<SeededFreezerSample> {
  const db = await getDb();
  const suffix = Date.now();
  const sensorId = `rf009-e2e-propagate-sensor-${suffix}`;
  const deviceId = `rf009-e2e-propagate-device-${suffix}`;

  const policyResult = await db.collection('temperaturePolicies').insertOne({
    name: `RF009 propagate e2e policy ${suffix}`,
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

  await bindSensor(sensorId, { thresholdProfileId: policyResult.insertedId.toString(), equipmentId: deviceId, ...bind });

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

export interface SeededFreezerSensor {
  sensorId: string;
  deviceId: string;
  policyId: string;
  freezerId: string;
}

/**
 * #1368 fixture: seeds a TemperaturePolicy, a Device, and a SensorMetadata
 * doc bound to an already-seeded FREEZER container (e.g. the one
 * seedParticipant.ts's seedStorageBoxLocation created), so
 * TelemetryMonitor.resolveRootSamples resolves the samples the API placed in
 * that freezer instead of a sample this fixture inserted itself
 * (seedSensorWithFreezerSample). Binds the sensor as seedSensorWithPolicy
 * does (#1392); `bind` switches parts off or overrides them.
 */
export async function seedSensorOnFreezer(
  freezerId: string,
  minTemp: number,
  maxTemp: number,
  bind: BindOptions = {}
): Promise<SeededFreezerSensor> {
  const db = await getDb();
  const suffix = Date.now();
  const sensorId = `rf009-e2e-freezer-sensor-${suffix}`;
  const deviceId = `rf009-e2e-freezer-device-${suffix}`;

  const policyResult = await db.collection('temperaturePolicies').insertOne({
    name: `RF009 freezer e2e policy ${suffix}`,
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

  // #984: see seedSensorWithPolicy's own comment above.
  const macSuffix = suffix.toString(16).padStart(6, '0').slice(-6);

  await db.collection('sensorMetadata').insertOne({
    sensorId,
    macAddress: `AA:BB:CC:${macSuffix.slice(0, 2)}:${macSuffix.slice(2, 4)}:${macSuffix.slice(4, 6)}`,
    equipment: null,
    device: deviceResult.insertedId,
    temperaturePolicy: policyResult.insertedId,
    storageContainer: new ObjectId(freezerId),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await bindSensor(sensorId, { thresholdProfileId: policyResult.insertedId.toString(), equipmentId: deviceId, ...bind });

  return { sensorId, deviceId, policyId: policyResult.insertedId.toString(), freezerId };
}

/** Deletes everything seedSensorOnFreezer created (its binding included), plus any excursion/incident it triggered; the freezer itself belongs to its own seeder. */
export async function removeSensorOnFreezer(sensor: SeededFreezerSensor): Promise<void> {
  const db = await getDb();
  await unbindSensor(sensor.sensorId);
  await Promise.all([
    db.collection('sensorMetadata').deleteMany({ sensorId: sensor.sensorId }),
    db.collection('devices').deleteMany({ deviceId: sensor.deviceId }),
    db.collection('temperaturePolicies').deleteMany({ _id: new ObjectId(sensor.policyId) }),
    db.collection('environmentalExcursions').deleteMany({ equipmentId: sensor.deviceId }),
    db.collection('temperatureIncidents').deleteMany({ sensorKey: sensor.sensorId }),
  ]);
}

/** Reads back the Mongo Sample document seedSensorWithFreezerSample created. */
export async function findFreezerSample(sensor: SeededFreezerSample): Promise<any | null> {
  const db = await getDb();
  return db.collection('samples').findOne({ _id: new ObjectId(sensor.rootSampleId) });
}

/** Deletes everything seedSensorWithFreezerSample created (sensor, its binding, device, policy, storage hierarchy, sample, and any excursion/incident it triggered). */
export async function removeSeededFreezerSample(sensor: SeededFreezerSample): Promise<void> {
  const db = await getDb();
  await unbindSensor(sensor.sensorId);
  await Promise.all([
    db.collection('sensorMetadata').deleteMany({ sensorId: sensor.sensorId }),
    db.collection('devices').deleteMany({ deviceId: sensor.deviceId }),
    db.collection('temperaturePolicies').deleteMany({ _id: new ObjectId(sensor.policyId) }),
    db.collection('environmentalExcursions').deleteMany({ equipmentId: sensor.deviceId }),
    db.collection('temperatureIncidents').deleteMany({ sensorKey: sensor.sensorId }),
    db.collection('samples').deleteMany({ _id: new ObjectId(sensor.rootSampleId) }),
    // Written when a cold-chain quarantine fires for this sample (#1207, #1208).
    db.collection('sample_movements').deleteMany({ sampleID: sensor.rootSampleId }),
    db.collection('quarantineActions').deleteMany({ specimenIds: sensor.rootSampleId }),
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

/** Reads back a temperaturePolicies doc by _id (raw, no Mongoose) to assert the stored canonical shape. */
export async function findTemperaturePolicy(policyId: string): Promise<any | null> {
  const db = await getDb();
  return db.collection('temperaturePolicies').findOne({ _id: new ObjectId(policyId) });
}

/** Same as findTemperaturePolicy, keyed by the unique name a UI-created policy was given. */
export async function findTemperaturePolicyByName(name: string): Promise<any | null> {
  const db = await getDb();
  return db.collection('temperaturePolicies').findOne({ name });
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
 * Deletes everything seedSensorWithPolicy created for one sensor (its
 * binding, and any datastream the API created for it, included), plus any
 * excursion/incident it triggered. TelemetryMonitor's missing-reading
 * detection (#299) scans every sensorMetadata doc every cycle, unlike the
 * ingestion-path tests above — without this, fixtures from every past e2e
 * run accumulate in the persistent mongodb-test-data volume and each one
 * adds a real quarantine-evaluation lookup to every future run-cycle call,
 * slowing (and eventually timing out) any test that triggers one.
 */
export async function removeSeededSensor(sensor: SeededSensor): Promise<void> {
  const db = await getDb();
  await unbindSensor(sensor.sensorId);
  await Promise.all([
    db.collection('sensorMetadata').deleteMany({ sensorId: sensor.sensorId }),
    db.collection('devices').deleteMany({ deviceId: sensor.deviceId }),
    db.collection('temperaturePolicies').deleteMany({ _id: new ObjectId(sensor.policyId) }),
    db.collection('environmentalExcursions').deleteMany({ equipmentId: sensor.deviceId }),
    db.collection('temperatureIncidents').deleteMany({ sensorKey: sensor.sensorId }),
  ]);
}
