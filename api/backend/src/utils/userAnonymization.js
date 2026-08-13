const crypto = require('crypto');

/**
 * Utilitário de Anonimização de Usuários para LGPD
 * Gera identificadores únicos, fixos e irreversíveis para usuários
 * Garante rastreabilidade sem violar privacidade
 */

/**
 * Gera um identificador anonimizado único e fixo para um usuário
 * Usa hash SHA-256 do userID + salt do sistema para garantir unicidade
 * Formato: USR-{8 caracteres hexadecimais}
 * 
 * @param {string|ObjectId} userID - ID do usuário
 * @param {string} salt - Salt do sistema (opcional, usa env var se disponível)
 * @returns {string} Identificador anonimizado (ex: USR-A3F2B9C1)
 */
function generateAnonId(userID, salt = null) {
  if (!userID) {
    return 'USR-SYSTEM';
  }

  // Usa salt do ambiente ou gera um fixo baseado no userID
  const systemSalt = salt || process.env.USER_ANON_SALT || 'BioAdvanceD-LGPD-2024';
  
  // Cria hash SHA-256 do userID + salt
  const hash = crypto
    .createHash('sha256')
    .update(String(userID) + systemSalt)
    .digest('hex');
  
  // Pega os primeiros 8 caracteres do hash e formata como USR-XXXX
  const shortHash = hash.substring(0, 8).toUpperCase();
  
  return `USR-${shortHash}`;
}

/**
 * Obtém ou gera identificador anonimizado para um usuário
 * Se o usuário já tiver anonId, retorna ele. Caso contrário, gera um novo.
 * 
 * @param {Object} user - Objeto do usuário (pode ter _id, userID, id)
 * @param {Object} db - Instância do banco de dados (opcional, para buscar anonId existente)
 * @returns {Promise<string>|string} Identificador anonimizado
 */
async function getUserAnonId(user, db = null) {
  if (!user) {
    return 'USR-SYSTEM';
  }

  // Tenta obter userID do objeto
  const userID = user._id?.toString() || user.userID || user.id || null;
  
  if (!userID) {
    return 'USR-SYSTEM';
  }

  // Se o usuário já tem anonId armazenado, retorna ele
  if (user.anonId) {
    return user.anonId;
  }

  // Se temos acesso ao banco, tenta buscar o anonId existente
  if (db) {
    try {
      const usersCollection = db.collection('users');
      const existingUser = await usersCollection.findOne(
        { _id: userID },
        { projection: { anonId: 1 } }
      );
      
      if (existingUser && existingUser.anonId) {
        return existingUser.anonId;
      }
    } catch (error) {
      // Se houver erro ao buscar, continua e gera novo
      console.warn('Erro ao buscar anonId do usuário:', error.message);
    }
  }

  // Gera novo identificador anonimizado
  return generateAnonId(userID);
}

/**
 * Anonimiza dados do usuário em um objeto de log
 * Remove todos os dados pessoais e substitui por identificador anonimizado
 * 
 * @param {Object} logData - Dados do log
 * @param {Object} db - Instância do banco de dados (opcional)
 * @returns {Promise<Object>} Dados do log anonimizados
 */
async function anonymizeLogUser(logData, db = null) {
  if (!logData) return logData;

  const anonymized = { ...logData };

  // Se temos userID, obtém o identificador anonimizado
  const userID = anonymized.userID || anonymized.userId || anonymized.user?._id?.toString();
  
  if (userID && userID !== 'system') {
    // Obtém identificador anonimizado
    const anonId = await getUserAnonId({ _id: userID }, db);
    
    // Substitui userName pelo identificador anonimizado
    anonymized.userName = anonId;
    anonymized.userID = anonId; // Também substitui userID para consistência
    anonymized.userId = anonId;
  } else {
    // Sistema ou usuário não identificado
    anonymized.userName = 'USR-SYSTEM';
    anonymized.userID = 'system';
    anonymized.userId = 'system';
  }

  // Remove dados pessoais do metadata.user se existir
  if (anonymized.metadata && anonymized.metadata.user) {
    anonymized.metadata.user = {
      userID: anonymized.userID,
      userRole: anonymized.metadata.user.userRole || null
      // Remove userName, name, email, etc.
    };
  }

  // Remove qualquer referência a dados pessoais no payload
  if (anonymized.payload && typeof anonymized.payload === 'object') {
    anonymized.payload = sanitizePayload(anonymized.payload);
  }

  // Remove dados pessoais da mensagem se contiver
  if (anonymized.message && typeof anonymized.message === 'string') {
    anonymized.message = sanitizeMessage(anonymized.message);
  }

  return anonymized;
}

/**
 * Sanitiza payload removendo dados pessoais
 */
function sanitizePayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;

  const sanitized = { ...payload };

  // Lista de campos sensíveis a remover
  const sensitiveFields = [
    'name', 'nome', 'userName', 'username', 'email', 'e-mail',
    'cpf', 'document', 'documento', 'phone', 'telefone',
    'address', 'endereco', 'birthDate', 'dataNascimento',
    'password', 'passwordHash', 'mfaSecret', 'token', 'secret',
    // RF005/RNF007 (#363/#564): the canonical ParticipantIdentity field
    // names — 'name'/'document' above predate them and don't cover the
    // fields by their actual names.
    'patientName', 'identityDocument'
  ];

  sensitiveFields.forEach(field => {
    if (sanitized[field] !== undefined) {
      delete sanitized[field];
    }
  });

  // Sanitiza objetos aninhados
  Object.keys(sanitized).forEach(key => {
    if (sanitized[key] && typeof sanitized[key] === 'object' && !Array.isArray(sanitized[key])) {
      sanitized[key] = sanitizePayload(sanitized[key]);
    } else if (Array.isArray(sanitized[key])) {
      sanitized[key] = sanitized[key].map(item => 
        typeof item === 'object' ? sanitizePayload(item) : item
      );
    }
  });

  return sanitized;
}

/**
 * Sanitiza mensagem removendo referências a dados pessoais
 */
function sanitizeMessage(message) {
  if (!message || typeof message !== 'string') return message;

  let sanitized = message;

  // Remove nomes de usuário (padrões comuns)
  sanitized = sanitized.replace(/\b(?:usuário|user|usuario)\s+[A-Za-zÀ-ÿ\s]+/gi, 'usuário');
  
  // Remove emails
  sanitized = sanitized.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[email]');
  
  // Remove CPFs
  sanitized = sanitized.replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF]');
  
  // Remove telefones
  sanitized = sanitized.replace(/\b(?:\(?\d{2}\)?\s?)?\d{4,5}-?\d{4}\b/g, '[telefone]');

  return sanitized;
}

/**
 * Anonimiza array de logs
 */
async function anonymizeLogs(logs, db = null) {
  if (!Array.isArray(logs)) return logs;

  const anonymizedLogs = await Promise.all(
    logs.map(log => anonymizeLogUser(log, db))
  );

  return anonymizedLogs;
}

/**
 * Mascara dados do usuário para exibição
 * Versão síncrona que não precisa do banco
 */
function maskUser(user) {
  if (!user) return 'USR-SYSTEM';

  // Se já tem anonId, retorna
  if (user.anonId) {
    return user.anonId;
  }

  // Gera baseado no ID disponível
  const userID = user._id?.toString() || user.userID || user.id;
  if (!userID) return 'USR-SYSTEM';

  return generateAnonId(userID);
}

module.exports = {
  generateAnonId,
  getUserAnonId,
  anonymizeLogUser,
  anonymizeLogs,
  maskUser,
  sanitizePayload,
  sanitizeMessage
};

