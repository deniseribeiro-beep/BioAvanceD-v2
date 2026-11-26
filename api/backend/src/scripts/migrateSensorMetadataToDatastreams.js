/**
 * Migration: each SensorMetadata row's binding moved onto a temperature
 * TelemetryDatastream (#1392, RF017 AC5; V2E-0562..0571).
 *
 * One datastream per sensor (observedProperty `temperature`, unit `Cel`),
 * valid from the run: equipmentId is the freezer's Equipment (its
 * containerID, else the row's equipment), storageLocationId is the freezer's
 * mirrored location (`legacy-storage-container:<_id>`), thresholdProfileId
 * is the row's temperaturePolicy, and samplingPolicyId is
 * --sampling-policy-id. A row whose freezer has no location, or with no
 * equipment or no policy, is listed in unresolved and not written; no
 * location is created. sensorMetadata, storageContainers and
 * storageLocations are only read, so SensorMetadata stays the readers'
 * fallback. The rule is
 * docs/decisions/2026-10-21-sensor-metadata-to-datastream-migration.md.
 *
 * Idempotent: a sensor with a temperature datastream open or valid now is
 * counted in alreadyBound, so a second run writes nothing.
 *
 * One-way: no rollback. The datastreams it creates carry no field marking
 * this run apart from those bound since (they share the run instant as
 * validityPeriod.start, which the run does not print), and telemetry
 * readings written since carry their telemetryDatastreamId, so deleting the
 * datastreams would orphan those readings. sensorMetadata, storageContainers
 * and storageLocations are only read, so SensorMetadata stays the readers'
 * fallback. Undo is restoring the datastream collection from a backup.
 *
 * Usage (from api/backend):
 *   npm run migrate:sensor-metadata-to-datastreams -- --sampling-policy-id <profileId>
 *     applies; the sampling policy must be a stored ConfigurationProfile
 *     profileId, else nothing is written
 *   npm run migrate:sensor-metadata-to-datastreams -- --dry-run             counts, writes nothing
 */

const { connectDB, closeConnection } = require('../database/mongo');
const { migrateSensorMetadataToDatastreams } = require('../services/sensorMetadataDatastreamMigration.service');

function samplingPolicyIdArg(argv) {
  const index = argv.indexOf('--sampling-policy-id');
  if (index === -1) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error('--sampling-policy-id requer um valor');
  return value;
}

async function run(argv = process.argv.slice(2)) {
  const dryRun = argv.includes('--dry-run');
  const samplingPolicyId = samplingPolicyIdArg(argv);
  const db = await connectDB();
  const summary = await migrateSensorMetadataToDatastreams(db, { dryRun, samplingPolicyId });
  console.log(`SensorMetadata -> TelemetryDatastream (${summary.mode}):`, JSON.stringify(summary, null, 2));
  return summary;
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error('Erro na migração SensorMetadata -> TelemetryDatastream:', error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeConnection();
    });
}

module.exports = { run };
