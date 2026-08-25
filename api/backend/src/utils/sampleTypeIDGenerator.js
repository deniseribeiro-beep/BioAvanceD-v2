const logger = require('./logger');

/**
 * Gera um ID numérico único para Sample Type
 */
async function generateUniqueSampleTypeID(db, collectionName = 'sampleTypes') {
  try {
    const collection = db.collection(collectionName);
    
    const lastItem = await collection
      // #756: restrito a sampleTypeID numérico, espelhando a correção de #736 em
      // equipmentIDGenerator. Na ordenação BSON do MongoDB toda string vem
      // depois de qualquer número, então um sampleTypeID string é devolvido
      // primeiro por sort: { sampleTypeID: -1 } e o incremento vira concatenação
      // de string em vez de soma -- corrompendo o gerador permanentemente
      // para essa collection, já que o valor corrompido também é string.
      .findOne(
        { sampleTypeID: { $type: 'number' } },
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

