const crypto = require('crypto');
const logger = require('./logger');

/**
 * Gera um ID único numérico para amostras
 * Usa randomização criptograficamente segura
 * @param {Object} db - Instância do banco de dados MongoDB
 * @param {string} collectionName - Nome da collection (padrão: 'amostras')
 * @returns {Promise<number>} ID único numérico
 */
async function generateUniqueSampleID(db, collectionName = 'amostras') {
  const maxAttempts = 100; // Limite de tentativas para evitar loop infinito
  let attempts = 0;

  while (attempts < maxAttempts) {
    // Gera um número aleatório entre 1000000 e 9999999 (7 dígitos)
    // Usa crypto.randomInt para garantir segurança criptográfica
    const sampleID = crypto.randomInt(1000000, 9999999);

    // Verifica unicidade no banco de dados
    const samplesCollection = db.collection(collectionName);
    const existing = await samplesCollection.findOne({ sampleID });

    if (!existing) {
      logger.info(`ID único de amostra gerado: ${sampleID} (tentativa ${attempts + 1})`);
      return sampleID;
    }

    attempts++;
    logger.warn(`Colisão detectada para ID ${sampleID}, tentando novamente... (tentativa ${attempts})`);
  }

  // Se chegou aqui, não conseguiu gerar um ID único após muitas tentativas
  throw new Error('Não foi possível gerar um ID único de amostra após múltiplas tentativas. Tente novamente.');
}

module.exports = { generateUniqueSampleID };


