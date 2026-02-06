const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const securityService = require('../services/security.service');
const notificationService = require('../services/notification.service');
const logger = require('../utils/logger');
const auditLogger = require('../utils/auditLogger');

/**
 * Todas as rotas de segurança requerem autenticação e perfil Administrador
 */
router.use(authenticate);
router.use(requireRole(4)); // Apenas Administrador (accessType 4)

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
    return res.status(400).json({
      success: false,
      error: (req.t && req.t('security.updateConfigError')) || 'Erro ao atualizar configurações de segurança',
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
      entity: req.query.entity
    };

    const exportData = await securityService.exportLogs(db, filters, format);

    // Registra log de exportação
    auditLogger.init(db);
    await auditLogger.log({
      action: 'EXPORT',
      entity: 'Logs',
      result: 'success',
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

/**
 * PUT /api/security/permissions
 * Atualiza permissões por perfil
 */
router.put('/permissions', async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: (req.t && req.t('errors.databaseUnavailable')) || 'Banco de dados não disponível'
      });
    }

    // Busca permissões atuais para comparar mudanças
    const currentPermissions = await securityService.getPermissions(db);
    
    // Valida e atualiza permissões
    const updatedPermissions = await securityService.updatePermissions(db, req.body, currentPermissions, req);

    return res.status(200).json({
      success: true,
      message: (req.t && req.t('security.updatePermissionsSuccess')) || 'Permissões atualizadas com sucesso',
      data: updatedPermissions
    });
  } catch (error) {
    logger.error('Erro ao atualizar permissões:', error.message);
    return res.status(400).json({
      success: false,
      error: (req.t && req.t('security.updatePermissionsError')) || 'Erro ao atualizar permissões',
      message: error.message
    });
  }
});

module.exports = router;


