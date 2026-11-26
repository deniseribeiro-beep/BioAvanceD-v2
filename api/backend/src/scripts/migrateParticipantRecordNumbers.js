/**
 * Migration: a hospital record number still stored in plaintext on
 * `patients.recordNumber` moves onto the participant's identity as
 * recordNumberCiphertext and recordNumberHash (P1X-0355), #1386.
 *
 * Every writer now stores the number enciphered on `participantIdentities`
 * and unsets the Patient copy, but a record no writer has touched since still
 * carries the plaintext on Patient. The decision is
 * docs/decisions/2026-10-17-participant-identity-names-and-fields.md, item 6:
 * the readers (the conflict check, the search, the import lookup, batch
 * linkage and the by-barcode read) match the identity first and fall back to
 * `patients.recordNumber`. Those fallbacks, and the
 * `patients_record_number_idx_v1` index, are removed only once this reports
 * `remaining: 0` on every deployment.
 *
 * Per Patient carrying the field, by the bucket it is counted in:
 * - cleared: the stored number is null or empty, so there is nothing to move
 *   and the Patient field is only unset;
 * - noIdentity: the participant has no identity record, and nothing is
 *   written. `npm run migrate:participant-identities` creates the identities;
 *   run it first, then run this again;
 * - moved: the identity got the number as recordNumberCiphertext,
 *   recordNumberHash and encryptionKeyVersion, and the Patient copy was
 *   unset. Where the identity already holds the number (recordNumberCiphertext
 *   or recordNumber present, a null included), the identity is authoritative:
 *   it is never overwritten and only the Patient copy is unset, so a number a
 *   clearing write set to null stays null. A number the identity holds counts
 *   as the Patient's only where it is the same number (recordNumberHash among
 *   the Patient number's blind-index candidates, or the deciphered or keyless
 *   plaintext equal to it);
 * - conflict: the identity holds a different number from the Patient's (two
 *   Patients sharing one participantId, say). Nothing is written and the
 *   Patient copy stays, so no number is ever dropped; its _id and
 *   participantId are logged, never the number, and a person resolves it;
 * - raced: a guarded update matched nothing, because a live write gave the
 *   identity a recordNumberCiphertext, or changed the Patient's number, since
 *   it was read. Not retried; the Patient is left as it is and the next run
 *   picks it up.
 *
 * The identity update is guarded on recordNumberCiphertext still being
 * absent, and the Patient unset on recordNumber still being the value read.
 *
 * Applying it needs ENCRYPTION_KEY: it throws before its first write rather
 * than store the number in plaintext on the identity. A dry run counts
 * without a key.
 *
 * Idempotent: a migrated Patient carries no recordNumber, so the second run
 * finds nothing. `remaining` counts the Patients still holding one.
 *
 * One-way: no rollback. It unsets the plaintext `patients.recordNumber` once
 * the number is enciphered on the identity, or already held there; writing it
 * back would store a personal identifier in plaintext again, which is what the
 * move removes, and a moved number cannot be told from one a writer enciphered
 * since. Where the stored number is null or empty (cleared), or the identity's
 * number was set to null, the Patient field is unset with the number enciphered
 * nowhere, so that value is dropped. Undo is restoring patients and
 * participantIdentities from a backup.
 *
 * Usage (from api/backend):
 *   npm run migrate:participant-record-numbers               applies
 *   npm run migrate:participant-record-numbers -- --dry-run  counts, writes nothing
 */

const { connectDB, closeConnection } = require('../database/mongo');
const participantIdentityService = require('../services/participantIdentity.service');
const { assertFieldEncryptionConfigured, decryptValue } = require('../utils/fieldEncryption');

const LEGACY_QUERY = { recordNumber: { $exists: true } };

function holdsRecordNumber(identity) {
  return identity.recordNumberCiphertext !== undefined || identity.recordNumber !== undefined;
}

