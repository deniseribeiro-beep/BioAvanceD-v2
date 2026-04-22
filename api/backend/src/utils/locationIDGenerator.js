const logger = require('./logger');

/**
 * Gera um ID numérico único para Location
 */
async function generateUniqueLocationID(db, collectionName = 'locations') {
  try {
    const collection = db.collection(collectionName);
    
    const lastItem = await collection
      .findOne(
        {},
        { 
          sort: { locationID: -1 },
          projection: { locationID: 1 }
        }
      );
    
    let newID = 1;
    
    if (lastItem && lastItem.locationID) {
      newID = lastItem.locationID + 1;
    }
    
    const existing = await collection.findOne({ locationID: newID });
    if (existing) {
      newID++;
      const existing2 = await collection.findOne({ locationID: newID });
      if (existing2) {
        throw new Error('Não foi possível gerar um locationID único. Tente novamente.');
      }
      logger.info(`LocationID gerado: ${newID} (após verificação de duplicidade)`);
      return newID;
    }
    
    logger.info(`LocationID gerado: ${newID}`);
    return newID;
  } catch (error) {
    logger.error('Erro ao gerar locationID:', error.message);
    throw error;
  }
}

module.exports = { generateUniqueLocationID };

