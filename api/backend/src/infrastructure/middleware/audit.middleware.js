/**
 * Middleware de Auditoria Global
 * Registra automaticamente todas as requisições e respostas
 */
const auditLogger = require('../../utils/auditLogger');

/**
 * Middleware para registrar requisições HTTP
 */
const auditRequest = async (req, res, next) => {
  // Ignora rotas de health check e keepalive (muito frequentes)
  const ignoredPaths = ['/api/health', '/api/auth/keepalive'];
  if (ignoredPaths.includes(req.path)) {
    return next();
  }

  const startTime = Date.now();
  const originalSend = res.send.bind(res);
  
  // Intercepta resposta para registrar status
  res.send = function(data) {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;
    
    // Registra requisição (assíncrono, não bloqueia resposta)
    setImmediate(async () => {
      try {
        const db = req.app.locals.db;
        if (db) {
          auditLogger.init(db);
          
          // Determina ação baseada no método HTTP e status
          let action = normalizeHttpMethodToAction(req.method, req.path);
          let result = 'success';
          let severity = 'info';
          
          if (statusCode >= 500) {
            result = 'error';
            severity = 'error';
            action = `${action}_ERROR`;
          } else if (statusCode >= 400) {
            result = 'error';
            severity = 'warning';
            if (statusCode === 401) {
              action = 'UNAUTHORIZED';
            } else if (statusCode === 403) {
              action = 'FORBIDDEN';
            } else {
              action = `${action}_FAILED`;
            }
          }
          
          // Determina entidade baseada na rota
          const entity = determineEntity(req.path);
          
          // Determina módulo
          const module = determineModule(req.path);
          
          await auditLogger.log({
            action: action,
            resourceType: entity,
            status: result,
            severity: severity,
            message: `${req.method} ${req.path} - ${statusCode} (${duration}ms)`,
            req: req,
            module: module,
            payload: {
              method: req.method,
              path: req.path,
              statusCode: statusCode,
              duration: duration,
              query: Object.keys(req.query).length > 0 ? 'present' : null
            }
          });
        }
      } catch (error) {
        // Não bloqueia requisição se houver erro no log
        console.error('Erro ao registrar auditoria:', error.message);
      }
    });
    
    return originalSend(data);
  };
  
  next();
};

/**
 * #1115: URL segment -> canonical resourceType (dict-02 P1X-0326, "Tipo da
 * entidade afetada"). This map decides the resourceType on the AUTOMATIC
 * audit row for every request, because app.js mounts auditRequest globally.
 *
 * It used to live inside determineEntity with 26 keys, beside a separate
 * 15-entry VALID_ENTITIES list, and the two had already drifted apart. It
 * covered 14 of the 59 /api prefixes app.js mounts, so 45 route families --
 * security, legal-holds, retention-policies, e-consent, backup and audit
 * among them -- recorded the catch-all Sistema on every automatic row.
 *
 * Hoisted to module scope with VALID_ENTITIES derived from it, so there is
 * one vocabulary instead of two. Names are grounded, in this order: the
 * literal the codebase already passes to auditLogger for that domain (that
 * is where storage -> StorageContainer comes from), else dict-02's Entidade
 * column (AuditEvent, Collection, Consent, RCSAssessment, RetentionPolicy,
 * SecurityConfiguration, TerminologyConcept), else the singular of the
 * resource. audit-entity-coverage.arch.test.js fails if a newly mounted
 * prefix is missing from here and not declared entity-less below.
 *
 * HISTORICAL CUTOFF (#1117). This map was filled in a84eaa63. Audit rows
 * written BEFORE that commit carry resourceType Sistema for the 41 route
 * families it added, and cannot be corrected -- the trail is immutable and
 * hash-chained (#1094/#1105). Only 4 of those 41 also audited explicitly
 * via auditLogger (facilities, rooms, security, storage), so for the other
 * 37 -- e-consent, legal-holds, retention-policies, access-requests and
 * disposition-actions among them -- Sistema is the only type their
 * historical rows ever recorded. A resourceType query over any of those
 * families is incomplete before that commit, and Sistema does not look
 * wrong the way a null would.
 */
