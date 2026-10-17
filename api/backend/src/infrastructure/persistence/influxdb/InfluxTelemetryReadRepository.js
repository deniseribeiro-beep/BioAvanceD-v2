const influxConnection = require('../../database/influxdb/connection');

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
}

module.exports = new InfluxTelemetryReadRepository();
