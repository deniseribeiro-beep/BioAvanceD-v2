/**
 * Utilitário para serializar logs do MongoDB para JSON
 * Converte tipos especiais (ObjectId, Date, Buffer, etc.) para formatos legíveis
 */

/**
 * Serializa um documento do MongoDB para JSON seguro
 * Converte ObjectIds, Dates, Buffers e outros tipos especiais
 */
function serializeLog(log) {
  if (!log) return null;
  
  return serializeValue(log);
}

/**
 * Serializa qualquer valor, tratando tipos especiais
 */
function serializeValue(value, depth = 0, visited = new WeakSet()) {
  // Proteção contra recursão infinita
  if (depth > 10) {
    return '[Profundidade máxima atingida]';
  }

  // Valores primitivos
  if (value === null || value === undefined) {
    return value;
  }

  // Verifica referências circulares
  if (typeof value === 'object') {
    if (visited.has(value)) {
      return '[Referência circular]';
    }
    visited.add(value);
  }

  // Trata ObjectId do MongoDB
  if (isObjectId(value)) {
    return {
      _type: 'ObjectId',
      _value: value.toString()
    };
  }

  // Trata Date
  if (value instanceof Date) {
    return {
      _type: 'Date',
      _value: value.toISOString(),
      _formatted: value.toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    };
  }

  // Trata Buffer
  if (Buffer.isBuffer(value)) {
    return {
      _type: 'Buffer',
      _value: value.toString('base64'),
      _size: value.length
    };
  }

  // Trata arrays
  if (Array.isArray(value)) {
    return value.map(item => serializeValue(item, depth + 1, visited));
  }

  // Trata objetos
  if (typeof value === 'object') {
    const serialized = {};
    for (const key in value) {
      if (value.hasOwnProperty(key)) {
        // Pula propriedades internas do MongoDB
        if (key.startsWith('$') || key === '__proto__') {
          continue;
        }
        
        try {
          serialized[key] = serializeValue(value[key], depth + 1, visited);
        } catch (error) {
          serialized[key] = `[Erro ao serializar: ${error.message}]`;
        }
      }
    }
    return serialized;
  }

  // Outros tipos primitivos
  return value;
}

/**
 * Verifica se um valor é um ObjectId do MongoDB
 */
function isObjectId(value) {
  if (!value) return false;
  
  // Verifica por constructor name
  if (value.constructor && value.constructor.name === 'ObjectId') {
    return true;
  }
  
  // Verifica por métodos característicos
  if (typeof value.toString === 'function' && 
      typeof value.toHexString === 'function' &&
      typeof value.valueOf === 'function') {
    // Verifica se toString retorna uma string hexadecimal de 24 caracteres
    try {
      const str = value.toString();
      if (typeof str === 'string' && /^[0-9a-fA-F]{24}$/.test(str)) {
        return true;
      }
    } catch (e) {
      // Não é ObjectId se toString falhar
    }
  }
  
  return false;
}

/**
 * Serializa múltiplos logs
 */
function serializeLogs(logs) {
  if (!Array.isArray(logs)) {
    return serializeLog(logs);
  }
  
  return logs.map(log => serializeLog(log));
}

/**
 * Serializa apenas tipos especiais mantendo estrutura simples
 * Útil quando queremos apenas converter ObjectIds e Dates
 */
function serializeLogSimple(log) {
  if (!log) return null;
  
  // Se já está serializado (tem _type), retorna como está
  if (log._type) {
    return log;
  }
  
  const serialized = { ...log };
  
  // Serializa _id
  if (serialized._id) {
    if (isObjectId(serialized._id)) {
      serialized._id = serialized._id.toString();
    } else if (typeof serialized._id === 'object' && serialized._id.toString) {
      // Pode ser um ObjectId já parcialmente convertido
      serialized._id = serialized._id.toString();
    }
  }
  
  // Serializa dates - verifica se é Date ou string já
  if (serialized.timestamp) {
    if (serialized.timestamp instanceof Date) {
      serialized.timestamp = serialized.timestamp.toISOString();
    } else if (typeof serialized.timestamp === 'string') {
      // Já está serializado, mantém
    } else if (typeof serialized.timestamp === 'object' && serialized.timestamp._type === 'Date') {
      // Já está no formato serializado, mantém
    }
  }
  
  if (serialized.dateTime) {
    if (serialized.dateTime instanceof Date) {
      serialized.dateTime = serialized.dateTime.toISOString();
    }
  }
  
  if (serialized.createdAt && serialized.createdAt instanceof Date) {
    serialized.createdAt = serialized.createdAt.toISOString();
  }
  
  if (serialized.updatedAt && serialized.updatedAt instanceof Date) {
    serialized.updatedAt = serialized.updatedAt.toISOString();
  }
  
  // Serializa payload recursivamente
  if (serialized.payload && typeof serialized.payload === 'object') {
    serialized.payload = serializeValue(serialized.payload, 0, new WeakSet());
  }
  
  // Serializa metadata recursivamente
  if (serialized.metadata && typeof serialized.metadata === 'object') {
    serialized.metadata = serializeValue(serialized.metadata, 0, new WeakSet());
  }
  
  // Serializa entityID se for ObjectId ou objeto
  if (serialized.entityID) {
    if (isObjectId(serialized.entityID)) {
      serialized.entityID = serialized.entityID.toString();
    } else if (typeof serialized.entityID === 'object') {
      // Se for objeto com _value, extrai
      if (serialized.entityID._value) {
        serialized.entityID = String(serialized.entityID._value);
      } else if (typeof serialized.entityID.toString === 'function') {
        // Tenta converter com toString
        try {
          const str = serialized.entityID.toString();
          if (str && str !== '[object Object]') {
            serialized.entityID = str;
          } else {
            serialized.entityID = JSON.stringify(serialized.entityID);
          }
        } catch (e) {
          serialized.entityID = JSON.stringify(serialized.entityID);
        }
      } else {
        serialized.entityID = JSON.stringify(serialized.entityID);
      }
    } else if (typeof serialized.entityID !== 'string' && typeof serialized.entityID !== 'number') {
      // Garante que seja string ou número
      serialized.entityID = String(serialized.entityID);
    }
  }
  
  // Serializa userID se for ObjectId
  if (serialized.userID) {
    if (isObjectId(serialized.userID)) {
      serialized.userID = serialized.userID.toString();
    } else if (typeof serialized.userID === 'object' && serialized.userID.toString) {
      serialized.userID = serialized.userID.toString();
    }
  }
  
  if (serialized.userId) {
    if (isObjectId(serialized.userId)) {
      serialized.userId = serialized.userId.toString();
    } else if (typeof serialized.userId === 'object' && serialized.userId.toString) {
      serialized.userId = serialized.userId.toString();
    }
  }
  
  return serialized;
}

module.exports = {
  serializeLog,
  serializeLogs,
  serializeLogSimple,
  serializeValue,
  isObjectId
};

