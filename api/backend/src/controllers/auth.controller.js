const authService = require('../services/auth.service');
const logger = require('../utils/logger');
const auditLogger = require('../utils/auditLogger');
const bcrypt = require('bcryptjs');
const passwordService = require('../services/password.service');
const sessionService = require('../services/session.service');

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

function attachRefreshCookieIfPresent(res, result) {
  if (result?.refreshToken) {
    res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, getRefreshCookieOptions());
  }
}

function sanitizeAuthPayload(result) {
  if (!result || typeof result !== 'object') {
    return result;
  }

  const { refreshToken, sessionID, ...safeResult } = result;
  return safeResult;
}

/**
 * Controller de Autenticação
 * RF001 - Login com MFA
 */
class AuthController {
  async register(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: (req.t && req.t('errors.databaseUnavailable')) || 'Banco de dados não disponível'
        });
      }

      const user = await authService.registerUser(db, req.body);

      return res.status(201).json({
        success: true,
        message: (req.t && req.t('users.registerSuccess')) || 'Usuário registrado com sucesso',
        data: user
      });
    } catch (error) {
      logger.error('Erro no registro:', error.message);
      return res.status(400).json({
        success: false,
        error: (req.t && req.t('users.registerError')) || 'Erro ao registrar usuário',
        message: error.message
      });
    }
  }

  async login(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: (req.t && req.t('errors.databaseUnavailable')) || 'Banco de dados não disponível'
        });
      }

      const result = await authService.login(db, req.body, req);

      // Primeiro login - MFA obrigatório
      if (result.requiresMFASetup) {
        return res.status(200).json({
          success: true,
          requiresMFASetup: true,
          requiresTwoFactorSetup: true, // Compatibilidade com frontend
          message: (req.t && req.t('auth.mfaSetupRequired')) || 'Configuração de MFA obrigatória no primeiro acesso',
          data: {
            tempToken: result.tempToken,
            user: result.user
          }
        });
      }

      // MFA habilitado mas código não fornecido
      if (result.requiresMFA) {
        return res.status(200).json({
          success: true,
          requiresMFA: true,
          requiresTwoFactor: true, // Compatibilidade com frontend
          message: (req.t && req.t('auth.mfaRequired')) || 'Código de autenticação necessário'
        });
      }

      // RF014 AC#4 (#648): admin forçou redefinição de senha e a nova senha
      // ainda não foi enviada -- mesmo padrão de "flag no nível raiz" que
      // requiresMFASetup/requiresMFA acima, não aninhado em `data`
      // (AuthContext.tsx's frontend só lê responseData.requiresPasswordChange
      // no nível raiz; aninhado em `data`, cai no fallback genérico de 2FA).
      if (result.requiresPasswordChange) {
        return res.status(200).json({
          success: true,
          requiresPasswordChange: true,
          message: (req.t && req.t('auth.passwordChangeRequired')) || result.message
        });
      }

      // Log de login bem-sucedido (assíncrono para não bloquear resposta)
      if (result.user) {
        req.user = result.user; // Define req.user para o auditLogger
        setImmediate(() => {
          auditLogger.logLogin(req, true).catch((logError) => {
            logger.error('Erro ao registrar auditoria de login:', logError.message);
          });
        });
      }

      attachRefreshCookieIfPresent(res, result);
      const safeResult = sanitizeAuthPayload(result);

      return res.status(200).json({
        success: true,
        message: (req.t && req.t('auth.loginSuccess')) || 'Login realizado com sucesso',
        data: safeResult
      });
    } catch (error) {
      logger.error('Erro no login:', error && error.stack ? error.stack : error.message);
      // Log de tentativa de login falhada (assíncrono para não bloquear resposta)
      setImmediate(() => {
        auditLogger.logLogin(req, false, error).catch((logError) => {
          logger.error('Erro ao registrar auditoria de login:', logError.message);
        });
      });
      if (error.code === 'MFA_LOCKED') {
        return res.status(401).json({
          success: false,
          code: 'MFA_LOCKED',
          error: (req.t && req.t('auth.mfaLocked')) || 'MFA bloqueado devido a muitas tentativas falhas',
          message: error.message
        });
      }
      return res.status(401).json({
        success: false,
        error: (req.t && req.t('auth.loginError')) || 'Erro ao fazer login. Verifique suas credenciais.',
        message: error.message
      });
    }
  }

  async setupMFA(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: (req.t && req.t('errors.databaseUnavailable')) || 'Banco de dados não disponível'
        });
      }

      const result = await authService.setupMFA(db, req.user.userID);

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('Erro ao configurar MFA:', error.message);
      return res.status(400).json({
        success: false,
        error: (req.t && req.t('mfa.setupError')) || 'Erro ao configurar MFA',
        message: error.message
      });
    }
  }

  async enableMFA(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const { mfaCode, code } = req.body; // Suporta ambos os formatos
      const codeToUse = mfaCode || code;
      
      if (!codeToUse) {
        return res.status(400).json({
          success: false,
          error: (req.t && req.t('mfa.codeRequired')) || 'Código MFA é obrigatório'
        });
      }

      const result = await authService.enableMFA(db, req.user.userID, codeToUse);

      attachRefreshCookieIfPresent(res, result);
      const safeResult = sanitizeAuthPayload(result);

      // Se for primeiro login, retorna token completo
      if (result.token) {
        return res.status(200).json({
          success: true,
          message: (req.t && req.t('mfa.enableFirstLoginSuccess')) || 'MFA ativado com sucesso. Primeiro acesso concluído.',
          data: {
            token: result.token,
            user: result.user
          }
        });
      }

      return res.status(200).json({
        success: true,
        message: (req.t && req.t('mfa.enableSuccess')) || 'MFA ativado com sucesso',
        data: safeResult
      });
    } catch (error) {
      logger.error('Erro ao ativar MFA:', error.message);
      return res.status(400).json({
        success: false,
        error: (req.t && req.t('mfa.enableError')) || 'Erro ao ativar MFA',
        message: error.message
      });
    }
  }

  async requestPasswordReset(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const { email } = req.body;
      if (!email) {
        return res.status(400).json({
          success: false,
          error: (req.t && req.t('errors.invalidEmail')) || 'Email é obrigatório'
        });
      }

      const result = await authService.requestPasswordReset(db, email, req);

      return res.status(200).json({
        success: true,
        message: result.message,
        data: {
          resetLink: result.resetLink,
          token: result.token
        }
      });
    } catch (error) {
      logger.error('Erro ao solicitar recuperação de senha:', error.message);
      return res.status(400).json({
        success: false,
        error: (req.t && req.t('auth.passwordResetError')) || 'Erro ao solicitar recuperação de senha',
        message: error.message
      });
    }
  }

  async resetPassword(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const { token, newPassword } = req.body;
      if (!token) {
        return res.status(400).json({
          success: false,
          error: (req.t && req.t('auth.resetTokenRequired')) || 'Token de recuperação é obrigatório'
        });
      }

      if (!newPassword) {
        return res.status(400).json({
          success: false,
          error: (req.t && req.t('auth.newPasswordRequired')) || 'Nova senha é obrigatória'
        });
      }

      const result = await authService.resetPassword(db, token, newPassword, req);

      return res.status(200).json({
        success: true,
        message: result.message
      });
    } catch (error) {
      logger.error('Erro ao resetar senha:', error.message);
      return res.status(400).json({
        success: false,
        error: (req.t && req.t('auth.resetPasswordError')) || 'Erro ao resetar senha',
        message: error.message
      });
    }
  }

  async changePassword(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: (req.t && req.t('errors.databaseUnavailable')) || 'Banco de dados não disponível'
        });
      }

      const { oldPassword, newPassword } = req.body;

      if (!oldPassword || !newPassword) {
        return res.status(400).json({
          success: false,
          error: 'Senha atual e nova senha são obrigatórias'
        });
      }

      const { ObjectId } = require('mongodb');
      const usersCollection = db.collection('users');
      const user = await usersCollection.findOne({ _id: new ObjectId(req.user.userID) });

      if (!user) {
        return res.status(404).json({
          success: false,
          error: (req.t && req.t('users.notFound')) || 'Usuário não encontrado'
        });
      }

      const oldMatches = await bcrypt.compare(oldPassword, user.password);
      if (!oldMatches) {
        return res.status(400).json({
          success: false,
          error: (req.t && req.t('auth.invalidCurrentPassword')) || 'Senha atual incorreta'
        });
      }

      passwordService.validateStrength(newPassword);
      await passwordService.validateReuse(newPassword, user);

      const newHash = await bcrypt.hash(newPassword, 10);
      const history = Array.isArray(user.passwordHistory) ? user.passwordHistory : [];
      const updatedHistory = [user.password, ...history].slice(0, 3);

      await usersCollection.updateOne(
        { _id: user._id },
        {
          $set: {
            password: newHash,
            passwordHistory: updatedHistory,
            lastPasswordChange: new Date(),
            forceReset: false,
            failedLoginAttempts: 0,
            updatedAt: new Date()
          }
        }
      );

      // #958 / RNF021 AC#2: "Logout, inativação, troca de senha ou alteração
      // crítica de papel revogam as sessões afetadas." All-but-current, because
      // the session making this request just proved knowledge of BOTH the old
      // and the new password -- it is not an affected session. Every other live
      // session was authenticated with a password that no longer exists.
      //
      // A missing Authorization header fails CLOSED for free: hashToken(undefined)
      // hashes '' and matches no stored tokenHash, so nothing is excluded and all
      // sessions die.
      const currentToken = (req.headers && req.headers.authorization || '').replace('Bearer ', '');
      await sessionService.revokeAllOtherSessions(
        db, req.user.userID, currentToken, 'password_change', req.user.userID
      );
      
      return res.status(200).json({
        success: true,
        message: (req.t && req.t('auth.passwordChangeSuccess')) || 'Senha alterada com sucesso'
      });
    } catch (error) {
      logger.error('Erro ao trocar senha:', error.message);
      return res.status(400).json({
        success: false,
        error: (req.t && req.t('auth.passwordChangeError')) || 'Erro ao trocar senha',
        message: error.message
      });
    }
  }

  async setupMFAFirstLogin(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({
          success: false,
          error: (req.t && req.t('auth.usernameAndPasswordRequired')) || 'Usuário e senha são obrigatórios'
        });
      }

      const result = await authService.setupMFAFirstLogin(db, { username, password });

      logger.info('QR Code gerado com sucesso para primeiro login:', { username });

      return res.status(200).json({
        success: true,
        data: {
          qrCode: result.qrCode,
          secret: result.secret,
          manualEntryKey: result.manualEntryKey || result.secret
        }
      });
    } catch (error) {
      logger.error('Erro ao configurar MFA no primeiro login:', error.message);
      return res.status(400).json({
        success: false,
        error: (req.t && req.t('mfa.setupError')) || 'Erro ao configurar MFA',
        message: error.message
      });
    }
  }

  async enableMFAFirstLogin(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const { username, password, code } = req.body;
      if (!username || !password) {
        return res.status(400).json({
          success: false,
          error: 'Usuário e senha são obrigatórios'
        });
      }

      if (!code) {
        return res.status(400).json({
          success: false,
          error: (req.t && req.t('mfa.codeRequired')) || 'Código MFA é obrigatório'
        });
      }

      const result = await authService.enableMFAFirstLogin(db, { username, password }, code, req);

      attachRefreshCookieIfPresent(res, result);
      const safeResult = sanitizeAuthPayload(result);

      return res.status(200).json({
        success: true,
        message: (req.t && req.t('mfa.enableFirstLoginSuccess')) || 'MFA ativado com sucesso. Primeiro acesso concluído.',
        data: safeResult
      });
    } catch (error) {
      logger.error('Erro ao ativar MFA no primeiro login:', error.message);
      return res.status(400).json({
        success: false,
        error: (req.t && req.t('mfa.enableError')) || 'Erro ao ativar MFA',
        message: error.message
      });
    }
  }
}

module.exports = new AuthController();

