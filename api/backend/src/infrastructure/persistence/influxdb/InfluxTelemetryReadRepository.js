const { flux, fluxExpression, fluxFloat } = require('@influxdata/influxdb-client');
const influxConnection = require('../../database/influxdb/connection');
const TemperatureModel = require('../../../models/Temperature');
const { CURRENT_REVISION_FLUX } = require('./telemetryRevisions');

// The report's stop when the caller gives none: InfluxDB's maximum time
// (2262), not now(). A reading whose device clock ran ahead (clockStatus
// drift) is stored at its future observedAt, and the Mongo read this
// replaces listed it whatever its timestamp.
const REPORT_UNBOUNDED_STOP = new Date('2262-01-01T00:00:00Z');

const OPTIONAL_REPORT_TAGS =['locationId', 'facility', 'zone', 'clockStatus', 'datastreamId', 'storageLocationId', 'revision'];

function mapReportRow(row) {
  const unit = row.temperatureUnit || '°C';
  const value = Number(row.reading);
  const mapped = {
    logId: row.telemetryReadingId ?? null,
    telemetryReadingId: row.telemetryReadingId ?? null,
    timestamp: new Date(row._time),
    sensorId: row.sensorId ?? null,
    measurement: row._measurement,
    temperatureValue: value,
    temperatureUnit: unit,
    temperatureCelsius: TemperatureModel.toCelsius(value, unit),
  };
  for (const tag of OPTIONAL_REPORT_TAGS) {
    if (row[tag] !== undefined && row[tag] !== null && row[tag] !== '') mapped[tag] = row[tag];
  }
  return mapped;
}

class InfluxTelemetryReadRepository {
  // RF009 AC1 (#1317): a reading lives in InfluxDB, so its readers query
  // InfluxDB. Two measurements carry readings: POST /api/iot/telemetry writes
  // `temperature` (field `value`), while the temperature route, MQTT and the
  // IoT queue write `freezer_temperature` (field `temperatureValue`). Both are
  // read here. `range(start: 0)` keeps the unbounded reach of the Mongo read
  // this replaces, so a sensor with an old reading stays stale rather than
  // missing; bucket retention bounds the scan. `last()` runs per series and
  // tags split one sensor into several, so the newest time is kept in JS.
  // Errors are not caught: the caller must not mistake an outage for silence.
  //
  // temperatureReport reads both measurements for the temperature report
  // (RF009 AC1, #1317). A `freezer_temperature` point carries its unit as the
  // `temperatureUnit` tag; a `temperature` point has no unit tag and is
  // Celsius. Celsius is computed in Flux, so the critical filter compares
  // each sensor's Celsius bounds before the limit, and in JS with
  // TemperatureModel.toCelsius for the rows returned. Every value enters the
  // query through the `flux` template, never by concatenation. The
  // temperature history also reads through it, with `critical: null`.
  // readingById reads one reading by its telemetryReadingId the same way (#1391).
  // readingsAtLocation reads every reading bound to one storage location over
  // [start, stop), oldest first and unlimited, for the exposure summary
  // (RF009 AC5/AC6, #1392): Flux's range is start-inclusive and stop-exclusive.
  // #1518 (RNF025 C8): the report, the history and the exposure summary read
  // the current revision of each reading only (CURRENT_REVISION_FLUX), before
  // the critical filter, so a corrected in-range reading leaves no
  // out-of-range original behind; readingById reads every revision, so a
  // superseded reading stays readable by its id.
  async lastReadingAtBySensor() {
    await influxConnection.connectInfluxDB();
    const queryApi = influxConnection.getInfluxQueryApi();
    const fluxQuery = `from(bucket: "${influxConnection.getInfluxConfig().bucket}")
      |> range(start: 0)
      |> filter(fn: (r) => (r._measurement == "freezer_temperature" and r._field == "temperatureValue") or (r._measurement == "temperature" and r._field == "value"))
      |> last()
      |> keep(columns: ["sensorId", "_time"])`;
    const rows = await queryApi.collectRows(fluxQuery);

    const lastReadingAtBySensor = new Map();
    for (const row of rows) {
      if (row.sensorId === undefined || row.sensorId === null || row.sensorId === '') continue;
      const readingAt = new Date(row._time);
      if (Number.isNaN(readingAt.getTime())) continue;

      const key = String(row.sensorId);
      const current = lastReadingAtBySensor.get(key);
      if (!current || readingAt.getTime() > current.getTime()) {
        lastReadingAtBySensor.set(key, readingAt);
      }
    }
    return lastReadingAtBySensor;
  }

