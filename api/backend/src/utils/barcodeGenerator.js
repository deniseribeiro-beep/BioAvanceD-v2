const logger = require('./logger');

/**
 * Gera um código de barras único no formato BR-YYYY-NNN
 * Formato: BR-{ano}-{número sequencial de 3 dígitos}
 * Exemplo: BR-2024-001, BR-2024-002, etc.
 * 
 * @param {Object} db - Instância do banco de dados MongoDB
 * @param {string} collectionName - Nome da collection (padrão: 'amostras')
 * @returns {Promise<string>} Código de barras único no formato BR-YYYY-NNN
 */
async function generateUniqueBarcode(db, collectionName = 'amostras') {
  const currentYear = new Date().getFullYear();
  const prefix = `BR-${currentYear}-`;
  
  const samplesCollection = db.collection(collectionName);
  
  // Busca o último código de barras do ano atual
  const lastSample = await samplesCollection
    .findOne(
      { 
        barcode: { $regex: `^${prefix}` }
      },
      { 
        sort: { barcode: -1 } 
      }
    );
  
  let sequenceNumber = 1;
  
  if (lastSample && lastSample.barcode) {
    // Extrai o número sequencial do último código
    const lastBarcode = String(lastSample.barcode);
    const match = lastBarcode.match(new RegExp(`^${prefix}(\\d+)$`));
    
    if (match && match[1]) {
      const lastSequence = parseInt(match[1], 10);
      if (!isNaN(lastSequence)) {
        sequenceNumber = lastSequence + 1;
      }
    }
  }
  
  // Formata o número sequencial com 3 dígitos (001, 002, etc.)
  const formattedSequence = String(sequenceNumber).padStart(3, '0');
  const barcode = `${prefix}${formattedSequence}`;
  
  // Verifica se o código gerado já existe (proteção contra race conditions)
  const existing = await samplesCollection.findOne({ barcode });
  if (existing) {
    // Se já existe, tenta o próximo número
    sequenceNumber++;
    const newFormattedSequence = String(sequenceNumber).padStart(3, '0');
    const newBarcode = `${prefix}${newFormattedSequence}`;
    
    // Verifica novamente
    const existing2 = await samplesCollection.findOne({ barcode: newBarcode });
    if (existing2) {
      throw new Error('Não foi possível gerar um código de barras único. Tente novamente.');
    }
    
    logger.info(`Código de barras gerado: ${newBarcode} (após verificação de duplicidade)`);
    return newBarcode;
  }
  
  logger.info(`Código de barras gerado: ${barcode}`);
  return barcode;
}

module.exports = { generateUniqueBarcode };

