/**
 * Creates a ParticipantIdentity for each Patient that has none, then moves
 * the Patient's contact fields onto its identity and checks parity.
 *
 * One-way: no rollback. The contact move covers email, phone and the
 * representative name, email, identity document and phone; it overwrites an
 * identity's differing value with the Patient's (also unsetting the old
 * `<field>Encrypted` envelope), unsets the Patient copy (and the Patient's
 * representativeIdentityDocumentEncrypted) and re-encrypts
 * plaintext contacts on the identities; no old value is kept. The identities
 * it inserts cannot be told from those patient.service.js has written since.
 * Undo is restoring patients and participantIdentities from a backup.
 */
const { connectDB, closeConnection } = require('../database/mongo');
const {
  backfillParticipantIdentities,
  checkParticipantIdentityParity,
  moveParticipantContactToIdentity
} = require('../services/participant-identity-backfill.service');

async function run() {
  const db = await connectDB();
  const { summary } = await backfillParticipantIdentities(db);
  console.log('ParticipantIdentity backfill:', JSON.stringify(summary, null, 2));

  // #1166 slice 4: after the backfill, so every Patient carrying a contact
  // has an identity record to move it onto.
  const { summary: contactSummary } = await moveParticipantContactToIdentity(db);
  console.log('ParticipantIdentity contact move:', JSON.stringify(contactSummary, null, 2));

  const parity = await checkParticipantIdentityParity(db);
  console.log('ParticipantIdentity parity check:', JSON.stringify(parity, null, 2));

  return { summary, contactSummary, parity };
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error('Erro no backfill/parity de ParticipantIdentity:', error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeConnection();
    });
}

module.exports = { run };
