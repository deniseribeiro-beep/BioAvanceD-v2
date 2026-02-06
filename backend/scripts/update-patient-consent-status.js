require('dotenv').config();
const { connectDB, closeConnection } = require('../src/database/mongo');
const logger = require('../src/utils/logger');

/**
 * Script para adicionar status de consentimento aos pacientes existentes
 */
async function updatePatientConsentStatus() {
  try {
    logger.info('Iniciando atualização de status de consentimento dos pacientes...');

    const db = await connectDB();
    const patientsCollection = db.collection('pacientes');

    // Atualiza todos os pacientes que não têm status definido
    const result = await patientsCollection.updateMany(
      { status: { $exists: false } },
      {
        $set: {
          status: 'PENDING_CONSENT',
          consentNotifiedAt: new Date(),
          consentTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 dias
          consentToken: require('crypto').randomBytes(32).toString('hex')
        }
      }
    );

    logger.info(`Pacientes atualizados: ${result.modifiedCount}`);
    logger.info('Atualização de status de consentimento concluída!');

    await closeConnection();
    process.exit(0);
  } catch (error) {
    logger.error('Erro ao atualizar status de consentimento:', error);
    await closeConnection();
    process.exit(1);
  }
}

updatePatientConsentStatus();
