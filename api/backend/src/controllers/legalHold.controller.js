const legalHoldService = require('../services/legalHold.service');
const logger = require('../utils/logger');

class LegalHoldController {
  async impose(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }

      const imposedBy = req.body?.imposedBy || (req.user ? String(req.user.userID) : null);
      const hold = await legalHoldService.imposeHold(db, { ...req.body, imposedBy });

      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'CREATE',
          resourceType: 'LegalHold',
          resourceId: hold.legalHoldId,
          status: 'success',
          severity: 'critical',
          message: `Bloqueio legal/ético aplicado (${hold.legalHoldId})`,
          payload: { targetEntityType: hold.targetEntityType, targetEntityIds: hold.targetEntityIds, reason: hold.reason },
          req,
          module: 'Retenção e destinação',
        });
      }

      return res.status(201).json({ success: true, message: 'Bloqueio legal aplicado com sucesso', data: hold });
    } catch (error) {
      logger.error('Erro ao aplicar bloqueio legal:', error.message);
      return res.status(400).json({ success: false, error: 'Erro ao aplicar bloqueio legal', message: error.message });
    }
  }

  async release(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }

      const releasedBy = req.user ? String(req.user.userID) : null;
      const hold = await legalHoldService.releaseHold(db, req.params.id, releasedBy, req.body?.releaseReason);

      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'UPDATE',
          resourceType: 'LegalHold',
          resourceId: hold.legalHoldId,
          status: 'success',
          severity: 'critical',
          message: `Bloqueio legal/ético liberado (${hold.legalHoldId})`,
          payload: { releaseReason: hold.releaseReason },
          req,
          module: 'Retenção e destinação',
        });
      }

      return res.status(200).json({ success: true, message: 'Bloqueio legal liberado com sucesso', data: hold });
    } catch (error) {
      logger.error('Erro ao liberar bloqueio legal:', error.message);
      return res.status(400).json({ success: false, error: 'Erro ao liberar bloqueio legal', message: error.message });
    }
  }

  async getById(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }

      const hold = await legalHoldService.getById(db, req.params.id);
      if (!hold) {
        return res.status(404).json({ success: false, error: 'Bloqueio legal não encontrado' });
      }

      return res.status(200).json({ success: true, data: hold });
    } catch (error) {
      logger.error('Erro ao buscar bloqueio legal:', error.message);
      return res.status(400).json({ success: false, error: 'Erro ao buscar bloqueio legal', message: error.message });
    }
  }

  async getAll(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }

      const holds = await legalHoldService.getAll(db);
      return res.status(200).json({ success: true, data: holds });
    } catch (error) {
      logger.error('Erro ao listar bloqueios legais:', error.message);
      return res.status(500).json({ success: false, error: 'Erro ao listar bloqueios legais', message: error.message });
    }
  }
}

module.exports = new LegalHoldController();
