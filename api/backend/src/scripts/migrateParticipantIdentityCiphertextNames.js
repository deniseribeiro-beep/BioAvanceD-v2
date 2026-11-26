/**
 * Migration: `participantIdentities` records still holding a ciphertext under
 * its old `<field>Encrypted` name get it moved to `<field>Ciphertext`, #1386.
 *
 * Every update writer now sets the new name and unsets the old one, but a
 * record no writer has touched since still carries the old name. The decision
 * is docs/decisions/2026-10-17-participant-identity-names-and-fields.md, item
 * 1: writes use the new names, a reader falls back to an old name only where
 * the new one is absent, and this one-off migration moves the rest. The
 * old-name fallbacks (decryptIdentity, the key-rotation rewrite's
 * legacyFields) are removed only once this reports `remaining: 0` on every
 * deployment.
 *
 * Per legacy field present on a record:
 * - the new name absent: the envelope moves to it unchanged (no decrypt, no
 *   re-encrypt, encryptionKeyVersion untouched) and the old name is unset;
 * - the new name present, a null included: the old envelope is stale and is
 *   only unset, so a field a clearing write set to null stays null.
 *
 * Each record is one updateOne guarded on every old envelope's iv still being
 * the one read, and on every new name it sets still being absent. A record a
 * live write changed since it was read fails the filter: it is counted as
 * raced, not retried, and the next run picks it up.
 *
 * Idempotent: a migrated record carries no old name, so the second run finds
 * nothing. `remaining` counts the records still holding one.
 *
 * One-way: no rollback. Where the new name was already present the old
 * envelope is unset, not kept, and a moved envelope cannot be told from one a
 * writer stored under the new name since. Putting the old names back would
 * leave those fields unreadable: decryptIdentity reads only the new names and
 * no reader falls back to the old ones. Undo is restoring
 * participantIdentities from a backup.
 *
 * Usage (from api/backend):
 *   npm run migrate:participant-identity-ciphertext-names               applies
 *   npm run migrate:participant-identity-ciphertext-names -- --dry-run  counts, writes nothing
 */

const { connectDB, closeConnection } = require('../database/mongo');
const participantIdentityService = require('../services/participantIdentity.service');

// [legacy name, new name] for every field the registry still lists an old
// name for.
function namePairs() {
  const fieldMap = participantIdentityService.getEncryptedFieldMap();
  return Object.entries(participantIdentityService.getLegacyCiphertextFieldMap())
    .map(([plainField, legacyField]) => [legacyField, fieldMap[plainField]]);
}

function legacyQuery() {
  return { $or: namePairs().map(([legacyField]) => ({ [legacyField]: { $exists: true } })) };
}

function moveOf(doc) {
  const filter = { _id: doc._id };
  const $set = {};
  const $unset = {};
  for (const [legacyField, newField] of namePairs()) {
    if (doc[legacyField] === undefined) continue;
    if (doc[newField] === undefined) {
      $set[newField] = doc[legacyField];
      filter[newField] = { $exists: false };
    }
    $unset[legacyField] = '';
    // The iv is unique per envelope, so an unchanged iv is an unchanged value.
    filter[`${legacyField}.iv`] = doc[legacyField]?.iv ?? null;
  }
  const update = Object.keys($set).length > 0 ? { $set, $unset } : { $unset };
  return { filter, update };
}

async function migrateParticipantIdentityCiphertextNames(db, { dryRun = false } = {}) {
  const identities = db.collection('participantIdentities');
  const summary = { mode: dryRun ? 'dry-run' : 'apply', candidates: 0, moved: 0, raced: 0 };
  const query = legacyQuery();

  const docs = await identities.find(query).toArray();
  for (const doc of docs) {
    summary.candidates += 1;
    if (dryRun) {
      summary.moved += 1;
      continue;
    }
    const { filter, update } = moveOf(doc);
    const result = await identities.updateOne(filter, update);
    // A live write set a new name, or changed an old envelope, since it was read.
    if (result.matchedCount === 0) summary.raced += 1;
    else summary.moved += 1;
  }

  summary.remaining = await identities.countDocuments(query);
  return summary;
}

async function run(argv = process.argv.slice(2)) {
  const db = await connectDB();
  const summary = await migrateParticipantIdentityCiphertextNames(db, { dryRun: argv.includes('--dry-run') });
  console.log('participantIdentities <field>Encrypted -> <field>Ciphertext:', JSON.stringify(summary, null, 2));
  return summary;
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error('Erro na migração dos nomes de ciphertext de participantIdentities:', error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeConnection();
    });
}

module.exports = { migrateParticipantIdentityCiphertextNames, run };
