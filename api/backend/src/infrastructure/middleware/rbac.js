/**
 * Middleware RBAC (Role-Based Access Control)
 * RNF008 - Controle de Acesso Baseado em Função
 *
 * #421: enforcement resolves via UserRoleAssignment -> Role -> Permission
 * (see rbac-assignment.service.js), not accessType/roleName — atomic
 * cutover per dict-07's migration-table rule, no dual-read of the old
 * fields here. hierarchyLevel mirrors the old accessType numbering:
 * 1 = UsuarioExterno, 2 = Tecnico, 3 = Coordenador, 4 = Administrador.
 */

const logger = require('../../utils/logger');
const { resolveUserHierarchyLevel, userHasPermission } = require('../../services/rbac-assignment.service');

function getDb(req) {
  return req.app && req.app.locals && req.app.locals.db;
}

/**
 * Verifica se o usuário tem o nível de acesso necessário
 */
const requireRole = (...allowedRoles) => {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Não autenticado',
        message: 'É necessário fazer login'
      });
    }

    const db = getDb(req);
    if (!db) {
      logger.error('requireRole: req.app.locals.db indisponível');
      return res.status(500).json({
        success: false,
        error: 'Erro interno',
        message: 'Erro ao verificar permissões'
      });
    }

    const userLevel = await resolveUserHierarchyLevel(db, req.user.userID);

    if (userLevel === null || !allowedRoles.includes(userLevel)) {
      logger.warn(`Acesso negado para usuário ${req.user.userID} - Nível: ${userLevel}, Requerido: ${allowedRoles.join(', ')}`);
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
 * Permissões específicas por funcionalidade (nomes usados como
 * permissionCode no catálogo Permission — ver rbac-catalog-seed.service.js)
 */
const permissions = {
  createUser: true,
  createSample: true,
  editSample: true,
  deleteSample: true,
  createPatient: true,
  withdrawSample: true,
  uploadSampleFiles: true,
  deleteSampleFiles: true,
  uploadFiles: true,
  viewReports: true,
  viewTemperature: true,
  manageTemperature: true,
  manageBackup: true,
  manageSystem: true,
  resetMFA: true,
  manageOrganizations: true,
};

/**
 * Middleware para verificar permissão específica
 */
const requirePermission = (permission) => {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Não autenticado',
        message: 'É necessário fazer login'
      });
    }

    if (!permissions[permission]) {
      logger.error(`Permissão não definida: ${permission}`);
      return res.status(500).json({
        success: false,
        error: 'Erro de configuração',
        message: 'Permissão não configurada'
      });
    }

    const db = getDb(req);
    if (!db) {
      logger.error('requirePermission: req.app.locals.db indisponível');
      return res.status(500).json({
        success: false,
        error: 'Erro interno',
        message: 'Erro ao verificar permissões'
      });
    }

    const hasPermission = await userHasPermission(db, req.user.userID, permission);

    if (!hasPermission) {
      logger.warn(`Permissão negada: ${permission} para usuário ${req.user.userID}`);

      // Registra tentativa de acesso negado
      setImmediate(async () => {
        try {
          if (db) {
            const auditLogger = require('../../utils/auditLogger');
            auditLogger.init(db);
            await auditLogger.log({
              action: 'FORBIDDEN',
              entity: 'Access',
              result: 'error',
              severity: 'warning',
              message: `Tentativa de acesso negado: ${permission}`,
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
