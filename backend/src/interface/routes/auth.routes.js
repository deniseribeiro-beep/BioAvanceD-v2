const express = require('express');
const router = express.Router();
const authController = require('../../controllers/auth.controller');
const { authenticate } = require('../../infrastructure/middleware/auth');
const logger = require('../../utils/logger');
const auditLogger = require('../../utils/auditLogger');

// RF001 - Login (compatível com frontend)
router.post('/login', (req, res) => {
  // Frontend envia: { username, password, twoFactorCode }
  // Backend espera: { email, password, mfaCode }
  const { username, email, password, twoFactorCode, mfaCode } = req.body;
  const loginIdentifier = username || email;
  logger.info(`Login request recebido - username: "${username}", email: "${email}", password: ${password ? 'fornecida' : 'não fornecida'}`);
  req.body.email = loginIdentifier; // Compatibilidade - permite login com username ou email
  req.body.mfaCode = twoFactorCode || mfaCode; // Compatibilidade
  logger.info(`Dados convertidos - email: "${req.body.email}", mfaCode: ${req.body.mfaCode ? 'fornecido' : 'não fornecido'}`);
  authController.login(req, res);
});

// RF003 - Cadastro de usuário (pode ser público ou protegido dependendo da regra)
router.post('/register', authController.register.bind(authController));

// Troca de senha autenticada
router.post('/change-password', authenticate, authController.changePassword.bind(authController));

// MFA - Requer autenticação (compatível com frontend)
router.get('/two-factor/qr', authenticate, authController.setupMFA.bind(authController));
router.post('/two-factor/enable', authenticate, (req, res) => {
  req.body.mfaCode = req.body.code; // Compatibilidade
  authController.enableMFA(req, res);
});
router.post('/two-factor/disable', authenticate, (req, res) => {
  // TODO: Implementar desabilitar MFA
  res.status(501).json({
    success: false,
    error: (req.t && req.t('common.notImplemented')) || 'Funcionalidade não implementada'
  });
});
router.get('/two-factor/status', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: (req.t && req.t('errors.databaseUnavailable')) || 'Banco de dados não disponível'
      });
    }

    const usersCollection = db.collection('users');
    const { ObjectId } = require('mongodb');
    const user = await usersCollection.findOne({ _id: new ObjectId(req.user.userID) });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: (req.t && req.t('users.notFound')) || 'Usuário não encontrado'
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        mfaEnabled: user.mfaEnabled || false,
        mfaLocked: user.mfaLocked || false
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: (req.t && req.t('mfa.statusError')) || 'Erro ao verificar status MFA',
      message: error.message
    });
  }
});

// Keepalive - Renova sessão por atividade
router.post('/keepalive', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: (req.t && req.t('errors.databaseUnavailable')) || 'Banco de dados não disponível'
      });
    }

    const token = req.headers.authorization?.substring(7);
    const sessionService = require('../../services/session.service');
    
    const session = await sessionService.updateActivity(db, token);
    
    if (!session) {
      // Log de sessão expirada no keepalive
      setImmediate(async () => {
        try {
          auditLogger.init(db);
          await auditLogger.log({
            action: 'SESSION_EXPIRED',
            entity: 'Authentication',
            result: 'error',
            severity: 'warning',
            message: (req.t && req.t('auth.sessionExpiredMessage')) || 'Sessão expirada durante keepalive',
            req: req,
            module: (req.t && req.t('common.security')) || 'Segurança'
          });
        } catch (error) {
          // Não bloqueia resposta
        }
      });
      
      return res.status(401).json({
        success: false,
        error: (req.t && req.t('auth.sessionExpired')) || 'Sessão expirada',
        message: (req.t && req.t('auth.sessionExpiredMessage')) || 'Sua sessão expirou. Faça login novamente.',
        sessionExpired: true
      });
    }

    // Log de keepalive bem-sucedido (apenas para auditoria, não muito frequente)
    // Comentado para evitar spam de logs - keepalive é muito frequente
    // setImmediate(async () => {
    //   try {
    //     auditLogger.init(db);
    //     await auditLogger.log({
    //       action: 'KEEPALIVE',
    //       entity: 'Session',
    //       result: 'success',
    //       severity: 'info',
    //       message: (req.t && req.t('auth.sessionRenewed')) || 'Sessão renovada',
    //       req: req,
    //       module: (req.t && req.t('common.authentication')) || 'Autenticação'
    //     });
    //   } catch (error) {
    //     // Não bloqueia resposta
    //   }
    // });

    return res.status(200).json({
      success: true,
      message: (req.t && req.t('auth.sessionRenewed')) || 'Sessão renovada',
      data: {
        lastActivity: session.lastActivity,
        expiresAt: session.expiresAt
      }
    });
  } catch (error) {
    logger.error('Erro no keepalive:', error.message);
    return res.status(500).json({
      success: false,
      error: (req.t && req.t('auth.keepaliveError')) || 'Erro ao renovar sessão',
      message: error.message
    });
  }
});

