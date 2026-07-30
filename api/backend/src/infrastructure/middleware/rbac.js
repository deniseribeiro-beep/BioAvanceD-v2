/**
 * Middleware RBAC (Role-Based Access Control)
 * RNF008 - Controle de Acesso Baseado em Função
 * 
 * AccessTypes (corrigidos):
 * 1 = UsuarioExterno
 * 2 = Tecnico
 * 3 = Coordenador
 * 4 = Administrador
 */

const logger = require('../../utils/logger');

function resolveUserRole(user = {}) {
  const roleFromAccessType = Number(user.accessType || user.role || 0);
  if ([1, 2, 3, 4].includes(roleFromAccessType)) {
    return roleFromAccessType;
  }

  const normalizedRoleName = String(user.roleName || user.role || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

  const roleNameToAccessType = {
    administrador: 4,
    admin: 4,
    coordenador: 3,
    tecnico: 2,
    pesquisador: 1,
    pesquisadora: 1,
    researcher: 1,
    'usuario externo': 1,
    'usuário externo': 1,
    external: 1,
  };

  return roleNameToAccessType[normalizedRoleName] || 1;
}

/**
 * Verifica se o usuário tem o nível de acesso necessário
 */
const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Não autenticado',
        message: 'É necessário fazer login'
      });
    }

    const userRole = resolveUserRole(req.user);
    
    // Verifica se é administrador também por roleName (fallback)
    const isAdminByRoleName = req.user.roleName === 'Administrador';
    const isAdminByAccessType = userRole === 4;
    const isAdmin = isAdminByRoleName || isAdminByAccessType;

    // Se a rota requer administrador (4), verifica ambos os métodos
    if (allowedRoles.includes(4) && !isAdmin) {
      logger.warn(`Acesso negado para usuário ${req.user.userID} - Role: ${userRole}, RoleName: ${req.user.roleName}, Requerido: ${allowedRoles.join(', ')}`);
      return res.status(403).json({
        success: false,
        error: 'Acesso negado',
        message: 'Apenas administradores podem acessar este recurso'
      });
    }

    if (!allowedRoles.includes(userRole)) {
      logger.warn(`Acesso negado para usuário ${req.user.userID} - Role: ${userRole}, RoleName: ${req.user.roleName}, Requerido: ${allowedRoles.join(', ')}`);
      return res.status(403).json({
        success: false,
        error: 'Acesso negado',
        message: 'Você não tem permissão para acessar este recurso'
      });
    }

    next();
  };
};

/**
 * Permissões específicas por funcionalidade
 */
const permissions = {
  // RF003 - Cadastro de usuário
  createUser: [3, 4], // Coordenador (3), Administrador (4)

  // RF004 - Cadastro de amostra
  createSample: [2, 3, 4], // Técnico (2), Coordenador (3), Administrador (4)
  
  // Editar e deletar amostra
  editSample: [3, 4], // Coordenador (3), Administrador (4)
  deleteSample: [4], // Least privilege: apenas Administrador (4)

  // RF005 - Cadastro de paciente
  createPatient: [3, 4], // Coordenador (3), Administrador (4)

  // RF006 - Retirada de amostra
  withdrawSample: [2, 3, 4], // Técnico (2), Coordenador (3), Administrador (4)

  // RF007 - Upload de arquivos de análise (apenas Admin e Coordenador)
  uploadSampleFiles: [3, 4], // Coordenador (3), Administrador (4)
  deleteSampleFiles: [3, 4], // Coordenador (3), Administrador (4)
  
  // RF007 - Upload de arquivos (geral - mantido para compatibilidade)
  uploadFiles: [2, 3, 4], // Técnico (2), Coordenador (3), Administrador (4)

  // RF008 - Relatórios
  viewReports: [1, 2, 3, 4], // Todos: Usuário Externo (1), Técnico (2), Coordenador (3), Administrador (4)

  // RF009 - Visualizar temperatura
  viewTemperature: [2, 3, 4], // Técnico (2), Coordenador (3), Administrador (4)

  // RF009 - Gerenciar incidentes de temperatura (reconhecer/resolver/escalar)
  manageTemperature: [2, 3, 4], // Técnico (2), Coordenador (3), Administrador (4)

  // RF010 - Backup
  manageBackup: [4], // Apenas Administrador (4)

  // Gerenciar sistema
  manageSystem: [4], // Apenas Administrador (4)
  
  // Reset MFA
  resetMFA: [4], // Apenas Administrador (4)

  // Organization entity (#346) - foundational institutional-scope data
  manageOrganizations: [4], // Apenas Administrador (4)
};

/**
 * Middleware para verificar permissão específica
 */
const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Não autenticado',
        message: 'É necessário fazer login'
      });
    }

    const userRole = resolveUserRole(req.user);
    const allowedRoles = permissions[permission];

    if (!allowedRoles) {
      logger.error(`Permissão não definida: ${permission}`);
      return res.status(500).json({
        success: false,
        error: 'Erro de configuração',
        message: 'Permissão não configurada'
      });
    }

    if (!allowedRoles.includes(userRole)) {
      logger.warn(`Permissão negada: ${permission} para usuário ${req.user.userID} (Role: ${userRole})`);
      
      // Registra tentativa de acesso negado
      setImmediate(async () => {
        try {
          const db = req.app.locals.db;
          if (db) {
            const auditLogger = require('../../utils/auditLogger');
            auditLogger.init(db);
            await auditLogger.log({
              action: 'FORBIDDEN',
              entity: 'Access',
              result: 'error',
              severity: 'warning',
              message: `Tentativa de acesso negado: ${permission} (Role: ${userRole})`,
              req: req,
              module: 'Segurança'
            });
          }
        } catch (error) {
          // Não bloqueia se houver erro no log
        }
      });
      
      return res.status(403).json({
        success: false,
        error: 'Acesso negado',
        message: 'Você não tem permissão para esta ação'
      });
    }

    next();
  };
};

module.exports = {
  requireRole,
  requirePermission,
  permissions
};

