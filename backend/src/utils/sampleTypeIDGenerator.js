const logger = require('./logger');

/**
 * Gera um ID numérico único para Sample Type
 */
async function generateUniqueSampleTypeID(db, collectionName = 'sampleTypes') {
  try {
    const collection = db.collection(collectionName);
    
    const lastItem = await collection
      .findOne(
        {},
        { 
          sort: { sampleTypeID: -1 },
          projection: { sampleTypeID: 1 }
        }
      );
    
    let newID = 1;
    
    if (lastItem && lastItem.sampleTypeID) {
      newID = lastItem.sampleTypeID + 1;
    }
    
    const existing = await collection.findOne({ sampleTypeID: newID });
    if (existing) {
      newID++;
      const existing2 = await collection.findOne({ sampleTypeID: newID });
      if (existing2) {
        throw new Error('Não foi possível gerar um ID único. Tente novamente.');
      }
      logger.info(`ID de tipo de amostra gerado: ${newID} (após verificação de duplicidade)`);
      return newID;
    }
    
    logger.info(`ID de tipo de amostra gerado: ${newID}`);
    return newID;
  } catch (error) {
    logger.error('Erro ao gerar ID de tipo de amostra:', error.message);
    throw error;
  }
}

module.exports = { generateUniqueSampleTypeID };

