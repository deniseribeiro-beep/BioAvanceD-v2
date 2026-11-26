/**
 * Migration: `participantIdentities` records missing their own id or their
 * status get them: P1X-0348 participantIdentityId (a fresh uuid) and P1X-0361
 * identityStatus ('active'), #1386.
 *
 * Every insert now writes both (ParticipantIdentityModel.create, and the
 * upsert writers' $setOnInsert), but a record inserted before that carries
 * neither. The decision to build both is
 * docs/decisions/2026-10-17-participant-identity-names-and-fields.md, items
 * 2 and 3.
 *
 * Only a null or absent value is set: an id already assigned is kept, and a
 * status already set (merged, restricted, inactive) is never reset to
 * 'active'. Each record is one updateOne guarded on the fields it sets still
 * being null or absent. A record a live write changed since it was read fails
 * the filter: it is counted as raced, not retried, and the next run picks it
 * up.
 *
 * Idempotent: a migrated record carries both fields, so the second run finds
 * nothing. `remaining` counts the records still missing one.
 *
 * One-way: no rollback. The participantIdentityId it assigns is a fresh random
 * uuid and the identityStatus is 'active'; records inserted since carry the
 * same two fields from ParticipantIdentityModel.create, so this run's writes
 * cannot be told apart. Undo is restoring participantIdentities from a backup.
 *
 * Usage (from api/backend):
 *   npm run migrate:participant-identity-ids               applies
 *   npm run migrate:participant-identity-ids -- --dry-run  counts, writes nothing
 */

const crypto = require('crypto');
const { connectDB, closeConnection } = require('../database/mongo');

// In MongoDB, `null` matches a null value and an absent field alike.
const MISSING_QUERY = { $or: [{ participantIdentityId: null }, { identityStatus: null }] };

function missing(value) {
  return value === null || value === undefined;
}

function assignmentOf(doc) {
  const $set = {};
  const filter = { _id: doc._id };
  if (missing(doc.participantIdentityId)) {
    $set.participantIdentityId = crypto.randomUUID();
    filter.participantIdentityId = null;
  }
  if (missing(doc.identityStatus)) {
    $set.identityStatus = 'active';
    filter.identityStatus = null;
  }
  return { filter, update: { $set } };
}

async function migrateParticipantIdentityIds(db, { dryRun = false } = {}) {
  const identities = db.collection('participantIdentities');
  const summary = { mode: dryRun ? 'dry-run' : 'apply', scanned: 0, assigned: 0, raced: 0 };

  const docs = await identities.find(MISSING_QUERY).toArray();
  for (const doc of docs) {
    summary.scanned += 1;
    if (dryRun) {
      summary.assigned += 1;
      continue;
    }
    const { filter, update } = assignmentOf(doc);
    const result = await identities.updateOne(filter, update);
    // A live write set the field, or changed the record, since it was read.
    if (result.matchedCount === 0) summary.raced += 1;
    else summary.assigned += 1;
  }

  summary.remaining = await identities.countDocuments(MISSING_QUERY);
  return summary;
}

async function run(argv = process.argv.slice(2)) {
  const db = await connectDB();
  const summary = await migrateParticipantIdentityIds(db, { dryRun: argv.includes('--dry-run') });
  console.log('participantIdentities participantIdentityId/identityStatus:', JSON.stringify(summary, null, 2));
  return summary;
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error('Erro na migração de participantIdentityId/identityStatus:', error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeConnection();
    });
}

module.exports = { migrateParticipantIdentityIds, run };
