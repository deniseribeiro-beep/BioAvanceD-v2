const LogModel = require('../models/Log');
const logger = require('../utils/logger');
const { sanitizePatientForLogs } = require('../utils/patientAnonymization');
const { anonymizeLogs, anonymizeLogUser } = require('../utils/userAnonymization');
const { serializeLogs, serializeLogSimple } = require('../utils/logSerializer');
const ExcelJS = require('exceljs');
const auditV2Service = require('./audit-v2.service');
const securityAlertsService = require('./securityAlerts.service');

// #780: getLogs used to build its Mongo sort spec straight from the
// request's `sortBy`, with no validation. A key no document carries is legal
// in Mongo and compares equal across every document, so on this *paginated*
// query an unrecognized field did not degrade to "unsorted" -- it silently
// returned the wrong page with a 200. Audit logs are also the one collection
// where ordering is part of the meaning.
//
// Derived from Log.js's own document builder rather than guessed, so the
// list cannot drift from what createLog actually writes. Deliberately
// excluded: `timestampFormatted` (a pt-BR display string -- sorting it is
// lexicographic on "dd/mm/yyyy" and meaningless), and the free-form/object
// fields `message`, `payload`, `errorStack` and `metadata`.
const SORTABLE_LOG_FIELDS = new Set([
  'logId',
  'dateTime',
  'timestamp',
  'timestampISO',
  'userId',
  'userName',
  'action',
  'resourceType',
  'resourceId',
  'status',
  'entity',
  'entityID',
  'result',
  'severity',
  'source',
  'ipSource',
  'module',
  'createdAt',
]);

const DEFAULT_LOG_SORT = { dateTime: -1, timestamp: -1 };

/**
 * Service de Logs/Auditoria
 * RNF009 - Auditoria e Rastreabilidade
 * LGPD: Logs não devem conter dados sensíveis de pacientes
 */
class LogService {
  /**
   * Sanitiza dados de log para remover informações sensíveis
   * Mantém dados de rastreamento (IP, User-Agent, etc) que são seguros
   */
  sanitizeLogData(logData) {
    const sanitized = { ...logData };
    
    // Se a entidade é Patient, sanitiza dados sensíveis
    if (sanitized.entity === 'Patient' && sanitized.entityID) {
      // Remove dados sensíveis da mensagem se contiver
      if (sanitized.message && typeof sanitized.message === 'string') {
        // Remove referências a nomes de pacientes da mensagem
        // Mantém apenas referências ao ID
        sanitized.message = sanitized.message.replace(/Paciente\s+[^0-9]+/gi, 'Paciente');
      }
      
      // Garante que entityID seja apenas o ID de 8 dígitos
      if (sanitized.entityID && typeof sanitized.entityID === 'string' && sanitized.entityID.length === 8 && /^\d{8}$/.test(sanitized.entityID)) {
        // ID válido, mantém
      } else {
        // Se não for ID válido, tenta extrair ou remove
        sanitized.entityID = sanitized.entityID?.toString().match(/\d{8}/)?.[0] || 'N/A';
      }
    }

    // Garante que dados de rastreamento (IP, metadata.tracking) sejam preservados
    // Esses dados são seguros e importantes para auditoria
    if (sanitized.metadata && sanitized.metadata.tracking) {
      // Mantém todos os dados de rastreamento
      sanitized.metadata.tracking = { ...sanitized.metadata.tracking };
    }
    
    return sanitized;
  }

  /**
   * Registra um evento de log
   */
  async createLog(db, logData, req) {
    try {
      // Sanitiza dados sensíveis antes de validar
      const sanitizedLogData = this.sanitizeLogData(logData);
      
      const validation = LogModel.validate(sanitizedLogData);
      if (!validation.isValid) {
        throw new Error(validation.errors.join(', '));
      }

      const logsCollection = db.collection('logs');
      const log = LogModel.create(sanitizedLogData, req);

      if (!log.auditHash) {
        const integrityService = require('./integrityCheckService');
        log.auditHash = integrityService.computeAuditHash(log);
      }

      const result = await logsCollection.insertOne(log);
      const insertedId = result && Object.prototype.hasOwnProperty.call(result, 'insertedId')
        ? result.insertedId
        : null;

      if (!insertedId) {
        logger.warn('insertOne de logs retornou sem insertedId; mantendo fluxo sem falha.');
      }

      const createdLog = {
        _id: insertedId,
        ...log
      };

      try {
        await auditV2Service.ingestLogRecord(createdLog, db);
      } catch (auditError) {
        logger.warn('Falha ao espelhar log em audit_events:', auditError.message || auditError);
        // RNF009's Merkle audit trail is tamper-evident by design; a swallowed
        // ingest failure here means it silently stops recording (#369/#394).
        // A warn-level log line alone was proven to hide that for ~4 weeks.
        securityAlertsService.init(db);
        await securityAlertsService.logSecurityAlert({
          type: 'AUDIT_TRAIL_WRITE_FAILURE',
          severity: 'critical',
          userID: createdLog.userId || createdLog.userID,
          action: 'AUDIT_V2_INGEST_FAILED',
          reason: 'Falha ao espelhar log em audit_events (trilha Merkle RNF009)',
          details: {
            logID: createdLog._id,
            entity: createdLog.entity,
            error: auditError.message || String(auditError)
          }
        });
      }

      // Serializa o log criado para converter tipos especiais
      return serializeLogSimple(createdLog);
    } catch (error) {
      logger.error('Erro ao criar log:', error.message);
      throw error;
    }
  }

