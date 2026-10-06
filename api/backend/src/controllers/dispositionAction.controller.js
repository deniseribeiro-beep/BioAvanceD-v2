const dispositionActionService = require('../services/dispositionAction.service');
const logger = require('../utils/logger');

class DispositionActionController {
  async record(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }

      const performedBy = req.body?.performedBy || (req.user ? String(req.user.userID) : null);
      const action = await dispositionActionService.recordDisposition(db, { ...req.body, performedBy });

      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'CREATE',
          resourceType: 'DispositionAction',
          resourceId: action.dispositionActionId,
          status: 'success',
          severity: 'critical',
          message: `Ação de destinação registrada (${action.dispositionAction})`,
          payload: { entityType: action.entityType, affectedRecordIds: action.affectedRecordIds, retentionPolicyId: action.retentionPolicyId },
          req,
          module: 'Retenção e destinação',
        });
      }

      return res.status(201).json({ success: true, message: 'Ação de destinação registrada com sucesso', data: action });
    } catch (error) {
      logger.error('Erro ao registrar ação de destinação:', error.message);
      const blocked = /bloqueio legal ou ético ativo/.test(error.message);
      return res.status(blocked ? 409 : error.statusCode === 422 ? 422 : 400).json({ success: false, error: 'Erro ao registrar ação de destinação', message: error.message, details: error.details });
    }
  }

  async getCertificate(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }

      const certificate = await dispositionActionService.getCertificate(db, req.params.id);
      if (!certificate) {
        return res.status(404).json({ success: false, error: 'Ação de destinação não encontrada' });
      }

      return res.status(200).json({ success: true, data: certificate });
    } catch (error) {
      logger.error('Erro ao gerar certificado de destinação:', error.message);
      return res.status(400).json({ success: false, error: 'Erro ao gerar certificado de destinação', message: error.message });
    }
  }

  async getById(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }

      const action = await dispositionActionService.getById(db, req.params.id);
      if (!action) {
        return res.status(404).json({ success: false, error: 'Ação de destinação não encontrada' });
      }

      return res.status(200).json({ success: true, data: action });
    } catch (error) {
      logger.error('Erro ao buscar ação de destinação:', error.message);
      return res.status(400).json({ success: false, error: 'Erro ao buscar ação de destinação', message: error.message });
    }
  }

  async getAll(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }

      const actions = await dispositionActionService.getAll(db);
      return res.status(200).json({ success: true, data: actions });
    } catch (error) {
      logger.error('Erro ao listar ações de destinação:', error.message);
      return res.status(500).json({ success: false, error: 'Erro ao listar ações de destinação', message: error.message });
    }
  }
}

module.exports = new DispositionActionController();
