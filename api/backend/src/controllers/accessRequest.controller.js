const accessRequestService = require('../services/accessRequest.service');
const logger = require('../utils/logger');

class AccessRequestController {
  async createAccessRequest(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }

      const accessRequest = await accessRequestService.createRequest(db, req.body);

      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'CREATE',
          resourceType: 'AccessRequest',
          resourceId: accessRequest.accessRequestId,
          status: 'success',
          severity: 'critical',
          message: `Solicitação de acesso registrada (${accessRequest.accessRequestId})`,
          payload: {
            requesterId: accessRequest.requesterId,
            studyId: accessRequest.studyId,
            requestedItems: accessRequest.requestedItems,
          },
          req,
          module: 'Acesso e distribuição',
        });
      }

      return res.status(201).json({
        success: true,
        message: 'Solicitação de acesso registrada com sucesso',
        data: accessRequest,
      });
    } catch (error) {
      logger.error('Erro ao registrar solicitação de acesso:', error.message);
      return res.status(error.statusCode === 422 ? 422 : 400).json({
        success: false,
        error: 'Erro ao registrar solicitação de acesso',
        message: error.message,
        details: error.details,
      });
    }
  }

  async evaluateCompatibility(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }

      const accessRequest = await accessRequestService.evaluateCompatibility(db, req.params.id);

      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'UPDATE',
          resourceType: 'AccessRequest',
          resourceId: accessRequest.accessRequestId,
          status: 'success',
          severity: 'critical',
          message: `Compatibilidade avaliada para solicitação de acesso (${accessRequest.accessRequestId})`,
          payload: { overallCompatible: accessRequest.overallCompatible, consentCompatibility: accessRequest.consentCompatibility },
          req,
          module: 'Acesso e distribuição',
        });
      }

      return res.status(200).json({ success: true, message: 'Compatibilidade avaliada', data: accessRequest });
    } catch (error) {
      logger.error('Erro ao avaliar compatibilidade da solicitação de acesso:', error.message);
      return res.status(400).json({
        success: false,
        error: 'Erro ao avaliar compatibilidade da solicitação de acesso',
        message: error.message,
      });
    }
  }

  async recordDecision(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }

      const decidedBy = req.user ? req.user.userID : null;
      const accessRequest = await accessRequestService.recordDecision(db, req.params.id, req.body || {}, decidedBy);

      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'UPDATE',
          resourceType: 'AccessRequest',
          resourceId: accessRequest.accessRequestId,
          status: 'success',
          severity: 'critical',
          message: `Decisão do comitê registrada para solicitação de acesso (${accessRequest.committeeDecision.status})`,
          payload: { committeeDecision: accessRequest.committeeDecision, approvalPeriod: accessRequest.approvalPeriod },
          req,
          module: 'Acesso e distribuição',
        });
      }

      return res.status(200).json({ success: true, message: 'Decisão registrada com sucesso', data: accessRequest });
    } catch (error) {
      logger.error('Erro ao registrar decisão da solicitação de acesso:', error.message);
      return res.status(400).json({
        success: false,
        error: 'Erro ao registrar decisão da solicitação de acesso',
        message: error.message,
      });
    }
  }

  async distribute(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }

      const accessRequest = await accessRequestService.markDistributed(db, req.params.id);

      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'UPDATE',
          resourceType: 'AccessRequest',
          resourceId: accessRequest.accessRequestId,
          status: 'success',
          severity: 'critical',
          message: `Solicitação de acesso vinculada à disponibilização (${accessRequest.accessRequestId})`,
          payload: { distributionStatus: accessRequest.distributionStatus, distributedAt: accessRequest.distributedAt },
          req,
          module: 'Acesso e distribuição',
        });
      }

      return res.status(200).json({ success: true, message: 'Disponibilização registrada com sucesso', data: accessRequest });
    } catch (error) {
      logger.error('Erro ao vincular disponibilização da solicitação de acesso:', error.message);
      return res.status(400).json({
        success: false,
        error: 'Erro ao vincular disponibilização da solicitação de acesso',
        message: error.message,
      });
    }
  }

  async revoke(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }

      const decidedBy = req.user ? req.user.userID : null;
      const accessRequest = await accessRequestService.revokeAccess(db, req.params.id, req.body?.justification, decidedBy);

      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'UPDATE',
          resourceType: 'AccessRequest',
          resourceId: accessRequest.accessRequestId,
          status: 'success',
          severity: 'critical',
          message: `Acesso revogado para solicitação (${accessRequest.accessRequestId})`,
          payload: { committeeDecision: accessRequest.committeeDecision },
          req,
          module: 'Acesso e distribuição',
        });
      }

      return res.status(200).json({ success: true, message: 'Acesso revogado com sucesso', data: accessRequest });
    } catch (error) {
      logger.error('Erro ao revogar acesso da solicitação:', error.message);
      return res.status(400).json({
        success: false,
        error: 'Erro ao revogar acesso da solicitação',
        message: error.message,
      });
    }
  }

  async getAccessCheck(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }

      const result = await accessRequestService.getAccessCheck(db, req.params.id);
      if (!result) {
        return res.status(404).json({ success: false, error: 'Solicitação de acesso não encontrada' });
      }

      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      logger.error('Erro ao verificar acesso da solicitação:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Erro ao verificar acesso da solicitação',
        message: error.message,
      });
    }
  }

  async getById(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }

      const accessRequest = await accessRequestService.getById(db, req.params.id);
      if (!accessRequest) {
        return res.status(404).json({ success: false, error: 'Solicitação de acesso não encontrada' });
      }

      return res.status(200).json({ success: true, data: accessRequest });
    } catch (error) {
      logger.error('Erro ao buscar solicitação de acesso:', error.message);
      return res.status(400).json({
        success: false,
        error: 'Erro ao buscar solicitação de acesso',
        message: error.message,
      });
    }
  }

  async getAll(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }

      const accessRequests = await accessRequestService.getAll(db);
      return res.status(200).json({ success: true, data: accessRequests });
    } catch (error) {
      logger.error('Erro ao listar solicitações de acesso:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Erro ao listar solicitações de acesso',
        message: error.message,
      });
    }
  }
}

module.exports = new AccessRequestController();
