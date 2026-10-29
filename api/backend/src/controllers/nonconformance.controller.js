const nonconformanceService = require('../services/nonconformance.service');
const logger = require('../utils/logger');

class NonconformanceController {
  async open(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }

      const detectedBy = req.body?.detectedBy || (req.user ? String(req.user.userID) : null);
      const nonconformance = await nonconformanceService.open(db, { ...req.body, detectedBy });

      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'CREATE',
          resourceType: 'Nonconformance',
          resourceId: nonconformance.nonconformanceId,
          status: 'success',
          severity: 'critical',
          message: `Não conformidade aberta (${nonconformance.nonconformanceId})`,
          payload: { nonconformanceType: nonconformance.nonconformanceType, affectedEntityIds: nonconformance.affectedEntityIds },
          req,
          module: 'Ensaios e qualidade',
        });
      }

      return res.status(201).json({ success: true, message: 'Não conformidade registrada com sucesso', data: nonconformance });
    } catch (error) {
      logger.error('Erro ao abrir não conformidade:', error.message);
      return res.status(error.statusCode === 422 ? 422 : 400).json({ success: false, error: 'Erro ao abrir não conformidade', message: error.message, details: error.details });
    }
  }

  async recordCorrectiveAction(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }

      const nonconformance = await nonconformanceService.recordCorrectiveAction(db, req.params.id, req.body || {});

      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'UPDATE',
          resourceType: 'Nonconformance',
          resourceId: nonconformance.nonconformanceId,
          status: 'success',
          severity: 'critical',
          message: `Ação corretiva registrada para não conformidade (${nonconformance.nonconformanceId})`,
          payload: { correctiveAction: nonconformance.correctiveAction },
          req,
          module: 'Ensaios e qualidade',
        });
      }

      return res.status(200).json({ success: true, message: 'Ação corretiva registrada com sucesso', data: nonconformance });
    } catch (error) {
      logger.error('Erro ao registrar ação corretiva:', error.message);
      return res.status(400).json({ success: false, error: 'Erro ao registrar ação corretiva', message: error.message });
    }
  }

  async verifyEffectiveness(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }

      const verifiedBy = req.body?.verifiedBy || (req.user ? String(req.user.userID) : null);
      const nonconformance = await nonconformanceService.verifyEffectiveness(db, req.params.id, { ...req.body, verifiedBy });

      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'UPDATE',
          resourceType: 'Nonconformance',
          resourceId: nonconformance.nonconformanceId,
          status: 'success',
          severity: 'critical',
          message: `Verificação de eficácia registrada para não conformidade (${nonconformance.effectivenessVerification.outcome})`,
          payload: { effectivenessVerification: nonconformance.effectivenessVerification, status: nonconformance.status },
          req,
          module: 'Ensaios e qualidade',
        });
      }

      return res.status(200).json({ success: true, message: 'Verificação de eficácia registrada com sucesso', data: nonconformance });
    } catch (error) {
      logger.error('Erro ao verificar eficácia da ação corretiva:', error.message);
      return res.status(400).json({ success: false, error: 'Erro ao verificar eficácia da ação corretiva', message: error.message });
    }
  }

  async getById(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }

      const nonconformance = await nonconformanceService.getById(db, req.params.id);
      if (!nonconformance) {
        return res.status(404).json({ success: false, error: 'Não conformidade não encontrada' });
      }

      return res.status(200).json({ success: true, data: nonconformance });
    } catch (error) {
      logger.error('Erro ao buscar não conformidade:', error.message);
      return res.status(400).json({ success: false, error: 'Erro ao buscar não conformidade', message: error.message });
    }
  }

  async getAll(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }

      const nonconformances = await nonconformanceService.getAll(db);
      return res.status(200).json({ success: true, data: nonconformances });
    } catch (error) {
      logger.error('Erro ao listar não conformidades:', error.message);
      return res.status(500).json({ success: false, error: 'Erro ao listar não conformidades', message: error.message });
    }
  }
}

module.exports = new NonconformanceController();
