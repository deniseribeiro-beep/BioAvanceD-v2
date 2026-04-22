const nodemailer = require('nodemailer');

// Configure o transporte SMTP (Ethereal para testes)
const transporter = nodemailer.createTransport({
  host: 'smtp.ethereal.email',
  port: 587,
  auth: {
    user: process.env.ETHEREAL_USER || 'seu_usuario@ethereal.email',
    pass: process.env.ETHEREAL_PASS || 'sua_senha',
  },
});

/**
 * Envia e-mail de consentimento para o paciente
 * @param {string} patientEmail
 * @param {string} patientName
 * @param {string} consentToken
 */
async function sendConsentEmail(patientEmail, patientName, consentToken) {
  try {
    const biobankName = process.env.BIOBANK_NAME || 'BioAvanceD';
    const domain = process.env.BIOBANK_DOMAIN || 'localhost:3000';
    const consentUrl = `https://${domain}/paciente/consentimento/${consentToken}`;

    const mailOptions = {
      from: `"${biobankName}" <no-reply@${domain}>`,
      to: patientEmail,
      subject: `Ação Necessária: Seu Termo de Consentimento - ${biobankName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #1976d2;">Olá ${patientName},</h2>
          <p>Seu cadastro foi realizado. Para garantir sua privacidade e controle sobre seus dados (LGPD), acesse seu painel de consentimento dinâmico no link abaixo:</p>
          <p style="text-align: center; margin: 32px 0;">
            <a href="${consentUrl}" style="background: #1976d2; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold;">Acessar Consentimento</a>
          </p>
          <p>Ou copie e cole este link no navegador:<br><a href="${consentUrl}">${consentUrl}</a></p>
          <hr style="margin: 32px 0;">
          <small style="color: #888;">Guarde este e-mail. Você pode acessar este link a qualquer momento no futuro para alterar suas preferências de privacidade.</small>
        </div>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[ConsentEmail] E-mail enviado para ${patientEmail} (ID: ${info.messageId})`);
  } catch (err) {
    console.error(`[ConsentEmail] Falha ao enviar e-mail para ${patientEmail}:`, err.message);
  }
}

module.exports = { sendConsentEmail };
