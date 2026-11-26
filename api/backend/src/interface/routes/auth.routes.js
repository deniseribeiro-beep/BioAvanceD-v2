const express = require('express');
const router = express.Router();
const authController = require('../../controllers/auth.controller');
const authService = require('../../services/auth.service');
const { authenticate } = require('../../infrastructure/middleware/auth');
const logger = require('../../utils/logger');
const auditLogger = require('../../utils/auditLogger');
const jwt = require('jsonwebtoken');
const env = require('../../config/env');
const SessionModel = require('../../models/Session');
const UserModel = require('../../models/User');

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

// #1057 (Denise, 2026-09-25): POST /register was deleted from this router.
// Account creation is RF003's, and its one route is POST /api/users/register.
// The duplicate here had no in-repo consumer, and a second door onto
// registerUser is what let #1037's escalation past #998's floor.

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
            resourceType: 'Authentication',
            status: 'error',
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
    //       status: 'success',
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
        // The response key stays lastActivity; the stored name is lastActivityAt.
        lastActivity: SessionModel.lastActivityOf(session),
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
      
      const loggedOutSessionId = sessionCheck.valid ? SessionModel.sessionIdOf(sessionCheck.session) : null;
      if (loggedOutSessionId) {
        // #974: an explicit logout is 'user_request' by the session's own
        // owner. req.user is not relied on here because this route reaches
        // the revoke through verifySession rather than the authenticate
        // middleware, so the session document is the authoritative actor.
        await sessionService.invalidateSession(
          db,
          loggedOutSessionId,
          'user_request',
          SessionModel.ownerOf(sessionCheck.session),
          { req }
        );
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
        resourceType: 'Authentication',
        status: 'error',
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
    const { resolveRoleDisplayName, resolveUserHierarchyLevel, isAuditReader } = require('../../services/rbac-assignment.service');
    const [roleName, accessType, auditReader] = await Promise.all([
      resolveRoleDisplayName(db, req.user.userID),
      resolveUserHierarchyLevel(db, req.user.userID),
      // #1239: the audit-trail gate's own rule, for the frontend's Logs guard.
      isAuditReader(db, req.user.userID)
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
          isAuditReader: auditReader,
          name: UserModel.displayNameOf(user),
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
    await sessionService.revokeAllOtherSessions(db, req.user.userID, token, 'user_request', null, { req });

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

    if (sessionCheck.valid && SessionModel.sessionIdOf(sessionCheck.session) === sessionId) {
      clearRefreshCookie(res);
    }

    const revoked = await sessionService.revokeSessionById(db, req.user.userID, sessionId, 'user_request', req.user.userID, { req });

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
    if (!session || SessionModel.ownerOf(session) !== String(decoded.userID)) {
      clearRefreshCookie(res);
      return res.status(401).json({
        success: false,
        error: 'Sessão de refresh inválida ou revogada'
      });
    }
    const sessionId = SessionModel.sessionIdOf(session);

    // #1249: session.autoRenewal off -- the session is not renewed, so it ends
    // with its access token, recorded as an expiry.
    if (!(await sessionService.resolveSessionPolicy(db)).autoRenewal) {
      await sessionService.invalidateSession(db, sessionId, 'expiration', 'system');
      clearRefreshCookie(res);
      return res.status(401).json({
        success: false,
        code: 'SESSION_RENEWAL_DISABLED',
        error: 'Renovação automática de sessão desativada pela política de segurança'
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

    // #1306 (RNF021 C2): refresh used to check only that the user exists, so
    // an inactivated account kept renewing its access token.
    if (UserModel.normalizeStatus(UserModel.accountStatusOf(user)) !== 'active') {
      await sessionService.invalidateSession(db, sessionId, 'admin_action', 'system');
      clearRefreshCookie(res);
      return res.status(401).json({
        success: false,
        code: 'ACCOUNT_INACTIVE',
        error: 'Conta inativa'
      });
    }

    // #431: accessType resolved fresh from the RBAC assignment via
    // authService.issueAccessToken, not read off the (no-longer-populated,
    // since #427) User document field.
    const accessToken = await authService.issueAccessToken(db, user);

    // #1456 (RNF021 AC1): the shared signer adds a random jti, so two
    // rotations inside one second still issue different tokens and the one
    // rotated away no longer matches the stored hash.
    const newRefreshToken = authService.issueRefreshToken(user, sessionId);

    await sessionService.rotateSessionTokens(db, sessionId, accessToken, newRefreshToken, session);
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

// #1246: the password strength rules in force, so every form that sets a
// password checks what the server will check. Unauthenticated on purpose: the
// token-reset page and the first-login change have no session yet, and the
// rules are what a user is told before choosing (the reuse keys stay out).
router.get('/password-policy', async (req, res) => {
  const db = req.app.locals.db;
  if (!db) {
    return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
  }
  const passwordService = require('../../services/password.service');
  const policy = await passwordService.resolvePasswordPolicy(db);
  // #1249: allowPasswordReset rides along so the login page can hide the
  // forgot-password link while the flow is switched off.
  return res.status(200).json({
    success: true,
    data: { ...passwordService.publicStrengthRules(policy), allowPasswordReset: policy.allowPasswordReset }
  });
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