const ENTITY_MAP = {
  'auth': 'Authentication',
  'users': 'User',
  'user': 'User',
  'patients': 'Patient',
  'pacientes': 'Patient',
  'patient': 'Patient',
  'samples': 'Sample',
  'sample': 'Sample',
  'Samples': 'Sample',
  'amostras': 'Sample',
  'temperature': 'Temperature',
  'sensors': 'Sensor',
  'sensor': 'Sensor',
  'reports': 'Report',
  'report': 'Report',
  'import': 'Import',
  'import-lgpd': 'Import',
  'export': 'Export',
  'logs': 'Log',
  'log': 'Log',
  'access': 'Access',
  'equipment': 'Equipment',
  'policies': 'Policy',
  'policy': 'Policy',
  'results': 'Result',
  'result': 'Result',

  // #1115: the 40 mounted prefixes that previously fell through to Sistema.
  'access-requests': 'AccessRequest',
  'analysis-files': 'AnalysisFile',
  'analysis-types': 'AnalysisType',
  'assays': 'Assay',
  'audit': 'AuditEvent',
  'backup': 'Backup',
  'backup-policy': 'BackupPolicy',
  'cids': 'Cid',
  'collections': 'Collection',
  'compliance': 'Compliance',
  'datasets': 'Dataset',
  'disposition-actions': 'DispositionAction',
  'e-consent': 'Consent',
  'extraction-protocols': 'ExtractionProtocol',
  'facilities': 'Facility',
  'hpo': 'TerminologyConcept',
  'incidents': 'Incident',
  'iot': 'TelemetryReading',
  'legal-holds': 'LegalHold',
  'measurement-units': 'MeasurementUnit',
  'nonconformances': 'Nonconformance',
  'notification-rules': 'NotificationRule',
  'notifications': 'Notification',
  'omics-qualifications': 'OmicsQualification',
  'omics-runs': 'OmicsRun',
  'organizations': 'Organization',
  'orphanet': 'TerminologyConcept',
  'protocols': 'Protocol',
  'quality': 'RCSAssessment',
  'quality-descriptions': 'QualityDescription',
  'reagent-lots': 'ReagentLot',
  'report-templates': 'ReportTemplate',
  'retention-policies': 'RetentionPolicy',
  'rooms': 'Room',
  'sample-origins': 'SampleOrigin',
  'sample-types': 'SampleType',
  'security': 'SecurityConfiguration',
  'storage': 'StorageContainer',
  'studies': 'Study',
  'terminologies': 'TerminologyConcept',
  'workflow-runs': 'WorkflowRun'
};

/**
 * #1115: prefixes that deliberately have NO affected entity, so Sistema is
 * the correct resourceType rather than a gap. Declared explicitly so the
 * architecture test can tell "decided" from "not yet mapped" -- that is the
 * whole difference between this list and the silence it replaces.
 *
 *  health         liveness probe, not an operation on anything
 *  dictionary     reads the canonical data dictionary itself
 *  phone-codes    static reference lookup
 *  intake-wizard  multi-entity workflow; its handlers audit explicitly
 */
const NO_ENTITY_ROUTES = [
  'health',
  'dictionary',
  'phone-codes',
  'intake-wizard'
];

/**
 * Lista de entidades válidas do sistema, derivada do mapa acima (#1115).
 * Antes era uma segunda lista mantida à mão, que já havia divergido.
 */
const VALID_ENTITIES = [...new Set(Object.values(ENTITY_MAP)), 'Sistema'];

/**
 * Determina entidade baseada no path
 */
