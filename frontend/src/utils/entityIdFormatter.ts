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

/**
 * Verifica se um entityID é válido (não é vazio ou null)
 */
export function isValidEntityID(entityID: any): boolean {
  if (!entityID) return false;
  if (typeof entityID === 'string' && entityID.trim() === '') return false;
  if (typeof entityID === 'object' && Object.keys(entityID).length === 0) return false;
  return true;
}

/**
 * Obtém o tipo de ID baseado no formato
 * Útil para exibir informações adicionais
 */
export function getEntityIDType(entityID: any): string {
  if (!entityID) return 'none';
  
  const formatted = formatEntityID(entityID);
  
  // ObjectId do MongoDB (24 caracteres hexadecimais)
  if (/^[0-9a-fA-F]{24}$/.test(formatted)) {
    return 'ObjectId';
  }
  
  // ID de paciente (8 dígitos numéricos)
  if (/^\d{8}$/.test(formatted)) {
    return 'PatientID';
  }
  
  // ID numérico longo
  if (/^\d+$/.test(formatted)) {
    return 'NumericID';
  }
  
  // String genérica
  if (typeof formatted === 'string') {
    return 'StringID';
  }
  
  return 'Unknown';
}

/**
 * Formata entityID com tipo identificado
 * Retorna objeto com value e type
 */
export function formatEntityIDWithType(entityID: any): { value: string; type: string } {
  return {
    value: formatEntityID(entityID),
    type: getEntityIDType(entityID)
  };
}

