const crypto = require('crypto');
const logger = require('./logger');

/**
 * Utilitário para anonimização de pacientes conforme LGPD
 * Gera IDs únicos de 8 dígitos criptograficamente seguros
 */

/**
 * Gera um ID único de 8 dígitos numéricos aleatórios
 * Usa randomização criptograficamente segura
 * @param {Object} db - Instância do banco de dados MongoDB
 * @param {string} collectionName - Nome da collection (padrão: 'pacientes')
 * @returns {Promise<string>} ID único de 8 dígitos
 */
async function generateUniquePatientID(db, collectionName = 'pacientes') {
  const maxAttempts = 100; // Limite de tentativas para evitar loop infinito
  let attempts = 0;

  while (attempts < maxAttempts) {
    // Gera 8 dígitos aleatórios usando crypto.randomInt (criptograficamente seguro)
    // Garante que o primeiro dígito não seja zero (para manter 8 dígitos)
    const firstDigit = crypto.randomInt(1, 10); // 1-9
    const remainingDigits = Array.from({ length: 7 }, () => crypto.randomInt(0, 10));
    const patientID = `${firstDigit}${remainingDigits.join('')}`;

    // Verifica unicidade no banco de dados
    const patientsCollection = db.collection(collectionName);
    const existing = await patientsCollection.findOne({ patientID });

    if (!existing) {
      logger.info(`ID único gerado: ${patientID} (tentativa ${attempts + 1})`);
      return patientID;
    }

    attempts++;
    logger.warn(`Colisão detectada para ID ${patientID}, tentando novamente... (tentativa ${attempts})`);
  }

  // Se chegou aqui, não conseguiu gerar um ID único após muitas tentativas
  throw new Error('Não foi possível gerar um ID único após múltiplas tentativas. Tente novamente.');
}

/**
 * Valida se um ID de paciente existe no banco de dados
 * Retorna apenas se existe, sem expor dados sensíveis
 * @param {Object} db - Instância do banco de dados MongoDB
 * @param {string} patientID - ID do paciente a validar
 * @param {string} collectionName - Nome da collection (padrão: 'pacientes')
 * @returns {Promise<boolean>} true se o ID existe, false caso contrário
 */
async function validatePatientID(db, patientID, collectionName = 'pacientes') {
  try {
    if (!patientID || typeof patientID !== 'string' || patientID.length !== 8) {
      return false;
    }

    // Valida se contém apenas dígitos
    if (!/^\d{8}$/.test(patientID)) {
      return false;
    }

    const patientsCollection = db.collection(collectionName);
    const patient = await patientsCollection.findOne(
      { patientID },
      { projection: { patientID: 1, _id: 0 } } // Retorna apenas patientID, sem dados sensíveis
    );

    return !!patient;
  } catch (error) {
    logger.error('Erro ao validar ID de paciente:', error.message);
    return false;
  }
}

/**
 * Busca paciente apenas pelo ID, sem expor dados sensíveis
 * Retorna apenas informações não sensíveis para módulo operacional
 * @param {Object} db - Instância do banco de dados MongoDB
 * @param {string} patientID - ID do paciente
 * @param {string} collectionName - Nome da collection (padrão: 'pacientes')
 * @returns {Promise<Object|null>} Objeto com apenas ID e dados não sensíveis, ou null
 */
async function getPatientByIDOnly(db, patientID, collectionName = 'pacientes') {
  try {
    const patientsCollection = db.collection(collectionName);
    const patient = await patientsCollection.findOne(
      { patientID },
      {
        projection: {
          patientID: 1,
          _id: 0,
          // Não retorna dados sensíveis como nome, data de nascimento, etc.
          // Apenas ID e dados necessários para operações laboratoriais
        }
      }
    );

    if (!patient) {
      return null;
    }

    // Retorna apenas o ID, sem dados sensíveis
    return {
      patientID: patient.patientID,
      exists: true
    };
  } catch (error) {
    logger.error('Erro ao buscar paciente por ID:', error.message);
    return null;
  }
}

/**
 * Sanitiza dados de paciente para logs (remove dados sensíveis)
 * @param {Object} patient - Dados do paciente
 * @returns {Object} Dados sanitizados (apenas ID)
 */
function sanitizePatientForLogs(patient) {
  if (!patient) {
    return { patientID: null };
  }

  return {
    patientID: patient.patientID || null
    // Remove todos os outros campos sensíveis
  };
}

module.exports = {
  generateUniquePatientID,
  validatePatientID,
  getPatientByIDOnly,
  sanitizePatientForLogs
};