  /**
   * Busca logs com filtros avançados
   */
  async getLogs(db, filters = {}) {
    try {
      const logsCollection = db.collection('logs');
      const query = {};

      // Filtro por usuário
      const userIdValue = filters.userId || filters.userID || filters.user;
      if (userIdValue) {
        query.$or = [
          { userId: userIdValue },
          { userID: userIdValue },
          { 'metadata.userID': userIdValue }
        ];
      }

      // Filtro por nome de usuário (busca por identificador anonimizado)
      // Nota: userName agora contém identificador anonimizado (USR-XXXX)
      if (filters.userName) {
        query.userName = { $regex: filters.userName, $options: 'i' };
      }

      // Filtro por ação
      if (filters.action) {
        if (Array.isArray(filters.action)) {
          query.action = { $in: filters.action };
        } else {
          query.action = filters.action;
        }
      }

      // Filtro por entidade
      if (filters.entity) {
        if (Array.isArray(filters.entity)) {
          query.entity = { $in: filters.entity };
        } else {
          query.entity = filters.entity;
        }
      }

      // Filtro por tipo de recurso (canônico)
      if (filters.resourceType) {
        const resourceTypeFilter = Array.isArray(filters.resourceType)
          ? { $in: filters.resourceType }
          : filters.resourceType;

        query.$and = query.$and || [];
        query.$and.push({
          $or: [
            { resourceType: resourceTypeFilter },
            { entity: resourceTypeFilter }
          ]
        });
      }

      // Filtro por severidade
      if (filters.severity) {
        if (Array.isArray(filters.severity)) {
          query.severity = { $in: filters.severity };
        } else {
          query.severity = filters.severity;
        }
      }

      // Filtro por resultado
      if (filters.result) {
        if (Array.isArray(filters.result)) {
          query.result = { $in: filters.result };
        } else {
          query.result = filters.result;
        }
      }

      // Filtro por status (canônico)
      if (filters.status) {
        const statusFilter = Array.isArray(filters.status)
          ? { $in: filters.status }
          : filters.status;

        query.$and = query.$and || [];
        query.$and.push({
          $or: [
            { status: statusFilter },
            { result: statusFilter }
          ]
        });
      }

      // Filtro por IP
      if (filters.ip || filters.ipSource || filters.sourceIP) {
        const ipValue = filters.ip || filters.ipSource || filters.sourceIP;
        query.ipSource = { $regex: ipValue, $options: 'i' };
      }

      // Filtro por módulo
      if (filters.module) {
        if (Array.isArray(filters.module)) {
          query.module = { $in: filters.module };
        } else {
          query.module = filters.module;
        }
      }

      // Filtro por busca de texto (busca em message, entity, action)
      if (filters.search) {
        const searchConditions = [
          { message: { $regex: filters.search, $options: 'i' } },
          { action: { $regex: filters.search, $options: 'i' } },
          { userName: { $regex: filters.search, $options: 'i' } }, // Busca por identificador anonimizado
          { entity: { $regex: filters.search, $options: 'i' } },
          { resourceType: { $regex: filters.search, $options: 'i' } }
        ];

        if (query.$or) {
          const existingAnd = Array.isArray(query.$and) ? query.$and : [];
          // Se já existe $or, combina com busca
          query.$and = [
            ...existingAnd,
            { $or: query.$or },
            { $or: searchConditions }
          ];
          delete query.$or;
        } else {
          query.$or = searchConditions;
        }
      }

      // Filtro por intervalo de datas
      if (filters.startDate || filters.endDate) {
        const dateQuery = {};
        if (filters.startDate) {
          dateQuery.$gte = new Date(filters.startDate);
        }
        if (filters.endDate) {
          // Adiciona 23:59:59 ao final do dia
          const endDate = new Date(filters.endDate);
          endDate.setHours(23, 59, 59, 999);
          dateQuery.$lte = endDate;
        }
        
        // Busca tanto em timestamp quanto em dateTime (compatibilidade)
        const dateConditions = [
          { timestamp: dateQuery },
          { dateTime: dateQuery }
        ];

        if (query.$and) {
          query.$and.push({ $or: dateConditions });
        } else if (query.$or) {
          const existingAnd = Array.isArray(query.$and) ? query.$and : [];
          query.$and = [
            ...existingAnd,
            { $or: query.$or },
            { $or: dateConditions }
          ];
          delete query.$or;
        } else {
          query.$or = dateConditions;
        }
      }

      // Paginação
      const limit = parseInt(filters.limit) || 50;
      const skip = parseInt(filters.skip) || 0;
      const page = parseInt(filters.page) || 1;
      const actualSkip = skip || (page - 1) * limit;

      // Ordenação (#780: allow-listed -- see SORTABLE_LOG_FIELDS above)
      const requestedSortBy = typeof filters.sortBy === 'string' ? filters.sortBy.trim() : '';
      const sortField = SORTABLE_LOG_FIELDS.has(requestedSortBy) ? requestedSortBy : null;

      if (requestedSortBy && !sortField) {
        logger.warn(
          `[LOGS] Campo de ordenação não reconhecido, aplicando ordenação padrão: ${requestedSortBy}`
        );
      }

      const sortOrder = filters.sortOrder === 'asc' ? 1 : -1;
      // Falls back to the date pair rather than to the requested name, so an
      // unrecognized field can never reach the driver as a sort key.
      const sort = sortField ? { [sortField]: sortOrder } : { ...DEFAULT_LOG_SORT };

      // Busca logs
      const logs = await logsCollection
        .find(query)
        .sort(sort)
        .limit(limit)
        .skip(actualSkip)
        .toArray();

      // Anonimiza logs antes de retornar (LGPD)
      const anonymizedLogs = await anonymizeLogs(logs, db);

      // Serializa logs para converter tipos especiais do MongoDB (ObjectId, Date, etc.)
      const serializedLogs = serializeLogs(anonymizedLogs);

      // Conta total
      const total = await logsCollection.countDocuments(query);

      return {
        logs: serializedLogs,
        total,
        limit,
        skip: actualSkip,
        page: page || Math.floor(actualSkip / limit) + 1,
        totalPages: Math.ceil(total / limit),
        // #780: the ordering actually applied. Without this the allow-list's
        // fallback would be as silent as the bug it replaces -- a caller
        // sending an unrecognized sortBy would still get a plausible 200 with
        // no way to tell the parameter was dropped (cf. #789).
        sortBy: sortField || 'dateTime',
        sortOrder: sortField && sortOrder === 1 ? 'asc' : 'desc'
      };
    } catch (error) {
      logger.error('Erro ao buscar logs:', error.message);
      throw error;
    }
  }

