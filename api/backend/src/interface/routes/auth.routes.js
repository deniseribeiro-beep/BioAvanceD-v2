const express = require('express');
const router = express.Router();
const authController = require('../../controllers/auth.controller');
const { authenticate } = require('../../infrastructure/middleware/auth');
const logger = require('../../utils/logger');
const auditLogger = require('../../utils/auditLogger');
const jwt = require('jsonwebtoken');
const env = require('../../config/env');

const REFRESH_COOKIE_NAME = 'refresh_token';

function getRefreshCookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'strict' : 'lax',
    path: '/api/auth',
    maxAge: 7 * 24 * 60 * 60 * 1000
  };
}

function setRefreshCookie(res, refreshToken) {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, getRefreshCookieOptions());
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE_NAME, getRefreshCookieOptions());
}

function getCookieValue(req, cookieName) {
  const cookieHeader = req.headers.cookie || '';
  const segments = cookieHeader.split(';').map((segment) => segment.trim());
  const match = segments.find((segment) => segment.startsWith(`${cookieName}=`));
  return match ? decodeURIComponent(match.substring(cookieName.length + 1)) : null;
}

// RF001 - Login (compatível com frontend)
router.post('/login', async (req, res, next) => {
  // Frontend envia: { username, password, twoFactorCode }
  // Backend espera: { email, password, mfaCode }
  const { username, email, password, twoFactorCode, mfaCode } = req.body;
  const loginIdentifier = username || email;
  logger.info(`Login request recebido - username: "${username}", email: "${email}", password: ${password ? 'fornecida' : 'não fornecida'}`);
  req.body.email = loginIdentifier; // Compatibilidade - permite login com username ou email
  req.body.mfaCode = twoFactorCode || mfaCode; // Compatibilidade
  logger.info(`Dados convertidos - email: "${req.body.email}", mfaCode: ${req.body.mfaCode ? 'fornecido' : 'não fornecido'}`);
  try {
    await authController.login(req, res);
  } catch (error) {
    logger.error('Erro não tratado na rota de login:', error.message);

    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: 'Erro interno ao processar login',
        message: error.message
      });
    }

    return next(error);
  }
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
  res.status(501).json({
    success: false,
    error: (req.t && req.t('common.notImplemented')) || 'Funcionalidade não implementada'
  });
});
router.get('/two-factor/status', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;

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
      const sessionCheck = await sessionService.verifySession(db, token);
      
      if (sessionCheck.valid && sessionCheck.session?.sessionID) {
        await sessionService.invalidateSession(db, sessionCheck.session.sessionID);
      }
    }

    clearRefreshCookie(res);
    
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

    // #428: accessType/roleName no longer persisted on the User document
    // (#427) — resolve both display values from the active RBAC assignment,
    // same pattern as user.routes.js's resolveRoleDisplayName since #427.
    const { resolveRoleDisplayName, resolveUserHierarchyLevel } = require('../../services/rbac-assignment.service');
    const [roleName, accessType] = await Promise.all([
      resolveRoleDisplayName(db, req.user.userID),
      resolveUserHierarchyLevel(db, req.user.userID)
    ]);

    return res.status(200).json({
      success: true,
      data: {
        user: {
          _id: user._id,
          userID: req.user.userID,
          email: user.email,
          username: user.username,
          accessType,
          roleName,
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

// Lista sessões ativas do usuário autenticado
router.get('/sessions', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;

    const token = req.headers.authorization?.substring(7);
    const sessionService = require('../../services/session.service');
    const sessions = await sessionService.listUserSessions(db, req.user.userID, token);

    return res.status(200).json({
      success: true,
      data: sessions
    });
  } catch (error) {
    logger.error('Erro ao listar sessões:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao listar sessões',
      message: error.message
    });
  }
});

// Revoga todas as sessões exceto a atual
router.delete('/sessions/all-others', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;

    const token = req.headers.authorization?.substring(7);
    const sessionService = require('../../services/session.service');
    await sessionService.revokeAllOtherSessions(db, req.user.userID, token);

    return res.status(200).json({
      success: true,
      message: 'Todas as outras sessões foram encerradas'
    });
  } catch (error) {
    logger.error('Erro ao revogar outras sessões:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao encerrar outras sessões',
      message: error.message
    });
  }
});

// Revoga uma sessão específica
router.delete('/sessions/:sessionId', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;

    const { sessionId } = req.params;
    const sessionService = require('../../services/session.service');
    const token = req.headers.authorization?.substring(7);
    const sessionCheck = await sessionService.verifySession(db, token);

    if (sessionCheck.valid && sessionCheck.session?.sessionID === sessionId) {
      clearRefreshCookie(res);
    }

    const revoked = await sessionService.revokeSessionById(db, req.user.userID, sessionId);

    if (!revoked) {
      return res.status(404).json({
        success: false,
        error: 'Sessão não encontrada'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Sessão encerrada com sucesso'
    });
  } catch (error) {
    logger.error('Erro ao revogar sessão específica:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao encerrar sessão',
      message: error.message
    });
  }
});

// Atualiza token de acesso com refresh token HttpOnly
router.post('/refresh', async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        error: (req.t && req.t('errors.databaseUnavailable')) || 'Banco de dados não disponível'
      });
    }

    const refreshToken = getCookieValue(req, REFRESH_COOKIE_NAME);
    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        error: 'Refresh token não fornecido'
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET || env.JWT_SECRET);
    } catch (tokenError) {
      clearRefreshCookie(res);
      return res.status(401).json({
        success: false,
        error: 'Refresh token inválido'
      });
    }

    if (!decoded?.userID || decoded?.type !== 'refresh') {
      clearRefreshCookie(res);
      return res.status(401).json({
        success: false,
        error: 'Refresh token inválido'
      });
    }

    const sessionService = require('../../services/session.service');
    const session = await sessionService.getSessionByRefreshToken(db, refreshToken);
    if (!session || session.userID !== String(decoded.userID)) {
      clearRefreshCookie(res);
      return res.status(401).json({
        success: false,
        error: 'Sessão de refresh inválida ou revogada'
      });
    }

    const usersCollection = db.collection('users');
    const { ObjectId } = require('mongodb');
    const user = await usersCollection.findOne({ _id: new ObjectId(decoded.userID) });
    if (!user) {
      clearRefreshCookie(res);
      return res.status(401).json({
        success: false,
        error: 'Usuário não encontrado para refresh'
      });
    }

    const accessToken = jwt.sign(
      {
        userID: user._id.toString(),
        email: user.email,
        username: user.username,
        accessType: user.accessType,
        name: user.name,
        mfaVerified: true
      },
      env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    const newRefreshToken = jwt.sign(
      {
        userID: user._id.toString(),
        sessionID: session.sessionID,
        type: 'refresh'
      },
      env.JWT_REFRESH_SECRET || env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    await sessionService.rotateSessionTokens(db, session.sessionID, accessToken, newRefreshToken);
    setRefreshCookie(res, newRefreshToken);

    return res.status(200).json({
      success: true,
      data: {
        token: accessToken
      }
    });
  } catch (error) {
    logger.error('Erro ao renovar token:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao renovar token',
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

