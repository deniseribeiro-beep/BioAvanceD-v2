const logger = require('./logger');

/**
 * Gera um ID numérico único para Sample Origin
 */
async function generateUniqueOriginID(db, collectionName = 'sampleOrigins') {
  try {
    const collection = db.collection(collectionName);
    
    const lastItem = await collection
      .findOne(
        {},
        { 
          sort: { originID: -1 },
          projection: { originID: 1 }
        }
      );
    
    let newID = 1;
    
    if (lastItem && lastItem.originID) {
      newID = lastItem.originID + 1;
    }
    
    const existing = await collection.findOne({ originID: newID });
    if (existing) {
      newID++;
      const existing2 = await collection.findOne({ originID: newID });
      if (existing2) {
        throw new Error('Não foi possível gerar um ID único. Tente novamente.');
      }
      logger.info(`ID de origem gerado: ${newID} (após verificação de duplicidade)`);
      return newID;
    }
    
    logger.info(`ID de origem gerado: ${newID}`);
    return newID;
  } catch (error) {
    logger.error('Erro ao gerar ID de origem:', error.message);
    throw error;
  }
}

module.exports = { generateUniqueOriginID };

