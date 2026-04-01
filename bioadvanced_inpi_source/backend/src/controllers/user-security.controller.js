const userSecurityService = require('../services/user-security.service');
const logger = require('../utils/logger');
const auditLogger = require('../utils/auditLogger');
const { ObjectId } = require('mongodb');

/**
 * Controller de Segurança do Usuário
 * Gerencia endpoints de segurança pessoal
 */
class UserSecurityController {
  /**
   * GET /api/user/security/status
   * Obtém status geral de segurança
   */
  async getStatus(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: (req.t && req.t('errors.databaseUnavailable')) || 'Banco de dados não disponível'
        });
      }

      const status = await userSecurityService.getSecurityStatus(db, req.user.userID);

      return res.status(200).json({
        success: true,
        data: status
      });
    } catch (error) {
      logger.error('Erro ao obter status de segurança:', error.message);
      return res.status(500).json({
        success: false,
        error: (req.t && req.t('userSecurity.status.error')) || 'Erro ao obter status de segurança',
        message: error.message
      });
    }
  }

  /**
   * GET /api/user/security/mfa
   * Obtém status do MFA
   */
  async getMFAStatus(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: (req.t && req.t('errors.databaseUnavailable')) || 'Banco de dados não disponível'
        });
      }

      const mfaStatus = await userSecurityService.getMFAStatus(db, req.user.userID);

      return res.status(200).json({
        success: true,
        data: mfaStatus
      });
    } catch (error) {
      logger.error('Erro ao obter status MFA:', error.message);
      return res.status(500).json({
        success: false,
        error: (req.t && req.t('userSecurity.mfa.statusError')) || 'Erro ao obter status MFA',
        message: error.message
      });
    }
  }

  /**
   * GET /api/user/security/password
   * Obtém status da senha
   */
  async getPasswordStatus(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: (req.t && req.t('errors.databaseUnavailable')) || 'Banco de dados não disponível'
        });
      }

      const passwordStatus = await userSecurityService.getPasswordStatus(db, req.user.userID);

      return res.status(200).json({
        success: true,
        data: passwordStatus
      });
    } catch (error) {
      logger.error('Erro ao obter status da senha:', error.message);
      return res.status(500).json({
        success: false,
        error: (req.t && req.t('userSecurity.password.statusError')) || 'Erro ao obter status da senha',
        message: error.message
      });
    }
  }

  /**
   * GET /api/user/security/sessions
   * Obtém sessões ativas
   */
  async getSessions(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: (req.t && req.t('errors.databaseUnavailable')) || 'Banco de dados não disponível'
        });
      }

      const token = req.headers.authorization?.replace('Bearer ', '');
      
      // Extrai informações da requisição atual
      const auditLogger = require('../utils/auditLogger');
      const requestInfo = auditLogger.extractRequestInfo(req);
      
      const sessions = await userSecurityService.getSessions(db, req.user.userID, token, requestInfo);

      return res.status(200).json({
        success: true,
        data: sessions
      });
    } catch (error) {
      logger.error('Erro ao obter sessões:', error.message);
      return res.status(500).json({
        success: false,
        error: (req.t && req.t('userSecurity.sessions.getError')) || 'Erro ao obter sessões',
        message: error.message
      });
    }
  }

  /**
   * GET /api/user/security/activities
   * Obtém atividades recentes
   */
  async getActivities(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: (req.t && req.t('errors.databaseUnavailable')) || 'Banco de dados não disponível'
        });
      }

      const limit = parseInt(req.query.limit) || 20;
      const activities = await userSecurityService.getActivities(db, req.user.userID, limit);

      return res.status(200).json({
        success: true,
        data: activities
      });
    } catch (error) {
      logger.error('Erro ao obter atividades:', error.message);
      return res.status(500).json({
        success: false,
        error: (req.t && req.t('userSecurity.activities.getError')) || 'Erro ao obter atividades',
        message: error.message
      });
    }
  }

  /**
   * PUT /api/user/security/mfa
   * Atualiza MFA (telefone ou passkey)
   */
  async updateMFA(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: (req.t && req.t('errors.databaseUnavailable')) || 'Banco de dados não disponível'
        });
      }

      const { method, enabled } = req.body;

      if (!method || !['phone', 'passkey'].includes(method)) {
        return res.status(400).json({
          success: false,
          error: 'Método inválido. Use "phone" ou "passkey"'
        });
      }

      if (typeof enabled !== 'boolean') {
        return res.status(400).json({
          success: false,
          error: 'Campo "enabled" deve ser booleano'
        });
      }

      await userSecurityService.updateMFA(db, req.user.userID, method, enabled);

      // Registra auditoria
      auditLogger.init(db);
      await auditLogger.log({
        action: 'UPDATE',
        entity: 'MFA',
        entityID: req.user.userID,
        result: 'success',
        severity: 'critical',
        message: `MFA ${method} ${enabled ? 'ativado' : 'desativado'}`,
        payload: {
          method: method,
          enabled: enabled
        },
        req: req,
        module: 'Segurança do Usuário'
      });

      return res.status(200).json({
        success: true,
        message: (req.t && req.t('userSecurity.mfa.updateSuccess')) || 'MFA atualizado com sucesso'
      });
    } catch (error) {
      logger.error('Erro ao atualizar MFA:', error.message);
      return res.status(400).json({
        success: false,
        error: (req.t && req.t('userSecurity.mfa.updateError')) || 'Erro ao atualizar MFA',
        message: error.message
      });
    }
  }

  /**
   * PUT /api/user/security/password
   * Atualiza senha
   */
  async updatePassword(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: (req.t && req.t('errors.databaseUnavailable')) || 'Banco de dados não disponível'
        });
      }

      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          success: false,
          error: 'Senha atual e nova senha são obrigatórias'
        });
      }

      await userSecurityService.updatePassword(db, req.user.userID, currentPassword, newPassword);

      // Registra auditoria
      auditLogger.init(db);
      await auditLogger.log({
        action: 'UPDATE',
        entity: 'Password',
        entityID: req.user.userID,
        result: 'success',
        severity: 'critical',
        message: 'Senha alterada',
        req: req,
        module: 'Segurança do Usuário'
      });

      return res.status(200).json({
        success: true,
        message: (req.t && req.t('userSecurity.password.updateSuccess')) || 'Senha alterada com sucesso'
      });
    } catch (error) {
      logger.error('Erro ao atualizar senha:', error.message);
      return res.status(400).json({
        success: false,
        error: (req.t && req.t('userSecurity.password.updateError')) || 'Erro ao alterar senha',
        message: error.message
      });
    }
  }

  /**
   * PUT /api/user/security/phone
   * Atualiza telefone
   */
  async updatePhone(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: (req.t && req.t('errors.databaseUnavailable')) || 'Banco de dados não disponível'
        });
      }

      const { phone } = req.body;

      if (!phone || (typeof phone === 'string' && phone.trim() === '')) {
        return res.status(400).json({
          success: false,
          error: 'Telefone é obrigatório'
        });
      }

      const result = await userSecurityService.updatePhone(db, req.user.userID, phone);

      // Registra auditoria
      auditLogger.init(db);
      await auditLogger.log({
        action: 'UPDATE',
        entity: 'Phone',
        entityID: req.user.userID,
        result: 'success',
        severity: 'warning',
        message: 'Telefone atualizado',
        req: req,
        module: 'Segurança do Usuário'
      });

      return res.status(200).json({
        success: true,
        message: (req.t && req.t('userSecurity.mfa.alternatives.phone.updateSuccess')) || 'Telefone atualizado com sucesso',
        data: {
          phone: result.phoneMasked,
          phoneMFAEnabled: result.phoneMFAEnabled
        }
      });
    } catch (error) {
      logger.error('Erro ao atualizar telefone:', error.message);
      return res.status(400).json({
        success: false,
        error: (req.t && req.t('userSecurity.mfa.alternatives.phone.updateError')) || 'Erro ao atualizar telefone',
        message: error.message
      });
    }
  }

  /**
   * POST /api/user/security/passkey/start
   * Inicia o processo de registro de passkey
   */
  async startPasskeyRegistration(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: (req.t && req.t('errors.databaseUnavailable')) || 'Banco de dados não disponível'
        });
      }

      const usersCollection = db.collection('users');
      const user = await usersCollection.findOne({ _id: new ObjectId(req.user.userID) });

      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'Usuário não encontrado'
        });
      }

      // Gera um desafio aleatório para o WebAuthn
      // O desafio deve ser um buffer de 16-64 bytes (usamos 32 bytes)
      const crypto = require('crypto');
      const challengeBuffer = crypto.randomBytes(32);
      const challenge = challengeBuffer.toString('base64');

      // Retorna o desafio e informações do usuário
      return res.status(200).json({
        success: true,
        data: {
          challenge: challenge,
          userId: user._id.toString(),
          userEmail: user.email,
          userName: user.name || user.username
        }
      });
    } catch (error) {
      logger.error('Erro ao iniciar registro de passkey:', error.message);
      return res.status(400).json({
        success: false,
        error: (req.t && req.t('userSecurity.mfa.alternatives.passkey.startError')) || 'Erro ao iniciar registro de passkey',
        message: error.message
      });
    }
  }

  /**
   * POST /api/user/security/passkey
   * Completa o registro de passkey (FIDO2/WebAuthn)
   */
  async completePasskeyRegistration(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: (req.t && req.t('errors.databaseUnavailable')) || 'Banco de dados não disponível'
        });
      }

      const { credentialId, publicKey, attestationObject, deviceName } = req.body;

      if (!credentialId || !attestationObject) {
        return res.status(400).json({
          success: false,
          error: 'credentialId e attestationObject são obrigatórios'
        });
      }
      
      // PublicKey é opcional em alguns casos (pode ser extraído do attestationObject)
      if (!publicKey) {
        logger.warn('PublicKey não fornecido, será extraído do attestationObject se necessário');
      }

      const passkey = await userSecurityService.addPasskey(db, req.user.userID, {
        credentialId,
        publicKey,
        attestationObject,
        deviceName
      });

      // Registra auditoria
      auditLogger.init(db);
      await auditLogger.log({
        action: 'CREATE',
        entity: 'Passkey',
        entityID: passkey._id.toString(),
        result: 'success',
        severity: 'critical',
        message: 'Passkey adicionada',
        payload: {
          deviceName: deviceName
        },
        req: req,
        module: 'Segurança do Usuário'
      });

      return res.status(201).json({
        success: true,
        message: (req.t && req.t('userSecurity.mfa.alternatives.passkey.addSuccess')) || 'Passkey adicionada com sucesso',
        data: {
          id: passkey._id.toString(),
          deviceName: passkey.deviceName
        }
      });
    } catch (error) {
      logger.error('Erro ao adicionar passkey:', error.message);
      return res.status(400).json({
        success: false,
        error: (req.t && req.t('userSecurity.mfa.alternatives.passkey.addError')) || 'Erro ao adicionar passkey',
        message: error.message
      });
    }
  }

  /**
   * DELETE /api/user/security/passkey/:id
   * Remove passkey
   */
  async removePasskey(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: (req.t && req.t('errors.databaseUnavailable')) || 'Banco de dados não disponível'
        });
      }

      const { id } = req.params;

      await userSecurityService.removePasskey(db, req.user.userID, id);

      // Registra auditoria
      auditLogger.init(db);
      await auditLogger.log({
        action: 'DELETE',
        entity: 'Passkey',
        entityID: id,
        result: 'success',
        severity: 'critical',
        message: 'Passkey removida',
        req: req,
        module: 'Segurança do Usuário'
      });

      return res.status(200).json({
        success: true,
        message: (req.t && req.t('userSecurity.mfa.alternatives.passkey.removeSuccess')) || 'Passkey removida com sucesso'
      });
    } catch (error) {
      logger.error('Erro ao remover passkey:', error.message);
      return res.status(400).json({
        success: false,
        error: (req.t && req.t('userSecurity.mfa.alternatives.passkey.removeError')) || 'Erro ao remover passkey',
        message: error.message
      });
    }
  }

  /**
   * POST /api/user/security/recovery-codes
   * Gera códigos de recuperação
   */
  async generateRecoveryCodes(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: (req.t && req.t('errors.databaseUnavailable')) || 'Banco de dados não disponível'
        });
      }

      const codes = await userSecurityService.generateRecoveryCodes(db, req.user.userID);

      // Registra auditoria
      auditLogger.init(db);
      await auditLogger.log({
        action: 'CREATE',
        entity: 'RecoveryCodes',
        entityID: req.user.userID,
        result: 'success',
        severity: 'critical',
        message: 'Códigos de recuperação gerados',
        req: req,
        module: 'Segurança do Usuário'
      });

      return res.status(201).json({
        success: true,
        message: (req.t && req.t('userSecurity.mfa.alternatives.recovery.generateSuccess')) || 'Códigos de recuperação gerados com sucesso',
        data: {
          codes: codes,
          remaining: codes.length
        }
      });
    } catch (error) {
      logger.error('Erro ao gerar códigos de recuperação:', error.message);
      return res.status(400).json({
        success: false,
        error: (req.t && req.t('userSecurity.mfa.alternatives.recovery.generateError')) || 'Erro ao gerar códigos de recuperação',
        message: error.message
      });
    }
  }

  /**
   * DELETE /api/user/security/sessions/:id
   * Revoga uma sessão específica
   */
  async revokeSession(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: (req.t && req.t('errors.databaseUnavailable')) || 'Banco de dados não disponível'
        });
      }

      const { id } = req.params;

      await userSecurityService.revokeSession(db, req.user.userID, id);

      // Registra auditoria
      auditLogger.init(db);
      await auditLogger.log({
        action: 'DELETE',
        entity: 'Session',
        entityID: id,
        result: 'success',
        severity: 'warning',
        message: 'Sessão revogada',
        req: req,
        module: 'Segurança do Usuário'
      });

      return res.status(200).json({
        success: true,
        message: (req.t && req.t('userSecurity.sessions.revokeSuccess')) || 'Sessão revogada com sucesso'
      });
    } catch (error) {
      logger.error('Erro ao revogar sessão:', error.message);
      return res.status(400).json({
        success: false,
        error: (req.t && req.t('userSecurity.sessions.revokeError')) || 'Erro ao revogar sessão',
        message: error.message
      });
    }
  }

  /**
   * DELETE /api/user/security/sessions
   * Revoga todas as sessões (exceto a atual)
   */
  async revokeAllSessions(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: (req.t && req.t('errors.databaseUnavailable')) || 'Banco de dados não disponível'
        });
      }

      const token = req.headers.authorization?.replace('Bearer ', '');
      await userSecurityService.revokeAllSessions(db, req.user.userID, token);

      // Registra auditoria
      auditLogger.init(db);
      await auditLogger.log({
        action: 'DELETE',
        entity: 'Sessions',
        entityID: req.user.userID,
        result: 'success',
        severity: 'critical',
        message: 'Todas as sessões revogadas',
        req: req,
        module: 'Segurança do Usuário'
      });

      return res.status(200).json({
        success: true,
        message: (req.t && req.t('userSecurity.sessions.revokeAllSuccess')) || 'Todas as sessões foram revogadas com sucesso'
      });
    } catch (error) {
      logger.error('Erro ao revogar todas as sessões:', error.message);
      return res.status(400).json({
        success: false,
        error: (req.t && req.t('userSecurity.sessions.revokeAllError')) || 'Erro ao revogar todas as sessões',
        message: error.message
      });
    }
  }

  /**
   * POST /api/user/security/password-reset/request
   * Solicita reset de senha com tempo de expiração
   */
  async requestPasswordReset(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: (req.t && req.t('errors.databaseUnavailable')) || 'Banco de dados não disponível'
        });
      }

      const { expirationHours = 1 } = req.body; // Padrão: 1 hora

      // Valida tempo de expiração (entre 15 minutos e 24 horas)
      if (expirationHours < 0.25 || expirationHours > 24) {
        return res.status(400).json({
          success: false,
          error: 'Tempo de expiração deve estar entre 15 minutos e 24 horas'
        });
      }

      const result = await userSecurityService.requestPasswordReset(db, req.user.userID, expirationHours);

      // Registra auditoria
      auditLogger.init(db);
      await auditLogger.log({
        action: 'CREATE',
        entity: 'PasswordReset',
        entityID: req.user.userID,
        result: 'success',
        severity: 'critical',
        message: 'Solicitação de reset de senha criada',
        payload: {
          expirationHours: expirationHours,
          expiresAt: result.expiresAt
        },
        req: req,
        module: 'Segurança do Usuário'
      });

      return res.status(200).json({
        success: true,
        message: (req.t && req.t('userSecurity.password.resetRequestSuccess')) || 'Link de reset de senha enviado com sucesso',
        data: {
          expiresAt: result.expiresAt,
          expirationHours: expirationHours
        }
      });
    } catch (error) {
      logger.error('Erro ao solicitar reset de senha:', error.message);
      return res.status(400).json({
        success: false,
        error: (req.t && req.t('userSecurity.password.resetRequestError')) || 'Erro ao solicitar reset de senha',
        message: error.message
      });
    }
  }
}

module.exports = new UserSecurityController();

