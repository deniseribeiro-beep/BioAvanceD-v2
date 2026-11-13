const { Resend } = require('resend');
const { Queue } = require('bullmq');
const { Server } = require('socket.io');
const crypto = require('crypto');
const os = require('os');
const logger = require('../utils/logger');
const { withRequestId } = require('../utils/requestContext');
const { connectDB } = require('../database/mongo');
const participantIdentityService = require('./participantIdentity.service');
const { initRedis } = require('../config/queue');

const CONSENT_TOKEN_TTL_DAYS = 7;

function consentTransportError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isLoopbackHostname(hostname) {
  const normalized = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

// #1169: the only patientData field a queued consent job carries. #1166
// slice 2 took the name and the contact out too: they are identity data, and
// processConsentNotificationJob resolves them from the participant's
// identity record at send time, so none of it is persisted in Redis.
const CONSENT_JOB_PATIENT_FIELDS = ['participantId'];

class NotificationService {
  constructor() {
    this.resendClient = null;
    this.smtpTransport = null;
    this.emailFrom = String(process.env.EMAIL_FROM || '').trim();
    this.adminEmail = process.env.ADMIN_EMAIL || '';
    this.isDevelopment = String(process.env.NODE_ENV || 'development').toLowerCase() === 'development';
    this.io = null;
    this.notificationQueue = null;
  }

  getFrontendUrl() {
    const frontendUrl = String(process.env.FRONTEND_URL || '').trim();
    if (!frontendUrl) {
      throw new Error('FRONTEND_URL é obrigatório para gerar links de consentimento');
    }
    return frontendUrl;
  }

  validateFrontendUrl({ remote = false } = {}) {
    let parsed;
    try {
      parsed = new URL(this.getFrontendUrl());
    } catch (error) {
      if (error?.code) throw error;
      throw consentTransportError('CONSENT_FRONTEND_URL_INVALID', 'FRONTEND_URL deve ser uma URL absoluta válida');
    }

    const isHttps = parsed.protocol === 'https:';
    const localDevelopment = this.isDevelopment && parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname);

    if (remote && (!isHttps || isLoopbackHostname(parsed.hostname))) {
      throw consentTransportError(
        'CONSENT_REMOTE_HTTPS_REQUIRED',
        'Convites remotos de consentimento exigem FRONTEND_URL HTTPS externamente acessível'
      );
    }

    if (!isHttps && !localDevelopment) {
      throw consentTransportError(
        'CONSENT_FRONTEND_HTTPS_REQUIRED',
        'FRONTEND_URL deve usar HTTPS; HTTP é permitido apenas em loopback durante desenvolvimento'
      );
    }

    return parsed;
  }

  normalizePhoneE164(rawPhone) {
    if (!rawPhone) return null;

    const trimmed = String(rawPhone).trim();
    if (!trimmed) return null;

    if (trimmed.startsWith('+')) {
      return trimmed;
    }

    let digits = trimmed.replace(/\D/g, '');
    if (!digits) return null;

    if (digits.startsWith('00')) {
      digits = digits.slice(2);
    }

    const defaultCountryCode = process.env.CONSENT_DEFAULT_COUNTRY_CODE || process.env.DEFAULT_COUNTRY_CODE || '55';
    if (digits.startsWith(defaultCountryCode)) {
      return `+${digits}`;
    }

    return `+${defaultCountryCode}${digits}`;
  }

  resolvePatientEmail(patientData = {}) {
    return patientData.email || patientData.emailAddress || patientData.contactEmail || null;
  }

  resolvePatientPhone(patientData = {}) {
    const rawPhone = patientData.phone || patientData.mobile || patientData.whatsapp || patientData.phoneNumber || null;
    return this.normalizePhoneE164(rawPhone);
  }

  formatConsentMessage(name, link) {
    const safeName = name || 'Paciente';
    return `BioAvanceD: Olá ${safeName}, sua participação no biobanco exige o aceite do termo de consentimento. Neste painel você pode aceitar o TCLE e, depois, revogar o termo inteiro ou apenas algumas permissões: ${link}`;
  }

  getResendClient() {
    if (this.resendClient) {
      return this.resendClient;
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error('RESEND_API_KEY é obrigatório para envio de e-mails');
    }

    this.resendClient = new Resend(apiKey);
    return this.resendClient;
  }

  // #833: real SMTP transport, selected by environment (option 1). Lazy and
  // cached like getResendClient above. host/port come from the test stack's
  // Mailpit container (compose.test.yml) in test; any real SMTP relay
  // elsewhere. No auth/TLS config here because Mailpit needs neither --
  // extending this for an authenticated relay is a separate change.
  getSmtpTransport() {
    if (this.smtpTransport) {
      return this.smtpTransport;
    }

    const nodemailer = require('nodemailer');
    this.smtpTransport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 1025),
      secure: false
    });
    return this.smtpTransport;
  }

  resolveRecipient(originalTo) {
    const safeTo = String(originalTo || '').trim();
    if (!safeTo) {
      throw new Error('Destinatário é obrigatório para envio de e-mail');
    }

    if (!this.isDevelopment) {
      return {
        to: safeTo,
        redirected: false,
        originalTo: safeTo
      };
    }

    if (!this.adminEmail) {
      throw new Error('ADMIN_EMAIL é obrigatório em NODE_ENV=development para redirecionamento seguro');
    }

    return {
      to: this.adminEmail,
      redirected: this.adminEmail !== safeTo,
      originalTo: safeTo
    };
  }

  emailSendTrace() {
    const sentAt = new Date();
    const smtpHost = String(process.env.SMTP_HOST || '').trim();
    const provider = smtpHost ? 'smtp' : 'resend';
    const sentAtLocal = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).format(sentAt);
    return {
      sentAt,
      sentAtLocal,
      provider,
      location: {
        kind: provider === 'smtp' ? 'smtp_relay' : 'resend',
        host: provider === 'smtp' ? smtpHost : 'resend',
        port: provider === 'smtp' ? String(process.env.SMTP_PORT || '1025') : null,
        machine: os.hostname(),
      },
    };
  }

  async persistComplianceLog(payload) {
    try {
      const db = await connectDB();
      const activeProvider = String(process.env.SMTP_HOST || '').trim() ? 'smtp' : 'resend';
      await db.collection('notification_compliance_logs').insertOne({
        provider: activeProvider,
        ...payload,
        createdAt: new Date()
      });
    } catch (error) {
      logger.error('[NOTIFICATION][COMPLIANCE] Falha ao persistir log de rastreabilidade:', error.message || error);
    }
  }

  logDevelopmentPreview({ subject, text, html, originalTo, effectiveTo, notificationType }) {
    if (!this.isDevelopment) {
      return;
    }

    logger.info('[NOTIFICATION][DEV_PREVIEW] E-mail simulado para validação rápida', {
      notificationType,
      originalTo,
      effectiveTo,
      subject
    });

    console.log('');
    console.log('========== [BIOAVANCED][DEV EMAIL PREVIEW] ==========');
    console.log(`Tipo: ${notificationType}`);
    console.log(`Para (original): ${originalTo}`);
    console.log(`Para (efetivo): ${effectiveTo}`);
    console.log(`Assunto: ${subject}`);
    console.log('--- Corpo (texto) ---');
    console.log(text || '[sem versão texto]');
    console.log('--- Corpo (HTML) ---');
    console.log(html || '[sem versão html]');
    console.log('======================================================');
    console.log('');
  }

  async sendEmail({ to, subject, html, text, notificationType, metadata = {} }) {
    // #903 (RF015 AC#3, "Registrar tentativas, falhas..."): these two throws
    // used to leave no record at all -- there is no recipient resolved yet
    // to attach one to, but the raw `to` argument is still worth keeping so
    // a validation failure isn't invisible in the compliance log.
    if (!subject || (!html && !text)) {
      await this.persistComplianceLog({
        ...this.emailSendTrace(),
        notificationType: notificationType || 'generic',
        subject,
        originalTo: String(to || '').trim(),
        metadata,
        deliveryStatus: 'DELIVERY_FAILED',
        errorCode: 'VALIDATION_FAILED',
        failedAt: new Date()
      });
      throw new Error('subject e html/text são obrigatórios para envio de e-mail');
    }

    if (!this.emailFrom) {
      await this.persistComplianceLog({
        ...this.emailSendTrace(),
        notificationType: notificationType || 'generic',
        subject,
        originalTo: String(to || '').trim(),
        metadata,
        deliveryStatus: 'DELIVERY_FAILED',
        errorCode: 'VALIDATION_FAILED',
        failedAt: new Date()
      });
      throw new Error('EMAIL_FROM é obrigatório para envio de e-mails');
    }

    let recipient;
    try {
      recipient = this.resolveRecipient(to);
    } catch (error) {
      await this.persistComplianceLog({
        ...this.emailSendTrace(),
        notificationType: notificationType || 'generic',
        subject,
        originalTo: String(to || '').trim(),
        metadata,
        deliveryStatus: 'DELIVERY_FAILED',
        errorCode: 'VALIDATION_FAILED',
        failedAt: new Date()
      });
      throw error;
    }

    this.logDevelopmentPreview({
      subject,
      text,
      html,
      originalTo: recipient.originalTo,
      effectiveTo: recipient.to,
      notificationType: notificationType || 'generic'
    });

    // #833: real SMTP transport, selected by environment (option 1) --
    // decided at send time, not in the constructor, so tests (and ops) can
    // flip SMTP_HOST per-case/per-deploy without restarting the process.
    // Resend stays the default when SMTP_HOST is unset, exactly as before.
    const provider = String(process.env.SMTP_HOST || '').trim() ? 'smtp' : 'resend';

    // RF015 AC#3 ("Registrar tentativas, falhas, entrega e confirmacao"):
    // persistComplianceLog used to run only after a successful send, so every
    // failure -- a provider error, a transport rejection -- left no record at
    // all. The only code that tried to record consent-delivery failures,
    // persistConsentDeliveryFailure, was a permanent no-op (#796) that also
    // wrote non-canonical fields onto Patient; RF015 puts this recording on
    // the notification, so it lives here and covers every notificationType,
    // not just consent. persistComplianceLog swallows its own errors, so it
    // cannot mask the failure being reported. #811 covered the failure leg
    // and is closed; #903 covers the attempt record below plus the pre-send
    // validation throws above (escalation/confirmation remain outstanding).

    // #903: record the attempt itself, before the transport is touched, so a
    // crash or hang mid-send still leaves a "we tried" row rather than
    // nothing. Insert-only, same as every other compliance write here;
    // volume/retention of these rows is #812's tracked concern.
    await this.persistComplianceLog({
      ...this.emailSendTrace(),
      provider,
      notificationType: notificationType || 'generic',
      subject,
      to: recipient.to,
      originalTo: recipient.originalTo,
      redirectedByEnvironment: recipient.redirected,
      metadata,
      deliveryStatus: 'ATTEMPTED',
      attemptedAt: new Date()
    });

    let messageId = null;
    try {
      if (provider === 'smtp') {
        const transporter = this.getSmtpTransport();
        const info = await transporter.sendMail({
          from: this.emailFrom,
          to: recipient.to,
          subject,
          html,
          text
        });
        messageId = info?.messageId || null;
      } else {
        const resend = this.getResendClient();
        const response = await resend.emails.send({
          from: this.emailFrom,
          to: recipient.to,
          subject,
          html,
          text
        });

        if (response.error) {
          throw new Error(response.error.message || 'Falha ao enviar e-mail via Resend');
        }

        messageId = response.data?.id || null;
      }
    } catch (error) {
      await this.persistComplianceLog({
        ...this.emailSendTrace(),
        provider,
        notificationType: notificationType || 'generic',
        subject,
        to: recipient.to,
        originalTo: recipient.originalTo,
        redirectedByEnvironment: recipient.redirected,
        metadata,
        deliveryStatus: 'DELIVERY_FAILED',
        failedAt: new Date(),
        errorCode: error?.code || 'CONSENT_DELIVERY_FAILED'
      });
      throw error;
    }

    await this.persistComplianceLog({
      ...this.emailSendTrace(),
      messageId,
      provider,
      notificationType: notificationType || 'generic',
      subject,
      to: recipient.to,
      originalTo: recipient.originalTo,
      redirectedByEnvironment: recipient.redirected,
      metadata,
      deliveryStatus: 'SENT'
    });

    return {
      success: true,
      channel: 'email',
      provider,
      mocked: false,
      notificationType: notificationType || 'generic',
      messageId,
      to: recipient.to,
      originalTo: recipient.originalTo,
      redirectedByEnvironment: recipient.redirected
    };
  }

  getNotificationQueue() {
    if (this.notificationQueue) {
      return this.notificationQueue;
    }

    const connection = initRedis();
    if (!connection) {
      logger.warn('[WARN] Fila de notificações não inicializada (Redis não configurado)');
      return null;
    }

    this.notificationQueue = new Queue('notification-queue', {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000
        },
        removeOnComplete: { age: 24 * 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600 }
      }
    });

    return this.notificationQueue;
  }

  async getConsentQueueStats() {
    const queue = this.getNotificationQueue();
    if (!queue) {
      return {
        available: false,
        counts: { waiting: 0, delayed: 0, active: 0, failed: 0 },
        totalQueued: 0
      };
    }

    const counts = await queue.getJobCounts('waiting', 'delayed', 'active', 'failed');
    const waiting = counts.waiting || 0;
    const delayed = counts.delayed || 0;
    const active = counts.active || 0;
    const failed = counts.failed || 0;

    return {
      available: true,
      counts: { waiting, delayed, active, failed },
      totalQueued: waiting + delayed,
      active
    };
  }

  generateConsentToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  buildConsentMetadata() {
    const token = this.generateConsentToken();
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + CONSENT_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    return {
      token,
      createdAt,
      expiresAt
    };
  }

  buildConsentLink(patientData, token) {
    const baseUrl = this.validateFrontendUrl().toString().replace(/\/$/, '');
    // #805: this read `patientID || patientId || id`, none of which any of the
    // six production callers carry -- they pass either a PatientModel.create()
    // result or a spread of a patients-collection document, and Patient's
    // canonical field list (models/Patient.js) has only `participantId`. Every
    // consent invitation therefore emailed `/patients/undefined/consent`.
    // participantId is not just the surviving alias: the endpoints that consume
    // this link's id segment, POST /api/e-consent/consent-tokens/{validate,accept},
    // resolve the patient by `{ participantId }` (patient.service.js), so it is
    // the only value the link can carry and still work.
    const participantId = String((patientData && patientData.participantId) || '').trim();
    if (!participantId) {
      throw consentTransportError(
        'CONSENT_PARTICIPANT_ID_REQUIRED',
        'participantId e obrigatorio para montar o link de consentimento'
      );
    }
    const encodedToken = encodeURIComponent(token);
    return `${baseUrl}/patients/${encodeURIComponent(participantId)}/consent?token=${encodedToken}`;
  }

  async sendConsentEmail(patientData, consentLink) {
    try {
      this.validateFrontendUrl({ remote: true });

      const email = this.resolvePatientEmail(patientData);
      if (!email) {
        throw consentTransportError('CONSENT_RECIPIENT_REQUIRED', 'E-mail do participante é obrigatório para convite remoto');
      }

      const message = this.formatConsentMessage(patientData.patientName, consentLink);
      const result = await this.sendEmail({
        to: email,
        subject: 'BioAvanceD - Termo de Consentimento',
        text: message,
        html: `<p>${message}</p>`,
        notificationType: 'RF_CONSENT_NOTIFICATION',
        // #796: this read `patientData.patientID`, which neither caller sets
        // -- routes/eConsent.js and fhir-import-staging.service.js both pass
        // `participantId`. Every RF_CONSENT_NOTIFICATION compliance record
        // persisted by sendEmail -> persistComplianceLog therefore carried
        // `patientID: null`, with no link back to the participant it was
        // sent for.
        metadata: {
          participantId: patientData.participantId || null
        }
      });

      return { ...result, success: true };
    } catch (error) {
      // #796: this used to call persistConsentDeliveryFailure, a permanent
      // no-op that wrote three non-canonical fields onto Patient through a
      // raw driver updateOne. Failure recording now happens in sendEmail,
      // on the notification, per RF015 AC#3.
      throw error;
    }
  }

  async sendConsentSmsFallback(patientData, consentLink) {
    const phone = this.resolvePatientPhone(patientData);
    if (!phone) {
      logger.warn('Consentimento: telefone ausente para SMS', { participantId: patientData.participantId || null });
      return { channel: 'sms', success: false, reason: 'missing_phone' };
    }

    const fallbackEmail = this.adminEmail || process.env.ALERT_EMAIL_TO;
    if (!fallbackEmail) {
      logger.warn('Consentimento: ADMIN_EMAIL/ALERT_EMAIL_TO ausente para fallback SMS');
      return { channel: 'sms', success: false, reason: 'missing_sms_fallback_email' };
    }

    const message = this.formatConsentMessage(patientData.patientName, consentLink);
    await this.sendEmail({
      to: fallbackEmail,
      subject: 'BioAvanceD | Fallback SMS de Consentimento',
      text: `Destino SMS: ${phone}\n\n${message}`,
      html: `<p><strong>Destino SMS:</strong> ${phone}</p><p>${message}</p>`,
      notificationType: 'RF_CONSENT_SMS_FALLBACK',
      // The callers pass `participantId`, as for the email path (#796); the
      // old `patientID` key recorded null on every fallback.
      metadata: {
        participantId: patientData.participantId || null,
        phone
      }
    });

    return {
      channel: 'sms',
      success: true,
      mocked: true,
      provider: 'resend-email-fallback'
    };
  }

  async sendConsentWhatsappFallback(patientData, consentLink) {
    const phone = this.resolvePatientPhone(patientData);
    if (!phone) {
      logger.warn('Consentimento: telefone ausente para WhatsApp', { participantId: patientData.participantId || null });
      return { channel: 'whatsapp', success: false, reason: 'missing_phone' };
    }

    return {
      channel: 'whatsapp',
      success: true,
      mocked: true,
      provider: 'resend-email-fallback',
      reason: 'Canal WhatsApp consolidado para envio por e-mail rastreável'
    };
  }

  async notifyPatientConsent(patientData, consentLink) {
    const results = await Promise.allSettled([
      this.sendConsentEmail(patientData, consentLink),
      this.sendConsentWhatsappFallback(patientData, consentLink)
    ]);

    return results.map((result) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }
      return { channel: 'unknown', success: false, reason: result.reason?.message || 'failed' };
    });
  }

  async enqueueConsentNotification(patientData, consentLink) {
    const queue = this.getNotificationQueue();
    if (!queue) {
      return this.notifyPatientConsent(patientData, consentLink);
    }

    // #1169: the job body is persisted in Redis (24h, 7 days on failure), so
    // it carries only the participantId. Callers hand over the whole request
    // payload -- civil identity, contact, the consent token -- and the worker
    // looks the name and contact up itself (#1166).
    const queuedPatientData = {};
    for (const field of CONSENT_JOB_PATIENT_FIELDS) {
      if (patientData?.[field] !== undefined) queuedPatientData[field] = patientData[field];
    }

    await queue.add('consent-notification', withRequestId({
      patientData: queuedPatientData,
      consentLink
    }));

    return [{ channel: 'queue', success: true, provider: 'bullmq' }];
  }

  async processConsentNotificationJob(jobData, db = null) {
    const patientData = await this.resolveConsentRecipient(jobData.patientData, db);
    return this.notifyPatientConsent(patientData, jobData.consentLink);
  }

  // #1166 slice 2: a queued job carries only the participantId, so the name
  // and contact come from the decrypted ParticipantIdentity record at send
  // time. Since slice 4 that record is the contact's only home, so `patients`
  // is not read at all.
  async resolveConsentRecipient(patientData = {}, db = null) {
    const participantId = patientData?.participantId;
    if (!participantId) return patientData;

    const database = db || await connectDB();
    const rawIdentity = await database.collection('participantIdentities').findOne({ participantId });
    const identity = rawIdentity ? participantIdentityService.decryptIdentity(rawIdentity) : null;

    const resolved = participantIdentityService.withIdentityContact(patientData, identity);
    if (identity?.patientName) resolved.patientName = identity.patientName;
    return resolved;
  }

  initSocketIO(serverOrIo) {
    if (this.io) {
      return this.io;
    }

    if (serverOrIo && typeof serverOrIo.of === 'function' && typeof serverOrIo.emit === 'function') {
      this.io = serverOrIo;
    } else {
      this.io = new Server(serverOrIo, {
        cors: {
          origin: process.env.FRONTEND_URL || '*',
          methods: ['GET', 'POST']
        },
        pingTimeout: 30000,
        pingInterval: 25000
      });
    }

    this.io.on('connection', (socket) => {
      logger.info(`✅ Cliente WebSocket conectado: ${socket.id}`);

      socket.on('subscribe:user', (userID) => {
        if (!userID) return;
        socket.join(`user-${userID}`);
      });

      socket.on('subscribe:job', (jobID) => {
        if (!jobID) return;
        socket.join(jobID);
      });

      socket.on('disconnect', () => {
        logger.info(`❌ Cliente WebSocket desconectado: ${socket.id}`);
      });
    });

    logger.info('✅ Socket.IO inicializado');
    return this.io;
  }

  async notifyJobQueued(userID, payload) {
    if (!this.io) return;
    this.io.to(`user-${userID}`).emit('import-queued', payload);
  }

  async notifyJobStarted(userID, payload) {
    if (!this.io) return;
    this.io.to(`user-${userID}`).emit('import-started', payload);
    if (payload?.jobID) {
      this.io.to(payload.jobID).emit('import-started', payload);
    }
  }

  async notifyJobProgress(userID, payload) {
    if (!this.io) return;
    this.io.to(`user-${userID}`).emit('import-progress', payload);
    if (payload?.jobID) {
      this.io.to(payload.jobID).emit('import-progress', payload);
    }
  }

  async notifyJobCompleted(userID, jobData) {
    try {
      if (this.io) {
        const payload = {
          jobID: jobData.jobID,
          status: jobData.status,
          dataType: jobData.dataType,
          successCount: jobData.successCount,
          errorCount: jobData.errorCount,
          message: `Importação de ${jobData.dataType} concluída`
        };
        this.io.to(`user-${userID}`).emit('import-completed', payload);
        if (jobData.jobID) {
          this.io.to(jobData.jobID).emit('import-completed', payload);
        }
      }

      if (jobData.userEmail) {
        await this.sendEmail({
          to: jobData.userEmail,
          subject: `Importação ${jobData.dataType} - Concluída`,
          html: this.generateJobEmailTemplate(jobData),
          notificationType: 'RF_IMPORT_COMPLETED'
        });
      }
    } catch (error) {
      logger.error('Erro ao enviar notificação de job concluído:', error);
    }
  }

  async notifyJobFailed(userID, jobData) {
    try {
      if (this.io) {
        const payload = {
          jobID: jobData.jobID,
          status: jobData.status,
          dataType: jobData.dataType,
          error: jobData.error,
          message: `Importação de ${jobData.dataType} falhou`
        };
        this.io.to(`user-${userID}`).emit('import-failed', payload);
        if (jobData.jobID) {
          this.io.to(jobData.jobID).emit('import-failed', payload);
        }
      }

      if (jobData.userEmail) {
        await this.sendEmail({
          to: jobData.userEmail,
          subject: `Importação ${jobData.dataType} - Falhou`,
          html: this.generateJobErrorEmailTemplate(jobData),
          notificationType: 'RF_IMPORT_FAILED'
        });
      }
    } catch (error) {
      logger.error('Erro ao enviar notificação de job falho:', error);
    }
  }

  generateJobEmailTemplate(jobData) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
      </head>
      <body>
        <h2>Importação Concluída</h2>
        <p><strong>Tipo:</strong> ${jobData.dataType}</p>
        <p><strong>Sucesso:</strong> ${jobData.successCount}</p>
        <p><strong>Erros:</strong> ${jobData.errorCount}</p>
        <p><strong>Job ID:</strong> ${jobData.jobID}</p>
      </body>
      </html>
    `;
  }

  generateJobErrorEmailTemplate(jobData) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
      </head>
      <body>
        <h2>Importação Falhou</h2>
        <p><strong>Tipo:</strong> ${jobData.dataType}</p>
        <p><strong>Job ID:</strong> ${jobData.jobID}</p>
        <p><strong>Erro:</strong> ${jobData.error || 'Erro desconhecido'}</p>
      </body>
      </html>
    `;
  }

  async sendAuthCode(email, code) {
    if (!email || !code) {
      throw new Error('email e code são obrigatórios para MFA');
    }

    const html = `
      <div style="font-family: Arial, Helvetica, sans-serif; background:#f8fafc; padding:24px; color:#0f172a;">
        <div style="max-width:620px; margin:0 auto; background:#ffffff; border:1px solid #e2e8f0; border-radius:12px; padding:24px;">
          <h1 style="margin:0 0 8px; color:#0f172a; font-size:22px;">BioAvanceD</h1>
          <p style="margin:0 0 20px; color:#334155;">Código de acesso para autenticação multifator</p>
          <p style="margin:0 0 12px; color:#334155;">Use o código abaixo para concluir seu acesso com segurança:</p>
          <div style="margin:14px 0 20px; padding:16px; text-align:center; background:#eff6ff; border:1px solid #bfdbfe; border-radius:10px;">
            <span style="font-size:32px; letter-spacing:6px; font-weight:700; color:#1d4ed8;">${code}</span>
          </div>
          <p style="margin:0 0 8px; color:#475569; font-size:13px;">Validade: 5 minutos.</p>
          <p style="margin:0; color:#64748b; font-size:12px;">Se você não solicitou este acesso, ignore este e-mail.</p>
        </div>
      </div>
    `;

    const text = `BioAvanceD - Código MFA\n\nCódigo de acesso: ${code}\nValidade: 5 minutos.\n\nSe não foi você, ignore este e-mail.`;

    return this.sendEmail({
      to: email,
      subject: 'BioAvanceD | Código de Acesso MFA',
      html,
      text,
      notificationType: 'RF001_MFA_AUTH_CODE',
      metadata: { codeLength: String(code).length }
    });
  }

  // #1203: the expiry line follows the caller's token. It used to read a
  // fixed "30 minutos", which matched neither the unauthenticated path's
  // 1 h token nor user-security's 1-24 h one.
  async sendPasswordReset(email, link, { expiresInMinutes } = {}) {
    if (!email || !link) {
      throw new Error('email e link são obrigatórios para recuperação de conta');
    }
    const minutes = Number(expiresInMinutes);
    const expiryText = Number.isFinite(minutes) && minutes > 0
      ? (minutes % 60 === 0
        ? `Este link expira em ${minutes / 60} hora${minutes === 60 ? '' : 's'}.`
        : `Este link expira em ${minutes} minutos.`)
      : 'Este link expira em breve.';

    const html = `
      <div style="font-family: Arial, sans-serif; background:#f4f7fb; padding:24px; color:#1d3557;">
        <div style="max-width:640px; margin:0 auto; background:white; border-radius:12px; padding:24px; border:1px solid #dbe5f1;">
          <h1 style="margin:0 0 8px; color:#0b2545;">BioAvanceD</h1>
          <p style="margin:0 0 20px; font-size:14px; color:#4f6d8a;">Plataforma de Gestão Inteligente de Biobanco</p>
          <h2 style="margin:0 0 16px; color:#1d3557;">Recuperação de senha</h2>
          <p style="line-height:1.6;">Recebemos uma solicitação para redefinir sua senha. Para continuar com segurança, clique no botão abaixo.</p>
          <p style="margin:24px 0;">
            <a href="${link}" style="display:inline-block; padding:12px 20px; background:#1d4ed8; color:#ffffff; text-decoration:none; border-radius:8px; font-weight:bold;">Redefinir senha</a>
          </p>
          <p style="font-size:13px; color:#6b7280; line-height:1.5;">Se você não solicitou esta recuperação, ignore este e-mail. ${expiryText}</p>
          <hr style="border:none; border-top:1px solid #e5e7eb; margin:24px 0;" />
          <p style="font-size:12px; color:#94a3b8; margin:0;">© ${new Date().getFullYear()} BioAvanceD · <a href="https://bioadvanced.dev" style="color:#1d4ed8; text-decoration:none;">bioadvanced.dev</a></p>
        </div>
      </div>
    `;

    const text = `BioAvanceD - Recuperação de senha\n\nAcesse: ${link}\n${expiryText}\n\nSe você não solicitou, ignore este e-mail.`;

    return this.sendEmail({
      to: email,
      subject: 'BioAvanceD | Recuperação de Senha',
      html,
      text,
      notificationType: 'RF003_PASSWORD_RESET',
      metadata: { linkDomain: String(link).split('/')[2] || null }
    });
  }

  async sendTemperatureAlert(sampleId, currentTemp, options = {}) {
    const targetEmail = options.email || process.env.ALERT_EMAIL_TO || this.adminEmail;
    if (!targetEmail) {
      throw new Error('ALERT_EMAIL_TO ou ADMIN_EMAIL deve ser configurado para alerta de temperatura');
    }

    const timestamp = new Date().toISOString();
    const body = `[ALERTA CRÍTICO] Amostra ${sampleId} fora da faixa segura: ${currentTemp}°C | ${timestamp}`;
    const html = `
      <div style="font-family: Arial, Helvetica, sans-serif; background:#fff7ed; padding:24px; color:#7c2d12;">
        <div style="max-width:680px; margin:0 auto; background:#ffffff; border:2px solid #f97316; border-radius:12px; overflow:hidden;">
          <div style="background:#b91c1c; color:#ffffff; padding:14px 18px; font-weight:700; font-size:16px;">
            ⚠️ ALERTA CRÍTICO: BioAvanceD - Freezer fora da faixa
          </div>
          <div style="padding:20px 18px;">
            <p style="margin:0 0 12px; color:#7c2d12;">Atenção imediata necessária para preservar a cadeia de custódia das amostras.</p>
            <table style="width:100%; border-collapse:collapse; font-size:14px;">
              <tr>
                <td style="padding:8px; border:1px solid #fed7aa;"><strong>ID da amostra</strong></td>
                <td style="padding:8px; border:1px solid #fed7aa;">${sampleId}</td>
              </tr>
              <tr>
                <td style="padding:8px; border:1px solid #fed7aa;"><strong>Temperatura atual</strong></td>
                <td style="padding:8px; border:1px solid #fed7aa; color:#b91c1c; font-weight:700;">${currentTemp}°C</td>
              </tr>
              <tr>
                <td style="padding:8px; border:1px solid #fed7aa;"><strong>Timestamp</strong></td>
                <td style="padding:8px; border:1px solid #fed7aa;">${timestamp}</td>
              </tr>
            </table>
            <p style="margin:14px 0 0; color:#9a3412; font-size:13px;">Ação recomendada: verificar sensor, freezer e status da política térmica imediatamente.</p>
          </div>
        </div>
      </div>
    `;

    return this.sendEmail({
      to: targetEmail,
      subject: '⚠️ ALERTA CRÍTICO: BioAvanceD - Freezer fora da faixa',
      html,
      text: body,
      notificationType: 'RF016_TEMPERATURE_ALERT',
      metadata: {
        sampleId,
        currentTemp
      }
    });
  }

  async sendOTPSMS(_phone, code) {
    const fallbackEmail = this.adminEmail || process.env.ALERT_EMAIL_TO;
    if (!fallbackEmail) {
      throw new Error('ADMIN_EMAIL é obrigatório para simular fluxo legado de SMS no modo unificado por e-mail');
    }

    const emailResult = await this.sendAuthCode(fallbackEmail, code);
    return {
      success: true,
      mocked: true,
      channel: 'sms',
      provider: 'resend-email-fallback',
      note: 'Fluxo legado de SMS redirecionado para e-mail no provedor único Resend',
      emailResult
    };
  }


  async sendCriticalTempAlert(sampleId, temp, options = {}) {
    const minTemp = Number(options.minTemp ?? process.env.TELEMETRY_MIN_TEMP_ALERT ?? -196);
    const maxTemp = Number(options.maxTemp ?? process.env.TELEMETRY_MAX_TEMP_ALERT ?? -80);
    if (temp >= minTemp && temp <= maxTemp) {
      return {
        triggered: false,
        reason: `Temperatura ${temp}°C dentro do range ${minTemp}°C..${maxTemp}°C`
      };
    }

    const emailResult = await this.sendTemperatureAlert(sampleId, temp, options);

    const smsSimulation = {
      success: true,
      mocked: true,
      channel: 'sms',
      provider: 'resend-email-fallback',
      reason: 'Canal SMS consolidado em e-mail para operação local e rastreável'
    };

    return {
      triggered: true,
      sampleId,
      temp,
      minTemp,
      maxTemp,
      sms: smsSimulation,
      email: emailResult
    };
  }
}

const notificationService = new NotificationService();
module.exports = notificationService;
module.exports.NotificationService = NotificationService;
module.exports.isLoopbackHostname = isLoopbackHostname;
