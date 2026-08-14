const { connectDB, closeConnection } = require('../database/mongo');
const {
  backfillParticipantIdentities,
  checkParticipantIdentityParity
} = require('../services/participant-identity-backfill.service');

async function run() {
  const db = await connectDB();
  const { summary } = await backfillParticipantIdentities(db);
  console.log('ParticipantIdentity backfill:', JSON.stringify(summary, null, 2));

  const parity = await checkParticipantIdentityParity(db);
  console.log('ParticipantIdentity parity check:', JSON.stringify(parity, null, 2));

  return { summary, parity };
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
