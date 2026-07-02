const { Resend } = require('resend');
const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

const from = process.env.EMAIL_FROM || 'onboarding@resend.dev';

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function sendIncidentAlertEmail(incident, recipients, escalationLevel = 0) {
  if (!process.env.SMTP_HOST && !process.env.RESEND_API_KEY) {
    logger.warn('SMTP_HOST e RESEND_API_KEY não configurados - alerta de incidente não enviado por email');
    return { success: false, reason: 'Email transport not configured' };
  }

  if (!recipients || recipients.length === 0) {
    logger.warn('Nenhum destinatário fornecido para alerta de incidente');
    return { success: false, reason: 'No recipients provided' };
  }

  const safeSensorName = escapeHtml(incident.sensorName);
  const safeTemp = escapeHtml(incident.currentTemperature);
  const safeMaxTemp = escapeHtml(incident.maxTemperature);
  const safeMinTemp = escapeHtml(incident.minTemperature);
  const safeSensorKey = escapeHtml(incident.sensorKey);
  const openedTime = new Date(incident.openedAt).toLocaleString('pt-BR');

  const escalationLevelLabel = [
    'Normal',
    'Supervisor',
    'Crítico'
  ][escalationLevel] || 'Normal';

  const escalationColor = {
    0: '#f59e0b', // amber
    1: '#ef4444', // red
    2: '#dc2626'  // darkred
  }[escalationLevel] || '#f59e0b';

  const subject = `🚨 INCIDENTE DE TEMPERATURA: ${safeSensorName}`;
  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; background: #f8fafc; padding: 24px; color: #0f172a;">
      <div style="max-width: 640px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 18px 40px rgba(15, 23, 42, 0.08);">
        <div style="background: linear-gradient(135deg, ${escalationColor}, ${escalationColor}); color: #ffffff; padding: 24px 28px;">
          <h1 style="margin: 0; font-size: 22px; line-height: 1.3;">Incidente de Temperatura Detectado</h1>
          <p style="margin: 8px 0 0; opacity: 0.92;">Nível de Escalação: ${escalationLevelLabel}</p>
        </div>
        <div style="padding: 28px;">
          <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.7;">O sensor <strong>${safeSensorName}</strong> registrou uma temperatura anómala de <strong>${safeTemp}°C</strong>.</p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <tr>
              <td style="padding: 12px 14px; border: 1px solid #e2e8f0; background: #f8fafc; font-size: 14px; font-weight: 700; width: 42%;">Sensor</td>
              <td style="padding: 12px 14px; border: 1px solid #e2e8f0; font-size: 14px;">${safeSensorName} (${safeSensorKey})</td>
            </tr>
            <tr>
              <td style="padding: 12px 14px; border: 1px solid #e2e8f0; background: #f8fafc; font-size: 14px; font-weight: 700;">Temperatura Atual</td>
              <td style="padding: 12px 14px; border: 1px solid #e2e8f0; font-size: 14px;">${safeTemp}°C</td>
            </tr>
            <tr>
              <td style="padding: 12px 14px; border: 1px solid #e2e8f0; background: #f8fafc; font-size: 14px; font-weight: 700;">Máxima Registrada</td>
              <td style="padding: 12px 14px; border: 1px solid #e2e8f0; font-size: 14px;">${safeMaxTemp}°C</td>
            </tr>
            <tr>
              <td style="padding: 12px 14px; border: 1px solid #e2e8f0; background: #f8fafc; font-size: 14px; font-weight: 700;">Mínima Registrada</td>
              <td style="padding: 12px 14px; border: 1px solid #e2e8f0; font-size: 14px;">${safeMinTemp}°C</td>
            </tr>
            <tr>
              <td style="padding: 12px 14px; border: 1px solid #e2e8f0; background: #f8fafc; font-size: 14px; font-weight: 700;">Aberto em</td>
              <td style="padding: 12px 14px; border: 1px solid #e2e8f0; font-size: 14px;">${openedTime}</td>
            </tr>
            <tr>
              <td style="padding: 12px 14px; border: 1px solid #e2e8f0; background: #f8fafc; font-size: 14px; font-weight: 700;">Ocorrências</td>
              <td style="padding: 12px 14px; border: 1px solid #e2e8f0; font-size: 14px;">${escapeHtml(incident.samplesOutOfRange)}</td>
            </tr>
          </table>
          <p style="margin: 18px 0 0; font-size: 13px; line-height: 1.6; color: #475569;">Este alerta foi gerado automaticamente pelo sistema de monitoramento do biobanco. Acesse o painel de gerenciamento de incidentes para mais detalhes.</p>
        </div>
      </div>
    </div>
  `;

  const smtpTransport = process.env.SMTP_HOST
    ? nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 25),
        secure: false,
      })
    : null;
  const sendEmail = smtpTransport
    ? (message) => smtpTransport.sendMail(message)
    : (message) => new Resend(process.env.RESEND_API_KEY).emails.send(message);

  const results = await Promise.allSettled(
    recipients.map(email => {
      const safeEmail = String(email || '').trim();
      if (!safeEmail) return Promise.reject(new Error('Invalid email'));
      return sendEmail({
        from,
        to: safeEmail,
        subject,
        html
      });
    })
  );

  const successful = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;

  if (failed > 0) {
    logger.error(`[INCIDENT_EMAIL] ${successful} enviados, ${failed} falharam para incidente ${incident.sensorName}`);
  }

  return {
    success: successful > 0,
    sent: successful,
    failed: failed,
    results
  };
}

module.exports = {
  sendIncidentAlertEmail
};
