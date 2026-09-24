/**
 * src/middleware/integrationSecurityMiddleware.js
 * Middleware de integração do sistema de segurança e conformidade
 * Integra de forma não-invasiva:
 * - authConsent (bloqueio ético)
 * - securityAlerts (alertas)
 * - complianceReport (rastreamento)
 * 
 * Uso: Aplicar no server.js antes de registrar rotas críticas
 */

const { authConsent, createConsentMiddleware } = require('./authConsent');
const securityAlertsService = require('../../services/securityAlerts.service');
const consentScopesConfig = require('../../config/consentScopes');
const logger = require('../../utils/logger');

/**
 * Middleware que rastreia tentativas bloqueadas para detectar atividades suspeitas
 */
function trackBlockedAttempts(req, res, next) {
  // Armazena tentativas de acesso no request para análise posterior
  if (!req.app.locals.blockedAttempts) {
    req.app.locals.blockedAttempts = new Map();
  }
  
  next();
}

/**
 * Middleware wrapper para capturar bloqueios de consentimento
 */
function consentBlockAlertWrapper(middleware) {
  return async (req, res, next) => {
    const originalJson = res.json.bind(res);
    
    res.json = function(data) {
      // Se foi bloqueio de consentimento (403 com código CONSENT_*)
      if (res.statusCode === 403 && data?.code?.includes('CONSENT')) {
        try {
          const db = req.app.locals.db;
          if (db) {
            securityAlertsService.init(db);
            
            const participantId = req.body?.participantId || req.params?.participantId || 'unknown';
            const userID = req.user?.userID || 'anomino';
            
            // Registra alerta
            securityAlertsService.alertConsentBlocked(
              participantId,
              req.originalUrl,
              data.code || 'UNKNOWN_REASON',
              req.ip,
              req.get('user-agent')
            ).catch(err => logger.error('[INTEGRATION] Erro ao registrar alerta:', err.message));

            // Detecção de atividades suspeitas (múltiplas tentativas)
            const attemptKey = `${userID}:${participantId}`;
            const attempts = req.app.locals.blockedAttempts.get(attemptKey) || [];
            attempts.push({ timestamp: new Date(), reason: data.code });
            req.app.locals.blockedAttempts.set(attemptKey, attempts);

            // Se mais de 3 tentativas em 5 minutos
            const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
            const recentAttempts = attempts.filter(a => a.timestamp > fiveMinutesAgo);

            if (recentAttempts.length >= 3) {
              securityAlertsService.detectSuspiciousActivity(
                participantId,
                userID,
                recentAttempts,
                req.ip,
                req.get('user-agent')
              ).catch(err => logger.error('[INTEGRATION] Erro ao detectar atividade suspeita:', err.message));

              // Limpa para não acumular
              req.app.locals.blockedAttempts.delete(attemptKey);
            }
          }
        } catch (error) {
          logger.error('[INTEGRATION] Erro no wrapper de alerta:', error.message);
        }
      }
      
      return originalJson.call(this, data);
    };

    return middleware(req, res, next);
  };
}

/**
 * Factory para criar integração de segurança em uma rota de escrita (POST/PUT)
 */
function createSecurityIntegration(options = {}) {
  const {
    consentRequired = true,
    allowedScopes = ['uso_pesquisa'],
    participantIdResolver = 'participantId',
    alertOnBlock = true
  } = options;

  return async (req, res, next) => {
    try {
      const db = req.app.locals.db;
      
      // Inicializa serviços
      if (db && alertOnBlock) {
        securityAlertsService.init(db);
      }

      // Se consent é requerido, aplica middleware
      if (consentRequired) {
        const middleware = authConsent({
          participantIdResolver,
          allowedScopes,
          strictMode: true
        });

        // Envolve para capturar bloqueios
        const wrappedMiddleware = consentBlockAlertWrapper(middleware);
        return wrappedMiddleware(req, res, next);
      }

      return next();
    } catch (error) {
      logger.error('[INTEGRATION] Erro na integração de segurança:', error.message);
      return next();
    }
  };
}

/**
 * Integra segurança em uma rota específica
 * Uso no server.js:
 * 
 * integrateSecurityIntoRoute(app, '/api/samples', 'post', {
 *   consentRequired: true,
 *   allowedScopes: ['uso_pesquisa']
 * });
 */
