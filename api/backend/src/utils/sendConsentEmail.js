const notificationService = require('../services/NotificationService');

/**
 * Envia e-mail de consentimento para o paciente
 * @param {string} patientEmail
 * @param {string} patientName
 * @param {string} consentToken
 */
async function sendConsentEmail(patientEmail, patientName, consentToken) {
  const patientData = {
    patientName,
    email: patientEmail
  };
  const consentUrl = notificationService.buildConsentLink(patientData, consentToken);
  return notificationService.sendConsentEmail(patientData, consentUrl);
}

module.exports = { sendConsentEmail };
