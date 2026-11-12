const { Point } = require('@influxdata/influxdb-client');
const logger = require('../utils/logger');
const {
  connectInfluxDB,
  getInfluxWriteApi,
} = require('../infrastructure/database/influxdb/connection');

// #1317: `identity` is the reading contract's (telemetryReadingContract.js);
// its id is a field, and its clockStatus, datastreamId (V2E-0546) and
// storageLocationId (V2E-0547) tags, on the point.
// #1518 (RNF025 C7, RNF004 C1): the point also keeps the contract's
// sequenceNumber (V2E-0553), receivedAt (V2E-0549), sourceEventId (V2E-0551)
// and payloadHash (V2E-0555) as fields, each only when present, so the
// series holds more than the device clock to order readings by. Fields, not
// tags: a tag per reading would make one series per reading.
async function saveTelemetryPoint(sensorId, temperature, timestamp, identity = null) {
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
    if (identity?.telemetryReadingId) point.stringField('telemetryReadingId', String(identity.telemetryReadingId));
    // intField refuses an integer past 2^63, which the contract accepts; an
    // out-of-range sequenceNumber still writes the point, without the field.
    if (Number.isSafeInteger(identity?.sequenceNumber) && identity.sequenceNumber >= 0) {
      point.intField('sequenceNumber', identity.sequenceNumber);
    }
    if (identity?.receivedAt instanceof Date && !Number.isNaN(identity.receivedAt.getTime())) {
      point.stringField('receivedAt', identity.receivedAt.toISOString());
    }
    if (identity?.sourceEventId) point.stringField('sourceEventId', String(identity.sourceEventId));
    if (identity?.payloadHash) point.stringField('payloadHash', String(identity.payloadHash));
    if (identity?.clockStatus) point.tag('clockStatus', String(identity.clockStatus));
    if (identity?.datastreamId) point.tag('datastreamId', String(identity.datastreamId));
    if (identity?.storageLocationId) point.tag('storageLocationId', String(identity.storageLocationId));

    await connectInfluxDB();
    const writeApi = getInfluxWriteApi({ requestScoped: true });

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