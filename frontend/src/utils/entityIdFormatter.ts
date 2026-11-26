/**
 * Utilitário para formatar entityID de logs
 * Trata diferentes tipos de IDs (ObjectId, patientID, etc.)
 */

/**
 * Formata um entityID para exibição
 * Trata ObjectIds do MongoDB, IDs numéricos, strings, etc.
 */
export function formatEntityID(entityID: any): string {
  if (!entityID) {
    return 'N/A';
  }

  // Se for string vazia
  if (typeof entityID === 'string' && entityID.trim() === '') {
    return 'N/A';
  }

  // Se for um objeto serializado (ObjectId)
  if (typeof entityID === 'object') {
    // Objeto com _type ObjectId (vindo da serialização)
    if (entityID._type === 'ObjectId' && entityID._value) {
      return entityID._value;
    }
    
    // Objeto com _value
    if (entityID._value) {
      return String(entityID._value);
    }
    
    // Objeto com método toString
    if (typeof entityID.toString === 'function') {
      try {
        const str = entityID.toString();
        if (str && str !== '[object Object]') {
          return str;
        }
      } catch (e) {
        // Ignora erro
      }
    }
    
    // Se não conseguir extrair, retorna representação do objeto
    return JSON.stringify(entityID);
  }

  // Se for número
  if (typeof entityID === 'number') {
    return String(entityID);
  }

  // Se for string
  if (typeof entityID === 'string') {
    return entityID.trim();
  }

  // Fallback
  return String(entityID);
}

