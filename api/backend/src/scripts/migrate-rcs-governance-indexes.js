/**
 * Creates the seven RCS governance indexes by name on their collections.
 *
 * Rollback: it rewrites no stored document; it only creates indexes, and
 * dropping each by its name on its collection (`dropIndex('<name>')`) undoes
 * it. `createIndex` creates a collection that does not exist yet, and
 * `dropIndex` leaves that (empty) collection in place. No rollback script.
 */
const { connectDB, closeConnection } = require('../database/mongo');

async function createIndex(collection, keys, options) {
  await collection.createIndex(keys, options);
  console.log(`[RCS_MIGRATION] ensured ${collection.collectionName}.${options.name}`);
}

async function migrateRcsGovernanceIndexes(db) {
  await createIndex(
    db.collection('rcs_model_versions'),
    { model_code: 1 },
    { unique: true, name: 'uq_rcs_model_versions_model_code' }
  );
  await createIndex(
    db.collection('rcs_sprec_catalog'),
    { model_code: 1, sprec_version: 1, matrix_type: 1, axis_code: 1, sprec_code: 1 },
    { unique: true, name: 'uq_rcs_sprec_catalog_axis_code' }
  );
  await createIndex(
    db.collection('rcs_severity_mappings'),
    { model_code: 1, sprec_version: 1, matrix_type: 1, axis_code: 1, sprec_codes: 1, condition_description: 1 },
    { unique: true, name: 'uq_rcs_severity_mapping_condition' }
  );
  await createIndex(
    db.collection('rcs_axis_weights'),
    { model_code: 1, sprec_version: 1, matrix_type: 1, axis_code: 1 },
    { unique: true, name: 'uq_rcs_axis_weights_axis' }
  );
  await createIndex(
    db.collection('rcs_grade_thresholds'),
    { model_code: 1, sprec_version: 1, grade: 1 },
    { unique: true, name: 'uq_rcs_grade_thresholds_grade' }
  );
  await createIndex(
    db.collection('rcs_governance_rules'),
    { model_code: 1, sprec_version: 1, rule_code: 1 },
    { unique: true, name: 'uq_rcs_governance_rules_rule' }
  );
  await createIndex(
    db.collection('rcs_evaluations'),
    { sample_id: 1, model_version: 1, evaluated_at: -1 },
    { name: 'idx_rcs_evaluations_sample_model_time' }
  );
}

async function main() {
  const db = await connectDB();
  try {
    await migrateRcsGovernanceIndexes(db);
  } finally {
    await closeConnection();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[RCS_MIGRATION] failed:', error?.message || error);
    process.exit(1);
  });
}

module.exports = {
  migrateRcsGovernanceIndexes,
};
