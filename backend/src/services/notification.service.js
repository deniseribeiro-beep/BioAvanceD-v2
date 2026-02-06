const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { Queue } = require('bullmq');
const logger = require('../utils/logger');
const env = require('../config/env');
const { initRedis } = require('../config/queue');

const DEFAULT_FRONTEND_URL = 'http://localhost:5173';
const CONSENT_TOKEN_TTL_DAYS = 7;

const getFrontendUrl = () => {
  return env.FRONTEND_URL || DEFAULT_FRONTEND_URL;
};

const formatConsentMessage = (name, link) => {
  const safeName = name || 'Paciente';
  return `BioAvanceD: Olá ${safeName}, sua participação no biobanco exige o aceite do termo de consentimento. Acesse: ${link}`;
};

const resolveEmail = (patientData) => {
  return patientData.email || patientData.emailAddress || patientData.contactEmail || null;
};

const DEFAULT_COUNTRY_CODE = process.env.CONSENT_DEFAULT_COUNTRY_CODE || process.env.DEFAULT_COUNTRY_CODE || '55';

const normalizePhoneE164 = (rawPhone) => {
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

  if (digits.startsWith(DEFAULT_COUNTRY_CODE)) {
    return `+${digits}`;
  }

  return `+${DEFAULT_COUNTRY_CODE}${digits}`;
};

const resolvePhone = (patientData) => {
  const rawPhone = patientData.phone || patientData.mobile || patientData.whatsapp || patientData.phoneNumber || null;
  return normalizePhoneE164(rawPhone);
};

const getEmailTransporter = () => {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !port || !user || !pass) {
    return null;
  }

  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass }
  });
};

const sendEmail = async (patientData, consentLink) => {
  const email = resolveEmail(patientData);
  if (!email) {
    logger.warn('Consentimento: email ausente para paciente', { patientID: patientData.patientID });
    return { channel: 'email', success: false, reason: 'missing_email' };
  }

  const transporter = getEmailTransporter();
  const message = formatConsentMessage(patientData.patientName, consentLink);

  if (!transporter) {
    logger.info(`Consentimento EMAIL (mock) enviado para ${email}`);
    return { channel: 'email', success: true, provider: 'mock' };
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  await transporter.sendMail({
    from,
    to: email,
    subject: 'BioAvanceD - Termo de Consentimento',
    text: message
  });

  logger.info(`Consentimento EMAIL enviado para ${email}`);
  return { channel: 'email', success: true, provider: 'smtp' };
};

const sendSms = async (patientData, consentLink) => {
  const phone = resolvePhone(patientData);
  if (!phone) {
    logger.warn('Consentimento: telefone ausente para SMS', { patientID: patientData.patientID });
    return { channel: 'sms', success: false, reason: 'missing_phone' };
  }

  const message = formatConsentMessage(patientData.patientName, consentLink);
  logger.info(`Consentimento SMS (mock) enviado para ${phone}`, { message });
  return { channel: 'sms', success: true, provider: 'mock' };
};

const sendWhatsApp = async (patientData, consentLink) => {
  const phone = resolvePhone(patientData);
  if (!phone) {
    logger.warn('Consentimento: telefone ausente para WhatsApp', { patientID: patientData.patientID });
    return { channel: 'whatsapp', success: false, reason: 'missing_phone' };
  }

  const message = formatConsentMessage(patientData.patientName, consentLink);
  logger.info(`Consentimento WhatsApp (mock) enviado para ${phone}`, { message });
  return { channel: 'whatsapp', success: true, provider: 'mock' };
};

const notifyPatientConsent = async (patientData, consentLink) => {
  const results = await Promise.allSettled([
    sendEmail(patientData, consentLink),
    sendSms(patientData, consentLink),
    sendWhatsApp(patientData, consentLink)
  ]);

  const summary = results.map((result) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    return { channel: 'unknown', success: false, reason: result.reason?.message || 'failed' };
  });

  summary.forEach((item) => {
    if (item.success) {
      logger.info(`Consentimento enviado com sucesso (${item.channel})`, item);
    } else {
      logger.warn(`Falha ao enviar consentimento (${item.channel})`, item);
    }
  });

  return summary;
};

const getConsentQueueStats = async () => {
  const queue = getNotificationQueue();
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
};

let notificationQueue = null;

