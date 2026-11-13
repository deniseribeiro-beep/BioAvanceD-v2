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

/**
 * #1317: the telemetryReadingId of every `freezer_temperature` point the
 * temperature reading route wrote for `sensorId`, with each point's time.
 * #1392: `measurement: 'temperature'` reads the points POST
 * /api/iot/telemetry wrote instead (saveTelemetryPoint.js).
 */
export async function queryFreezerReadingIds(
  sensorId: string,
  lookbackMinutes = 10,
  measurement: 'freezer_temperature' | 'temperature' = 'freezer_temperature'
): Promise<{ time: string; telemetryReadingId: string }[]> {
  const queryApi = getClient().getQueryApi(org);
  const flux = `from(bucket: "${bucket}")
    |> range(start: -${lookbackMinutes}m)
    |> filter(fn: (r) => r._measurement == "${measurement}")
    |> filter(fn: (r) => r._field == "telemetryReadingId")
    |> filter(fn: (r) => r.sensorId == "${sensorId}")`;

  const rows = await queryApi.collectRows<{ _time: string; _value: string }>(flux);
  return rows.map((row) => ({ time: row._time, telemetryReadingId: row._value }));
}

/**
 * #1518 (RNF025 C7): each `temperature` point POST /api/iot/telemetry wrote
 * for `sensorId`, with its reading id and the order and provenance fields
 * saveTelemetryPoint.js keeps beside the device time (sequenceNumber,
 * receivedAt, sourceEventId, payloadHash), oldest first.
 */
export async function queryTemperaturePointFields(
  sensorId: string,
  lookbackMinutes = 60
): Promise<{
  time: string;
  telemetryReadingId: string;
  sequenceNumber?: number;
  receivedAt?: string;
  sourceEventId?: string;
  payloadHash?: string;
}[]> {
  const queryApi = getClient().getQueryApi(org);
  const flux = `from(bucket: "${bucket}")
    |> range(start: -${lookbackMinutes}m)
    |> filter(fn: (r) => r._measurement == "temperature")
    |> filter(fn: (r) => r.sensorId == "${sensorId}")
    |> filter(fn: (r) => r._field == "telemetryReadingId" or r._field == "sequenceNumber" or r._field == "receivedAt" or r._field == "sourceEventId" or r._field == "payloadHash")
    |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
    |> group()
    |> sort(columns: ["_time"])`;

  const rows = await queryApi.collectRows<{
    _time: string;
    telemetryReadingId: string;
    sequenceNumber?: number | string | null;
    receivedAt?: string | null;
    sourceEventId?: string | null;
    payloadHash?: string | null;
  }>(flux);
  return rows.map((row) => ({
    time: row._time,
    telemetryReadingId: row.telemetryReadingId,
    ...(row.sequenceNumber !== undefined && row.sequenceNumber !== null && row.sequenceNumber !== ''
      ? { sequenceNumber: Number(row.sequenceNumber) }
      : {}),
    ...(row.receivedAt ? { receivedAt: row.receivedAt } : {}),
    ...(row.sourceEventId ? { sourceEventId: row.sourceEventId } : {}),
    ...(row.payloadHash ? { payloadHash: row.payloadHash } : {}),
  }));
}

/**
 * #1518 (RNF025 C8): every `temperature` point POST /api/iot/telemetry wrote
 * for `sensorId`, one row per point and series, with its value, id, source
 * event, `revision` tag and supersedesTelemetryReadingId; null where absent.
 */
export async function queryTemperatureRevisions(sensorId: string, lookbackMinutes = 10): Promise<{
  time: string; value: number; telemetryReadingId: string; sourceEventId: string | null;
  revision: string | null; supersedesTelemetryReadingId: string | null;
}[]> {
  const queryApi = getClient().getQueryApi(org);
  const flux = `from(bucket: "${bucket}")
    |> range(start: -${lookbackMinutes}m)
    |> filter(fn: (r) => r._measurement == "temperature")
    |> filter(fn: (r) => r.sensorId == "${sensorId}")
    |> filter(fn: (r) => r._field == "value" or r._field == "telemetryReadingId" or r._field == "sourceEventId" or r._field == "supersedesTelemetryReadingId")
    |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
    |> group()
    |> sort(columns: ["_time"])`;

  const rows = await queryApi.collectRows<{
    _time: string;
    value: number | string;
    telemetryReadingId: string;
    sourceEventId?: string | null;
    revision?: string | null;
    supersedesTelemetryReadingId?: string | null;
  }>(flux);
  // An absent string column comes back as '', hence `|| null`.
  return rows.map((row) => ({
    time: row._time,
    value: Number(row.value),
    telemetryReadingId: row.telemetryReadingId,
    sourceEventId: row.sourceEventId || null,
    revision: row.revision || null,
    supersedesTelemetryReadingId: row.supersedesTelemetryReadingId || null,
  }));
}

/**
 * #1325: every point in the bucket, over the backup export's range. count()
 * runs per series first: group() before count() would merge `_value`
 * columns of different types into one table.
 */
export async function countAllPoints(): Promise<number> {
  const queryApi = getClient().getQueryApi(org);
  const flux = `from(bucket: "${bucket}")
    |> range(start: 1678-01-01T00:00:00Z, stop: 2262-01-01T00:00:00Z)
    |> count()
    |> group()
    |> sum()`;

  const rows = await queryApi.collectRows<{ _value: number }>(flux);
  return rows.length ? Number(rows[0]._value) : 0;
}

/** #1515: every point POST /api/iot/telemetry wrote for `sensorId`, one row per point, with its value, id and clockStatus tag. */
export async function queryTelemetryReadingPoints(
  sensorId: string,
  lookbackMinutes = 10
): Promise<{ time: string; value: number; telemetryReadingId: string; clockStatus: string | null }[]> {
  const queryApi = getClient().getQueryApi(org);
  const flux = `from(bucket: "${bucket}")
    |> range(start: -${lookbackMinutes}m)
    |> filter(fn: (r) => r._measurement == "temperature")
    |> filter(fn: (r) => r.sensorId == "${sensorId}")
    |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")`;

  const rows = await queryApi.collectRows<{ _time: string; value: number; telemetryReadingId: string; clockStatus?: string }>(flux);
  return rows.map((row) => ({
    time: row._time,
    value: row.value,
    telemetryReadingId: row.telemetryReadingId,
    clockStatus: row.clockStatus ?? null,
  }));
}
