const consentService = require('../services/consent.service');
const patientService = require('../services/patient.service');
const logger = require('../utils/logger');

class ConsentController {
  async createPolicy(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const policy = await consentService.createPolicy(db, req.body);

      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'CREATE',
          entity: 'ConsentPolicy',
          entityID: policy._id.toString(),
          result: 'success',
          severity: 'info',
          message: `Política de consentimento criada (${policy.version})`,
          payload: {
            title: policy.title,
            version: policy.version,
            active: policy.active,
            permissions: policy.granularPermissions?.map(p => p.key) || []
          },
          req: req,
          module: 'Consentimento'
        });
      }

      return res.status(201).json({
        success: true,
        message: 'Política de consentimento criada com sucesso',
        data: policy
      });
    } catch (error) {
      logger.error('Erro ao criar política de consentimento:', error.message);
      return res.status(400).json({
        success: false,
        error: 'Erro ao criar política de consentimento',
        message: error.message
      });
    }
  }

  async getActivePolicy(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const policy = await consentService.getActivePolicy(db);
      if (!policy) {
        return res.status(404).json({
          success: false,
          error: 'Nenhuma política ativa encontrada'
        });
      }

      return res.status(200).json({
        success: true,
        data: policy
      });
    } catch (error) {
      logger.error('Erro ao buscar política ativa:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Erro ao buscar política ativa',
        message: error.message
      });
    }
  }

  async getAllPolicies(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const policies = await consentService.getAllPolicies(db);
      return res.status(200).json({
        success: true,
        data: policies
      });
    } catch (error) {
      logger.error('Erro ao listar políticas:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Erro ao listar políticas',
        message: error.message
      });
    }
  }

  async getPoliciesHistory(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 10;
      const search = String(req.query.search || '');
      const result = await consentService.getPoliciesHistory(db, { page, limit, search });

      return res.status(200).json({
        success: true,
        data: result.items,
        pagination: result.pagination
      });
    } catch (error) {
      logger.error('Erro ao listar histórico paginado de políticas:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Erro ao listar histórico de políticas',
        message: error.message
      });
    }
  }

  async updatePolicy(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const policy = await consentService.updatePolicy(db, req.params.id, req.body || {});

      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'UPDATE',
          entity: 'ConsentPolicy',
          entityID: policy._id.toString(),
          result: 'success',
          severity: 'info',
          message: `Política de consentimento atualizada (${policy.version})`,
          payload: {
            title: policy.title,
            version: policy.version,
            active: policy.active,
            previousPolicyId: policy.previousPolicyId || null
          },
          req: req,
          module: 'Consentimento'
        });
      }

      return res.status(200).json({
        success: true,
        message: 'TCLE atualizado com nova versão automática',
        data: policy
      });
    } catch (error) {
      logger.error('Erro ao atualizar política de consentimento:', error.message);
      return res.status(400).json({
        success: false,
        error: 'Erro ao atualizar política de consentimento',
        message: error.message
      });
    }
  }

  async getActivePoliciesWithCaae(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const policies = await consentService.getActivePoliciesWithCaae(db);
      return res.status(200).json({
        success: true,
        data: policies
      });
    } catch (error) {
      logger.error('Erro ao listar políticas ativas com CAAE:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Erro ao listar políticas ativas com CAAE',
        message: error.message
      });
    }
  }

  async createTemplate(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const template = await consentService.createTemplate(db, req.body);

      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'CREATE',
          entity: 'ConsentTemplate',
          entityID: template._id.toString(),
          result: 'success',
          severity: 'info',
          message: `Template de consentimento criado (${template.version})`,
          payload: {
            title: template.title,
            version: template.version,
            active: template.active,
            permissions: template.permissions?.map(p => p.key) || []
          },
          req: req,
          module: 'Consentimento'
        });
      }

      return res.status(201).json({
        success: true,
        message: 'Template de consentimento criado com sucesso',
        data: template
      });
    } catch (error) {
      logger.error('Erro ao criar template de consentimento:', error.message);
      return res.status(400).json({
        success: false,
        error: 'Erro ao criar template de consentimento',
        message: error.message
      });
    }
  }

  async getActiveTemplate(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const template = await consentService.getActiveTemplate(db);
      if (!template) {
        return res.status(404).json({
          success: false,
          error: 'Nenhum template ativo encontrado'
        });
      }

      return res.status(200).json({
        success: true,
        data: template
      });
    } catch (error) {
      logger.error('Erro ao buscar template ativo:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Erro ao buscar template ativo',
        message: error.message
      });
    }
  }

  async createPatientConsent(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const payload = {
        ...req.body,
        patientId: req.body.patientId || req.body.patientID,
        ipAddress: req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress,
        userAgent: req.headers['user-agent']
      };

      const consent = await consentService.createPatientConsent(db, payload);

      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'SIGN',
          entity: 'PatientConsent',
          entityID: consent._id.toString(),
          result: 'success',
          severity: 'info',
          message: `Consentimento assinado para paciente ${consent.patientId}`,
          payload: {
            patientId: consent.patientId,
            templateId: consent.templateId,
            status: consent.status
          },
          req: req,
          module: 'Consentimento'
        });
      }

      return res.status(201).json({
        success: true,
        message: 'Consentimento registrado com sucesso',
        data: consent
      });
    } catch (error) {
      logger.error('Erro ao registrar consentimento:', error.message);
      return res.status(400).json({
        success: false,
        error: 'Erro ao registrar consentimento',
        message: error.message
      });
    }
  }

  async revokeConsent(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const consent = await consentService.revokeConsent(db, req.params.id);
      if (!consent) {
        return res.status(404).json({
          success: false,
          error: 'Consentimento não encontrado'
        });
      }

      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'REVOKE',
          entity: 'PatientConsent',
          entityID: req.params.id,
          result: 'success',
          severity: 'warning',
          message: `Consentimento revogado para paciente ${consent.patientId}`,
          payload: {
            patientId: consent.patientId,
            templateId: consent.templateId,
            status: 'REVOKED'
          },
          req: req,
          module: 'Consentimento'
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Consentimento revogado com sucesso',
        data: consent
      });
    } catch (error) {
      logger.error('Erro ao revogar consentimento:', error.message);
      return res.status(400).json({
        success: false,
        error: 'Erro ao revogar consentimento',
        message: error.message
      });
    }
  }

  async getPatientConsent(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const consent = await consentService.getPatientConsent(db, req.params.patientId);
      if (!consent) {
        return res.status(404).json({
          success: false,
          error: 'Consentimento não encontrado'
        });
      }

      return res.status(200).json({
        success: true,
        data: consent
      });
    } catch (error) {
      logger.error('Erro ao buscar consentimento:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Erro ao buscar consentimento',
        message: error.message
      });
    }
  }

  async validateConsentToken(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const patientId = req.body.patientId || req.body.patientID || req.query.patientId || req.query.patientID;
      const token = req.body.token || req.query.token;

      const result = await patientService.validateConsentToken(db, String(patientId), String(token));

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('Erro ao validar token de consentimento:', error.message);
      return res.status(400).json({
        success: false,
        error: 'Token inválido',
        message: error.message
      });
    }
  }

  async acceptConsentToken(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const patientId = req.body.patientId || req.body.patientID || req.query.patientId || req.query.patientID;
      const token = req.body.token || req.query.token;

      const result = await patientService.acceptConsentToken(db, String(patientId), String(token));

      return res.status(200).json({
        success: true,
        message: 'Consentimento confirmado com sucesso',
        data: result
      });
    } catch (error) {
      logger.error('Erro ao aceitar consentimento:', error.message);
      return res.status(400).json({
        success: false,
        error: 'Erro ao aceitar consentimento',
        message: error.message
      });
    }
  }
}

module.exports = new ConsentController();
