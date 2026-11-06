const retentionPolicyService = require('../services/retentionPolicy.service');
const { listDataClasses } = require('../governance/dataClasses');
const logger = require('../utils/logger');

class RetentionPolicyController {
  async createPolicy(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }

      const policy = await retentionPolicyService.createPolicy(db, req.body);

      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'CREATE',
          resourceType: 'RetentionPolicy',
          resourceId: policy._id.toString(),
          status: 'success',
          severity: 'critical',
          message: `Política de retenção criada (${policy.version})`,
          payload: {
            applicableEntityTypes: policy.applicableEntityTypes,
            triggerEvent: policy.triggerEvent,
            postRetentionAction: policy.postRetentionAction,
            retentionPeriod: policy.retentionPeriod,
            archiveRetentionPeriod: policy.archiveRetentionPeriod,
            archiveRetentionBasis: policy.archiveRetentionBasis,
            version: policy.version,
            active: policy.active
          },
          req,
          module: 'Segurança'
        });
      }

      return res.status(201).json({
        success: true,
        message: 'Política de retenção criada com sucesso',
        data: policy
      });
    } catch (error) {
      logger.error('Erro ao criar política de retenção:', error.message);
      return res.status(error.statusCode === 422 ? 422 : 400).json({
        success: false,
        error: 'Erro ao criar política de retenção',
        message: error.message,
        details: error.details
      });
    }
  }

  async updatePolicy(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }

      const policy = await retentionPolicyService.updatePolicy(db, req.params.id, req.body || {});

      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'UPDATE',
          resourceType: 'RetentionPolicy',
          resourceId: policy._id.toString(),
          status: 'success',
          severity: 'critical',
          message: `Política de retenção atualizada (${policy.version})`,
          payload: {
            applicableEntityTypes: policy.applicableEntityTypes,
            triggerEvent: policy.triggerEvent,
            postRetentionAction: policy.postRetentionAction,
            retentionPeriod: policy.retentionPeriod,
            archiveRetentionPeriod: policy.archiveRetentionPeriod,
            archiveRetentionBasis: policy.archiveRetentionBasis,
            version: policy.version,
            active: policy.active,
            previousPolicyId: policy.previousPolicyId || null
          },
          req,
          module: 'Segurança'
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Política de retenção atualizada com nova versão automática',
        data: policy
      });
    } catch (error) {
      logger.error('Erro ao atualizar política de retenção:', error.message);
      return res.status(error.statusCode === 422 ? 422 : 400).json({
        success: false,
        error: 'Erro ao atualizar política de retenção',
        message: error.message,
        details: error.details
      });
    }
  }

  async getActivePolicy(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }

      const policy = await retentionPolicyService.getActivePolicy(db);
      if (!policy) {
        return res.status(404).json({ success: false, error: 'Nenhuma política de retenção ativa encontrada' });
      }

      return res.status(200).json({ success: true, data: policy });
    } catch (error) {
      logger.error('Erro ao buscar política de retenção ativa:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Erro ao buscar política de retenção ativa',
        message: error.message
      });
    }
  }

  // RNF022 AC1 (#1462): each data class with its purpose, sensitivity, owner,
  // and its family's active policy and period (null when none is active).
  async getDataClasses(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }

      const data = [];
      for (const entry of listDataClasses()) {
        const policy = await retentionPolicyService.getActivePolicy(db, entry.code);
        data.push({
          code: entry.code,
          purpose: entry.purpose,
          ownerRole: entry.ownerRole,
          entityTypes: entry.entityTypes,
          sensitivity: entry.sensitivity,
          retentionPolicyId: policy ? String(policy._id) : null,
          retentionPeriod: policy ? (policy.retentionPeriod ?? null) : null,
        });
      }

      return res.status(200).json({ success: true, data });
    } catch (error) {
      logger.error('Erro ao buscar classes de dado:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Erro ao buscar classes de dado',
        message: error.message
      });
    }
  }

  async getPolicyById(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }

      const policy = await retentionPolicyService.getPolicyById(db, req.params.id);
      if (!policy) {
        return res.status(404).json({ success: false, error: 'Política de retenção não encontrada' });
      }

      return res.status(200).json({ success: true, data: policy });
    } catch (error) {
      logger.error('Erro ao buscar política de retenção:', error.message);
      return res.status(400).json({
        success: false,
        error: 'Erro ao buscar política de retenção',
        message: error.message
      });
    }
  }

  async getAllPolicies(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }

      const policies = await retentionPolicyService.getAllPolicies(db);
      return res.status(200).json({ success: true, data: policies });
    } catch (error) {
      logger.error('Erro ao listar políticas de retenção:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Erro ao listar políticas de retenção',
        message: error.message
      });
    }
  }
}

module.exports = new RetentionPolicyController();
