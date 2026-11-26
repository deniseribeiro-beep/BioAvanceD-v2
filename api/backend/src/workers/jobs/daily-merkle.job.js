const { connectDB } = require('../../database/mongo');
const integrityService = require('../../services/integrityCheckService');
const auditRootService = require('../../services/auditRoot.service');
const auditV2Service = require('../../services/audit-v2.service');
const logger = require('../../utils/logger');
const env = require('../../config/env');
const requestContext = require('../../utils/requestContext');
const jobMetrics = require('../../infrastructure/metrics/jobMetrics');

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

// #989: runOnce's catch below swallows everything, and that swallow is deliberate --
// scheduleNextRun() documents that runOnce() never rejects, so a rethrow would both
// become an unhandled rejection in a detached setTimeout AND skip the reschedule,
// permanently stopping the nightly job. But a signing key that cannot be loaded is a
// CONFIGURATION error, not a transient one: it never clears on its own, it stops every
// audit_roots root and every audit_tree_heads tree head from ever being sealed, and the
// worker's heartbeat healthcheck keeps the container green throughout. It gets its own
// log shape so an operator can tell it apart from "Mongo blipped".
const SIGNING_CONFIG_MARKERS = [
  'AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE',
  'AUDIT_MERKLE_SIGN_KEY_ID',
  'Audit signing key must be provided',
];

function isSigningConfigError(error) {
  if (!error) return false;
  if (SIGNING_CONFIG_MARKERS.some((marker) => String(error.message || error).includes(marker))) return true;
  // Both loaders readFile() the configured path, so an absent or unreadable key file
  // surfaces as a bare ENOENT/EACCES with nothing tying it to audit signing. Match it
  // only against the path actually configured, so an unrelated file error stays generic.
  const keyFile = String(env.AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE || '').trim();
  if (!keyFile) return false;
  return (error.code === 'ENOENT' || error.code === 'EACCES') && String(error.path || '') === keyFile;
}

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
  return requestContext.runAsJob(null, async () => {
    const date = new Date();
    const targetDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - 1)).toISOString().slice(0, 10);

    // No closeConnection() here: connectDB() hands back the process-wide shared
    // client, which the worker's queue handlers hold for the life of the process.
    // Closing it at the end of this nightly run left every later job failing with
    // "Client must be connected before running operations" while the heartbeat
    // healthcheck stayed green. The process that opened the connection owns it.
    // #1468 (RNF015 C1/C3): the run is recorded once, completed or failed,
    // under its own correlation id; with no database there is nothing to
    // record into, and runOnce still never rejects.
    let db = null;
    let outcome = 'completed';
    const t0 = process.hrtime.bigint();
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
      await sealEventChain(db);
      await recoverMissingDates(db, targetDate);
      await auditRootService.processTimestampBacklog({ externalDb: db });
      logger.info(`[daily-merkle] Root salva para ${targetDate} -> ${result.root}`);
    } catch (error) {
      outcome = 'failed';
      if (isSigningConfigError(error)) {
        logger.error(
          '[daily-merkle] ERRO DE CONFIGURACAO: a chave de assinatura de auditoria nao pode ser carregada. '
          + 'Nenhuma raiz diaria (audit_roots) nem tree head (audit_tree_heads) sera selada enquanto isso durar. '
          + 'Verifique AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE, AUDIT_MERKLE_SIGN_KEY_ID e '
          + 'AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON:',
          error.message || error
        );
      } else {
        logger.error('[daily-merkle] Erro ao executar job diário de Merkle:', error.message || error);
      }
    } finally {
      if (db) {
        const durationMs = Number(process.hrtime.bigint() - t0) / 1e6;
        await jobMetrics.recordJob(db, { worker: 'daily-merkle', job: 'run', outcome, durationMs });
      }
    }
  });
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

// #1307: the audit_events chain is sealed as its own signed tree head, at its
// current size, beside the daily roots of `logs` above. Without it no event
// could be verified (verifyAudit looks the head up by the event's own logId).
async function sealEventChain(db) {
  const head = await auditV2Service.sealChain(db);
  if (head) logger.info(`[daily-merkle] Cadeia audit_events selada em treeSize=${head.treeSize} com anchorStatus=${head.anchorStatus}`);
  return head;
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

module.exports = { runOnce, scheduleNextRun, anchorDate, sealEventChain };