const getNotificationQueue = () => {
  if (notificationQueue) return notificationQueue;
  const connection = initRedis();
  if (!connection) {
    logger.warn('[WARN] Fila de notificações não inicializada (Redis não configurado)');
    return null;
  }

  notificationQueue = new Queue('notification-queue', {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { age: 24 * 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 }
    }
  });

  return notificationQueue;
};

const enqueueConsentNotification = async (patientData, consentLink) => {
  const queue = getNotificationQueue();
  if (!queue) {
    return notifyPatientConsent(patientData, consentLink);
  }

  await queue.add('consent-notification', {
    patientData,
    consentLink
  });

  return [{ channel: 'queue', success: true, provider: 'bullmq' }];
};

const processConsentNotificationJob = async (jobData) => {
  return notifyPatientConsent(jobData.patientData, jobData.consentLink);
};

const generateConsentToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

const buildConsentLink = (patientData, token) => {
  const baseUrl = getFrontendUrl().replace(/\/$/, '');
  const patientId = patientData.patientID || patientData.patientId || patientData.id;
  const encodedToken = encodeURIComponent(token);
  return `${baseUrl}/patients/${patientId}/consent?token=${encodedToken}`;
};

const buildConsentMetadata = () => {
  const token = generateConsentToken();
  const createdAt = new Date();
  const expiresAt = new Date(Date.now() + CONSENT_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  return {
    token,
    createdAt,
    expiresAt
  };
};

/**
 * Serviço de Notificações Assíncronas
 * Envia notificações por email e WebSocket
 */

class NotificationService {
  constructor() {
    this.transporter = null;
    this.io = null; // Socket.IO instance
  }

  /**
   * Inicializa serviço de email
   */
  initEmail() {
    if (this.transporter) {
      return this.transporter;
    }

    const emailConfig = {
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    };

    if (emailConfig.auth.user && emailConfig.auth.pass) {
      this.transporter = nodemailer.createTransport(emailConfig);
      logger.info('✅ Serviço de email inicializado');
    } else {
      // Apenas loga em modo desenvolvimento para não poluir logs em produção
      if (process.env.NODE_ENV === 'development') {
        logger.warn('⚠️ Configuração de email não encontrada (SMTP_USER/SMTP_PASS), notificações por email desabilitadas');
        logger.warn('💡 Para habilitar email, configure SMTP_USER e SMTP_PASS no .env');
      }
    }

    return this.transporter;
  }

  /**
   * Inicializa Socket.IO
   */
  initSocketIO(serverOrIo) {
    if (this.io) {
      return this.io;
    }

    const { Server } = require('socket.io');

    // Aceita instância existente de Server ou cria uma nova a partir do HTTP server
    if (serverOrIo && typeof serverOrIo.of === 'function' && typeof serverOrIo.emit === 'function') {
      this.io = serverOrIo;
    } else {
      this.io = new Server(serverOrIo, {
        cors: {
          origin: process.env.FRONTEND_URL || '*',
          methods: ['GET', 'POST'],
        },
        pingTimeout: 30000,
        pingInterval: 25000,
      });
    }

    this.io.on('connection', (socket) => {
      logger.info(`✅ Cliente WebSocket conectado: ${socket.id}`);

      // Salas por usuário e por job
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

  // Eventos de ciclo de vida do job
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

  /**
   * Envia notificação de job completado
   */
  async notifyJobCompleted(userID, jobData) {
    try {
      // Notificação WebSocket
      if (this.io) {
        const payload = {
          jobID: jobData.jobID,
          status: jobData.status,
          dataType: jobData.dataType,
          successCount: jobData.successCount,
          errorCount: jobData.errorCount,
          message: `Importação de ${jobData.dataType} concluída`,
        };
        this.io.to(`user-${userID}`).emit('import-completed', payload);
        if (jobData.jobID) {
          this.io.to(jobData.jobID).emit('import-completed', payload);
        }
      }

      // Notificação Email (se configurado)
      if (this.transporter && jobData.userEmail) {
        await this.sendEmail({
          to: jobData.userEmail,
          subject: `Importação ${jobData.dataType} - Concluída`,
          html: this.generateJobEmailTemplate(jobData),
        });
      }

      logger.info(`✅ Notificação enviada para job ${jobData.jobID}`);
    } catch (error) {
      logger.error('Erro ao enviar notificação:', error);
      // Não lança erro para não interromper o processamento
    }
  }

  /**
   * Envia notificação de job falhado
   */
  async notifyJobFailed(userID, jobData) {
    try {
      // Notificação WebSocket
      if (this.io) {
        const payload = {
          jobID: jobData.jobID,
          status: jobData.status,
          dataType: jobData.dataType,
          error: jobData.error,
          message: `Importação de ${jobData.dataType} falhou`,
        };
        this.io.to(`user-${userID}`).emit('import-failed', payload);
        if (jobData.jobID) {
          this.io.to(jobData.jobID).emit('import-failed', payload);
        }
      }

      // Notificação Email (se configurado)
      if (this.transporter && jobData.userEmail) {
        await this.sendEmail({
          to: jobData.userEmail,
          subject: `Importação ${jobData.dataType} - Falhou`,
          html: this.generateJobErrorEmailTemplate(jobData),
        });
      }

      logger.info(`✅ Notificação de falha enviada para job ${jobData.jobID}`);
    } catch (error) {
      logger.error('Erro ao enviar notificação de falha:', error);
    }
  }

  /**
   * Envia email
   */
  async sendEmail({ to, subject, html, text }) {
    if (!this.transporter) {
      logger.warn('Serviço de email não configurado');
      return;
    }

    try {
      await this.transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to,
        subject,
        html,
        text: text || html,
      });

      logger.info(`✅ Email enviado para ${to}`);
    } catch (error) {
      logger.error('Erro ao enviar email:', error);
      throw error;
    }
  }

  /**
   * Gera template de email para job completado
   */
  generateJobEmailTemplate(jobData) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #4CAF50; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9f9f9; }
          .stats { display: flex; justify-content: space-around; margin: 20px 0; }
          .stat { text-align: center; }
          .stat-value { font-size: 24px; font-weight: bold; color: #4CAF50; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Importação Concluída</h1>
          </div>
          <div class="content">
            <p>Olá,</p>
            <p>Sua importação de <strong>${jobData.dataType}</strong> foi concluída com sucesso.</p>
            <div class="stats">
              <div class="stat">
                <div class="stat-value">${jobData.successCount}</div>
                <div>Registros Importados</div>
              </div>
              <div class="stat">
                <div class="stat-value">${jobData.errorCount}</div>
                <div>Erros</div>
              </div>
            </div>
            <p><strong>Job ID:</strong> ${jobData.jobID}</p>
            <p><strong>Arquivo:</strong> ${jobData.fileName}</p>
            <p><strong>Data:</strong> ${new Date(jobData.completedAt).toLocaleString('pt-BR')}</p>
          </div>
          <div class="footer">
            <p>BioAdvanceD - Sistema de Gerenciamento de Amostras Biológicas</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Gera template de email para job falhado
   */
  generateJobErrorEmailTemplate(jobData) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #f44336; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9f9f9; }
          .error { background-color: #ffebee; padding: 15px; border-left: 4px solid #f44336; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Importação Falhou</h1>
          </div>
          <div class="content">
            <p>Olá,</p>
            <p>Infelizmente, sua importação de <strong>${jobData.dataType}</strong> falhou.</p>
            <div class="error">
              <p><strong>Erro:</strong> ${jobData.error || 'Erro desconhecido'}</p>
            </div>
            <p><strong>Job ID:</strong> ${jobData.jobID}</p>
            <p><strong>Arquivo:</strong> ${jobData.fileName}</p>
            <p>Por favor, verifique o arquivo e tente novamente.</p>
          </div>
          <div class="footer">
            <p>BioAdvanceD - Sistema de Gerenciamento de Amostras Biológicas</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }
}

const notificationInstance = new NotificationService();
notificationInstance.notifyPatientConsent = notifyPatientConsent;
notificationInstance.enqueueConsentNotification = enqueueConsentNotification;
notificationInstance.processConsentNotificationJob = processConsentNotificationJob;
notificationInstance.getConsentQueueStats = getConsentQueueStats;
notificationInstance.generateConsentToken = generateConsentToken;
notificationInstance.buildConsentLink = buildConsentLink;
notificationInstance.buildConsentMetadata = buildConsentMetadata;

module.exports = notificationInstance;

