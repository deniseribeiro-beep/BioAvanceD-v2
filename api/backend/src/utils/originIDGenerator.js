const logger = require('./logger');

/**
 * Gera um ID numérico único para Sample Origin
 */
async function generateUniqueOriginID(db, collectionName = 'sampleOrigins') {
  try {
    const collection = db.collection(collectionName);
    
    const lastItem = await collection
      // #756: restrito a originID numérico, espelhando a correção de #736 em
      // equipmentIDGenerator. Na ordenação BSON do MongoDB toda string vem
      // depois de qualquer número, então um originID string é devolvido
      // primeiro por sort: { originID: -1 } e o incremento vira concatenação
      // de string em vez de soma -- corrompendo o gerador permanentemente
      // para essa collection, já que o valor corrompido também é string.
      .findOne(
        { originID: { $type: 'number' } },
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

