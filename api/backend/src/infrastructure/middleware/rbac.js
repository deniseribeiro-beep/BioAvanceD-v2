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
const {
  resolveUserHierarchyLevel,
  userHasPermission,
  resolveUserOrganizationScope,
  isOrganizationScopeUsable,
} = require('../../services/rbac-assignment.service');
const { PERMISSION_CATALOG } = require('../../services/rbac-catalog-seed.service');

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
 * permissionCode no catálogo Permission). Derivado de PERMISSION_CATALOG
 * (rbac-catalog-seed.service.js) em vez de listado à parte, para que um
 * novo permissionCode só precise ser adicionado uma vez (#436).
 */
const permissions = Object.fromEntries(
  Object.keys(PERMISSION_CATALOG).map((code) => [code, true])
);

/**
 * #631: default HTTP-verb -> dict-02 action mapping, used when a route
 * doesn't pass an explicit action to `requirePermission`. Deliberately
 * the lowest-risk shape (#630's own audit note): this covers every call
 * site whose derived action is already within its permissionCode's
 * (now #630-corrected) allowedActions, which is the overwhelming
 * majority. Only a route where the default would derive an action
 * outside its code's allowedActions needs the explicit override.
 */
const METHOD_TO_ACTION = {
  GET: 'READ',
  HEAD: 'READ',
  POST: 'CREATE',
  PUT: 'UPDATE',
  PATCH: 'UPDATE',
  DELETE: 'DELETE',
};

function logForbiddenAttempt(db, req, message) {
  setImmediate(async () => {
    try {
      if (db) {
        const auditLogger = require('../../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'FORBIDDEN',
          resourceType: 'Access',
          status: 'error',
          severity: 'warning',
          message,
          req: req,
          module: 'Segurança'
        });
      }
    } catch (error) {
      // Não bloqueia se houver erro no log
    }
  });
}

/**
 * Middleware para verificar permissão específica.
 *
 * #631: also enforces `PERMISSION_CATALOG[permission].allowedActions` —
 * the action is `explicitAction` when the route passes one, otherwise
 * derived from `req.method` via `METHOD_TO_ACTION`. A route whose real
 * action doesn't match its HTTP verb (e.g. a POST that reads/updates an
 * existing resource rather than creating one) must pass `explicitAction`
 * explicitly; see #630's audit for which call sites need it.
 */
const requirePermission = (permission, explicitAction) => {
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
      logForbiddenAttempt(db, req, `Tentativa de acesso negado: ${permission}`);
      return res.status(403).json({
        success: false,
        error: 'Acesso negado',
        message: 'Você não tem permissão para esta ação'
      });
    }

    const action = explicitAction || METHOD_TO_ACTION[req.method];
    const allowedActions = PERMISSION_CATALOG[permission].allowedActions;
    if (!action || !allowedActions.includes(action)) {
      logger.warn(`Ação não permitida: ${action || req.method} para permissão ${permission} (usuário ${req.user.userID})`);
      logForbiddenAttempt(db, req, `Ação não permitida: ${action || req.method} para permissão ${permission}`);
      return res.status(403).json({
        success: false,
        error: 'Acesso negado',
        message: 'Você não tem permissão para esta ação'
      });
    }

    next();
  };
};

/**
 * #340 (RF003 AC#3): resolves the caller's organization scope
 * (rbac-assignment.service#resolveUserOrganizationScope) and attaches it as
 * req.organizationScope for the route to filter/check against. Org-less
 * users ('none'/'unassigned' scope) get a hard 403 here rather than an
 * empty list — the product decision confirmed 2026-08-18. Administrador
 * (hierarchyLevel 4) resolves to 'global' and is left unfiltered by the
 * route, same bypass every other RBAC gate in this file gives it.
 */
const requireOrganizationScope = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'Não autenticado',
      message: 'É necessário fazer login'
    });
  }

  const db = getDb(req);
  if (!db) {
    logger.error('requireOrganizationScope: req.app.locals.db indisponível');
    return res.status(500).json({
      success: false,
      error: 'Erro interno',
      message: 'Erro ao verificar escopo organizacional'
    });
  }

  const scope = await resolveUserOrganizationScope(db, req.user.userID);

  if (!isOrganizationScopeUsable(scope)) {
    logger.warn(`Acesso negado por escopo organizacional: usuário ${req.user.userID} sem organização atribuída (scope=${scope.scope})`);
    return res.status(403).json({
      success: false,
      error: 'Sem organização atribuída',
      message: 'Seu usuário não possui organização atribuída para acessar este recurso'
    });
  }

  req.organizationScope = scope;
  next();
};

module.exports = {
  requireRole,
  requirePermission,
  requireOrganizationScope,
  permissions
};
