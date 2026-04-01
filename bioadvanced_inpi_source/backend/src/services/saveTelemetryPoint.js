const { Point } = require('@influxdata/influxdb-client');
const logger = require('../utils/logger');
const {
  connectInfluxDB,
  getInfluxWriteApi,
} = require('../infrastructure/database/influxdb/connection');

async function saveTelemetryPoint(sensorId, temperature, timestamp) {
  try {
    if (sensorId === undefined || sensorId === null || sensorId === '') {
      throw new Error('sensorId é obrigatório');
    }

    const numericTemperature = Number(temperature);
    if (!Number.isFinite(numericTemperature)) {
      throw new Error('temperature deve ser numérica');
    }

    const point = new Point('temperature')
      .tag('sensorId', String(sensorId))
      .floatField('value', numericTemperature)
      .timestamp(timestamp ? new Date(timestamp) : new Date());

    await connectInfluxDB();
    const writeApi = getInfluxWriteApi();

    writeApi.writePoint(point);
    await writeApi.flush();

    return true;
  } catch (error) {
    logger.error(`[ISO20387][INFLUXDB][TELEMETRY] Falha ao gravar ponto de telemetria: ${error.message || error}`);
    throw error;
  }
}

module.exports = {
  saveTelemetryPoint,
};