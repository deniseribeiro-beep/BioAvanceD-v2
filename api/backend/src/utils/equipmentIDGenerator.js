const logger = require('./logger');

/**
 * Gera um ID numérico único para equipamento
 * Busca o último equipmentID e incrementa
 * 
 * @param {Object} db - Instância do banco de dados MongoDB
 * @param {string} collectionName - Nome da collection (padrão: 'equipment')
 * @returns {Promise<number>} ID numérico único
 */
async function generateUniqueEquipmentID(db, collectionName = 'equipment') {
  try {
    const equipmentCollection = db.collection(collectionName);
    
    // Busca o último equipmentID.
    // #736: restrito a equipmentID numérico. Na ordenação BSON do MongoDB
    // toda string vem depois de qualquer número, então um equipmentID
    // string (fixtures de e2e gravam o containerID nesse campo) era
    // devolvido primeiro por sort: { equipmentID: -1 } e o incremento
    // virava concatenação de string em vez de soma.
    const lastEquipment = await equipmentCollection
      .findOne(
        { equipmentID: { $type: 'number' } },
        { 
          sort: { equipmentID: -1 },
          projection: { equipmentID: 1 }
        }
      );
    
    let newEquipmentID = 1; // Começa com 1 se não houver equipamentos
    
    if (lastEquipment && lastEquipment.equipmentID) {
      newEquipmentID = lastEquipment.equipmentID + 1;
    }
    
    // Verifica se o ID gerado já existe (proteção contra race conditions)
    const existing = await equipmentCollection.findOne({ equipmentID: newEquipmentID });
    if (existing) {
      newEquipmentID++; // Tenta o próximo número
      const existing2 = await equipmentCollection.findOne({ equipmentID: newEquipmentID });
      if (existing2) {
        throw new Error('Não foi possível gerar um ID de equipamento único. Tente novamente.');
      }
      logger.info(`ID de equipamento gerado: ${newEquipmentID} (após verificação de duplicidade)`);
      return newEquipmentID;
    }
    
    logger.info(`ID de equipamento gerado: ${newEquipmentID}`);
    return newEquipmentID;
  } catch (error) {
    logger.error('Erro ao gerar ID de equipamento:', error.message);
    throw error;
  }
}

module.exports = { generateUniqueEquipmentID };


