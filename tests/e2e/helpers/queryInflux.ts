import { InfluxDB } from '@influxdata/influxdb-client';

/**
 * RF009 (#289) fixture: reads back telemetry points written by
 * saveTelemetryPoint.js (api/backend/src/services/saveTelemetryPoint.js) —
 * proving persistence means querying the real InfluxDB bucket, not trusting
 * the ingest endpoint's 200 response alone (it fires the Influx write
 * fire-and-forget, see ingestTelemetry in iot.controller.js).
 *
 * Env vars mirror compose.test.yml's INFLUXDB_* block exactly, except the
 * URL: the backend container talks to `influxdb-test:8086` on the compose
 * network, but Playwright runs from the host (same reasoning as
 * seedParticipant.ts's Mongo helper), so this defaults to localhost against
 * the published port added alongside this spec.
 */

const url = process.env.E2E_INFLUXDB_URL || 'http://localhost:8086';
const token = process.env.E2E_INFLUXDB_TOKEN || 'bioavanced-test-token';
const org = process.env.E2E_INFLUXDB_ORG || 'bioavanced-test';
const bucket = process.env.E2E_INFLUXDB_BUCKET || 'bioavanced-test';

let client: InfluxDB | null = null;

function getClient(): InfluxDB {
  if (!client) {
    client = new InfluxDB({ url, token });
  }
  return client;
}

export interface TelemetryPoint {
  time: string;
  value: number;
}

/**
 * Returns every `temperature` measurement point recorded for `sensorId` in
 * the last `lookbackMinutes`, newest first.
 */
export async function queryTemperaturePoints(
  sensorId: string,
  lookbackMinutes = 10
): Promise<TelemetryPoint[]> {
  const queryApi = getClient().getQueryApi(org);
  const flux = `from(bucket: "${bucket}")
    |> range(start: -${lookbackMinutes}m)
    |> filter(fn: (r) => r._measurement == "temperature")
    |> filter(fn: (r) => r._field == "value")
    |> filter(fn: (r) => r.sensorId == "${sensorId}")
    |> sort(columns: ["_time"], desc: true)`;

  const rows = await queryApi.collectRows<{ _time: string; _value: number }>(flux);
  return rows.map((row) => ({ time: row._time, value: row._value }));
}
