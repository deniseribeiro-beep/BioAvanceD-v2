import { test, expect } from '@playwright/test';
import { MongoClient, type Db } from 'mongodb';
import { findTemperatureIncident, closeSeedSensorDb } from './helpers/seedSensor';

// Real-backend proof of #1552: POST /api/incidents/create is gated by the
// machine-ingest secret. Before it, the route carried no middleware, so an
// anonymous caller could open a cold-chain incident, which quarantines samples
// and mails the alert recipients. A missing or wrong x-telemetry-ingest-secret
// is refused with no incident written; the configured secret still opens one.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;
const mongoUri = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true';
const mongoDbName = process.env.E2E_MONGO_DB || 'bioavanced_test';

// #1552: the same machine ingest secret POST /api/iot/telemetry takes.
const ingestHeaders = () => ({ 'x-telemetry-ingest-secret': process.env.TELEMETRY_INGEST_SECRET ?? '' });

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

test.describe('POST /api/incidents/create machine-ingest gate (#1552) — real backend', () => {
  // The refusals read "no incident yet" for the key the last case then opens.
  test.describe.configure({ mode: 'serial' });
  let mongo: MongoClient | null = null;
  const sensorKey = `e2e-1552-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const data = {
    sensorKey,
    sensorName: `Sensor ${sensorKey}`,
    currentTemperature: -3.1,
    maxTemperature: -2.8,
    minTemperature: -4.2,
    samplesOutOfRange: 1,
  };

  async function getDb(): Promise<Db> {
    if (!mongo) {
      mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10_000 });
      await mongo.connect();
    }
    return mongo.db(mongoDbName);
  }

  test.afterAll(async () => {
    await (await getDb()).collection('temperatureIncidents').deleteMany({ sensorKey });
    if (mongo) await mongo.close();
    await closeSeedSensorDb();
  });

  test('refuses a request carrying no secret header, and writes no incident', async ({ request }) => {
    const response = await request.post(`${apiBaseURL}/api/incidents/create`, { data });

    expect(response.status()).toBe(403);
    expect(await findTemperatureIncident(sensorKey)).toBeNull();
  });

  test('refuses a request carrying the wrong secret, and writes no incident', async ({ request }) => {
    const response = await request.post(`${apiBaseURL}/api/incidents/create`, {
      headers: { 'x-telemetry-ingest-secret': 'wrong' },
      data,
    });

    expect(response.status()).toBe(403);
    expect(await findTemperatureIncident(sensorKey)).toBeNull();
  });

  test('opens the incident for a request carrying the configured secret', async ({ request }) => {
    const response = await request.post(`${apiBaseURL}/api/incidents/create`, { headers: ingestHeaders(), data });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(await findTemperatureIncident(sensorKey)).not.toBeNull();
  });
});
