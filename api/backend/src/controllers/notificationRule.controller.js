const notificationRuleService = require('../services/notificationRule.service');
const notificationDispatchService = require('../services/notificationDispatch.service');
const logger = require('../utils/logger');

class NotificationRuleController {
  async createRule(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }

      const rule = await notificationRuleService.createRule(db, req.body);

      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'CREATE',
          resourceType: 'NotificationRule',
          resourceId: rule._id.toString(),
          status: 'success',
          severity: 'info',
          message: `Regra de notificação criada (${rule.eventType}, ${rule.version})`,
          payload: {
            eventType: rule.eventType,
            channels: rule.channels,
            version: rule.version,
            active: rule.active
          },
          req,
          module: 'Segurança'
        });
      }

      return res.status(201).json({
        success: true,
        message: 'Regra de notificação criada com sucesso',
        data: rule
      });
    } catch (error) {
      logger.error('Erro ao criar regra de notificação:', error.message);
      return res.status(error.statusCode === 422 ? 422 : 400).json({
        success: false,
        error: 'Erro ao criar regra de notificação',
        message: error.message,
        details: error.details
      });
    }
  }

  async updateRule(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }

      const rule = await notificationRuleService.updateRule(db, req.params.id, req.body || {});

      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'UPDATE',
          resourceType: 'NotificationRule',
          resourceId: rule._id.toString(),
          status: 'success',
          severity: 'info',
          message: `Regra de notificação atualizada (${rule.eventType}, ${rule.version})`,
          payload: {
            eventType: rule.eventType,
            channels: rule.channels,
            version: rule.version,
            active: rule.active,
            previousRuleId: rule.previousRuleId || null
          },
          req,
          module: 'Segurança'
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Regra de notificação atualizada com nova versão automática',
        data: rule
      });
    } catch (error) {
      logger.error('Erro ao atualizar regra de notificação:', error.message);
      return res.status(error.statusCode === 422 ? 422 : 400).json({
        success: false,
        error: 'Erro ao atualizar regra de notificação',
        message: error.message,
        details: error.details
      });
    }
  }

  async getActiveRule(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }

      const rule = await notificationRuleService.getActiveRuleForEventType(db, req.query.eventType);
      if (!rule) {
        return res.status(404).json({ success: false, error: 'Nenhuma regra de notificação ativa encontrada' });
      }

      return res.status(200).json({ success: true, data: rule });
    } catch (error) {
      logger.error('Erro ao buscar regra de notificação ativa:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Erro ao buscar regra de notificação ativa',
        message: error.message
      });
    }
  }

  async getRuleById(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }

      const rule = await notificationRuleService.getRuleById(db, req.params.id);
      if (!rule) {
        return res.status(404).json({ success: false, error: 'Regra de notificação não encontrada' });
      }

      return res.status(200).json({ success: true, data: rule });
    } catch (error) {
      logger.error('Erro ao buscar regra de notificação:', error.message);
      return res.status(400).json({
        success: false,
        error: 'Erro ao buscar regra de notificação',
        message: error.message
      });
    }
  }

  async getAllRules(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }

      const rules = await notificationRuleService.getAllRules(db, { eventType: req.query.eventType });
      return res.status(200).json({ success: true, data: rules });
    } catch (error) {
      logger.error('Erro ao listar regras de notificação:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Erro ao listar regras de notificação',
        message: error.message
      });
    }
  }

  async listNotifications(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }

      const notifications = await notificationDispatchService.getNotifications(db, {
        eventType: req.query.eventType,
        status: req.query.status,
        limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined
      });
      return res.status(200).json({ success: true, data: notifications });
    } catch (error) {
      logger.error('Erro ao listar notificações:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Erro ao listar notificações',
        message: error.message
      });
    }
  }

  async confirmNotification(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }

      const notification = await notificationDispatchService.confirmNotification(db, req.params.id);
      return res.status(200).json({ success: true, data: notification });
    } catch (error) {
      logger.error('Erro ao confirmar notificação:', error.message);
      return res.status(400).json({
        success: false,
        error: 'Erro ao confirmar notificação',
        message: error.message
      });
    }
  }
}

module.exports = new NotificationRuleController();
