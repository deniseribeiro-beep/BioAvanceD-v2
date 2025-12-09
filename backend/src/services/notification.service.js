const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

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
  initSocketIO(server) {
    if (this.io) {
      return this.io;
    }

    const { Server } = require('socket.io');
    this.io = new Server(server, {
      cors: {
        origin: process.env.FRONTEND_URL || '*',
        methods: ['GET', 'POST'],
      },
    });

    this.io.on('connection', (socket) => {
      logger.info(`✅ Cliente WebSocket conectado: ${socket.id}`);

      socket.on('disconnect', () => {
        logger.info(`❌ Cliente WebSocket desconectado: ${socket.id}`);
      });
    });

    logger.info('✅ Socket.IO inicializado');
    return this.io;
  }

  /**
   * Envia notificação de job completado
   */
  async notifyJobCompleted(userID, jobData) {
    try {
      // Notificação WebSocket
      if (this.io) {
        this.io.to(`user-${userID}`).emit('import-completed', {
          jobID: jobData.jobID,
          status: jobData.status,
          dataType: jobData.dataType,
          successCount: jobData.successCount,
          errorCount: jobData.errorCount,
          message: `Importação de ${jobData.dataType} concluída`,
        });
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
        this.io.to(`user-${userID}`).emit('import-failed', {
          jobID: jobData.jobID,
          status: jobData.status,
          dataType: jobData.dataType,
          error: jobData.error,
          message: `Importação de ${jobData.dataType} falhou`,
        });
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

module.exports = new NotificationService();

