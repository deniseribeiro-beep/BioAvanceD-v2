const { getCollection } = require('../utils/collectionResolver');
const logger = require('../utils/logger');
const TelemetryDatastreamModel = require('../models/TelemetryDatastream');
const { LOCATION_CODE_PREFIX } = require('./legacyPlacementChain.service');

// #1392: a sensor's current TelemetryDatastream, its threshold profile's
// TemperaturePolicy and its freezer, for the readers that took these only
// from SensorMetadata (TelemetryMonitor, the temperature report, the
// cold-chain quarantine). The decisions are recorded in
// docs/decisions/2026-10-21-sensor-readers-from-datastream.md.
//
// Every lookup degrades to "nothing found" on an error, so the caller falls
// back to SensorMetadata: cold-chain availability wins
// (docs/decisions/2026-10-17-telemetry-threshold-from-datastream.md,
// decision 2). The fakes these readers are tested with do not apply
// queries, so each result is filtered again in JS.

// The observed property every ingestion path binds (telemetryReadingContract's
// READING_OBSERVED_PROPERTY).
const TEMPERATURE_PROPERTY = 'temperature';

// The temperature datastream valid at `at` for each sensor, keyed by
// String(sensorId). `null` sensorIds means every sensor.
async function currentDatastreamsBySensor(db, sensorIds = null, at = new Date()) {
  const streamsBySensor = new Map();
  try {
    const ids = sensorIds ? sensorIds.map(String) : null;
    const streams = await (await getCollection(db, 'telemetryDatastreams')).find({
      observedProperty: TEMPERATURE_PROPERTY,
      'validityPeriod.start': { $lte: at },
      ...(ids ? { sensorId: { $in: ids } } : {}),
    }).toArray();
    for (const stream of streams) {
      if (!stream?.sensorId || stream.observedProperty !== TEMPERATURE_PROPERTY) continue;
      if (ids && !ids.includes(String(stream.sensorId))) continue;
      if (!TelemetryDatastreamModel.validAt(stream, at)) continue;
      // Two valid rows can only be written past createDatastream's overlap
      // check (a migration). The first is kept, as resolveReadingBinding
      // keeps it, so these readers and ingestion agree.
      if (!streamsBySensor.has(String(stream.sensorId))) streamsBySensor.set(String(stream.sensorId), stream);
    }
  } catch (error) {
    logger.warn('[ISO20387][IOT] Não foi possível consultar TelemetryDatastream; vale SensorMetadata', { error: error.message });
    return new Map();
  }
  return streamsBySensor;
}

// The temperaturePolicies documents the given threshold profiles name, keyed
// by String(_id). `_id` is compared through $toString, as buildSensorLookup
// compares it (#912), so no ObjectId is built from either driver's bson
// (#651).
async function policiesByProfileId(db, profileIds = []) {
  const ids = [...new Set((profileIds || [])
    .filter((id) => id !== undefined && id !== null && String(id) !== '')
    .map(String))];
  if (ids.length === 0) return new Map();
  try {
    const policies = await db.collection('temperaturePolicies')
      .find({ $expr: { $in: [{ $toString: '$_id' }, ids] } })
      .toArray();
    return new Map(policies
      .filter((policy) => policy && ids.includes(String(policy._id)))
      .map((policy) => [String(policy._id), policy]));
  } catch (error) {
    logger.warn('[ISO20387][IOT] Não foi possível consultar as políticas dos TelemetryDatastreams; vale SensorMetadata', { error: error.message });
    return new Map();
  }
}

// The stored `_id` of the FREEZER StorageContainer whose mirrored
// StorageLocation (code `legacy-storage-container:<_id>`, #1379) is
// `storageLocationId`, or null. The `_id` is returned as read, so the
// parent_id walk matches its own type; no ObjectId is built (#651, #912).
async function freezerContainerIdOf(db, storageLocationId) {
  if (storageLocationId === undefined || storageLocationId === null || storageLocationId === '') return null;
  try {
    const location = await (await getCollection(db, 'storageLocations')).findOne({ storageLocationId: String(storageLocationId) });
    const code = location?.code;
    if (typeof code !== 'string' || !code.startsWith(LOCATION_CODE_PREFIX)) return null;
    const rest = code.slice(LOCATION_CODE_PREFIX.length);
    if (!rest) return null;
    const containers = await db.collection('storageContainers').find({
      containerType: 'FREEZER',
      $expr: { $eq: [{ $toString: '$_id' }, rest] },
    }).toArray();
    const freezer = containers.find((container) => container && String(container._id) === rest && container.containerType === 'FREEZER');
    return freezer ? freezer._id : null;
  } catch (error) {
    logger.warn('[ISO20387][IOT] Não foi possível resolver o freezer do TelemetryDatastream', { storageLocationId: String(storageLocationId), error: error.message });
    return null;
  }
}

module.exports = {
  TEMPERATURE_PROPERTY,
  currentDatastreamsBySensor,
  policiesByProfileId,
  freezerContainerIdOf,
};