function integrateSecurityIntoRoute(app, path, method, options = {}) {
  const securityMiddleware = createSecurityIntegration(options);
  
  app._router.stack.forEach(middleware => {
    if (middleware.route && middleware.route.path === path) {
      const layer = middleware.route.methods[method];
      if (layer) {
        // Insere middleware de segurança antes do handler
        middleware.route.stack.unshift({
          name: 'securityIntegration',
          method: 'all',
          handle: securityMiddleware
        });
      }
    }
  });

  logger.info(`[INTEGRATION] Segurança integrada em ${method.toUpperCase()} ${path}`);
}

/**
 * Aplica integração de segurança a múltiplas rotas críticas
 */
function applySecurityToAllCriticalRoutes(app) {
  const criticalRoutes = [
    // ===== SAMPLES (Amostras) =====
    { path: '/api/samples', method: 'post', scopes: ['uso_pesquisa'] },
    { path: '/api/samples/:id', method: 'put', scopes: ['uso_pesquisa'] },
    { path: '/api/samples/:id', method: 'delete', scopes: ['uso_pesquisa'] },

    // ===== RESULTS (Arquivos de Analise) =====
    { path: '/api/results', method: 'post', scopes: ['uso_pesquisa'] },
    { path: '/api/results/:id', method: 'put', scopes: ['uso_pesquisa'] },

    // ===== PACIENTES =====
    { path: '/api/patients', method: 'post', scopes: ['uso_pesquisa'] },
    { path: '/api/patients/:id', method: 'put', scopes: ['uso_pesquisa'] },

    // ===== EXTRACTIONS (Extrações) =====
    { path: '/api/extractions', method: 'post', scopes: ['uso_pesquisa'] },

    // ===== COMERCIAL =====
    { path: '/api/samples/:id/commercialize', method: 'post', scopes: ['uso_comercial'] },
    { path: '/api/samples/:id/share', method: 'post', scopes: ['compartilhamento_pesquisadores'] }
  ];

  criticalRoutes.forEach(route => {
    try {
      integrateSecurityIntoRoute(app, route.path, route.method, {
        consentRequired: true,
        allowedScopes: route.scopes,
        participantIdResolver: 'participantId',
        alertOnBlock: true
      });
    } catch (error) {
      logger.warn(`[INTEGRATION] Não foi possível integrar segurança em ${route.method.toUpperCase()} ${route.path}: ${error.message}`);
    }
  });

  logger.info(`[INTEGRATION] Segurança integrada em ${criticalRoutes.length} rotas críticas`);
}

/**
 * Middleware global para rastreamento de conformidade
 * Anexa informações que podem ser usadas em relatórios
 */
function complianceTrackingMiddleware(req, res, next) {
  // Adiciona timestamp de início
  req.complianceMetadata = {
    startTime: new Date(),
    endpoint: req.originalUrl,
    method: req.method
  };

  const originalSend = res.send.bind(res);
  
  res.send = function(data) {
    // Computa tempo de resposta
    req.complianceMetadata.duration = Date.now() - req.complianceMetadata.startTime.getTime();
    req.complianceMetadata.statusCode = res.statusCode;
    
    return originalSend(data);
  };

  next();
}

/**
 * Inicializa sistema completo de conformidade
 * Deve ser chamado no server.js após conectar ao DB
 */
async function initializeSecuritySystem(app, db) {
  try {
    logger.info('[INTEGRATION] Inicializando sistema de segurança...');

    // Inicializa serviços
    securityAlertsService.init(db);
    
    // Registra handler padrão para alertas (pode expandir com email, Slack, etc)
    securityAlertsService.registerAlertHandler(async (alert) => {
      logger.warn(`[ALERTS] ${alert.type} - ${alert.reason}`);
    });

    // Aplica middleware global
    app.use(trackBlockedAttempts);
    app.use(complianceTrackingMiddleware);

    // Aplica segurança às rotas críticas
    applySecurityToAllCriticalRoutes(app);

    logger.info('[INTEGRATION] ✅ Sistema de segurança inicializado com sucesso');

  } catch (error) {
    logger.error('[INTEGRATION] Erro ao inicializar sistema de segurança:', error.message);
  }
}

module.exports = {
  createSecurityIntegration,
  integrateSecurityIntoRoute,
  applySecurityToAllCriticalRoutes,
  trackBlockedAttempts,
  complianceTrackingMiddleware,
  consentBlockAlertWrapper,
  initializeSecuritySystem
};
