const { connectDB, closeConnection } = require('../../database/mongo');
const integrityService = require('../../services/integrityCheckService');
const auditRootService = require('../../services/auditRoot.service');
const auditV2Service = require('../../services/audit-v2.service');
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
const BACKFILL_DAYS = 7;

function isValidMerkleResult(result) {
  return Boolean(result && result.root && Array.isArray(result.leaves));
}

function toUtcDateString(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString().slice(0, 10);
}

async function recoverMissingDates(db, upToDateInclusive) {
  const limitDate = new Date(`${upToDateInclusive}T00:00:00.000Z`);
  const dateList = [];
  for (let i = BACKFILL_DAYS; i >= 1; i -= 1) {
    const d = new Date(limitDate);
    d.setUTCDate(limitDate.getUTCDate() - i);
    dateList.push(toUtcDateString(d));
  }

  for (const date of dateList) {
    const existing = await auditRootService.getRootByDate(date, db);
    if (existing) continue;
    logger.info(`[daily-merkle] Recuperando data sem root: ${date}`);
    const result = await integrityService.buildMerkleForDate(date, db, { persistMissing: true });
    if (!isValidMerkleResult(result)) {
      logger.warn(`[daily-merkle] Resultado Merkle inválido ao recuperar ${date}; root/leaves ausentes`);
      continue;
    }

    await auditRootService.saveDailyRoot({ date, root: result.root, treeSize: result.leaves.length, db });
    await anchorV2ForDate(db, date, result);
  }
}

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
    logger.info(`[daily-merkle] Gerando Merkle Root para ${targetDate}`);
    const result = await integrityService.buildMerkleForDate(targetDate, db, { persistMissing: true });
    if (!isValidMerkleResult(result)) {
      logger.warn(`[daily-merkle] Resultado Merkle inválido para ${targetDate}; job encerrado sem persistência`);
      return;
    }

    await auditRootService.saveDailyRoot({ date: targetDate, root: result.root, treeSize: result.leaves.length, db });
    await anchorV2ForDate(db, targetDate, result);
    await recoverMissingDates(db, targetDate);
    await auditRootService.processTimestampBacklog({ externalDb: db });
    logger.info(`[daily-merkle] Root salva para ${targetDate} -> ${result.root}`);
  } catch (error) {
    logger.error('[daily-merkle] Erro ao executar job diário de Merkle:', error.message || error);
  } finally {
    if (db) await closeConnection();
  }
}

async function anchorV2ForDate(db, date, result) {
  const logId = `audit-${date}`;
  const previous = await db.collection('audit_tree_heads').find({ logId }).sort({ treeSize: -1 }).limit(1).toArray();
  const previousTreeHeadHash = previous[0]?.rootHash || null;
  const treeHead = await auditV2Service.createTreeHead({
    logId,
    treeSize: result.leaves.length,
    rootHash: result.root,
    previousTreeHeadHash,
    periodStart: `${date}T00:00:00.000Z`,
    periodEnd: `${date}T23:59:59.999Z`,
    createdAt: new Date().toISOString(),
  }, db);
  logger.info(`[daily-merkle] Tree head v2 gerado para ${date} com anchorStatus=${treeHead.anchorStatus}`);
  return treeHead;
}

// #959: the ONLY caller of createTreeHead used to be scheduleNextRun's bare
// setTimeout to 02:30 UTC, inside the worker process. Nothing could reach the
// sealing path on demand -- not a test, not an operator, not an e2e spec -- and
// runOnce() seals YESTERDAY, so even firing it reaches a date the current run
// has no events for. This is the reachable entry point: it takes an ALREADY-OPEN
// db and an explicit date, so an HTTP handler can call it without runOnce's
// connectDB/closeConnection lifecycle tearing down the shared app connection,
// and without runOnce's catch-all swallowing the error the caller needs to see.
//
// Returns null (rather than throwing) when the date has no valid Merkle result;
// callers log their own message, which is why the two warns below still differ.
async function anchorDate(db, date) {
  const result = await integrityService.buildMerkleForDate(date, db, { persistMissing: true });
  if (!isValidMerkleResult(result)) return null;

  await auditRootService.saveDailyRoot({ date, root: result.root, treeSize: result.leaves.length, db });
  return anchorV2ForDate(db, date, result);
}

function scheduleNextRun() {
  const delay = msUntilNextRun();
  logger.info(`[daily-merkle] Próxima execução em ${Math.round(delay / 1000)}s`);
  setTimeout(async () => {
    // runOnce() has its own internal try/catch and never rejects, so no
    // outer catch is needed here — just always reschedule.
    await runOnce();
    scheduleNextRun();
  }, delay + 1000); // slight buffer
}

// Auto-start only when executed directly
if (require.main === module) {
  scheduleNextRun();
}

module.exports = { runOnce, scheduleNextRun, anchorDate };