function determineEntity(path) {
  const pathParts = path.split('/').filter(p => p);
  
  // Remove 'api' se presente
  if (pathParts[0] === 'api') {
    pathParts.shift();
  }
  
  if (pathParts.length === 0) return 'Sistema';
  
  const resource = pathParts[0];
  
  // Verifica se é um ObjectId ou ID numérico longo (não deve ser uma entidade)
  const isObjectId = /^[0-9a-fA-F]{24}$/.test(resource);
  const isLongNumericId = /^\d{8,}$/.test(resource);
  
  if (isObjectId || isLongNumericId) {
    // Se for um ID, tenta pegar a entidade do segundo path part
    if (pathParts.length > 1) {
      return determineEntity('/' + pathParts.slice(1).join('/'));
    }
    return 'Sistema';
  }

  // #1115: a version segment carries no entity either -- the affected
  // entity is in the sub-path, exactly as with an id above. app.js mounts
  // /api/v1/patients, which resolved to Sistema because v1 is not a
  // resource name. Found by audit-entity-coverage.arch.test.js.
  if (/^v\d+$/.test(resource) && pathParts.length > 1) {
    return determineEntity('/' + pathParts.slice(1).join('/'));
  }
  
  // Se o recurso está no mapa, retorna a entidade correspondente (#1115:
  // o mapa agora é ENTITY_MAP, no escopo do módulo).
  if (ENTITY_MAP[resource]) {
    return ENTITY_MAP[resource];
  }
  
  // Tenta criar uma entidade válida a partir do nome do recurso
  const capitalized = resource.charAt(0).toUpperCase() + resource.slice(1);
  
  // Verifica se está na lista de entidades válidas
  if (VALID_ENTITIES.includes(capitalized)) {
    return capitalized;
  }
  
  // Se não encontrou, retorna 'Sistema' como padrão seguro
  return 'Sistema';
}

/**
 * Normaliza método HTTP para ação semântica
 * GET -> READ, POST -> CREATE, PUT -> UPDATE, DELETE -> DELETE, etc.
 */
function normalizeHttpMethodToAction(method, path) {
  const methodUpper = method.toUpperCase();
  
  // Rotas especiais
  if (path.includes('/login')) return 'LOGIN';
  if (path.includes('/logout')) return 'LOGOUT';
  if (path.includes('/register')) return 'REGISTER';
  if (path.includes('/import')) return 'IMPORT';
  if (path.includes('/export')) return 'EXPORT';
  if (path.includes('/query')) return 'QUERY';
  if (path.includes('/generate')) return 'GENERATE';
  if (path.includes('/validate')) return 'VALIDATE';
  if (path.includes('/reset-mfa') || path.includes('/mfa')) return 'MFA';
  
  // Normaliza métodos HTTP para ações semânticas
  switch (methodUpper) {
    case 'GET':
      // GET em rota com ID específico é READ
      const pathParts = path.split('/').filter(p => p);
      const hasIdInPath = pathParts.some(part => /^[0-9a-fA-F]{24}$/.test(part) || /^\d{8,}$/.test(part));
      return hasIdInPath ? 'READ' : 'QUERY';
    case 'POST':
      return 'CREATE';
    case 'PUT':
    case 'PATCH':
      return 'UPDATE';
    case 'DELETE':
      return 'DELETE';
    default:
      return methodUpper;
  }
}

/**
 * Determina módulo baseado no path
 */
function determineModule(path) {
  if (path.includes('/auth')) return 'Autenticação';
  if (path.includes('/user') || path.includes('/access')) return 'Usuários';
  if (path.includes('/patient') || path.includes('/paciente')) return 'Cadastro';
  if (path.includes('/sample') || path.includes('/amostra')) return 'Amostras';
  if (path.includes('/temperature') || path.includes('/sensor')) return 'Monitoramento';
  if (path.includes('/report')) return 'Relatórios';
  if (path.includes('/import')) return 'Importação';
  if (path.includes('/export') || path.includes('/log')) return 'Exportação';
  if (path.includes('/equipment') || path.includes('/location')) return 'Configuração';
  return 'Sistema';
}

module.exports = {
  auditRequest,
  // #1115: exported for audit-entity-coverage.arch.test.js, which asserts
  // every prefix app.js mounts resolves to something other than 'Sistema'
  // unless it is declared entity-less.
  determineEntity,
  ENTITY_MAP,
  NO_ENTITY_ROUTES
};

