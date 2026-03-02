const nodemailer = require('nodemailer');
const twilio = require('twilio');
const logger = require('../utils/logger');
const {
  connectInfluxDB,
  getInfluxQueryApi,
  getInfluxConfig
} = require('../infrastructure/database/influxdb/connection');

class MockProvider {
  constructor(channel) {
    this.channel = channel;
  }

  async send(payload) {
    logger.info(`[NOTIFICATION][MOCK][${this.channel}]`, payload);
    return {
      success: true,
      mocked: true,
      channel: this.channel,
      payload
    };
  }
}

class TwilioProvider {
  constructor() {
    this.sid = process.env.TWILIO_ACCOUNT_SID;
    this.token = process.env.TWILIO_AUTH_TOKEN;
    this.from = process.env.TWILIO_PHONE_NUMBER;
    this.smsMock = String(process.env.SMS_MOCK || '').toLowerCase() === 'true';
    this.client = null;
  }

  getClient() {
    if (this.client) {
      return this.client;
    }

    if (!this.sid || !this.token) {
      throw new Error('TWILIO_ACCOUNT_SID e TWILIO_AUTH_TOKEN são obrigatórios para envio real de SMS');
    }

    this.client = twilio(this.sid, this.token);
    return this.client;
  }

  async send({ to, body }) {
    if (!to || !body) {
      throw new Error('to e body são obrigatórios para SMS');
    }

    if (this.smsMock) {
      console.log(`[SMS_MOCK] to=${to} body=${body}`);
      return {
        success: true,
        mocked: true,
        channel: 'sms',
        provider: 'twilio-mock'
      };
    }

    if (!this.from) {
      throw new Error('TWILIO_PHONE_NUMBER é obrigatório para envio real de SMS');
    }

    const client = this.getClient();
    const response = await client.messages.create({
      to,
      from: this.from,
      body
    });

    return {
      success: true,
      mocked: false,
      channel: 'sms',
      provider: 'twilio',
      sid: response.sid
    };
  }
}

class EmailProvider {
  constructor() {
    this.from = process.env.EMAIL_FROM || 'BioAvanceD <no-reply@bioadvanced.dev>';
    this.transporter = null;
  }

  async getTransporter() {
    if (this.transporter) {
      return this.transporter;
    }

    if (process.env.NODE_ENV === 'development') {
      const account = await nodemailer.createTestAccount();
      this.transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: account.user,
          pass: account.pass
        }
      });
      return this.transporter;
    }

    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = Number(process.env.SMTP_PORT || 587);
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;

    if (!smtpHost || !smtpUser || !smtpPass) {
      throw new Error('SMTP_HOST, SMTP_USER e SMTP_PASS são obrigatórios para e-mail fora de desenvolvimento');
    }

    this.transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass
      }
    });

    return this.transporter;
  }

  async send({ to, subject, html, text }) {
    if (!to || !subject || (!html && !text)) {
      throw new Error('to, subject e html/text são obrigatórios para e-mail');
    }

    const transporter = await this.getTransporter();
    const info = await transporter.sendMail({
      from: this.from,
      to,
      subject,
      html,
      text
    });

    const previewUrl = nodemailer.getTestMessageUrl(info) || null;
    if (previewUrl) {
      logger.info(`[EMAIL][ETHEREAL] Preview URL: ${previewUrl}`);
    }

    return {
      success: true,
      mocked: false,
      channel: 'email',
      provider: process.env.NODE_ENV === 'development' ? 'ethereal' : 'smtp',
      messageId: info.messageId,
      previewUrl
    };
  }
}

class NotificationService {
  constructor() {
    this.smsProvider = this.resolveProvider('sms');
    this.emailProvider = this.resolveProvider('email');
  }

  resolveProvider(channel) {
    const shouldMockByEnv = process.env.NODE_ENV !== 'production';
    if (shouldMockByEnv) {
      return new MockProvider(channel);
    }

    if (channel === 'sms') {
      return new TwilioProvider();
    }

    return new EmailProvider();
  }

  async sendOTPSMS(phone, code) {
    const body = `BioAvanceD MFA: seu código de verificação é ${code}. Válido por 5 minutos.`;
    return this.smsProvider.send({ to: phone, body });
  }

