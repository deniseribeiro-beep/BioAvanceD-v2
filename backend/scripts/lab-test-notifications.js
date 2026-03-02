require('dotenv').config();

const logger = require('../src/utils/logger');
const notificationService = require('../src/services/NotificationService');

async function runLabCycle() {
  process.env.NODE_ENV = process.env.NODE_ENV || 'development';
  process.env.SMS_MOCK = process.env.SMS_MOCK || 'true';

  const sampleId = process.env.LAB_SAMPLE_ID || `LAB-SAMPLE-${Date.now()}`;
  const simulatedFailureTemp = Number(process.env.LAB_SIMULATED_TEMP || -55);
  const otpPhone = process.env.LAB_OTP_PHONE || process.env.ALERT_SMS_TO || '+5500000000000';
  const recoveryEmail = process.env.LAB_RECOVERY_EMAIL || process.env.ALERT_EMAIL_TO || 'auditoria@bioadvanced.dev';

  logger.info('[LAB] Iniciando ciclo de testes de notificação...');

  logger.warn(`[LAB][1/3] Simulação de falha de sensor para ${sampleId} com ${simulatedFailureTemp}°C`);

  const otpResult = await notificationService.sendOTPSMS(otpPhone, '123456');
  logger.info('[LAB][2/3] Resultado SMS OTP (Twilio mock):', otpResult);

  const criticalAlertResult = await notificationService.sendCriticalTempAlert(sampleId, simulatedFailureTemp, {
    phone: otpPhone,
    email: recoveryEmail
  });
  logger.info('[LAB][2.1/3] Resultado alerta crítico:', criticalAlertResult);

  const recoveryResult = await notificationService.sendRecoveryEmail(recoveryEmail, `lab-token-${Date.now()}`);
  logger.info('[LAB][3/3] Resultado e-mail de auditoria/recuperação:', recoveryResult);

  const influxSimulation = await notificationService.sendCriticalTempAlertFromInflux(sampleId, {
    lookbackHours: Number(process.env.LAB_INFLUX_LOOKBACK_HOURS || 1),
    phone: otpPhone,
    email: recoveryEmail,
    minTemp: Number(process.env.TELEMETRY_MIN_TEMP_ALERT || -196),
    maxTemp: Number(process.env.TELEMETRY_MAX_TEMP_ALERT || -80)
  });

  logger.info('[LAB][EXTRA] Simulação via InfluxDB:', influxSimulation);
  logger.info('[LAB] Ciclo concluído com sucesso.');
}

runLabCycle()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error('[LAB] Falha no ciclo de laboratório:', error.message || error);
    process.exit(1);
  });
