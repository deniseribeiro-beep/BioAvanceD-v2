/**
 * src/services/securityAlerts.service.js
 * Sistema de alertas para eventos de segurança críticos
 * Notifica quando há bloqueios éticos, tentativas suspeitas, etc.
 * 
 * Conformidade: LGPD + ANVISA
 */

const logger = require('../utils/logger');
const { sanitizeSensitiveData } = require('../utils/security');

class SecurityAlertsService {
  constructor() {
    this.db = null;
    this.alertHandlers = [];
  }

  init(db) {
    this.db = db;
    const to = String(process.env.ALERT_EMAIL_TO || '').trim();
    if (!to || this.mailHandlerRegistered) return;
    const notificationService = require('./NotificationService');
    this.registerAlertHandler(this.constructor.createEmailHandler(notificationService, { to }));
    this.mailHandlerRegistered = true;
  }

  /**
   * Registra alerta de segurança crítico
   * Tipos: CONSENT_BLOCKED, REVOKED_ACCESS, SUSPICIOUS_ACTIVITY, MULTIPLE_FAILURES
   */
  async logSecurityAlert(params) {
    if (!this.db) {
      logger.error('[ALERTS] Database não inicializado');
      return;
    }

    try {
      const {
        type, // CONSENT_BLOCKED, REVOKED_ACCESS, SUSPICIOUS_ACTIVITY, MULTIPLE_FAILURES, etc
        severity, // low, medium, high, critical
        patientID,
        userID,
        action,
        reason,
        details = {},
        sourceIP,
        userAgent,
        affectedResources = []
      } = params;

      const alert = {
        type,
        severity,
        patientID,
        userID,
        action,
        reason,
        details: sanitizeSensitiveData(details),
        sourceIP,
        userAgent,
        affectedResources,
        timestamp: new Date(),
        status: 'open', // open, acknowledged, resolved
        acknowledged: false,
        acknowledgedBy: null,
        acknowledgedAt: null,
        createdAt: new Date()
      };

      const alertsCollection = this.db.collection('security_alerts');
      const result = await alertsCollection.insertOne(alert);

      logger.warn(`[ALERTS] Alerta de segurança registrado - Tipo: ${type}, Severidade: ${severity}`);

      // Dispara handlers registrados
      await this._triggerHandlers(alert);

      return result.insertedId;

    } catch (error) {
      logger.error('[ALERTS] Erro ao registrar alerta:', error.message);
    }
  }

  /**
   * Alertas por consentimento bloqueado
   */
  async alertConsentBlocked(patientID, operation, reason, sourceIP, userAgent) {
    return this.logSecurityAlert({
      type: 'CONSENT_BLOCKED',
      severity: 'high',
      patientID,
      action: 'ACCESS_DENIED',
      reason,
      details: {
        operation,
        blockedAt: new Date()
      },
      sourceIP,
      userAgent,
      affectedResources: [{ type: 'Patient', id: patientID }]
    });
  }

  /**
   * Alertas por consentimento revogado
   */
  async alertConsentRevoked(patientID, revokedScopes, sourceIP, userAgent) {
    return this.logSecurityAlert({
      type: 'REVOKED_ACCESS',
      severity: 'high',
      patientID,
      action: 'CONSENT_REVOKED',
      reason: 'Paciente revogou consentimento',
      details: {
        revokedScopes,
        revokedAt: new Date()
      },
      sourceIP,
      userAgent,
      affectedResources: [{ type: 'PatientConsent', id: patientID }]
    });
  }

  /**
   * Detecta e alerta atividades suspeitas
   * Ex: múltiplas tentativas de acesso em curto período
   */
  async detectSuspiciousActivity(patientID, userID, attempts = [], sourceIP, userAgent) {
    if (attempts.length < 3) {
      return; // Não alerta por poucas tentativas
    }

    return this.logSecurityAlert({
      type: 'SUSPICIOUS_ACTIVITY',
      severity: 'critical',
      patientID,
      userID,
      action: 'MULTIPLE_FAILED_ATTEMPTS',
      reason: `Múltiplas tentativas de acesso negado (${attempts.length}) em curto período`,
      details: {
        attemptCount: attempts.length,
        attempts: attempts.map(a => ({
          timestamp: a.timestamp,
          reason: a.reason
        })),
        timeWindow: '5 minutos'
      },
      sourceIP,
      userAgent,
      affectedResources: [
        { type: 'Patient', id: patientID },
        { type: 'User', id: userID }
      ]
    });
  }

  /**
   * Alerta PII exposure (vazamento de informação pessoal)
   */
  async alertPIIExposure(description, locations, severity = 'critical') {
    return this.logSecurityAlert({
      type: 'PII_EXPOSURE',
      severity,
      action: 'PII_DETECTED',
      reason: description,
      details: {
        locations,
        detectedAt: new Date()
      }
    });
  }