// Whether the identity holds the normalized number `value`. An identity whose
// number a clearing write set to null holds none, and matches every value.
function holdsSameRecordNumber(identity, value) {
  if (identity.recordNumberHash) {
    const candidates = participantIdentityService.computeBlindIndexCandidates('recordNumber', value);
    if (candidates.length > 0) return candidates.includes(identity.recordNumberHash);
  }
  if (identity.recordNumberCiphertext) {
    let deciphered = null;
    try {
      deciphered = decryptValue(identity.recordNumberCiphertext);
    } catch {
      deciphered = null;
    }
    // A ciphertext that cannot be read here is not known to be the same.
    return participantIdentityService.normalizeRecordNumber(deciphered) === value;
  }
  if (identity.recordNumberHash) return false;
  const plaintext = participantIdentityService.normalizeRecordNumber(identity.recordNumber);
  return plaintext === null || plaintext === value;
}

// The identity's share of encryptIdentityFields' output: its nulled plaintext
// recordNumber is left out.
function encryptedRecordNumber(value) {
  assertFieldEncryptionConfigured(value);
  const { recordNumberCiphertext, recordNumberHash, encryptionKeyVersion } =
    participantIdentityService.encryptIdentityFields({ recordNumber: value });
  if (!recordNumberCiphertext) {
    throw new Error('ENCRYPTION_KEY nao configurada: o numero de prontuario nao pode ser cifrado (#1386).');
  }
  return { recordNumberCiphertext, recordNumberHash, encryptionKeyVersion };
}

async function migrateParticipantRecordNumbers(db, { dryRun = false } = {}) {
  const patients = db.collection('patients');
  const identities = db.collection('participantIdentities');
  const summary = {
    mode: dryRun ? 'dry-run' : 'apply',
    candidates: 0,
    moved: 0,
    cleared: 0,
    noIdentity: 0,
    conflict: 0,
    raced: 0,
  };

  const docs = await patients.find(LEGACY_QUERY).toArray();

  // Fail closed before the first write, a Patient unset included.
  if (!dryRun) {
    const first = docs.find((doc) => participantIdentityService.normalizeRecordNumber(doc.recordNumber) !== null);
    if (first) encryptedRecordNumber(participantIdentityService.normalizeRecordNumber(first.recordNumber));
  }

  const unsetPatient = async (patient) => {
    const result = await patients.updateOne(
      { _id: patient._id, recordNumber: patient.recordNumber },
      { $unset: { recordNumber: '' } },
    );
    return result.matchedCount > 0;
  };

  for (const patient of docs) {
    summary.candidates += 1;
    const value = participantIdentityService.normalizeRecordNumber(patient.recordNumber);

    if (value === null) {
      if (dryRun || await unsetPatient(patient)) summary.cleared += 1;
      else summary.raced += 1;
      continue;
    }

    const identity = await identities.findOne({ participantId: patient.participantId });
    if (!identity) {
      summary.noIdentity += 1;
      continue;
    }

    if (holdsRecordNumber(identity) && !holdsSameRecordNumber(identity, value)) {
      summary.conflict += 1;
      console.warn(
        `[migrate:participant-record-numbers] conflito: patient ${patient._id} (participantId ${patient.participantId}) `
          + 'tem um numero de prontuario diferente do da identidade; mantido no paciente para revisao.',
      );
      continue;
    }

    if (dryRun) {
      summary.moved += 1;
      continue;
    }

    if (!holdsRecordNumber(identity)) {
      const result = await identities.updateOne(
        { _id: identity._id, recordNumberCiphertext: { $exists: false } },
        { $set: encryptedRecordNumber(value) },
      );
      // A live write gave the identity the number since it was read.
      if (result.matchedCount === 0) {
        summary.raced += 1;
        continue;
      }
    }

    if (await unsetPatient(patient)) summary.moved += 1;
    else summary.raced += 1;
  }

  summary.remaining = await patients.countDocuments(LEGACY_QUERY);
  return summary;
}

async function run(argv = process.argv.slice(2)) {
  const db = await connectDB();
  const summary = await migrateParticipantRecordNumbers(db, { dryRun: argv.includes('--dry-run') });
  console.log('patients.recordNumber -> participantIdentities.recordNumberCiphertext:', JSON.stringify(summary, null, 2));
  return summary;
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error('Erro na migração do número de prontuário para participantIdentities:', error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeConnection();
    });
}

module.exports = { migrateParticipantRecordNumbers, run };
