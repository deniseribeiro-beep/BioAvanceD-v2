/**
 * Migration: a birth date on `participantIdentities` stored at a midnight
 * instant is rewritten to 12:00:00.000 UTC of its calendar day, and its
 * blind index (birthDateHash) is recomputed, #1412.
 *
 * Writers stored an ISO YYYY-MM-DD birth date at UTC midnight and a
 * DD/MM/YYYY one (#1411) at host-local midnight, so on a UTC-minus host
 * (Brazil) the first was hashed, searched and shown as the day before. Every
 * writer now stores noon UTC (encryptIdentityFields, utils/birthDate.js). The
 * decision is docs/decisions/2026-10-28-birth-date-noon-utc.md; this is owed
 * once on every deployment.
 *
 * The calendar day of a stored value is read by calendarDayOf: a noon-UTC
 * instant is its UTC day, a host-local midnight is its local day, and any
 * other instant (a legacy UTC midnight among them) is its UTC day.
 *
 * Per identity holding a birth date, by the bucket it is counted in:
 * - legacyName: the date is only under the old birthDateEncrypted name, and
 *   nothing is written. `npm run migrate:participant-identity-ciphertext-names`
 *   renames it; run that first, then run this again;
 * - unreadable: the ciphertext cannot be deciphered here, or the stored value
 *   is no date. Nothing is written; its _id and participantId are logged,
 *   never the date, and a person resolves it;
 * - unchanged: the stored instant is already noon UTC of its day and, for a
 *   ciphertext, birthDateHash is that day's blind index under the active key;
 * - migrated: birthDateCiphertext, birthDateHash and encryptionKeyVersion
 *   were rewritten from the noon value, or, on a keyless stack (#1083), the
 *   plaintext birthDate was;
 * - raced: a guarded update matched nothing, because a live write changed the
 *   date since it was read. Not retried; the next run picks it up.
 *
 * A ciphertext update is guarded on the iv read (`birthDateCiphertext.iv`),
 * a plaintext one on the birthDate read.
 *
 * Applying it to a ciphertext needs ENCRYPTION_KEY: it throws before its first
 * write rather than store the date in plaintext. A dry run counts what it
 * would migrate under `migrated` and writes nothing.
 *
 * Idempotent: a second run reports `migrated: 0`. `remaining` counts the
 * identities left for a person or a rerun (legacyName + unreadable + raced).
 *
 * One-way: no rollback. It overwrites the stored instant with noon UTC of the
 * day, and a ciphertext's birthDateHash with that day's blind index (also where
 * only the hash differed, after a key change); a keyless stack's plaintext
 * birthDate is overwritten and no hash. The old instant, whatever it was, is
 * not kept, and putting a midnight back would bring back the day-before
 * reading the migration fixes (#1412). Undo is restoring participantIdentities
 * from a backup.
 *
 * Usage (from api/backend):
 *   npm run migrate:participant-birth-dates               applies
 *   npm run migrate:participant-birth-dates -- --dry-run  counts, writes nothing
 */

const { connectDB, closeConnection } = require('../database/mongo');
const participantIdentityService = require('../services/participantIdentity.service');
const { assertFieldEncryptionConfigured, decryptValue } = require('../utils/fieldEncryption');
const { parseBirthDateDay } = require('../utils/birthDate');

const CANDIDATE_QUERY = {
  $or: [
    { birthDateCiphertext: { $exists: true, $ne: null } },
    { birthDate: { $exists: true, $ne: null } },
    { birthDateEncrypted: { $exists: true, $ne: null } },
  ],
};

const present = (value) => value !== undefined && value !== null;

// The identity's share of encryptIdentityFields' output for the noon value.
function encryptedBirthDate(day) {
  assertFieldEncryptionConfigured(day);
  const { birthDateCiphertext, birthDateHash, encryptionKeyVersion } =
    participantIdentityService.encryptIdentityFields({ birthDate: day });
  if (!birthDateCiphertext) {
    throw new Error('ENCRYPTION_KEY nao configurada: a data de nascimento nao pode ser cifrada (#1412).');
  }
  return { birthDateCiphertext, birthDateHash, encryptionKeyVersion };
}

function warnUnreadable(identity) {
  console.warn(
    `[migrate:participant-birth-dates] ilegivel: identity ${identity._id} (participantId ${identity.participantId}) `
      + 'tem uma data de nascimento que nao pode ser lida; mantida para revisao.',
  );
}

function sameInstant(value, day) {
  const instant = value instanceof Date ? value : new Date(value);
  return instant.getTime() === day.getTime();
}

async function migrateParticipantBirthDates(db, { dryRun = false } = {}) {
  const identities = db.collection('participantIdentities');
  const summary = {
    mode: dryRun ? 'dry-run' : 'apply',
    candidates: 0,
    migrated: 0,
    unchanged: 0,
    legacyName: 0,
    unreadable: 0,
    raced: 0,
  };

  const docs = await identities.find(CANDIDATE_QUERY).toArray();

  // Fail closed before the first write.
  if (!dryRun && docs.some((doc) => present(doc.birthDateCiphertext))) {
    encryptedBirthDate(new Date(Date.UTC(2000, 0, 1, 12)));
  }

  for (const identity of docs) {
    summary.candidates += 1;

    if (present(identity.birthDateCiphertext)) {
      let deciphered = null;
      try {
        deciphered = decryptValue(identity.birthDateCiphertext);
      } catch {
        deciphered = null;
      }
      const day = present(deciphered) ? parseBirthDateDay(deciphered) : null;
      if (!day) {
        summary.unreadable += 1;
        warnUnreadable(identity);
        continue;
      }

      if (sameInstant(deciphered, day)
          && identity.birthDateHash === participantIdentityService.computeBlindIndex('birthDate', day)) {
        summary.unchanged += 1;
        continue;
      }

      if (dryRun) {
        summary.migrated += 1;
        continue;
      }

      const result = await identities.updateOne(
        { _id: identity._id, 'birthDateCiphertext.iv': identity.birthDateCiphertext.iv },
        { $set: encryptedBirthDate(day) },
      );
      if (result.matchedCount > 0) summary.migrated += 1;
      else summary.raced += 1;
      continue;
    }

    if (present(identity.birthDateEncrypted)) {
      summary.legacyName += 1;
      continue;
    }

    // A keyless stack (#1083) stores the plaintext only.
    const day = parseBirthDateDay(identity.birthDate);
    if (!day) {
      summary.unreadable += 1;
      warnUnreadable(identity);
      continue;
    }

    if (sameInstant(identity.birthDate, day)) {
      summary.unchanged += 1;
      continue;
    }

    if (dryRun) {
      summary.migrated += 1;
      continue;
    }

    const result = await identities.updateOne(
      { _id: identity._id, birthDate: identity.birthDate },
      { $set: { birthDate: day } },
    );
    if (result.matchedCount > 0) summary.migrated += 1;
    else summary.raced += 1;
  }

  summary.remaining = summary.legacyName + summary.unreadable + summary.raced;
  return summary;
}

async function run(argv = process.argv.slice(2)) {
  const db = await connectDB();
  const summary = await migrateParticipantBirthDates(db, { dryRun: argv.includes('--dry-run') });
  console.log('participantIdentities.birthDate -> 12:00 UTC do dia:', JSON.stringify(summary, null, 2));
  return summary;
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error('Erro na migração da data de nascimento em participantIdentities:', error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeConnection();
    });
}

module.exports = { migrateParticipantBirthDates, run };
