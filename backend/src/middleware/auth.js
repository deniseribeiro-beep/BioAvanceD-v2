const jwt = require('jsonwebtoken');
const env = require('../config/env');
const logger = require('../utils/logger');
const sessionService = require('../services/session.service');

/**
 * Middleware de autenticação JWT
 * RF001 - Login com MFA
 * Permite acesso a rotas de setup MFA mesmo sem MFA configurado
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // Registra tentativa de acesso sem autenticação
      setImmediate(async () => {
        try {
          const db = req.app.locals.db;
          if (db) {
            const auditLogger = require('../utils/auditLogger');
            auditLogger.init(db);
            await auditLogger.log({
              action: 'UNAUTHORIZED',
              entity: 'Authentication',
              result: 'error',
              severity: 'warning',
              message: `Tentativa de acesso sem token: ${req.method} ${req.path}`,
              req: req,
              module: 'Segurança'
            });
          }
        } catch (error) {
          // Não bloqueia se houver erro no log
        }
      });
      
      return res.status(401).json({
        success: false,
        error: 'Token não fornecido',
        message: 'É necessário fazer login para acessar este recurso'
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer '

    try {
      const decoded = jwt.verify(token, env.JWT_SECRET);
      
      // Verifica sessão e atualiza atividade (exceto para rotas de keepalive e setup MFA)
      const isKeepAliveRoute = req.path.includes('/keepalive');
      const isMFASetupRoute = req.path.includes('/mfa/setup') || 
                              req.path.includes('/two-factor/qr') ||
                              req.path.includes('/two-factor/enable') ||
                              req.path.includes('/mfa/enable') ||
                              req.path.includes('/security/mfa-setup');
      // Apenas rotas específicas de setup MFA em /user/security devem pular verificação de sessão
      const isUserSecurityMFASetup = req.path.includes('/user/security') && 
                                     (req.path.includes('/mfa-setup') || 
                                      req.path.includes('/two-factor/qr') ||
                                      req.path.includes('/two-factor/enable'));
      
      if (!isKeepAliveRoute && !isMFASetupRoute && !isUserSecurityMFASetup) {
        try {
          // Usa o banco de dados disponível em app.locals.db (conectado no server.js)
          const db = req.app.locals.db;
          if (db) {
            const sessionCheck = await sessionService.verifySession(db, token);
            
            if (!sessionCheck.valid) {
              // Registra sessão inválida/expirada
              setImmediate(async () => {
                try {
                  const auditLogger = require('../utils/auditLogger');
                  auditLogger.init(db);
                  await auditLogger.log({
                    action: 'SESSION_EXPIRED',
                    entity: 'Authentication',
                    result: 'error',
                    severity: 'warning',
                    message: `Sessão ${sessionCheck.reason === 'session_expired' ? 'expirada' : 'inválida'}: ${req.method} ${req.path}`,
                    req: req,
                    module: 'Segurança'
                  });
                } catch (error) {
                  // Não bloqueia se houver erro no log
                }
              });
              
              if (sessionCheck.reason === 'session_expired') {
                return res.status(401).json({
                  success: false,
                  error: 'Sessão expirada por inatividade',
                  message: 'Sua sessão expirou devido à inatividade. Faça login novamente.',
                  sessionExpired: true
                });
              }
              return res.status(401).json({
                success: false,
                error: 'Sessão inválida',
                message: 'Sessão não encontrada ou inválida'
              });
            }
            
            // Atualiza última atividade
            await sessionService.updateActivity(db, token);
          }
        } catch (sessionError) {
          logger.warn('Erro ao verificar sessão (continuando com JWT):', sessionError.message);
          // Continua mesmo se houver erro na verificação de sessão (fallback para JWT)
        }
      }
      
      // Verifica se é rota de setup MFA (permite token temporário)
      // Apenas rotas específicas de setup MFA são permitidas para que o usuário possa configurar sua segurança
      const isSecurityMFASetupRoute = req.path.includes('/security/mfa-setup');
      if (!isMFASetupRoute && !isUserSecurityMFASetup && !isSecurityMFASetupRoute && decoded.mfaSetupRequired && !decoded.mfaVerified) {
        return res.status(403).json({
          success: false,
          error: 'MFA não configurado',
          requiresMFASetup: true,
          message: 'É obrigatório configurar MFA no primeiro acesso. Configure o MFA antes de acessar outros recursos.'
        });
      }
      
      req.user = decoded;
      next();
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          error: 'Token expirado',
          message: 'Faça login novamente'
        });
      }
      return res.status(401).json({
        success: false,
        error: 'Token inválido',
        message: 'Token de autenticação inválido'
      });
    }
  } catch (error) {
    logger.error('Erro no middleware de autenticação:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro interno',
      message: 'Erro ao processar autenticação'
    });
  }
};

/**
 * Middleware opcional - não bloqueia se não houver token
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        const decoded = jwt.verify(token, env.JWT_SECRET);
        req.user = decoded;
      } catch (error) {
        // Ignora erro, continua sem usuário autenticado
      }
    }
    next();
  } catch (error) {
    next();
  }
};

module.exports = {
  authenticate,
  optionalAuth
};

