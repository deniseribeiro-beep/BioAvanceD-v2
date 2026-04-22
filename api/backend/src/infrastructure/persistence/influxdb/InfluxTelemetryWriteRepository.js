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

    point.timestamp(reading.timestamp ? new Date(reading.timestamp) : new Date());
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