// Logout
router.post('/logout', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const token = req.headers.authorization?.substring(7);
    
    if (db && token) {
      const sessionService = require('../../services/session.service');
      // Busca sessão pelo token
      const sessionsCollection = db.collection('sessions');
      const session = await sessionsCollection.findOne({ token });
      
      if (session) {
        await sessionService.invalidateSession(db, session.sessionID);
      }
      
      // Invalida todas as sessões do usuário
      await sessionService.invalidateUserSessions(db, req.user.userID);
    }
    
    // Log de logout
    await auditLogger.logLogout(req);
    
    return res.status(200).json({
      success: true,
      message: (req.t && req.t('auth.logoutSuccess')) || 'Logout realizado com sucesso'
    });
  } catch (error) {
    logger.error('Erro no logout:', error.message);
    
    // Tenta logar o logout mesmo em caso de erro
    try {
      await auditLogger.logLogout(req);
    } catch (logError) {
      // Ignora erro de log
    }
    
    return res.status(200).json({
      success: true,
      message: (req.t && req.t('auth.logoutSuccess')) || 'Logout realizado com sucesso'
    });
  }
});

// Verificar token
router.get('/verify', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: (req.t && req.t('errors.databaseUnavailable')) || 'Banco de dados não disponível'
      });
    }

    // Busca dados completos do usuário
    const usersCollection = db.collection('users');
    const { ObjectId } = require('mongodb');
    const user = await usersCollection.findOne({ _id: new ObjectId(req.user.userID) });

    if (!user) {
      // Registra tentativa de verificar token de usuário inexistente
      auditLogger.init(db);
      await auditLogger.log({
        action: 'TOKEN_VERIFY_FAILED',
        entity: 'Authentication',
        result: 'error',
        severity: 'warning',
        message: (req.t && req.t('auth.tokenVerifyFailed')) || 'Token verificado mas usuário não encontrado',
        req: req,
        module: (req.t && req.t('common.security')) || 'Segurança'
      });
      
      return res.status(404).json({
        success: false,
        error: (req.t && req.t('users.notFound')) || 'Usuário não encontrado'
      });
    }

    // Mapeia accessType para roleName usando traduções
    const roleNameMap = {
      1: (req.t && req.t('roles.externalUser')) || 'Usuário Externo',
      2: (req.t && req.t('roles.technician')) || 'Técnico',
      3: (req.t && req.t('roles.coordinator')) || 'Coordenador',
      4: (req.t && req.t('roles.administrator')) || 'Administrador'
    };

    // Usa roleName do banco se existir, senão mapeia do accessType
    const roleName = user.roleName || roleNameMap[user.accessType] || ((req.t && req.t('roles.technician')) || 'Técnico');

    return res.status(200).json({
      success: true,
      data: {
        user: {
          _id: user._id,
          userID: req.user.userID,
          email: user.email,
          username: user.username,
          accessType: user.accessType,
          roleName: roleName,
          name: user.name,
          mfaEnabled: user.mfaEnabled || false
        },
        valid: true
      }
    });
  } catch (error) {
    logger.error('Erro ao verificar token:', error.message);
    return res.status(500).json({
      success: false,
      error: (req.t && req.t('auth.verifyTokenError')) || 'Erro ao verificar token',
      message: error.message
    });
  }
});

// Password reset
router.post('/password-reset/request', authController.requestPasswordReset.bind(authController));
router.post('/password-reset/reset', authController.resetPassword.bind(authController));

// Endpoints para primeiro login (não requerem autenticação)
router.post('/two-factor/qr-first-login', authController.setupMFAFirstLogin.bind(authController));
router.post('/two-factor/enable-first-login', authController.enableMFAFirstLogin.bind(authController));

// Endpoints legados (mantidos para compatibilidade)
router.post('/mfa/setup', authenticate, authController.setupMFA.bind(authController));
router.post('/mfa/enable', authenticate, authController.enableMFA.bind(authController));

module.exports = router;

