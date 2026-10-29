const accessPolicyService = require('../services/accessPolicy.service');
const logger = require('../utils/logger');

function statusOf(error) {
  return [404, 422].includes(error.statusCode) ? error.statusCode : 400;
}

async function audit(req, db, policy, message) {
  if (!req.user) return;
  const auditLogger = require('../utils/auditLogger');
  auditLogger.init(db);
  await auditLogger.log({
    action: 'CREATE',
    resourceType: 'AccessPolicy',
    resourceId: policy.accessPolicyId,
    status: 'success',
    severity: 'critical',
    message,
    payload: { policyName: policy.policyName, policyVersion: policy.policyVersion, decisionEffect: policy.decisionEffect },
    req,
    module: 'Acesso e distribuição',
  });
}

class AccessPolicyController {
  async createPolicy(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }
      const policy = await accessPolicyService.createPolicy(db, req.body, req.user?.userID || null);
      await audit(req, db, policy, `Política de acesso criada (${policy.accessPolicyId} ${policy.policyVersion})`);
      return res.status(201).json({ success: true, message: 'Política de acesso criada', data: policy });
    } catch (error) {
      logger.error('Erro ao criar política de acesso:', error.message);
      return res.status(statusOf(error)).json({
        success: false,
        error: 'Erro ao criar política de acesso',
        message: error.message,
        details: error.details,
      });
    }
  }

  async createVersion(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }
      const policy = await accessPolicyService.createVersion(db, req.params.id, req.body, req.user?.userID || null);
      await audit(req, db, policy, `Nova versão de política de acesso (${policy.accessPolicyId} ${policy.policyVersion})`);
      return res.status(201).json({ success: true, message: 'Nova versão da política de acesso criada', data: policy });
    } catch (error) {
      logger.error('Erro ao versionar política de acesso:', error.message);
      return res.status(statusOf(error)).json({
        success: false,
        error: 'Erro ao versionar política de acesso',
        message: error.message,
        details: error.details,
      });
    }
  }

  async getVersions(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }
      const versions = await accessPolicyService.getVersions(db, req.params.id);
      if (versions.length === 0) {
        return res.status(404).json({ success: false, error: 'Política de acesso não encontrada' });
      }
      return res.status(200).json({ success: true, data: versions });
    } catch (error) {
      logger.error('Erro ao buscar política de acesso:', error.message);
      return res.status(500).json({ success: false, error: 'Erro ao buscar política de acesso', message: error.message });
    }
  }

  async getAll(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
      }
      const policies = await accessPolicyService.getAll(db);
      return res.status(200).json({ success: true, data: policies });
    } catch (error) {
      logger.error('Erro ao listar políticas de acesso:', error.message);
      return res.status(500).json({ success: false, error: 'Erro ao listar políticas de acesso', message: error.message });
    }
  }
}

module.exports = new AccessPolicyController();
