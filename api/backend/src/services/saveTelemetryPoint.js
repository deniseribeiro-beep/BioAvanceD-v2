const { Point } = require('@influxdata/influxdb-client');
const logger = require('../utils/logger');
const {
  connectInfluxDB,
  getInfluxConfig,
  getInfluxQueryApi,
  getInfluxWriteApi,
} = require('../infrastructure/database/influxdb/connection');
const { storedPointsAt, revisionPlan } = require('../infrastructure/persistence/influxdb/telemetryRevisions');

// #1317: `identity` is the reading contract's (telemetryReadingContract.js);
// its id is a field, and its clockStatus, datastreamId (V2E-0546) and
// storageLocationId (V2E-0547) tags, on the point.
// #1518 (RNF025 C7, RNF004 C1): the point also keeps the contract's
// sequenceNumber (V2E-0553), receivedAt (V2E-0549), sourceEventId (V2E-0551)
// and payloadHash (V2E-0555) as fields, each only when present, so the
// series holds more than the device clock to order readings by. Fields, not
// tags: a tag per reading would make one series per reading.
//
// #1518 (RNF025 C8): a late correction never overwrites the history.
// InfluxDB keys a point by measurement, tag set and time, so a second
// reading of the same sensor at the same observedAt and tags would replace
// the first one's value and fields. Before writing, the points already
// stored for the sensor at that time are read. With none, the point is
// written as before. With some, it is a correction: it gets a `revision` tag
// one past the highest stored (an untagged point is revision 0), which puts
// it in its own series beside the original, and a
// supersedesTelemetryReadingId field naming the reading it corrects.
// `[inference]` the append-and-supersede shape the consent history already
// uses (supersedesConsentId). A tag only on corrections, so an ordinary
// reading opens no series. A failed lookup throws, so the route answers 503
// and the device keeps the reading for its retry: nothing is written blind.
// A stored point with the reading's payloadHash (an identical resend, which
// may carry no sourceEventId of its own) or its own sourceEventId is no
// correction but a retry of a reading already written: it is written again
// into that point's series, as before, so a retry adds no revision
// (telemetryRevisions.js, revisionPlan).
// `[inference]` two corrections of one time sent concurrently can read the
// same revisions; a device's edge buffer sends one reading at a time.

async function saveTelemetryPoint(sensorId, temperature, timestamp, identity = null) {
  try {
    if (sensorId === undefined || sensorId === null || sensorId === '') {
      throw new Error('sensorId é obrigatório');
    }

    const numericTemperature = Number(temperature);
    if (!Number.isFinite(numericTemperature)) {
      throw new Error('temperature deve ser numérica');
    }

    const time = timestamp ? new Date(timestamp) : new Date();
    const point = new Point('temperature')
      .tag('sensorId', String(sensorId))
      .floatField('value', numericTemperature)
      .timestamp(time);
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

    const stored = await storedPointsAt(getInfluxQueryApi(), getInfluxConfig().bucket, {
      measurement: 'temperature',
      valueField: 'value',
      sensorId: String(sensorId),
      time,
    });
    const plan = revisionPlan(stored, identity || {});
    if (plan.revision !== null) point.tag('revision', plan.revision);
    if (plan.supersedesTelemetryReadingId !== null) {
      point.stringField('supersedesTelemetryReadingId', plan.supersedesTelemetryReadingId);
    }

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