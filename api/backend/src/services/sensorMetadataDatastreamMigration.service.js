const { getCollection } = require('../utils/collectionResolver');
const TelemetryDatastreamModel = require('../models/TelemetryDatastream');
const { createDatastream } = require('./telemetryBinding.service');
const { LOCATION_CODE_PREFIX } = require('./legacyPlacementChain.service');

// #1392, RF017 AC5: each SensorMetadata row's binding moved onto a
// temperature TelemetryDatastream (V2E-0562..0571). Additive: sensorMetadata,
// storageContainers and storageLocations are only read, and SensorMetadata
// stays the readers' fallback.
//
// No SensorMetadata field carries a sampling policy (V2E-0568, 1..1), so it
// is the --sampling-policy-id argument, checked as a stored
// ConfigurationProfile. The equipment is the freezer's Equipment
// (containerID === equipmentID), the location is the freezer's mirrored
// location (#1379), and none is created here. A row none of them resolves
// for is listed in unresolved and not written. The decisions are recorded
// in docs/decisions/2026-10-21-sensor-metadata-to-datastream-migration.md.
//
// Idempotent: a sensor with a temperature datastream open or valid now is
// counted in alreadyBound; a second run writes nothing.

const OBSERVED_PROPERTY = 'temperature';
const UNIT = 'Cel';

async function assertStoredSamplingPolicy(db, samplingPolicyId) {
  if (!samplingPolicyId) return null;
  const id = String(samplingPolicyId);
  const profile = await (await getCollection(db, 'configurationProfiles')).findOne({ profileId: id });
  if (!profile) throw new Error(`ConfigurationProfile ${id} não encontrado`);
  return id;
}

// storageContainers is raw: a string and an ObjectId _id both match, and no
// ObjectId is constructed (#912).
async function findContainer(db, containerId) {
  if (containerId === null || containerId === undefined) return null;
  const id = String(containerId);
  const rows = await db.collection('storageContainers')
    .find({ $expr: { $eq: [{ $toString: '$_id' }, id] } })
    .toArray();
  return rows.find((row) => String(row._id) === id) || null;
}

async function isBound(db, sensorId, now) {
  const streams = await (await getCollection(db, 'telemetryDatastreams'))
    .find({ sensorId, observedProperty: OBSERVED_PROPERTY })
    .toArray();
  return streams.some((stream) => !stream.validityPeriod?.end || TelemetryDatastreamModel.validAt(stream, now));
}

async function migrateSensorMetadataToDatastreams(db, { dryRun = false, samplingPolicyId = null, now = new Date() } = {}) {
  const policyId = await assertStoredSamplingPolicy(db, samplingPolicyId);
  if (!policyId && !dryRun) throw new Error('--sampling-policy-id é obrigatório para gravar');
  const summary = {
    mode: dryRun ? 'dry-run' : 'apply',
    samplingPolicyId: policyId,
    scanned: 0,
    created: 0,
    wouldCreate: 0,
    alreadyBound: 0,
    unresolved: [],
  };

  const rows = await db.collection('sensorMetadata').find({}).toArray();
  for (const row of rows) {
    summary.scanned += 1;
    const sensorId = String(row.sensorId);
    if (await isBound(db, sensorId, now)) {
      summary.alreadyBound += 1;
      continue;
    }

    const container = await findContainer(db, row.storageContainer);
    const location = container
      ? await (await getCollection(db, 'storageLocations')).findOne({ code: LOCATION_CODE_PREFIX + String(container._id) })
      : null;
    if (!location) {
      summary.unresolved.push({ sensorId, reason: 'freezer_not_located' });
      continue;
    }
    let equipmentId = null;
    if (container.containerID !== undefined && container.containerID !== null && container.containerID !== '') {
      equipmentId = String(container.containerID);
    } else if (row.equipment) {
      equipmentId = String(row.equipment);
    }
    if (!equipmentId) {
      summary.unresolved.push({ sensorId, reason: 'no_equipment' });
      continue;
    }
    if (!row.temperaturePolicy) {
      summary.unresolved.push({ sensorId, reason: 'no_policy' });
      continue;
    }

    if (dryRun) {
      summary.wouldCreate += 1;
      continue;
    }

    try {
      await createDatastream(db, {
        sensorId,
        equipmentId,
        storageLocationId: String(location.storageLocationId),
        observedProperty: OBSERVED_PROPERTY,
        unit: UNIT,
        samplingPolicyId: policyId,
        thresholdProfileId: String(row.temperaturePolicy),
        validityPeriod: { start: now },
      });
      summary.created += 1;
    } catch (error) {
      if (error.name !== 'TelemetryBindingError') throw error;
      if (error.code === 'DATASTREAM_OVERLAP') summary.alreadyBound += 1;
      else summary.unresolved.push({ sensorId, reason: error.message });
    }
  }
  return summary;
}

module.exports = { migrateSensorMetadataToDatastreams };
