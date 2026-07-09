/**
 * src/middleware/authConsent.js
 * Middleware de Bloqueio Ético (Porteiro de Consentimento)
 * Conformidade: LGPD + ANVISA
 * 
 * Valida consentimento do paciente antes de operações de escrita
 * Retorna 403 se consentimento ausente ou revogado
 */

const { ObjectId } = require('mongodb');
const logger = require('../../utils/logger');
const { sanitizeInput, sanitizeSensitiveData } = require('../../utils/security');
const { getCollection } = require('../../utils/collectionResolver');

/**
 * Middleware que valida consentimento ético antes de permitir operações
 * 
 * @param {Object} options - Configurações do middleware
 * @param {string|Function} options.participantIdResolver - Campo contendo participantId ou função para extrair
 * @param {string[]} options.allowedScopes - Escopos de consentimento necessários
 * @param {boolean} options.strictMode - Se true, revoga acesso mesmo sem consentimento (padrão: true)
 * @returns {Function} Middleware Express
 */
function authConsent(options = {}) {
  const {
    participantIdResolver = 'participantId',
    allowedScopes = ['uso_pesquisa'], // Scopes padrão
    strictMode = true
  } = options;

  return async (req, res, next) => {
    try {
      // Validação inicial
      const db = req.app.locals.db;
      if (!db) {
        logger.error('[AUTHCONSENT] Banco de dados não disponível');
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível',
          code: 'DB_UNAVAILABLE'
        });
      }

      // 1. EXTRAÇÃO DO PATIENT ID
      let participantId = null;

      if (typeof participantIdResolver === 'function') {
        participantId = participantIdResolver(req);
      } else if (typeof participantIdResolver === 'string') {
        // Tenta extrair do body, params ou locals
        participantId = 
          req.body?.[participantIdResolver] ||
          req.params?.[participantIdResolver] ||
          req.query?.[participantIdResolver] ||
          req.locals?.[participantIdResolver];
      }

      if (!participantId) {
        logger.warn('[AUTHCONSENT] PatientID não encontrado no request');
        return res.status(400).json({
          success: false,
          error: 'PatientID não fornecido',
          code: 'PATIENT_ID_MISSING',
          message: 'Não foi possível identificar o paciente para validação de consentimento'
        });
      }

      // Sanitiza o participantId
      const sanitizedPatientID = sanitizeInput(participantId.toString());
      logger.debug(`[AUTHCONSENT] Validando consentimento para participantId: ${sanitizedPatientID}`);

      // 2. BUSCAR CONSENTIMENTO NO BANCO
      const patientConsentsCollection = await getCollection(db, 'consents', 'findOne');
      
      // Busca o consentimento mais recente do paciente
      const activeConsent = await patientConsentsCollection.findOne(
        {
          participantId: participantId.toString(),
          status: 'ACTIVE'
        },
        {
          sort: { signedAt: -1, createdAt: -1 }
        }
      );

      // 3. VALIDAÇÕES DE CONSENTIMENTO

      // Verifica se existe consentimento ativo
      if (!activeConsent) {
        const logMessage = `[BLOQUEIO ÉTICO] Tentativa de operação sem consentimento ativo - PatientID: ${sanitizedPatientID}`;
        logger.warn(logMessage);

        // Registra tentativa bloqueada em auditoria
        try {
          const auditLogger = require('../../utils/auditLogger');
          auditLogger.init(db);
          
          await auditLogger.log({
            action: 'CONSENT_BLOCK_DENIED',
            entity: 'PatientConsent',
            entityID: sanitizedPatientID,
            result: 'blocked',
            severity: 'warning',
            message: logMessage,
            payload: {
              participantId: sanitizedPatientID,
              reason: 'NO_ACTIVE_CONSENT',
              requestMethod: req.method,
              requestPath: req.path,
              allowedScopes
            },
            req: req,
            module: 'AuthConsent'
          });
        } catch (auditError) {
          logger.error('[AUTHCONSENT] Erro ao registrar tentativa bloqueada:', auditError.message);
        }

        if (strictMode) {
          return res.status(403).json({
            success: false,
            error: '🔒 BLOQUEIO ÉTICO: Consentimento ausente',
            code: 'CONSENT_REQUIRED',
            message: 'Operação não permitida. O paciente não possui consentimento ativo para esta operação.',
            timestamp: new Date().toISOString()
          });
        }
      } else {
        // Consentimento existe e está ativo
        logger.debug(`[AUTHCONSENT] Consentimento ativo encontrado - ID: ${activeConsent._id}`);

        // 4. VALIDAR ESCOPOS DE CONSENTIMENTO (se especificados)
        if (allowedScopes && allowedScopes.length > 0) {
          const responses = activeConsent.responses || {};
          const hasRequiredScope = allowedScopes.some(scope => responses[scope] === true);

          if (!hasRequiredScope) {
            const logMessage = `[BLOQUEIO ÉTICO] Escopo de consentimento insuficiente - PatientID: ${sanitizedPatientID}, Escopos necessários: ${allowedScopes.join(', ')}`;
            logger.warn(logMessage);

            // Registra tentativa bloqueada em auditoria
            try {
              const auditLogger = require('../../utils/auditLogger');
              auditLogger.init(db);
              
              await auditLogger.log({
                action: 'CONSENT_SCOPE_DENIED',
                entity: 'PatientConsent',
                entityID: sanitizedPatientID,
                result: 'blocked',
                severity: 'warning',
                message: logMessage,
                payload: {
                  participantId: sanitizedPatientID,
                  reason: 'INSUFFICIENT_SCOPE',
                  grantedScopes: Object.keys(responses).filter(k => responses[k] === true),
                  requiredScopes: allowedScopes,
                  requestMethod: req.method,
                  requestPath: req.path
                },
                req: req,
                module: 'AuthConsent'
              });
            } catch (auditError) {
              logger.error('[AUTHCONSENT] Erro ao registrar tentativa de escopo insuficiente:', auditError.message);
            }

            if (strictMode) {
              return res.status(403).json({
                success: false,
                error: '🔒 BLOQUEIO ÉTICO: Escopo de consentimento insuficiente',
                code: 'INSUFFICIENT_SCOPE',
                message: `Operação não permitida. O paciente não consentiu com o escopo necessário.`,
                requiredScopes: allowedScopes,
                timestamp: new Date().toISOString()
              });
            }
          }
        }

        // 5. VERIFICAR SE NÃO FOI REVOGADO
        if (activeConsent.status === 'REVOKED' || activeConsent.revokedAt) {
          const logMessage = `[BLOQUEIO ÉTICO] Consentimento revogado - PatientID: ${sanitizedPatientID}, Revogado em: ${activeConsent.revokedAt}`;
          logger.warn(logMessage);

          // Registra tentativa bloqueada em auditoria
          try {
            const auditLogger = require('../../utils/auditLogger');
            auditLogger.init(db);
            
            await auditLogger.log({
              action: 'CONSENT_REVOKED_DENIED',
              entity: 'PatientConsent',
              entityID: sanitizedPatientID,
              result: 'blocked',
              severity: 'warning',
              message: logMessage,
              payload: {
                participantId: sanitizedPatientID,
                reason: 'CONSENT_REVOKED',
                revokedAt: activeConsent.revokedAt,
                requestMethod: req.method,
                requestPath: req.path
              },
              req: req,
              module: 'AuthConsent'
            });
          } catch (auditError) {
            logger.error('[AUTHCONSENT] Erro ao registrar revogação:', auditError.message);
          }

          return res.status(403).json({
            success: false,
            error: '🔒 BLOQUEIO ÉTICO: Consentimento revogado',
            code: 'CONSENT_REVOKED',
            message: `Operação não permitida. O paciente revogou seu consentimento em ${new Date(activeConsent.revokedAt).toLocaleString('pt-BR')}.`,
            revokedAt: activeConsent.revokedAt,
            timestamp: new Date().toISOString()
          });
        }
      }

      // 6. REGISTRAR ACESSO PERMITIDO EM AUDITORIA
      try {
        const auditLogger = require('../../utils/auditLogger');
        auditLogger.init(db);
        
        await auditLogger.log({
          action: 'CONSENT_VALIDATED',
          entity: 'PatientConsent',
          entityID: sanitizedPatientID,
          result: 'success',
          severity: 'info',
          message: `Acesso concedido - Validação de consentimento passou`,
          payload: {
            participantId: sanitizedPatientID,
            requestMethod: req.method,
            requestPath: req.path,
            allowedScopes: allowedScopes
          },
          req: req,
          module: 'AuthConsent'
        });
      } catch (auditError) {
        logger.error('[AUTHCONSENT] Erro ao registrar acesso permitido:', auditError.message);
      }

      // 7. ANEXAR DADOS DE CONSENTIMENTO AO REQUEST
      req.consent = {
        participantId: sanitizedPatientID,
        consentID: activeConsent?._id.toString() || null,
        status: activeConsent?.status || null,
        signedAt: activeConsent?.signedAt || null,
        scopes: activeConsent?.responses || {},
        validated: true,
        validatedAt: new Date()
      };

      logger.debug(`[AUTHCONSENT] Consentimento validado com sucesso para participantId: ${sanitizedPatientID}`);
      return next();

    } catch (error) {
      logger.error('[AUTHCONSENT] Erro no middleware de consentimento:', error.message);
      logger.error('[AUTHCONSENT] Stack trace:', error.stack);

      return res.status(500).json({
        success: false,
        error: 'Erro ao validar consentimento',
        code: 'CONSENT_VALIDATION_ERROR',
        message: 'Ocorreu um erro ao validar o consentimento do paciente. Por favor, tente novamente.',
        timestamp: new Date().toISOString()
      });
    }
  };
}

/**
 * Factory para criar middleware com escopos específicos
 * Facilita reutilização com configurações específicas
 */
const createConsentMiddleware = {
  /**
   * Consentimento para pesquisa
   */
  research: (options = {}) => authConsent({
    ...options,
    allowedScopes: ['uso_pesquisa', ...(options.allowedScopes || [])]
  }),

  /**
   * Consentimento para uso comercial
   */
  commercial: (options = {}) => authConsent({
    ...options,
    allowedScopes: ['uso_comercial', ...(options.allowedScopes || [])]
  }),

  /**
   * Consentimento genérico
   */
  generic: (allowedScopes = []) => authConsent({
    allowedScopes
  })
};

module.exports = {
  authConsent,
  createConsentMiddleware
};
