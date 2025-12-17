const { connectDB, closeConnection } = require('../../database/mongo');
const integrityService = require('../../services/integrityCheckService');
const auditRootService = require('../../services/auditRoot.service');
const logger = require('../../utils/logger');

/**
 * Daily Merkle Job
 * - Runs at approximately 02:30 UTC daily (simple scheduler)
 * - Calls integrityService.buildMerkleForDate(date, db) and saves root via auditRootService
 *
 * Implementation is lightweight and uses setTimeout re-scheduling to avoid external deps.
 */

const RUN_HOUR_UTC = 2; // 02:30 UTC
const RUN_MINUTE_UTC = 30;

function msUntilNextRun() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), RUN_HOUR_UTC, RUN_MINUTE_UTC, 0));
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next - now;
}

async function runOnce() {
  const date = new Date();
  const targetDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - 1)).toISOString().slice(0, 10);

  let db = null;
  try {
    db = await connectDB();
    logger.info(`[daily-merkle] Generating Merkle Root for ${targetDate}`);
    const result = await integrityService.buildMerkleForDate(targetDate, db);
    if (!result || !result.root) {
      logger.warn(`[daily-merkle] No root produced for ${targetDate}`);
    }

    await auditRootService.saveDailyRoot({ date: targetDate, root: result.root, db });
    logger.info(`[daily-merkle] Saved Merkle Root for ${targetDate} -> ${result.root}`);
  } catch (error) {
    logger.error('[daily-merkle] Error running daily merkle job:', error.message || error);
  } finally {
    if (db) await closeConnection();
  }
}

function scheduleNextRun() {
  const delay = msUntilNextRun();
  logger.info(`[daily-merkle] Next run in ${Math.round(delay / 1000)}s`);
  setTimeout(async () => {
    try {
      await runOnce();
    } catch (e) {
      logger.error('[daily-merkle] Run error:', e.message || e);
    } finally {
      // always reschedule
      scheduleNextRun();
    }
  }, delay + 1000); // slight buffer
}

// Auto-start schedule when required
scheduleNextRun();

module.exports = { runOnce, scheduleNextRun };
