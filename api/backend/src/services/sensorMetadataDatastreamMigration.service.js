const { getCollection } = require('../utils/collectionResolver');
const TelemetryDatastreamModel = require('../models/TelemetryDatastream');
const { createDatastream } = require('./telemetryBinding.service');
const { resolveTemperatureBinding, assertStoredSamplingPolicy } = require('./sensorDatastream.service');

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

    const binding = await resolveTemperatureBinding(db, row);
    if (!binding.ok) {
      summary.unresolved.push({ sensorId, reason: binding.reason });
      continue;
    }

    if (dryRun) {
      summary.wouldCreate += 1;
      continue;
    }

    try {
      await createDatastream(db, {
        sensorId,
        equipmentId: binding.equipmentId,
        storageLocationId: binding.storageLocationId,
        observedProperty: OBSERVED_PROPERTY,
        unit: UNIT,
        samplingPolicyId: policyId,
        thresholdProfileId: binding.thresholdProfileId,
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
