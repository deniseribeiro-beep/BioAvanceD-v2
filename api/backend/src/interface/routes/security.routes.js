const express = require('express');
const router = express.Router();
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requireRole } = require('../../infrastructure/middleware/rbac');
const securityService = require('../../services/security.service');
const notificationService = require('../../services/notification.service');
const logger = require('../../utils/logger');
const auditLogger = require('../../utils/auditLogger');

/**
 * Todas as rotas de segurança requerem autenticação e perfil Administrador
 */
router.use(authenticate);
router.use(requireRole(4)); // Apenas Administrador (hierarchyLevel 4)

/**
 * GET /api/security/config
 * Retorna todas as configurações de segurança atuais
 */
router.get('/config', async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: (req.t && req.t('errors.databaseUnavailable')) || 'Banco de dados não disponível'
      });
    }

    const config = await securityService.getConfig(db);

    return res.status(200).json({
      success: true,
      data: config
    });
  } catch (error) {
    logger.error('Erro ao buscar configurações de segurança:', error.message);
    return res.status(500).json({
      success: false,
      error: (req.t && req.t('security.getConfigError')) || 'Erro ao buscar configurações de segurança',
      message: error.message
    });
  }
});

/**
 * PUT /api/security/config
 * Atualiza configurações de segurança
 */
router.put('/config', async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: (req.t && req.t('errors.databaseUnavailable')) || 'Banco de dados não disponível'
      });
    }

    // Busca configuração atual para comparar mudanças
    const currentConfig = await securityService.getConfig(db);
    
    // Valida e atualiza configurações
    const updatedConfig = await securityService.updateConfig(db, req.body, currentConfig, req);

    return res.status(200).json({
      success: true,
      message: (req.t && req.t('security.updateConfigSuccess')) || 'Configurações de segurança atualizadas com sucesso',
      data: updatedConfig
    });
  } catch (error) {
    logger.error('Erro ao atualizar configurações de segurança:', error.message);
    // A ConfigurationReleaseError carries its status (409: another change
    // was activated first), and a ConfigurationValidationError its own (422:
    // a governance invariant was broken, 400: another gate failed); anything
    // else is a refused configuration.
    return res.status(error.statusCode || 400).json({
      success: false,
      error: (req.t && req.t('security.updateConfigError')) || 'Erro ao atualizar configurações de segurança',
      message: error.message,
      ...(error.validationRun ? {
        configurationValidationRunId: error.validationRun.configurationValidationRunId,
        violatedInvariants: error.violatedInvariants,
        violations: error.violations,
      } : {})
    });
  }
});

/**
 * GET /api/security/config/releases
 * RF014 AC4: the ConfigurationRelease history of this environment's
 * security configuration, newest first.
 */
router.get('/config/releases', async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: (req.t && req.t('errors.databaseUnavailable')) || 'Banco de dados não disponível'
      });
    }
    const requested = Number.parseInt(req.query.limit, 10);
    const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, 200) : 50;
    const releases = await securityService.listReleases(db, { limit });
    return res.status(200).json({ success: true, data: releases });
  } catch (error) {
    logger.error('Erro ao listar releases de configuração:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao listar releases de configuração',
      message: error.message
    });
  }
});

/**
 * GET /api/security/config/catalog
 * RF014 AC1, CFG-002: the setting catalog, one entry per configuration key
 * with its type, scope, allowed values, default, dependencies, owner and
 * validity.
 */
router.get('/config/catalog', (req, res) => {
  return res.status(200).json({ success: true, data: securityService.settingCatalog() });
});

/**
 * POST /api/security/config/rollback
 * RF014 AC4: governed rollback to an earlier release, recorded as a new
 * release. Body: { configurationReleaseId }.
 */
