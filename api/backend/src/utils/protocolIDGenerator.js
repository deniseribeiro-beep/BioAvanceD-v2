const logger = require('./logger');

/**
 * Gera um ID numérico único para Extraction Protocol
 */
async function generateUniqueProtocolID(db, collectionName = 'extractionProtocols') {
  try {
    const collection = db.collection(collectionName);
    
    const lastItem = await collection
      // #756: restrito a protocolID numérico, espelhando a correção de #736 em
      // equipmentIDGenerator. Na ordenação BSON do MongoDB toda string vem
      // depois de qualquer número, então um protocolID string é devolvido
      // primeiro por sort: { protocolID: -1 } e o incremento vira concatenação
      // de string em vez de soma -- corrompendo o gerador permanentemente
      // para essa collection, já que o valor corrompido também é string.
      .findOne(
        { protocolID: { $type: 'number' } },
        { 
          sort: { protocolID: -1 },
          projection: { protocolID: 1 }
        }
      );
    
    let newID = 1;
    
    if (lastItem && lastItem.protocolID) {
      newID = lastItem.protocolID + 1;
    }
    
    const existing = await collection.findOne({ protocolID: newID });
    if (existing) {
      newID++;
      const existing2 = await collection.findOne({ protocolID: newID });
      if (existing2) {
        throw new Error('Não foi possível gerar um ID único. Tente novamente.');
      }
      logger.info(`ID de protocolo gerado: ${newID} (após verificação de duplicidade)`);
      return newID;
    }
    
    logger.info(`ID de protocolo gerado: ${newID}`);
    return newID;
  } catch (error) {
    logger.error('Erro ao gerar ID de protocolo:', error.message);
    throw error;
  }
}

module.exports = { generateUniqueProtocolID };

