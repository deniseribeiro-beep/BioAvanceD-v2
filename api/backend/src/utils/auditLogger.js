const net = require('net');
const logService = require('../services/log.service');
const { sanitizePatientForLogs } = require('./patientAnonymization');
const { getUserAnonId, anonymizeLogUser } = require('./userAnonymization');
const { getActiveRoleCodes } = require('../services/rbac-assignment.service');

const ROLE_LABEL_BY_CODE = {
  administrator: 'Administrador',
  coordinator: 'Coordenador',
  technician: 'Técnico',
  external_user: 'Usuário Externo',
};

/**
 * Logger Central de Auditoria
 * Sistema padronizado de logging para o BioAvanceD
 * Garante rastreabilidade total sem dados sensíveis (LGPD)
 */

class AuditLogger {
  constructor() {
    this.db = null;
  }

  /**
   * Inicializa o logger com instância do banco
   */
  init(db) {
    this.db = db;
  }

  /**
   * Extrai informações da requisição HTTP para rastreamento
   */
  extractRequestInfo(req) {
    if (!req) return {};

    const headers = req.headers || {};

    // Captura IP real considerando proxies e load balancers
    let ip = 'N/A';
    if (req.ip) {
      ip = req.ip;
    } else if (headers['x-forwarded-for']) {
      // X-Forwarded-For pode conter múltiplos IPs (cliente, proxy1, proxy2)
      const forwardedIps = headers['x-forwarded-for'].split(',');
      ip = forwardedIps[0].trim(); // Primeiro IP é o cliente real
    } else if (headers['x-real-ip']) {
      ip = headers['x-real-ip'];
    } else if (req.connection?.remoteAddress) {
      ip = req.connection.remoteAddress;
    } else if (req.socket?.remoteAddress) {
      ip = req.socket.remoteAddress;
    }

    // Remove porta do IP se presente (ex: ::ffff:192.168.1.1:12345 -> ::ffff:192.168.1.1,
    // 192.168.1.1:12345 -> 192.168.1.1). Não mexe em endereços IPv6 "nus" (sem porta),
    // já que net.isIP() os reconhece como válidos por inteiro (ex: "::1").
    if (ip && ip.includes(':') && net.isIP(ip) === 0) {
      const lastColon = ip.lastIndexOf(':');
      const host = ip.slice(0, lastColon);
      const port = ip.slice(lastColon + 1);
      if (/^\d{1,5}$/.test(port) && (net.isIP(host) !== 0 || !host.includes(':'))) {
        ip = host;
      }
    }

    return {
      ip: ip,
      ipOriginal: req.ip || req.connection?.remoteAddress || 'N/A',
      forwardedFor: headers['x-forwarded-for'] || null,
      realIp: headers['x-real-ip'] || null,
      userAgent: headers['user-agent'] || 'N/A',
      method: req.method || 'N/A',
      path: req.path || req.url || 'N/A',
      origin: headers.origin || 'N/A',
      referer: headers.referer || headers.referrer || null,
      host: headers.host || 'N/A',
      protocol: req.protocol || 'http',
      secure: req.secure || false,
      headers: {
        'accept': headers.accept || null,
        'accept-language': headers['accept-language'] || null,
        'accept-encoding': headers['accept-encoding'] || null,
        'content-type': headers['content-type'] || null
      }
    };
  }

  /**
   * Extrai informações do usuário (anonimizado para LGPD)
   */
  async extractUserInfo(req, db = null) {
    if (!req || !req.user) return {};

    const userID = req.user.userID || req.user._id?.toString() || null;

    // Obtém identificador anonimizado
    const anonId = await getUserAnonId(req.user, db);

    // #426: resolve o rótulo de papel via UserRoleAssignment -> Role quando
    // possível; accessType/roleName do req.user ficam como fallback quando
    // db não está disponível (ex.: chamadores que nunca chamaram init(db)).
    let userRole = req.user.roleName;
    if (!userRole && db && userID) {
      try {
        const roleCodes = await getActiveRoleCodes(db, userID);
        userRole = roleCodes.map((code) => ROLE_LABEL_BY_CODE[code]).find(Boolean);
      } catch (error) {
        // db não totalmente configurado (ex.: mock parcial em teste) -- cai
        // para a heurística de accessType abaixo.
      }
    }
    if (!userRole) {
      userRole = req.user.accessType === 4 ? 'Administrador' :
        req.user.accessType === 3 ? 'Coordenador' :
        req.user.accessType === 2 ? 'Técnico' : 'Usuário Externo';
    }

    return {
      userID: anonId, // Usa identificador anonimizado
      userName: anonId, // Usa identificador anonimizado em vez de nome
      userRole
    };
  }

