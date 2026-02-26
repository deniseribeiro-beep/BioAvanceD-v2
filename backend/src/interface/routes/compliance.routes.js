/**
 * src/interface/routes/compliance.routes.js
 * Rotas para acessar relatórios de conformidade e dashboards
 * Requer autenticação + role de admin
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requireRole } = require('../../infrastructure/middleware/rbac');
const complianceReportService = require('../../services/complianceReport.service');
const securityAlertsService = require('../../services/securityAlerts.service');
const logger = require('../../utils/logger');

/**
 * GET /api/compliance/dashboard
 * Retorna dashboard de conformidade dos últimos 30 dias
 */
router.get('/dashboard', authenticate, requireRole(4), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    complianceReportService.init(db);
    const daysBack = parseInt(req.query.days) || 30;
    const dashboard = await complianceReportService.getDashboardMetrics(daysBack);

    return res.status(200).json({
      success: true,
      data: dashboard
    });
  } catch (error) {
    logger.error('[COMPLIANCE] Erro ao gerar dashboard:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao gerar dashboard',
      message: error.message
    });
  }
});

/**
 * GET /api/compliance/report
 * Gera relatório completo num período
 * Query params: startDate, endDate (formato: YYYY-MM-DD)
 */
router.get('/report', authenticate, requireRole(4), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const { startDate, endDate, format } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'startDate e endDate são obrigatórios',
        message: 'Use formato: YYYY-MM-DD'
      });
    }

    complianceReportService.init(db);

    if (format === 'csv') {
      const csv = await complianceReportService.exportReportCSV(startDate, endDate);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="compliance-report.csv"');
      return res.send(csv);
    }

    const report = await complianceReportService.generateComplianceReport(startDate, endDate);

    return res.status(200).json({
      success: true,
      data: report
    });
  } catch (error) {
    logger.error('[COMPLIANCE] Erro ao gerar relatório:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao gerar relatório',
      message: error.message
    });
  }
});

/**
 * GET /api/compliance/alerts
 * Lista alertas de segurança abertos
 */
router.get('/alerts', authenticate, requireRole(4), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    securityAlertsService.init(db);
    
    const filters = {};
    if (req.query.severity) {
      filters.severity = req.query.severity;
    }
    if (req.query.type) {
      filters.type = req.query.type;
    }

    const alerts = await securityAlertsService.getOpenAlerts(filters);

    return res.status(200).json({
      success: true,
      total: alerts.length,
      data: alerts
    });
  } catch (error) {
    logger.error('[COMPLIANCE] Erro ao buscar alertas:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao buscar alertas',
      message: error.message
    });
  }
});

/**
 * POST /api/compliance/alerts/:id/acknowledge
 * Reconhece um alerta
 */
router.post('/alerts/:id/acknowledge', authenticate, requireRole(4), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const { ObjectId } = require('mongodb');
    securityAlertsService.init(db);

    await securityAlertsService.acknowledgeAlert(
      new ObjectId(req.params.id),
      req.user._id.toString()
    );

    return res.status(200).json({
      success: true,
      message: 'Alerta reconhecido'
    });
  } catch (error) {
    logger.error('[COMPLIANCE] Erro ao reconhecer alerta:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao reconhecer alerta',
      message: error.message
    });
  }
});

/**
 * POST /api/compliance/alerts/:id/resolve
 * Resolve um alerta
 */
router.post('/alerts/:id/resolve', authenticate, requireRole(4), async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Banco de dados não disponível'
      });
    }

    const { resolution } = req.body;
    if (!resolution) {
      return res.status(400).json({
        success: false,
        error: 'resolution é obrigatório'
      });
    }

    const { ObjectId } = require('mongodb');
    securityAlertsService.init(db);

    await securityAlertsService.resolveAlert(
      new ObjectId(req.params.id),
      resolution,
      req.user._id.toString()
    );

    return res.status(200).json({
      success: true,
      message: 'Alerta resolvido'
    });
  } catch (error) {
    logger.error('[COMPLIANCE] Erro ao resolver alerta:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao resolver alerta',
      message: error.message
    });
  }
});

/**
 * GET /api/compliance/scopes
 * Retorna todos os escopos de consentimento disponíveis
 */
router.get('/scopes', authenticate, async (req, res) => {
  try {
    const { getAllScopes, getScopesByCategory, getHighRiskScopes } = require('../../config/consentScopes');

    const category = req.query.category;
    
    let scopes;
    if (category) {
      scopes = getScopesByCategory(category);
    } else if (req.query.highRiskOnly === 'true') {
      scopes = getHighRiskScopes();
    } else {
      scopes = getAllScopes();
    }

    return res.status(200).json({
      success: true,
      data: scopes
    });
  } catch (error) {
    logger.error('[COMPLIANCE] Erro ao buscar escopos:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao buscar escopos',
      message: error.message
    });
  }
});

module.exports = router;
