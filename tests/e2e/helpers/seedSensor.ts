import { MongoClient, Db } from 'mongodb';

/**
 * RF009 (#289) fixture: seeds a real TemperaturePolicy + SensorMetadata
 * pair directly against the test stack's Mongo — no API seed path exists
 * for either collection, only the manual dev script pattern already noted
 * in seedParticipant.ts. Shares the same connection env vars/convention.
 */

const mongoUri = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017';
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
}

/**
 * Seeds a TemperaturePolicy and a SensorMetadata doc bound to it, so a
 * POST /api/iot/telemetry reading for `sensorId` resolves a real policy in
 * iot.controller.js's resolveTemperaturePolicy (bypassing its NODE_ENV=test
 * hardcoded 'sensor-1' shortcut, which this deliberately avoids using so
 * the out-of-range/incident path is proven against real seeded data).
 */
export async function seedSensorWithPolicy(
  minTemp: number,
  maxTemp: number
): Promise<SeededSensor> {
  const db = await getDb();
  const suffix = Date.now();
  const sensorId = `rf009-e2e-sensor-${suffix}`;

  const policyResult = await db.collection('temperaturePolicies').insertOne({
    name: `RF009 e2e policy ${suffix}`,
    targetTemp: (minTemp + maxTemp) / 2,
    minTemp,
    maxTemp,
    hysteresis: 0.5,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await db.collection('sensorMetadata').insertOne({
    sensorId,
    macAddress: `AA:BB:CC:00:00:${(suffix % 100).toString().padStart(2, '0')}`,
    equipment: null,
    temperaturePolicy: policyResult.insertedId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return { sensorId, policyId: policyResult.insertedId.toString(), minTemp, maxTemp };
}

/** Reads back the TemperatureIncident (if any) opened for a given sensor. */
export async function findTemperatureIncident(sensorId: string): Promise<any | null> {
  const db = await getDb();
  return db.collection('temperatureIncidents').findOne({ sensorKey: sensorId });
}
