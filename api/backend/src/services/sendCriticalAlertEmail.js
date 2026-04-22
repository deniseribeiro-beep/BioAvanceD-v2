const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const from = process.env.EMAIL_FROM || 'onboarding@resend.dev';

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function sendCriticalAlertEmail(sensorId, currentTemp, limitTemp, recipientEmail) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY não configurada');
  }

  const safeSensorId = escapeHtml(sensorId);
  const safeCurrentTemp = escapeHtml(currentTemp);
  const safeLimitTemp = escapeHtml(limitTemp);
  const safeRecipientEmail = String(recipientEmail || '').trim();

  if (!safeRecipientEmail) {
    throw new Error('recipientEmail é obrigatório para envio do alerta crítico');
  }

  const subject = '🚨 ALERTA CRÍTICO: Violação de Temperatura';
  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; background: #f8fafc; padding: 24px; color: #0f172a;">
      <div style="max-width: 640px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 18px 40px rgba(15, 23, 42, 0.08);">
        <div style="background: linear-gradient(135deg, #dc2626, #ef4444); color: #ffffff; padding: 24px 28px;">
          <h1 style="margin: 0; font-size: 22px; line-height: 1.3;">Alerta crítico de temperatura</h1>
          <p style="margin: 8px 0 0; opacity: 0.92;">Resposta imediata recomendada para a cadeia de frio.</p>
        </div>
        <div style="padding: 28px;">
          <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.7;">O sensor <strong>${safeSensorId}</strong> registrou a temperatura <strong>${safeCurrentTemp}°C</strong>, ultrapassando o limite crítico de <strong>${safeLimitTemp}°C</strong>.</p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <tr>
              <td style="padding: 12px 14px; border: 1px solid #e2e8f0; background: #f8fafc; font-size: 14px; font-weight: 700; width: 42%;">Sensor</td>
              <td style="padding: 12px 14px; border: 1px solid #e2e8f0; font-size: 14px;">${safeSensorId}</td>
            </tr>
            <tr>
              <td style="padding: 12px 14px; border: 1px solid #e2e8f0; background: #f8fafc; font-size: 14px; font-weight: 700;">Temperatura atual</td>
              <td style="padding: 12px 14px; border: 1px solid #e2e8f0; font-size: 14px;">${safeCurrentTemp}°C</td>
            </tr>
            <tr>
              <td style="padding: 12px 14px; border: 1px solid #e2e8f0; background: #f8fafc; font-size: 14px; font-weight: 700;">Limite crítico</td>
              <td style="padding: 12px 14px; border: 1px solid #e2e8f0; font-size: 14px;">${safeLimitTemp}°C</td>
            </tr>
          </table>
          <p style="margin: 18px 0 0; font-size: 13px; line-height: 1.6; color: #475569;">Este alerta foi gerado automaticamente pelo monitoramento IoT do biobanco.</p>
        </div>
      </div>
    </div>
  `;

  return resend.emails.send({
    from,
    to: safeRecipientEmail,
    subject,
    html
  });
}

module.exports = {
  sendCriticalAlertEmail
};