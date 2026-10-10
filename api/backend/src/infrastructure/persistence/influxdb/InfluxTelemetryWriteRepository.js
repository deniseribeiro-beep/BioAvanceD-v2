const { Point } = require('@influxdata/influxdb-client');
const logger = require('../../../utils/logger');
const {
  connectInfluxDB,
  getInfluxWriteApi
} = require('../../database/influxdb/connection');

class InfluxTelemetryWriteRepository {
  constructor() {
    this.buffer = [];
    this.flushTimer = null;
    this.writeApi = null;
    this.flushing = false;
    this.maxBatchSize = 200;
    this.flushIntervalMs = 1000;
  }

  enqueueTemperatureReading(reading) {
    if (!reading || reading.temperatureValue === undefined || reading.temperatureValue === null) {
      return;
    }

    this.buffer.push({ ...reading });

    if (this.buffer.length >= this.maxBatchSize) {
      void this.flush();
      return;
    }

    this.scheduleFlush();
  }

  // RF009 AC1, RNF016 C3 (#1317): InfluxDB is the reading's authority, so a
  // reading is acknowledged only after its point is written. This awaits the
  // write and throws on failure; the caller stores nothing and answers 503.
  async writeTemperatureReadingNow(reading) {
    const writeApi = await this.ensureWriteApi();
    writeApi.writePoint(this.toPoint(reading));
    await writeApi.flush();
    return new Date();
  }

  scheduleFlush() {
    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, this.flushIntervalMs);
  }

  async ensureWriteApi() {
    if (this.writeApi) {
      return this.writeApi;
    }

    await connectInfluxDB();
    this.writeApi = getInfluxWriteApi();
    return this.writeApi;
  }

  toPoint(reading) {
    const point = new Point('freezer_temperature')
      .floatField('temperatureValue', Number(reading.temperatureValue));

    if (reading.sensorId || reading.sensorID) {
      point.tag('sensorId', String(reading.sensorId || reading.sensorID));
    }

    if (reading.locationId) {
      point.tag('locationId', String(reading.locationId));
    }

    if (reading.facility) {
      point.tag('facility', String(reading.facility));
    }

    if (reading.zone) {
      point.tag('zone', String(reading.zone));
    }

    if (reading.temperatureUnit) {
      point.tag('temperatureUnit', String(reading.temperatureUnit));
    }

    if (reading.signalQuality) {
      point.stringField('signalQuality', String(reading.signalQuality));
    }

    if (reading.batteryLevel !== undefined && reading.batteryLevel !== null && Number.isFinite(Number(reading.batteryLevel))) {
      point.intField('batteryLevel', Number(reading.batteryLevel));
    }

    // #1317: a reading's time is its observedAt (V2E-0548), the validated
    // timestamp; a reading from before the contract has only `timestamp`.
    if (reading.telemetryReadingId) {
      point.stringField('telemetryReadingId', String(reading.telemetryReadingId));
    }
    if (reading.clockStatus) {
      point.tag('clockStatus', String(reading.clockStatus));
    }

    const observedAt = reading.observedAt || reading.timestamp;
    point.timestamp(observedAt ? new Date(observedAt) : new Date());
    return point;
  }

  async flush() {
    if (this.flushing || this.buffer.length === 0) {
      return;
    }

    this.flushing = true;
    const batch = this.buffer.splice(0, this.maxBatchSize);

    try {
      const writeApi = await this.ensureWriteApi();
      const points = batch.map((reading) => this.toPoint(reading));
      writeApi.writePoints(points);
      await writeApi.flush();
    } catch (error) {
      logger.error('[ISO20387][INFLUXDB] Falha ao persistir lote de telemetria:', error.message || error);
      this.buffer.unshift(...batch);
    } finally {
      this.flushing = false;

      if (this.buffer.length > 0) {
        this.scheduleFlush();
      }
    }
  }
}

module.exports = new InfluxTelemetryWriteRepository();