  async temperatureReport({ start = null, stop = null, sensorIds = null, critical = null, limit = 100, offset = 0 } = {}) {
    const empty = { rows: [], total: 0 };
    // Fails closed: a caller scoped to no sensor sees nothing.
    if (Array.isArray(sensorIds) && sensorIds.length === 0) return empty;
    // A Flux range refuses an empty window, where the Mongo read returned nothing.
    if (start && stop && start.getTime() >= stop.getTime()) return empty;

    let criticalFilter = '';
    if (critical) {
      const disjuncts = [];
      for (const [sensorId, bounds] of critical.boundsBySensor || new Map()) {
        const sides = [];
        if (Number.isFinite(bounds?.min)) sides.push(String(flux`r.celsius < ${fluxFloat(bounds.min)}`));
        if (Number.isFinite(bounds?.max)) sides.push(String(flux`r.celsius > ${fluxFloat(bounds.max)}`));
        if (sides.length === 0) continue;
        disjuncts.push(String(flux`(r.sensorId == ${String(sensorId)} and (${fluxExpression(sides.join(' or '))}))`));
      }
      const flaggedSensorIds = critical.flaggedSensorIds || [];
      if (flaggedSensorIds.length > 0) {
        disjuncts.push(String(flux`contains(value: r.sensorId, set: ${flaggedSensorIds.map(String)})`));
      }
      if (disjuncts.length === 0) return empty;
      criticalFilter = String(flux`
      |> filter(fn: (r) => ${fluxExpression(disjuncts.join(' or '))})`);
    }

    const sensorFilter = Array.isArray(sensorIds)
      ? String(flux`
      |> filter(fn: (r) => contains(value: r.sensorId, set: ${sensorIds.map(String)}))`)
      : '';

    await influxConnection.connectInfluxDB();
    const queryApi = influxConnection.getInfluxQueryApi();
    const pipeline = flux`from(bucket: ${influxConnection.getInfluxConfig().bucket})
      |> range(start: ${start || new Date(0)}, stop: ${stop || REPORT_UNBOUNDED_STOP})
      |> filter(fn: (r) => r._measurement == "freezer_temperature" or r._measurement == "temperature")
      |> filter(fn: (r) => r._field == "temperatureValue" or r._field == "value" or r._field == "telemetryReadingId")${fluxExpression(sensorFilter)}
      |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
      |> map(fn: (r) => ({r with reading: if exists r.temperatureValue then r.temperatureValue else r.value}))
      |> filter(fn: (r) => exists r.reading)
      |> map(fn: (r) => ({r with celsius: if exists r.temperatureUnit and r.temperatureUnit == "°F" then (r.reading - 32.0) * 5.0 / 9.0 else if exists r.temperatureUnit and r.temperatureUnit == "K" then r.reading - 273.15 else r.reading}))${fluxExpression(CURRENT_REVISION_FLUX)}${fluxExpression(criticalFilter)}
      |> group()`;

    const rawRows = await queryApi.collectRows(flux`${pipeline}
      |> sort(columns: ["_time"], desc: true)
      |> limit(n: ${limit}, offset: ${offset})`);
    const countRows = await queryApi.collectRows(flux`${pipeline}
      |> count(column: "celsius")`);

    const rows = rawRows.map(mapReportRow);
    rows.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return { rows, total: Number(countRows[0]?.celsius ?? 0) };
  }

  async readingById(telemetryReadingId) {
    await influxConnection.connectInfluxDB();
    const queryApi = influxConnection.getInfluxQueryApi();
    const rows = await queryApi.collectRows(flux`from(bucket: ${influxConnection.getInfluxConfig().bucket})
      |> range(start: ${new Date(0)}, stop: ${REPORT_UNBOUNDED_STOP})
      |> filter(fn: (r) => r._measurement == "freezer_temperature" or r._measurement == "temperature")
      |> filter(fn: (r) => r._field == "temperatureValue" or r._field == "value" or r._field == "telemetryReadingId")
      |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
      |> map(fn: (r) => ({r with reading: if exists r.temperatureValue then r.temperatureValue else r.value}))
      |> filter(fn: (r) => exists r.reading)
      |> map(fn: (r) => ({r with celsius: if exists r.temperatureUnit and r.temperatureUnit == "°F" then (r.reading - 32.0) * 5.0 / 9.0 else if exists r.temperatureUnit and r.temperatureUnit == "K" then r.reading - 273.15 else r.reading}))
      |> filter(fn: (r) => r.telemetryReadingId == ${String(telemetryReadingId)})
      |> group()
      |> limit(n: 1)`);
    return rows.length > 0 ? mapReportRow(rows[0]) : null;
  }

  async readingsAtLocation({ storageLocationId, start, stop } = {}) {
    if (storageLocationId === undefined || storageLocationId === null || String(storageLocationId) === '') return [];
    if (!start || !stop || new Date(start).getTime() >= new Date(stop).getTime()) return [];

    await influxConnection.connectInfluxDB();
    const queryApi = influxConnection.getInfluxQueryApi();
    const rawRows = await queryApi.collectRows(flux`from(bucket: ${influxConnection.getInfluxConfig().bucket})
      |> range(start: ${new Date(start)}, stop: ${new Date(stop)})
      |> filter(fn: (r) => r._measurement == "freezer_temperature" or r._measurement == "temperature")
      |> filter(fn: (r) => r._field == "temperatureValue" or r._field == "value" or r._field == "telemetryReadingId")
      |> filter(fn: (r) => r.storageLocationId == ${String(storageLocationId)})
      |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
      |> map(fn: (r) => ({r with reading: if exists r.temperatureValue then r.temperatureValue else r.value}))
      |> filter(fn: (r) => exists r.reading)
      |> map(fn: (r) => ({r with celsius: if exists r.temperatureUnit and r.temperatureUnit == "°F" then (r.reading - 32.0) * 5.0 / 9.0 else if exists r.temperatureUnit and r.temperatureUnit == "K" then r.reading - 273.15 else r.reading}))${fluxExpression(CURRENT_REVISION_FLUX)}
      |> group()
      |> sort(columns: ["_time"])`);

    const rows = rawRows.map(mapReportRow);
    rows.sort((a, b) => (a.timestamp.getTime() - b.timestamp.getTime())
      || String(a.telemetryReadingId ?? '').localeCompare(String(b.telemetryReadingId ?? '')));
    return rows;
  }
}

module.exports = new InfluxTelemetryReadRepository();
