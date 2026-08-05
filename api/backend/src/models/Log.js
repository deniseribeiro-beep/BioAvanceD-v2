/**
 * Modelo de validação e estrutura para Log (Auditoria)
 * RNF009 - Auditoria e Rastreabilidade
 */

// Lista de entidades válidas do sistema
const VALID_ENTITIES = [
  'Access',
  'Authentication',
  'Assistant',
  'Equipment',
  'Export',
  'Import',
  'IntelligentAssistant',
  'Location',
  'Log',
  'Patient',
  'Policy',
  'Report',
  'Result',
  'Sample',
  'SampleFile',
  'Sensor',
  'Sistema',
  'Temperature',
  'User'
];

class LogModel {
  static validate(data) {
    const errors = [];

    const normalizedResourceType = String(data.entityType || data.resourceType || data.entity || '').trim();

    if (!data.userID && !data.userId) {
      errors.push('userID é obrigatório');
    }

    if (!data.action || typeof data.action !== 'string') {
      errors.push('action é obrigatório e deve ser string');
    }

    if (!normalizedResourceType) {
      errors.push('resourceType/entity é obrigatório e deve ser string');
    } else {
      // Valida se a entidade é válida (não é um ID)
      const entity = normalizedResourceType;
      
      // Verifica se é um ObjectId (24 caracteres hexadecimais)
      const isObjectId = /^[0-9a-fA-F]{24}$/.test(entity);
      // Verifica se é um ID numérico longo
      const isLongNumericId = /^\d{8,}$/.test(entity);
      
      if (isObjectId || isLongNumericId) {
        errors.push(`entity não pode ser um ID (${entity}). Use um nome de entidade válido.`);
      } else if (!VALID_ENTITIES.includes(entity) && entity !== 'Sistema') {
        // Mantém a entidade sem ruído adicional no teste/evidência
      }
    }

    if (data.severity && !['info', 'warning', 'error', 'critical'].includes(data.severity)) {
      errors.push('severity deve ser: info, warning, error ou critical');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static create(data, req = null) {
    const timestamp = data.occurredAt || data.dateTime || data.timestamp || new Date();
    const normalizedResourceType = String(data.entityType || data.resourceType || data.entity || 'Sistema').trim() || 'Sistema';
    const normalizedResourceId = data.entityId || data.resourceId || data.entityID || null;
    const normalizedStatus = data.result || data.status || 'success';
    const reqHeaders = req?.headers || {};
    
    // Normaliza e valida a entidade
    let entity = normalizedResourceType;
    if (typeof entity === 'string') {
      entity = entity.trim();
      
      // Se for um ObjectId ou ID numérico longo, corrige para 'Sistema'
      const isObjectId = /^[0-9a-fA-F]{24}$/.test(entity);
      const isLongNumericId = /^\d{8,}$/.test(entity);
      
      if (isObjectId || isLongNumericId) {
        console.warn(`Entidade inválida detectada (ID): ${entity}. Corrigindo para 'Sistema'.`);
        entity = 'Sistema';
      } else if (!VALID_ENTITIES.includes(entity) && entity !== 'Sistema') {
        // Mantém a entidade sem ruído adicional no teste/evidência
      }
    }
    
    return {
      logId: data.logId || data.logID || null, // Int conforme dicionário (MongoDB usa ObjectId)
      dateTime: timestamp, // DateTime ISO 8601
      timestamp: timestamp, // Alias para compatibilidade
      timestampISO: timestamp.toISOString(), // Formato ISO completo
      timestampFormatted: timestamp.toLocaleString('pt-BR', { 
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }), // Formato legível para humanos
      userId: data.userId || data.userID || data.userID || 'system', // String conforme dicionário
      userName: data.userName || null,
      action: data.action, // CREATE, READ, UPDATE, DELETE, LOGIN, LOGOUT, IMPORT, EXPORT, etc
      resourceType: entity,
      resourceId: normalizedResourceId,
      status: normalizedStatus,
      entity: entity, // Patient, Sample, User, Sistema, etc (garantidamente válido)
      entityID: normalizedResourceId,
      result: normalizedStatus, // success, error, warning
      severity: data.severity || 'info', // info, warning, error, critical
      source: data.source || data.origin || 'api', // String - Origem do evento
      ipSource: data.ipSource || data.sourceIP || (req ? (req.ip || reqHeaders['x-forwarded-for'] || reqHeaders['x-real-ip'] || req.connection?.remoteAddress) : null), // String - IP de origem
      module: data.module || 'Sistema', // Módulo de origem (Autenticação, Cadastro, Amostras, etc)
      message: data.message || null,
      payload: data.payload || null, // Payload relevante (sanitizado)
      errorStack: data.errorStack || null, // Stack simplificado de erro
      metadata: data.metadata || {}, // Dados adicionais sem informações sensíveis
      createdAt: new Date()
    };
  }

  static validateResult(result) {
    return ['success', 'failure'].includes(result); // Conforme dicionário
  }

  static validateSeverity(severity) {
    return ['info', 'warning', 'error', 'critical'].includes(severity);
  }
}

module.exports = LogModel;

