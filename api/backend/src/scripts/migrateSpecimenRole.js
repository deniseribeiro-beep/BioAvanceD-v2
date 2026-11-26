/**
 * Migration: every stored sample gets its specimenRole (ELM-0121, #1201).
 *
 * specimenRole is 1..1 Core, and every create writes it since #1201; a
 * sample stored before has none. Per document:
 *
 * - a role that, trimmed and lower-cased, is one of SPECIMEN_ROLE_VALUES:
 *   unchanged, whatever its stored case.
 * - no role (absent, null or empty): the default a create would have given
 *   it, SampleModel.resolveSpecimenRole (derivative with parentSpecimenIds,
 *   else primary), the rule of docs/decisions/2026-10-13-specimen-role.md.
 * - any other value: not written, and listed in the summary's invalid for a
 *   person to correct.
 *
 * Idempotent: a filled document holds one of the five values, so a second
 * run writes nothing.
 *
 * One-way: no rollback. The run writes the default a create would have given
 * (SampleModel.resolveSpecimenRole), so a filled sample cannot be told from
 * one created since, and specimenRole is 1..1 Core, so unsetting it would
 * leave the sample invalid. Undo is restoring samples from a backup.
 *
 * Usage (from api/backend):
 *   npm run migrate:specimen-role               applies
 *   npm run migrate:specimen-role -- --dry-run  counts, writes nothing
 */

const { connectDB, closeConnection } = require('../database/mongo');
const { getCollection } = require('../utils/collectionResolver');
const { SampleModel, SPECIMEN_ROLE_VALUES } = require('../models/Sample');

async function migrateSpecimenRole(db, { dryRun = false } = {}) {
  const samples = await getCollection(db, 'samples');
  const summary = {
    mode: dryRun ? 'dry-run' : 'apply',
    scanned: 0,
    unchanged: 0,
    primary: 0,
    derivative: 0,
    invalid: [],
  };

  const docs = await samples.find({}).toArray();
  for (const doc of docs) {
    summary.scanned += 1;
    const stored = String(doc.specimenRole ?? '').trim().toLowerCase();
    if (SPECIMEN_ROLE_VALUES.includes(stored)) {
      summary.unchanged += 1;
      continue;
    }
    if (stored !== '') {
      summary.invalid.push(doc.specimenId || String(doc._id));
      continue;
    }

    const specimenRole = SampleModel.resolveSpecimenRole(doc);
    summary[specimenRole] += 1;
    if (dryRun) continue;
    // Conditioned on the value read, so a concurrent write is not
    // overwritten; a null filter also matches an absent field.
    await samples.updateOne(
      { _id: doc._id, specimenRole: doc.specimenRole ?? null },
      { $set: { specimenRole } },
    );
  }

  return summary;
}

async function run(argv = process.argv.slice(2)) {
  const db = await connectDB();
  const summary = await migrateSpecimenRole(db, { dryRun: argv.includes('--dry-run') });
  console.log('specimenRole backfill:', JSON.stringify(summary, null, 2));
  return summary;
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error('Erro na migração specimenRole:', error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeConnection();
    });
}

module.exports = { migrateSpecimenRole, run };