  /**
   * Alerta tentativa de bypass de segurança
   */
  async alertBypassAttempt(userID, method, details, sourceIP, userAgent) {
    return this.logSecurityAlert({
      type: 'SECURITY_BYPASS_ATTEMPT',
      severity: 'critical',
      userID,
      action: 'BYPASS_DETECTED',
      reason: `Tentativa de bypass de mecanismo de segurança: ${method}`,
      details,
      sourceIP,
      userAgent,
      affectedResources: [{ type: 'SecurityControl', id: method }]
    });
  }

  /**
   * Obtém alertas abertos
   */
  async getOpenAlerts(filters = {}) {
    if (!this.db) {
      logger.error('[ALERTS] Database não inicializado');
      return [];
    }

    try {
      const query = {
        status: 'open',
        ...filters
      };

      const alertsCollection = this.db.collection('security_alerts');
      const alerts = await alertsCollection
        .find(query)
        .sort({ severity: -1, timestamp: -1 })
        .toArray();

      return alerts;
    } catch (error) {
      logger.error('[ALERTS] Erro ao buscar alertas:', error.message);
      return [];
    }
  }

  /**
   * Reconhece um alerta (marca como viewed)
   */
  async acknowledgeAlert(alertID, userID) {
    if (!this.db) {
      logger.error('[ALERTS] Database não inicializado');
      return;
    }

    try {
      const alertsCollection = this.db.collection('security_alerts');
      const result = await alertsCollection.updateOne(
        { _id: alertID },
        {
          $set: {
            acknowledged: true,
            acknowledgedBy: userID,
            acknowledgedAt: new Date(),
            status: 'acknowledged'
          }
        }
      );

      logger.info(`[ALERTS] Alerta reconhecido por usuário: ${userID}`);
      return result;
    } catch (error) {
      logger.error('[ALERTS] Erro ao reconhecer alerta:', error.message);
    }
  }

  /**
   * Resolve um alerta (fecha como resolvido)
   */
  async resolveAlert(alertID, resolution, resolvedBy) {
    if (!this.db) {
      logger.error('[ALERTS] Database não inicializado');
      return;
    }

    try {
      const alertsCollection = this.db.collection('security_alerts');
      const result = await alertsCollection.updateOne(
        { _id: alertID },
        {
          $set: {
            status: 'resolved',
            resolution,
            resolvedBy,
            resolvedAt: new Date()
          }
        }
      );

      logger.info(`[ALERTS] Alerta resolvido: ${alertID}`);
      return result;
    } catch (error) {
      logger.error('[ALERTS] Erro ao resolver alerta:', error.message);
    }
  }

  /**
   * Registra handler customizado para alertas
   * Permite enviar notificações por email, Slack, etc
   */
  registerAlertHandler(handler) {
    if (typeof handler === 'function') {
      this.alertHandlers.push(handler);
      logger.info('[ALERTS] Handler registrado');
    }
  }

  /**
   * Dispara todos os handlers registrados
   */
  async _triggerHandlers(alert) {
    for (const handler of this.alertHandlers) {
      try {
        await handler(alert);
      } catch (error) {
        logger.error('[ALERTS] Erro em handler:', error.message);
      }
    }
  }

  /**
   * Handler padrão: Log em arquivo
   * Pode ser estendido com email, Slack, etc.
   */
  static createEmailHandler(nodemailer, emailConfig) {
    return async (alert) => {
      if (['high', 'critical'].includes(alert.severity)) {
        try {
          const subject = `🚨 Alerta de Segurança [${alert.severity.toUpperCase()}]: ${alert.type}`;
          const html = `
            <h2>Alerta de Segurança</h2>
            <p><strong>Tipo:</strong> ${alert.type}</p>
            <p><strong>Severidade:</strong> ${alert.severity}</p>
            <p><strong>Razão:</strong> ${alert.reason}</p>
            <p><strong>Timestamp:</strong> ${alert.timestamp}</p>
            <hr>
            <p>Detalhes: ${JSON.stringify(alert.details, null, 2)}</p>
          `;

          await nodemailer.sendEmail({
            to: emailConfig.to,
            subject,
            html,
            text: `${alert.type}: ${alert.reason}`,
            notificationType: 'SECURITY_ALERT',
          });

          logger.info('[ALERTS] Email de alerta enviado');
        } catch (error) {
          logger.error('[ALERTS] Erro ao enviar email:', error.message);
        }
      }
    };
  }

  /**
   * Handler padrão: Log Slack (mock)
   */
  static createSlackHandler(slackWebhook) {
    return async (alert) => {
      if (['high', 'critical'].includes(alert.severity)) {
        try {
          // Implementar POST para webhook Slack
          logger.info(`[ALERTS] Notificação Slack enviada: ${alert.type}`);
        } catch (error) {
          logger.error('[ALERTS] Erro ao enviar para Slack:', error.message);
        }
      }
    };
  }
}

module.exports = new SecurityAlertsService();
