/**
 * Migration: Sample.organizationId from Sample.collectionSite (#1192).
 *
 * collectionSite (ELM-0128) was both the collection site and the tenancy
 * key. organizationId now carries the tenancy key on its own (see
 * docs/decisions/2026-10-11-sample-tenancy.md), and until this has run the
 * readers fall back to collectionSite (services/sampleTenancy.service.js).
 * Per document:
 *
 * - organizationId null, missing or empty, collectionSite non-empty:
 *   organizationId is set to collectionSite.
 * - organizationId already set: unchanged.
 * - no collectionSite: unchanged, and counted; such a sample is in no
 *   organization's scope before or after.
 *
 * Writes no other field. Idempotent: a backfilled document has an
 * organizationId, so a second run changes nothing.
 *
 * One-way: no rollback. The run sets organizationId equal to collectionSite
 * where it was null, missing or empty, and which of the three it was is not
 * recorded; samples created since carry an organizationId too, so this run's
 * writes cannot be told apart. Nothing needs it undone: collectionSite is
 * never changed, and the readers fell back to it before the run. Undo is
 * restoring samples from a backup.
 *
 * Usage (from api/backend):
 *   npm run migrate:sample-organization               applies
 *   npm run migrate:sample-organization -- --dry-run  counts, writes nothing
 */

const { connectDB, closeConnection } = require('../database/mongo');
const { getCollection } = require('../utils/collectionResolver');

function isPresent(value) {
  return value !== undefined && value !== null && value !== '';
}

async function migrateSampleOrganization(db, { dryRun = false } = {}) {
  const samples = await getCollection(db, 'samples');
  const summary = {
    mode: dryRun ? 'dry-run' : 'apply',
    scanned: 0,
    backfilled: 0,
    alreadySet: 0,
    noCollectionSite: 0,
  };

  const docs = await samples.find({}).toArray();
  for (const doc of docs) {
    summary.scanned += 1;
    if (isPresent(doc.organizationId)) {
      summary.alreadySet += 1;
      continue;
    }
    if (!isPresent(doc.collectionSite)) {
      summary.noCollectionSite += 1;
      continue;
    }
    if (dryRun) {
      summary.backfilled += 1;
      continue;
    }
    // Conditioned on the values read, so a concurrent write is not
    // overwritten; the next run picks the document up again.
    const result = await samples.updateOne(
      { _id: doc._id, organizationId: { $in: [null, ''] }, collectionSite: doc.collectionSite },
      { $set: { organizationId: String(doc.collectionSite) } },
    );
    if (result && result.matchedCount > 0) summary.backfilled += 1;
  }

  return summary;
}

async function run(argv = process.argv.slice(2)) {
  const db = await connectDB();
  const summary = await migrateSampleOrganization(db, { dryRun: argv.includes('--dry-run') });
  console.log('Sample.organizationId from collectionSite:', JSON.stringify(summary, null, 2));
  return summary;
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error('Erro na migração Sample.organizationId:', error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeConnection();
    });
}

module.exports = { migrateSampleOrganization, run };
