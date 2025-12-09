const logger = require('./logger');

/**
 * Gera um ID numérico único para Quality Description
 * Busca o último qualityID e incrementa
 * 
 * @param {Object} db - Instância do banco de dados MongoDB
 * @param {string} collectionName - Nome da collection (padrão: 'qualityDescriptions')
 * @returns {Promise<number>} ID numérico único
 */
async function generateUniqueQualityID(db, collectionName = 'qualityDescriptions') {
  try {
    const qualityCollection = db.collection(collectionName);
    
    // Busca o último qualityID
    const lastQuality = await qualityCollection
      .findOne(
        {},
        { 
          sort: { qualityID: -1 },
          projection: { qualityID: 1 }
        }
      );
    
    let newQualityID = 1; // Começa com 1 se não houver qualidades
    
    if (lastQuality && lastQuality.qualityID) {
      newQualityID = lastQuality.qualityID + 1;
    }
    
    // Verifica se o ID gerado já existe (proteção contra race conditions)
    const existing = await qualityCollection.findOne({ qualityID: newQualityID });
    if (existing) {
      newQualityID++; // Tenta o próximo número
      const existing2 = await qualityCollection.findOne({ qualityID: newQualityID });
      if (existing2) {
        throw new Error('Não foi possível gerar um ID de qualidade único. Tente novamente.');
      }
      logger.info(`ID de qualidade gerado: ${newQualityID} (após verificação de duplicidade)`);
      return newQualityID;
    }
    
    logger.info(`ID de qualidade gerado: ${newQualityID}`);
    return newQualityID;
  } catch (error) {
    logger.error('Erro ao gerar ID de qualidade:', error.message);
    throw error;
  }
}

module.exports = {
  generateUniqueQualityID
};

