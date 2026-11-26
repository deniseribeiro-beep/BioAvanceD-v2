const logger = require('../../utils/logger');
const requestContext = require('../../utils/requestContext');
const jobMetrics = require('../../infrastructure/metrics/jobMetrics');

const SWEEP_MS = 60 * 60 * 1000;

/**
 * Closes consents whose term validTo has passed and tells each holder once.
 * The same close also runs when a consent is read, so a stopped worker does
 * not leave an ended term looking open.
 */
function scheduleNextRun() {
  const timer = setTimeout(() => requestContext.runAsJob(null, async () => {
    // #1468 (RNF015 C1/C3): each sweep runs under its own correlation id and
    // is recorded once, completed or failed, when a database was reached.
    let db = null;
    let outcome = 'completed';
    const t0 = process.hrtime.bigint();
    try {
      const { connectDB } = require('../../database/mongo');
      const consentService = require('../../services/consent.service');
      db = await connectDB();
      const result = await consentService.expireDueConsents(db);
      if (result.closed > 0) {
        logger.info(`Termos encerrados por vencimento: ${result.closed}`);
      }
    } catch (error) {
      outcome = 'failed';
      logger.error('Erro na varredura de vencimento do TCLE:', error.message || error);
    } finally {
      if (db) {
        const durationMs = Number(process.hrtime.bigint() - t0) / 1e6;
        await jobMetrics.recordJob(db, { worker: 'consent-expiry', job: 'sweep', outcome, durationMs });
      }
      scheduleNextRun();
    }
  }), SWEEP_MS);
  if (typeof timer.unref === 'function') timer.unref();
}

module.exports = { scheduleNextRun, SWEEP_MS };