router.post('/config/rollback', async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: (req.t && req.t('errors.databaseUnavailable')) || 'Banco de dados não disponível'
      });
    }
    const { configurationReleaseId } = req.body || {};
    if (!configurationReleaseId || typeof configurationReleaseId !== 'string') {
      return res.status(400).json({ success: false, error: 'configurationReleaseId é obrigatório' });
    }
    const updatedConfig = await securityService.rollbackConfig(db, configurationReleaseId, req);
    return res.status(200).json({
      success: true,
      message: 'Configuração revertida para a release solicitada',
      data: updatedConfig
    });
  } catch (error) {
    logger.error('Erro ao reverter configuração de segurança:', error.message);
    return res.status(error.statusCode || 400).json({
      success: false,
      error: 'Erro ao reverter configuração de segurança',
      message: error.message
    });
  }
});

/**
 * GET /api/security/logs/export
 * Exporta logs filtrados (CSV ou JSON)
 */
router.get('/logs/export', async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: (req.t && req.t('errors.databaseUnavailable')) || 'Banco de dados não disponível'
      });
    }

    const format = req.query.format || 'csv'; // csv ou json
    const filters = {
      severity: req.query.severity,
      module: req.query.module,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      action: req.query.action,
      entity: req.query.entity,
      source: req.query.source // #1271: 'archive' exports logs_archive
    };

    const exportData = await securityService.exportLogs(db, filters, format);

    // Registra log de exportação
    auditLogger.init(db);
    await auditLogger.log({
      action: 'EXPORT',
      resourceType: 'Logs',
      status: 'success',
      severity: 'info',
      message: (req.t && req.t('security.logsExportMessage')) ? req.t('security.logsExportMessage').replace('{format}', format) : `Exportação de logs realizada (formato: ${format})`,
      payload: { format, filters },
      req: req,
      module: (req.t && req.t('common.security')) || 'Segurança'
    });

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=logs_${new Date().toISOString().split('T')[0]}.csv`);
      return res.status(200).send(exportData);
    } else {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=logs_${new Date().toISOString().split('T')[0]}.json`);
      return res.status(200).json(exportData);
    }
  } catch (error) {
    // #1271: an unknown ?source= (log.service's logSourceCollection).
    if (error.statusCode === 422) {
      return res.status(422).json({ success: false, error: 'Dados inválidos', message: error.message, details: error.details || [error.message] });
    }
    logger.error('Erro ao exportar logs:', error.message);
    return res.status(500).json({
      success: false,
      error: (req.t && req.t('security.exportLogsError')) || 'Erro ao exportar logs',
      message: error.message
    });
  }
});

/**
 * GET /api/security/permissions
 * Lista permissões por perfil
 */
router.get('/permissions', async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: (req.t && req.t('errors.databaseUnavailable')) || 'Banco de dados não disponível'
      });
    }

    const permissions = await securityService.getPermissions(db);

    return res.status(200).json({
      success: true,
      data: permissions
    });
  } catch (error) {
    logger.error('Erro ao buscar permissões:', error.message);
    return res.status(500).json({
      success: false,
      error: (req.t && req.t('security.getPermissionsError')) || 'Erro ao buscar permissões',
      message: error.message
    });
  }
});

/**
 * GET /api/security/consent-queue
 * Retorna status da fila de notificações de consentimento
 */
router.get('/consent-queue', async (_req, res) => {
  try {
    const stats = await notificationService.getConsentQueueStats();

    return res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('Erro ao buscar status da fila de consentimento:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao buscar status da fila de consentimento',
      message: error.message
    });
  }
});

// #1149: there is deliberately no PUT /permissions. It wrote a
// `security_permissions` store that no authorization path reads, answered
// 'Permissões atualizadas com sucesso', and wrote a critical-severity audit
// row for a change that never took effect. Pointing it at the real roles
// would not help either: the RBAC seed re-unions each role's permissionIds
// on every boot, so a revoke would silently revert at the next restart
// (#1123). GET /permissions stays, read-only.

module.exports = router;