  /**
   * Busca logs de um usuário específico
   */
  async getUserLogs(db, userID, limit = 50) {
    try {
      const logsCollection = db.collection('logs');
      const query = {
        $or: [
          { userID },
          { userId: userID },
          { userName: userID }
        ]
      };

      const logs = await logsCollection
        .find(query)
        .sort({ dateTime: -1, timestamp: -1 })
        .limit(limit)
        .toArray();

      const anonymizedLogs = await anonymizeLogs(logs, db);
      return serializeLogs(anonymizedLogs);
    } catch (error) {
      logger.error('Erro ao buscar logs do usuário:', error.message);
      throw error;
    }
  }

  /**
   * Busca logs de uma entidade específica
   */
  async getEntityLogs(db, entity, entityID, limit = 50) {
    try {
      const logsCollection = db.collection('logs');
      const query = {
        $and: [
          { $or: [{ entity }, { resourceType: entity }] },
          { $or: [{ entityID }, { resourceId: entityID }] }
        ]
      };

      const logs = await logsCollection
        .find(query)
        .sort({ dateTime: -1, timestamp: -1 })
        .limit(limit)
        .toArray();

      // Serializa logs para converter tipos especiais
      return serializeLogs(logs);
    } catch (error) {
      logger.error('Erro ao buscar logs da entidade:', error.message);
      throw error;
    }
  }