  /**
   * Sanitiza payload removendo dados sensíveis
   */
  sanitizePayload(payload, entity) {
    if (!payload || typeof payload !== 'object') return payload;

    const sanitized = { ...payload };

    // Remove campos sensíveis
    const sensitiveFields = [
      'password', 'passwordHash', 'mfaSecret', 'token', 'secret',
      'patientName', 'name', 'email', 'cpf', 'document', 'address',
      'phone', 'telefone', 'birthDate', 'dataNascimento',
      // RF005/RNF007 (#363/#564): identityDocument is the canonical
      // civil-identity field ParticipantIdentity introduced — 'document'
      // above predates it and doesn't cover the field by its actual name.
      'identityDocument'
    ];

    sensitiveFields.forEach(field => {
      if (sanitized[field] !== undefined) {
        delete sanitized[field];
      }
    });

    // Se for entidade Patient, sanitiza usando utilitário específico
    if (entity === 'Patient' && sanitized.participantId) {
      return sanitizePatientForLogs(sanitized);
    }

    return sanitized;
  }

  /**
   * Extrai stack simplificado de erro
   */
  extractErrorStack(error) {
    if (!error || !error.stack) return null;

    const stack = error.stack.split('\n').slice(0, 5).join('\n');
    return stack;
  }

  /**
   * Determina módulo de origem baseado no path da requisição
   */
  determineModule(path) {
    if (!path) return 'Sistema';

    const pathLower = path.toLowerCase();

    if (pathLower.includes('/auth') || pathLower.includes('/login') || pathLower.includes('/logout')) {
      return 'Autenticação';
    }
    if (pathLower.includes('/patient') || pathLower.includes('/paciente')) {
      return 'Cadastro';
    }
    if (pathLower.includes('/sample') || pathLower.includes('/amostra')) {
      return 'Amostras';
    }
    if (pathLower.includes('/import')) {
      return 'Importação';
    }
    if (pathLower.includes('/user')) {
      return 'Usuários';
    }
    if (pathLower.includes('/config') || pathLower.includes('/settings')) {
      return 'Configurações';
    }
    if (pathLower.includes('/assistant')) {
      return 'IA Assistente';
    }
    if (pathLower.includes('/ia')) {
      return 'Sistema';
    }
    if (pathLower.includes('/security') || pathLower.includes('/mfa')) {
      return 'Segurança';
    }
    if (pathLower.includes('/backup')) {
      return 'Backup';
    }
    if (pathLower.includes('/report')) {
      return 'Relatórios';
    }

    return 'Sistema';
  }

  /**
   * Registra log de auditoria
   */
  async log(options) {
    if (!this.db) {
      console.error('AuditLogger não foi inicializado. Chame init(db) primeiro.');
      return;
    }

    const {
      action,           // Tipo de ação (LOGIN, CREATE, UPDATE, etc.)
      resourceType,     // Entidade afetada, nome canônico (Patient, Sample, User, etc.)
      resourceId,       // Identificador canônico da entidade (sem dados sensíveis)
      status,           // 'success', 'error', 'warning'
      occurredAt,       // Momento canônico do evento (opcional, default: agora)
      severity,         // 'info', 'warning', 'error', 'critical'
      message,          // Mensagem detalhada
      payload,          // Payload relevante (sanitizado)
      error,            // Objeto de erro (opcional)
      req,              // Requisição HTTP (opcional)
      module            // Módulo de origem (opcional, será determinado automaticamente)
    } = options;
    const entity = resourceType;
    const entityID = resourceId;
    const result = status;

    try {
      const requestInfo = this.extractRequestInfo(req);
      const userInfo = await this.extractUserInfo(req, this.db);
      const moduleName = module || (req ? this.determineModule(req.path || req.url) : 'Sistema');

      // Sanitiza payload
      const sanitizedPayload = payload ? this.sanitizePayload(payload, entity) : null;

      // Extrai stack de erro se houver
      const errorStack = error ? this.extractErrorStack(error) : null;

      const eventTime = occurredAt ? new Date(occurredAt) : new Date();

      const logData = {
        userID: userInfo.userID || 'USR-SYSTEM',
        userName: userInfo.userName || 'USR-SYSTEM', // Já anonimizado pelo extractUserInfo
        action: (action || 'LOG').toString().toUpperCase(),
        resourceType: formatEntity(entity),
        resourceId: entityID || null,
        status: result || 'success',
        entity: formatEntity(entity),
        entityID: entityID || null,
        result: result || 'success',
        severity: severity || 'info',
        sourceIP: requestInfo.ip, // IP principal para compatibilidade
        ipSource: requestInfo.ip, // Alias para compatibilidade
        source: requestInfo.origin,
        module: moduleName,
        message: message || `${action} em ${entity}`,
        payload: sanitizedPayload,
        errorStack: errorStack,
        timestamp: eventTime,
        dateTime: eventTime,
        metadata: {
          // Dados de rastreamento completos
          tracking: {
            ip: requestInfo.ip,
            ipOriginal: requestInfo.ipOriginal,
            forwardedFor: requestInfo.forwardedFor,
            realIp: requestInfo.realIp,
            userAgent: requestInfo.userAgent,
            referer: requestInfo.referer,
            host: requestInfo.host,
            protocol: requestInfo.protocol,
            secure: requestInfo.secure
          },
          // Dados da requisição
          request: {
            method: requestInfo.method,
            path: requestInfo.path,
            origin: requestInfo.origin,
            headers: requestInfo.headers
          },
          // Dados do usuário (anonimizado)
          user: {
            userID: userInfo.userID, // Identificador anonimizado
            userRole: userInfo.userRole
            // userName removido - não deve conter dados pessoais
          }
        }
      };

      // Garante anonimização completa antes de salvar
      const anonymizedLogData = await anonymizeLogUser(logData, this.db);
      
      await logService.createLog(this.db, anonymizedLogData, req);
    } catch (error) {
      console.error('Erro ao registrar log de auditoria:', error.message);
    }
  }

