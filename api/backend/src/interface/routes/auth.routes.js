const express = require('express');
const router = express.Router();
const authController = require('../../controllers/auth.controller');
const authService = require('../../services/auth.service');
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission } = require('../../infrastructure/middleware/rbac');
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
//
// #1037: esta rota NÃO tem `authenticate` -- diferente de todas as suas
// vizinhas -- e auth.controller.js entrega `req.body` inteiro a
// registerUser, que respeita `userData.accessType || 2`. accessType 4 mapeia
// para 'administrator' em ROLE_CODE_BY_ACCESS_TYPE, e resolveScopeForRole
// atalha hierarchyLevel 4 para escopo GLOBAL sem validar organizationId --
// ou seja, a concessão não pode falhar. O mesmo pedido ainda cai no ramo que
// zera mfaEnabled/mfaSecretCiphertext por padrão. Resultado medido: um POST anônimo
// devolvia 201 e gravava uma atribuição de administrador global, ativa, com
// MFA desligado.
//
// A rota irmã POST /api/users/register carrega o piso de hierarquia do #998,
// cujo próprio comentário descreve exatamente esta escalada um nível abaixo.
// As duas chegam ao MESMO serviço; o piso vivia só numa delas. Este guard é
// o piso equivalente para a rota pública, e é a única parte do #1037 que não
// depende de uma decisão de produto: se esta rota deve existir, ser
// autenticada ou ser removida continua em aberto lá.
//
// Falha FECHADA em vez de rebaixar em silêncio. Um rebaixamento silencioso
// deixaria o chamador acreditando que escolheu o nível que pediu, e quem
// legitimamente precisa escolher um nível tem a rota autenticada para isso.
// Um pedido sem accessType/roleName segue inalterado e recebe o padrão 2.
function rejectCallerSuppliedPrivilege(req, res, next) {
  const body = req.body || {};
  const supplied = ['accessType', 'roleName'].filter((k) => body[k] !== undefined && body[k] !== null);
  if (supplied.length === 0) {
    return next();
  }

  logger.warn(
    `#1037: registro público recusado -- nível de acesso fornecido pelo chamador: ${supplied.join(", ")}`
  );
  return res.status(403).json({
    success: false,
    error: (req.t && req.t("errors.forbidden")) || "Acesso negado",
    message: "Este endpoint não aceita accessType nem roleName. Use a rota autenticada de criação de usuários para definir o nível de acesso."
  });
}

// #1037: this route was UNAUTHENTICATED. rejectCallerSuppliedPrivilege above
// closed the escalation half -- an anonymous caller could no longer ASK for
// accessType 4 -- but an anonymous caller could still create a default-level
// account, with a caller-supplied organizationId, attributed to `system` and
// with no audit row naming an actor, because there was no actor to name.
//
// The specification settles this; it is not a taste call:
//   - RF003 ("Gestão de usuários") has `Ator primário: Administrador` and
//     owns the whole account lifecycle. RF001 (authentication) creates
//     SESSIONS, not accounts -- its acceptance criteria have no
//     account-creation clause at all. This route lives on the RF001 surface
//     while performing an RF003 action.
//   - RF003 AC#6 requires auditing account creation.
//   - RF012 AC#1 and RNF009 AC#2 (Crítica) both make the ACTOR a mandatory
//     element of every audit event. An anonymous creation cannot supply one.
//   - No requirement anywhere in docs-7-27-2026 or the 7-31 amendment asks
//     for unauthenticated self-registration, and UserAccount carries no
//     pending-approval state, no self-registered flag and no activation step
//     that such a flow would need. UserRoleAssignment.grantedBy is 1..1 Core.
//
// Gated to match the authenticated twin (POST /api/users/register), which is
// what the frontend actually calls. rejectCallerSuppliedPrivilege STAYS: the
// twin is where a caller who legitimately needs to choose a level does so,
// under #998's hierarchy floor. That makes this route a strictly weaker
// duplicate of the twin, which is an argument for deleting it outright --
// tracked separately rather than done here, because whether an out-of-repo
// consumer posts to it cannot be answered from inside this repo.
router.post(
  '/register',
  authenticate,
  requirePermission('createUser'),
  rejectCallerSuppliedPrivilege,
  authController.register.bind(authController)
);

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
        // #974: an explicit logout is 'user_request' by the session's own
        // owner. req.user is not relied on here because this route reaches
        // the revoke through verifySession rather than the authenticate
        // middleware, so the session document is the authoritative actor.
        await sessionService.invalidateSession(
          db,
          sessionCheck.session.sessionID,
          'user_request',
          sessionCheck.session.userID
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

    const revoked = await sessionService.revokeSessionById(db, req.user.userID, sessionId, 'user_request', req.user.userID);

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

    // #431: accessType resolved fresh from the RBAC assignment via
    // authService.issueAccessToken, not read off the (no-longer-populated,
    // since #427) User document field.
    const accessToken = await authService.issueAccessToken(db, user);

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

