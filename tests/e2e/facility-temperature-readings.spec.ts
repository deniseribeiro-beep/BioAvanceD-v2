import { test, expect } from '@playwright/test';
import { bindSensor, unbindSensor, closeSeedSensorDb } from './helpers/seedSensor';
import { realLogin, seedRealAuth } from './helpers/realAuth';

// Real backend only: the readings are persisted in InfluxDB, so run via
// `npm run test:e2e:docker` against the compose test stack, never the mocked
// suite.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

// #1091: POST /api/iot/telemetry is gated by machineIngestGate.js, which
// fails closed on a missing/mismatched x-telemetry-ingest-secret header.
const ingestHeaders = () => ({ 'x-telemetry-ingest-secret': process.env.TELEMETRY_INGEST_SECRET ?? '' });

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

// #1397 (RF009 AC7): Facility Management's "Controle de Temperatura" and
// "Histórico de Leituras" tabs show the readings persisted in InfluxDB.
test.describe('Facility Management temperature tabs read the persisted readings (#1397, RF009) — real backend', () => {
  test.afterAll(closeSeedSensorDb);

  test('RF009 a reading posted through the ingest endpoint appears in Facility Management\'s temperature tabs', async ({ page, request }) => {
    const session = await realLogin(request);
    await seedRealAuth(page, session);

    const sensorId = `rf009-facility-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await bindSensor(sensorId);
    try {
      const reading = await request.post(`${apiBaseURL}/api/iot/telemetry`, {
        headers: ingestHeaders(),
        data: { sensorId, temperature: -47.5, timestamp: new Date().toISOString() },
      });
      expect(reading.status(), await reading.text()).toBe(200);
      const { telemetryReadingId } = await reading.json();
      expect(telemetryReadingId).toBeTruthy();

      await page.goto('/facility-management?tab=temperature');
      const card = page.getByTestId(`temperature-sensor-card-${sensorId}`);
      await expect(card).toBeVisible();
      await expect(card).toContainText('-47.5°C');

      await page.getByTestId('facility-tab-history').click();
      const historyRow = page.getByTestId(`history-row-${telemetryReadingId}`);
      await expect(historyRow).toContainText(sensorId);
      await expect(historyRow).toContainText('-47.5°C');
    } finally {
      await unbindSensor(sensorId);
    }
  });
});

// #1397 (RF009 AC7): the Dashboard's temperature chart shows the readings
// persisted in InfluxDB, its legend naming each sensor's newest value.
test.describe('Dashboard temperature chart reads the persisted readings (#1397, RF009) — real backend', () => {
  test.afterAll(closeSeedSensorDb);

  test('RF009 a reading posted through the ingest endpoint appears in the Dashboard temperature chart', async ({ page, request }) => {
    const session = await realLogin(request);
    await seedRealAuth(page, session);

    const sensorId = `rf009-dashboard-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await bindSensor(sensorId);
    try {
      const reading = await request.post(`${apiBaseURL}/api/iot/telemetry`, {
        headers: ingestHeaders(),
        data: { sensorId, temperature: -47.5, timestamp: new Date().toISOString() },
      });
      expect(reading.status(), await reading.text()).toBe(200);

      await page.goto('/dashboard');
      await expect(page.getByTestId(`dashboard-temperature-sensor-${sensorId}`)).toContainText('-47.5°C');
    } finally {
      await unbindSensor(sensorId);
    }
  });
});