  /**
   * Exporta logs para CSV
   */
  async exportLogsToCSV(db, filters = {}) {
    try {
      const { stringify } = require('csv-stringify/sync');
      const result = await this.getLogs(db, { ...filters, limit: 10000 }); // Limite alto para exportação
      
      const headers = [
        'ID',
        'Timestamp',
        'Usuário',
        'Ação',
        'Entidade',
        'ID Entidade',
        'Resultado',
        'Severidade',
        'Módulo',
        'IP de Origem',
        'Mensagem'
      ];

      // Logs já vêm anonimizados do getLogs, mas garante anonimização aqui também
      const anonymizedLogs = await anonymizeLogs(result.logs, db);
      
      const rows = anonymizedLogs.map(log => [
        log._id?.toString() || log.logID || 'N/A',
        log.timestampFormatted || log.timestampISO || (log.timestamp ? new Date(log.timestamp).toISOString() : 'N/A'),
        log.userName || 'USR-SYSTEM', // Já anonimizado
        log.action || 'N/A',
        log.entity || 'N/A',
        log.entityID || 'N/A',
        log.result || 'N/A',
        log.severity || 'N/A',
        log.module || 'N/A',
        log.ipSource || 'N/A',
        log.message || 'N/A'
      ]);

      const csvContent = stringify([headers, ...rows]);

      return csvContent;
    } catch (error) {
      logger.error('Erro ao exportar logs para CSV:', error.message);
      throw error;
    }
  }

  /**
   * Exporta logs para Excel
   */
  async exportLogsToExcel(db, filters = {}) {
    try {
      // Busca logs com limite alto para exportação
      const result = await this.getLogs(db, { ...filters, limit: 10000 });
      
      // Valida estrutura da resposta
      if (!result || typeof result !== 'object') {
        throw new Error('Resposta inválida do serviço de logs');
      }
      
      const logs = result.logs || [];
      if (!Array.isArray(logs)) {
        throw new Error('Dados de logs em formato inválido');
      }
      
      // Se não houver logs, cria arquivo vazio com apenas headers
      if (logs.length === 0) {
        logger.warn('Nenhum log encontrado para exportação');
      }
      
      const headers = [
        'ID',
        'Timestamp',
        'Usuário',
        'Ação',
        'Entidade',
        'ID Entidade',
        'Resultado',
        'Severidade',
        'Módulo',
        'IP de Origem',
        'Mensagem',
        'Payload',
        'Stack de Erro'
      ];

      // Logs já vêm anonimizados do getLogs, mas garante anonimização aqui também
      let anonymizedLogs = logs;
      try {
        anonymizedLogs = await anonymizeLogs(logs, db);
      } catch (anonymizeError) {
        logger.warn('Erro ao anonimizar logs, usando logs originais:', anonymizeError.message);
        anonymizedLogs = logs;
      }
      
      const rows = anonymizedLogs.map(log => {
        try {
          // Extrai IP de forma segura
          let ipSource = 'N/A';
          if (log.ipSource) {
            ipSource = String(log.ipSource);
          } else if (log.sourceIP) {
            ipSource = String(log.sourceIP);
          } else if (log.metadata && typeof log.metadata === 'object' && log.metadata.tracking && log.metadata.tracking.ip) {
            ipSource = String(log.metadata.tracking.ip);
          }
          
          // Extrai timestamp de forma segura
          let timestamp = 'N/A';
          if (log.timestampFormatted) {
            timestamp = String(log.timestampFormatted);
          } else if (log.timestampISO) {
            timestamp = String(log.timestampISO);
          } else if (log.timestamp) {
            try {
              const date = log.timestamp instanceof Date ? log.timestamp : new Date(log.timestamp);
              timestamp = isNaN(date.getTime()) ? 'N/A' : date.toISOString();
            } catch {
              timestamp = 'N/A';
            }
          }
          
          // Extrai ID de forma segura
          let logId = 'N/A';
          if (log._id) {
            logId = typeof log._id === 'string' ? log._id : String(log._id);
          } else if (log.logID) {
            logId = String(log.logID);
          }
          
          return [
            logId,
            timestamp,
            log.userName || 'USR-SYSTEM',
            log.action || 'N/A',
            log.entity || 'N/A',
            log.entityID ? String(log.entityID) : 'N/A',
            log.result || 'N/A',
            log.severity || 'N/A',
            log.module || 'N/A',
            ipSource,
            log.message ? String(log.message) : 'N/A',
            log.payload ? (typeof log.payload === 'string' ? log.payload : JSON.stringify(log.payload)) : 'N/A',
            log.errorStack ? String(log.errorStack) : 'N/A'
          ];
        } catch (rowError) {
          logger.warn('Erro ao processar linha de log:', rowError.message);
          return headers.map(() => 'N/A');
        }
      });

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Logs');
      worksheet.addRow(headers);
      rows.forEach((row) => worksheet.addRow(row));

      const buffer = await workbook.xlsx.writeBuffer();
      return Buffer.from(buffer);
    } catch (error) {
      logger.error('Erro ao exportar logs para Excel:', error.message);
      logger.error('Rastreamento:', error.stack);
      throw new Error(`Erro ao exportar logs: ${error.message}`);
    }
  }
}

module.exports = new LogService();