  /**
   * Métodos de conveniência para ações comuns
   */
  async logLogin(req, success, error = null) {
    await this.log({
      action: 'LOGIN',
      resourceType: 'Authentication',
      status: success ? 'success' : 'error',
      severity: success ? 'info' : 'warning',
      message: success 
        ? `Login realizado com sucesso`
        : `Tentativa de login falhou: ${error?.message || 'Credenciais inválidas'}`,
      error: error,
      req: req,
      module: 'Autenticação'
    });
  }

  async logLogout(req) {
    await this.log({
      action: 'LOGOUT',
      resourceType: 'Authentication',
      status: 'success',
      severity: 'info',
      message: 'Logout realizado',
      req: req,
      module: 'Autenticação'
    });
  }

  async logCreate(req, entity, entityID, payload = null) {
    await this.log({
      action: 'CREATE',
      resourceType: entity,
      resourceId: entityID,
      status: 'success',
      severity: 'info',
      message: `${entity} criado com sucesso`,
      payload: payload,
      req: req
    });
  }

  async logUpdate(req, entity, entityID, payload = null) {
    await this.log({
      action: 'UPDATE',
      resourceType: entity,
      resourceId: entityID,
      status: 'success',
      severity: 'info',
      message: `${entity} atualizado com sucesso`,
      payload: payload,
      req: req
    });
  }

  async logDelete(req, entity, entityID) {
    await this.log({
      action: 'DELETE',
      resourceType: entity,
      resourceId: entityID,
      status: 'success',
      severity: 'warning',
      message: `${entity} deletado`,
      req: req
    });
  }

  async logImport(req, entity, result, total, success, errors, context = {}) {
    // Conforme fluxograma: registra após processamento com métricas consolidadas
    const payload = {
      total,
      success,
      errors,
      // #798: blank rows are skipped by isEmptyRow and deliberately stay out
      // of `total`, so without this the audit record cannot distinguish a
      // clean 9-row file from a 12-row file whose last three rows were blank
      // -- which is the one case where an operator most needs to notice.
      // This payload hand-picks known keys off `context`, so a caller passing
      // `skipped` has no effect until it is read here by name.
      skipped: context.skipped || 0,
      jobID: context.jobID || null,
      dataType: context.dataType || entity.toLowerCase(),
      fhirResourcesCreated: context.fhirResourcesCreated || 0,
      fhirResourcesUpdated: context.fhirResourcesUpdated || 0,
      processingTime: context.processingTime || null,
      status: result || 'pending',
    };

    await this.log({
      action: 'IMPORT',
      resourceType: entity,
      status: errors > 0 ? 'warning' : (result === 'pending' ? 'info' : 'success'),
      severity: errors > 0 ? 'warning' : (result === 'pending' ? 'info' : 'info'),
      message: `Importação de ${entity}: ${success}/${total} registros importados${errors > 0 ? ` com ${errors} erro(s)` : ''}${context.jobID ? ` (Job: ${context.jobID})` : ''}`,
      payload: payload,
      req: req,
      module: 'Importação'
    });
  }

  async logError(req, entity, error, context = null) {
    await this.log({
      action: 'ERROR',
      resourceType: entity || 'Sistema',
      status: 'error',
      severity: 'error',
      message: `Erro: ${error?.message || 'Erro desconhecido'}`,
      error: error,
      payload: context,
      req: req
    });
  }

  async logLanguageChange(req, language) {
    await this.log({
      action: 'CONFIG',
      resourceType: 'Settings',
      status: 'success',
      severity: 'info',
      message: `Idioma alterado para ${language}`,
      payload: { language },
      req: req,
      module: 'Configurações'
    });
  }

  async logPermissionChange(req, targetUser, changes) {
    await this.log({
      action: 'UPDATE',
      resourceType: 'User',
      resourceId: targetUser,
      status: 'success',
      severity: 'info',
      message: 'Permissões ou cargo alterados',
      payload: changes,
      req: req,
      module: 'Usuários'
    });
  }

  async logAssistant(req, question, response) {
    await this.log({
      action: 'QUERY',
      resourceType: 'Assistant',
      status: 'success',
      severity: 'info',
      message: 'Consulta ao sistema',
      payload: { questionLength: question?.length || 0, responseLength: response?.length || 0 },
      req: req,
      module: 'Sistema'
    });
  }
}

function formatEntity(entity) {
  if (!entity) return 'Unknown';
  const s = entity.toString().trim();
  if (!s) return 'Unknown';
  try {
    return s.charAt(0).toUpperCase() + s.slice(1);
  } catch (_) {
    return 'Unknown';
  }
}

// Singleton instance
const auditLogger = new AuditLogger();

module.exports = auditLogger;

