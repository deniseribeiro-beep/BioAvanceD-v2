require('dotenv').config();
const { connectDB, closeConnection } = require('../src/database/mongo');
const logger = require('../src/utils/logger');

/**
 * Script para verificar status de consentimento dos pacientes
 */
async function checkPatientConsentStatus() {
  try {
    logger.info('Verificando status de consentimento dos pacientes...');

    const db = await connectDB();
    const patientsCollection = db.collection('pacientes');

    // Busca todos os pacientes
    const patients = await patientsCollection.find({}).project({ patientID: 1, status: 1, consentToken: 1, consentNotifiedAt: 1 }).toArray();

    logger.info(`Total de pacientes no banco: ${patients.length}`);
    
    if (patients.length > 0) {
      logger.info('Primeiros 5 pacientes:');
      patients.slice(0, 5).forEach((p, idx) => {
        logger.info(`${idx + 1}. ID: ${p.patientID}, Status: ${p.status || 'NÃO DEFINIDO'}, Token: ${p.consentToken ? 'SIM' : 'NÃO'}, NotifiedAt: ${p.consentNotifiedAt || 'NUNCA'}`);
      });
    }

    // Verifica quantos tem cada status
    const statusCounts = {};
    patients.forEach(p => {
      const s = p.status || 'UNDEFINED';
      statusCounts[s] = (statusCounts[s] || 0) + 1;
    });

    logger.info('Contagem por status:');
    Object.entries(statusCounts).forEach(([status, count]) => {
      logger.info(`  ${status}: ${count}`);
    });

    await closeConnection();
    process.exit(0);
  } catch (error) {
    logger.error('Erro ao verificar status:', error);
    await closeConnection();
    process.exit(1);
  }
}

checkPatientConsentStatus();