  async sendRecoveryEmail(email, token) {
    const appDomain = process.env.APP_DOMAIN || 'https://bioadvanced.dev';
    const recoveryUrl = `${appDomain.replace(/\/$/, '')}/recover-password?token=${encodeURIComponent(token)}`;

    const html = `
      <div style="font-family: Arial, sans-serif; background:#f4f7fb; padding:24px; color:#1d3557;">
        <div style="max-width:640px; margin:0 auto; background:white; border-radius:12px; padding:24px; border:1px solid #dbe5f1;">
          <h1 style="margin:0 0 8px; color:#0b2545;">BioAvanceD</h1>
          <p style="margin:0 0 20px; font-size:14px; color:#4f6d8a;">Plataforma de Gestão Inteligente de Biobanco</p>
          <h2 style="margin:0 0 16px; color:#1d3557;">Recuperação de senha</h2>
          <p style="line-height:1.6;">Recebemos uma solicitação para redefinir sua senha. Para continuar com segurança, clique no botão abaixo.</p>
          <p style="margin:24px 0;">
            <a href="${recoveryUrl}" style="display:inline-block; padding:12px 20px; background:#1d4ed8; color:#ffffff; text-decoration:none; border-radius:8px; font-weight:bold;">Redefinir senha</a>
          </p>
          <p style="font-size:13px; color:#6b7280; line-height:1.5;">Se você não solicitou esta recuperação, ignore este e-mail. Este link expira em 30 minutos.</p>
          <hr style="border:none; border-top:1px solid #e5e7eb; margin:24px 0;" />
          <p style="font-size:12px; color:#94a3b8; margin:0;">© ${new Date().getFullYear()} BioAvanceD · <a href="https://bioadvanced.dev" style="color:#1d4ed8; text-decoration:none;">bioadvanced.dev</a></p>
        </div>
      </div>
    `;

    const text = `BioAvanceD - Recuperação de senha\n\nAcesse: ${recoveryUrl}\n\nSe você não solicitou, ignore este e-mail.`;

    return this.emailProvider.send({
      to: email,
      subject: 'BioAvanceD | Recuperação de Senha',
      html,
      text
    });
  }

  async sendCriticalTempAlert(sampleId, temp, options = {}) {
    const minTemp = Number(options.minTemp ?? process.env.TELEMETRY_MIN_TEMP_ALERT ?? -196);
    const maxTemp = Number(options.maxTemp ?? process.env.TELEMETRY_MAX_TEMP_ALERT ?? -80);
    const phone = options.phone || process.env.ALERT_SMS_TO;
    const email = options.email || process.env.ALERT_EMAIL_TO;

    if (temp >= minTemp && temp <= maxTemp) {
      return {
        triggered: false,
        reason: `Temperatura ${temp}°C dentro do range ${minTemp}°C..${maxTemp}°C`
      };
    }

    const body = `[ALERTA CRÍTICO] Amostra ${sampleId} fora de faixa: ${temp}°C (esperado ${minTemp}°C..${maxTemp}°C)`;
    const html = `
      <h2>Alerta Crítico de Temperatura</h2>
      <p><strong>Amostra:</strong> ${sampleId}</p>
      <p><strong>Temperatura:</strong> ${temp}°C</p>
      <p><strong>Faixa esperada:</strong> ${minTemp}°C até ${maxTemp}°C</p>
      <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
    `;

    const [smsResult, emailResult] = await Promise.allSettled([
      phone ? this.smsProvider.send({ to: phone, body }) : Promise.resolve({ skipped: true, reason: 'ALERT_SMS_TO ausente' }),
      email ? this.emailProvider.send({ to: email, subject: `BioAvanceD ALERTA: ${sampleId}`, html, text: body }) : Promise.resolve({ skipped: true, reason: 'ALERT_EMAIL_TO ausente' })
    ]);

    return {
      triggered: true,
      sampleId,
      temp,
      minTemp,
      maxTemp,
      sms: smsResult.status === 'fulfilled' ? smsResult.value : { success: false, error: smsResult.reason?.message || 'sms_failed' },
      email: emailResult.status === 'fulfilled' ? emailResult.value : { success: false, error: emailResult.reason?.message || 'email_failed' }
    };
  }

  async sendCriticalTempAlertFromInflux(sampleId, options = {}) {
    await connectInfluxDB();
    const queryApi = getInfluxQueryApi();
    const influx = getInfluxConfig();

    const locationFilter = options.locationId
      ? `|> filter(fn: (r) => r.locationId == "${String(options.locationId)}")`
      : '';

    const flux = `
      from(bucket: "${influx.bucket}")
        |> range(start: -${Number(options.lookbackHours || 1)}h)
        |> filter(fn: (r) => r._measurement == "freezer_temperature")
        |> filter(fn: (r) => r._field == "temperatureValue")
        ${locationFilter}
        |> sort(columns: ["_time"], desc: true)
        |> limit(n: 1)
    `;

    const rows = await queryApi.collectRows(flux);
    if (!rows.length) {
      return {
        triggered: false,
        reason: 'Sem dados recentes no InfluxDB para simulação'
      };
    }

    const latestTemp = Number(rows[0]._value);
    return this.sendCriticalTempAlert(sampleId, latestTemp, options);
  }
}

module.exports = new NotificationService();