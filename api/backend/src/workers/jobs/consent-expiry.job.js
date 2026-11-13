const logger = require('../../utils/logger');

const SWEEP_MS = 60 * 60 * 1000;

/**
 * Closes consents whose term validTo has passed and tells each holder once.
 * The same close also runs when a consent is read, so a stopped worker does
 * not leave an ended term looking open.
 */
function scheduleNextRun() {
  const timer = setTimeout(async () => {
    try {
      const { connectDB } = require('../../database/mongo');
      const consentService = require('../../services/consent.service');
      const db = await connectDB();
      const result = await consentService.expireDueConsents(db);
      if (result.closed > 0) {
        logger.info(`Termos encerrados por vencimento: ${result.closed}`);
      }
    } catch (error) {
      logger.error('Erro na varredura de vencimento do TCLE:', error.message || error);
    } finally {
      scheduleNextRun();
    }
  }, SWEEP_MS);
  if (typeof timer.unref === 'function') timer.unref();
}

module.exports = { scheduleNextRun, SWEEP_MS };
