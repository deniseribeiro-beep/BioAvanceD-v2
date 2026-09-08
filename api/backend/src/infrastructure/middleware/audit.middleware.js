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
 * Lista de entidades válidas do sistema
 */
const VALID_ENTITIES = [
  'Access',
  'Authentication',
  'Equipment',
  'Export',
  'Import',
  'Log',
  'Patient',
  'Policy',
  'Report',
  'Result',
  'Sample',
  'Sensor',
  'Sistema',
  'Temperature',
  'User'
];

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
  
  const entityMap = {
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
    'result': 'Result'
  };
  
  // Se o recurso está no mapa, retorna a entidade correspondente
  if (entityMap[resource]) {
    return entityMap[resource];
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
  auditRequest
};

