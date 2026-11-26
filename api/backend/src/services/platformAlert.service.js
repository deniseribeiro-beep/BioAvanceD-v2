// RNF015 C2 (#1323): the scheduled platform alert check. Each run reads the
// request metrics, the queue depths and the graph-outbox DEAD_LETTER count,
// evaluates the rules in platformAlerts.js and opens or resolves one episode
// per alert key in `platformAlerts`. Platform alerts are no organization's,
// so they stay out of the org-scoped `alerts` collection.
//
// An episode is identified by { alertKey, status: 'active' }; no hysteresis,
// the same as alertLifecycle.service.js: `ok` resolves at once.
//
// The dead-letter count is read fresh on each run. markDeadLetter and
// requeueDeadLetters in neo4jOutbox.service.js move rows into and out of
// DEAD_LETTER; the next run sees their effect. The previous http and queue
// readings are written only by runPlatformAlertCheck.
//
// RNF010 C2 (#1484): the age of the newest successful backupHistory row is
// read fresh on each run and checked against the BackupPolicy's rpoHours.
//
// RNF015 C2 (#1468): the backend's memory and disk in use are read fresh on
// each run (resourceUsage.js) and checked against ALERT_MEMORY_RATIO and
// ALERT_DISK_RATIO.

const logger = require('../utils/logger');
const env = require('../config/env');
const httpMetrics = require('../infrastructure/metrics/httpMetrics');
const queueDepth = require('../infrastructure/metrics/queueDepth');
const resourceUsage = require('../infrastructure/metrics/resourceUsage');
const { evaluateAlerts, windowOf } = require('../infrastructure/metrics/platformAlerts');
const { COLLECTION_NAME: OUTBOX_COLLECTION } = require('./neo4jOutbox.service');
const notificationDispatchService = require('./notificationDispatch.service');
const backupPolicyService = require('./backup-policy.service');

const PLATFORM_ALERTS_COLLECTION = 'platformAlerts';
const DEAD_LETTER_MAX_TIME_MS = 2000;
const EPISODE_MAX_TIME_MS = 2000;
const BACKUP_READ_MAX_TIME_MS = 2000;

const DEFAULT_THRESHOLDS = Object.freeze({
  httpErrorRate: 0.05, httpP95Ms: 2500, queueBacklog: 100, memoryRatio: 0.9, diskRatio: 0.9,
});

let prevTotals = null;
let prevSince = null;
let prevQueues = [];
let lastEvaluation = null;
// The open episode is a findOne then an insertOne, so two runs at once could
// both open one; a run that starts while another is pending does nothing.
let inFlight = false;

// A blank value is unset. A value the predicate refuses falls back to the
// default with a warning, so ALERT_HTTP_ERROR_RATE=2 cannot switch an alert off.
function parseThreshold(name, raw, fallback, accepts) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const value = Number(String(raw).trim());
  if (Number.isFinite(value) && accepts(value)) return value;
  logger.warn(`[PLATFORM_ALERT] ${name} inválido, usando o padrão ${fallback}`);
  return fallback;
}

function thresholdsFrom(env) {
  return {
    httpErrorRate: parseThreshold('ALERT_HTTP_ERROR_RATE', env.ALERT_HTTP_ERROR_RATE,
      DEFAULT_THRESHOLDS.httpErrorRate, (v) => v > 0 && v <= 1),
    httpP95Ms: parseThreshold('ALERT_HTTP_P95_MS', env.ALERT_HTTP_P95_MS,
      DEFAULT_THRESHOLDS.httpP95Ms, (v) => v > 0),
    queueBacklog: parseThreshold('ALERT_QUEUE_BACKLOG', env.ALERT_QUEUE_BACKLOG,
      DEFAULT_THRESHOLDS.queueBacklog, (v) => v >= 0),
    memoryRatio: parseThreshold('ALERT_MEMORY_RATIO', env.ALERT_MEMORY_RATIO,
      DEFAULT_THRESHOLDS.memoryRatio, (v) => v > 0 && v <= 1),
    diskRatio: parseThreshold('ALERT_DISK_RATIO', env.ALERT_DISK_RATIO,
      DEFAULT_THRESHOLDS.diskRatio, (v) => v > 0 && v <= 1),
  };
}

async function readDeadLetter(db) {
  try {
    return await db.collection(OUTBOX_COLLECTION).countDocuments(
      { status: 'DEAD_LETTER' },
      { maxTimeMS: DEAD_LETTER_MAX_TIME_MS }
    );
  } catch {
    logger.warn('[PLATFORM_ALERT] contagem de DEAD_LETTER indisponível');
    return null;
  }
}

// Null when any part of the reading fails, so the BACKUP_RPO row is unknown.
async function readBackupRpo(db, now) {
  try {
    const history = db.collection('backupHistory');
    const newest = await history.findOne(
      { status: 'success' },
      { sort: { completedAt: -1 }, projection: { completedAt: 1 }, maxTimeMS: BACKUP_READ_MAX_TIME_MS }
    );
    const anyRun = newest
      ? true
      : !!(await history.findOne({}, { projection: { _id: 1 }, maxTimeMS: BACKUP_READ_MAX_TIME_MS }));
    const policy = await backupPolicyService.getPolicy(db);
    const rpoHours = Number(policy?.rpoHours);
    let ageHours = null;
    if (newest) {
      const completedAt = new Date(newest.completedAt);
      if (Number.isNaN(completedAt.getTime())) return null;
      ageHours = (now.getTime() - completedAt.getTime()) / 3600000;
    }
    return { ageHours, anyRun, rpoHours };
  } catch {
    logger.warn('[PLATFORM_ALERT] leitura do RPO de backup indisponível');
    return null;
  }
}

async function applyEpisode(db, alerts, result, now) {
  if (result.state === 'unknown') return;
  const active = await alerts.findOne(
    { alertKey: result.key, status: 'active' },
    { maxTimeMS: EPISODE_MAX_TIME_MS }
  );

  if (result.state === 'ok') {
    if (!active) return;
    await alerts.updateOne(
      { _id: active._id, status: 'active' },
      { $set: { status: 'resolved', resolvedAt: now } }
    );
    logger.info(`[PLATFORM_ALERT] ${result.code} ${result.subject} resolvido`);
    return;
  }

  if (active) {
    await alerts.updateOne({ _id: active._id }, { $set: { value: result.value, lastSeenAt: now } });
    return;
  }

  const inserted = await alerts.insertOne({
    alertKey: result.key,
    code: result.code,
    subject: result.subject,
    severity: result.severity,
    status: 'active',
    value: result.value,
    threshold: result.threshold,
    openedAt: now,
    lastSeenAt: now,
  });
  logger.error(`[PLATFORM_ALERT] ${result.code} ${result.subject} valor=${result.value} limite=${result.threshold}`);
  // Fire-and-forget, as temperature.service.js: a missing NotificationRule
  // for 'platform_alert' never blocks the episode being recorded.
  void notificationDispatchService.dispatchNotification(db, {
    eventType: 'platform_alert',
    sourceEventType: 'PlatformAlert',
    sourceEventId: inserted && inserted.insertedId,
    payload: {
      code: result.code,
      subject: result.subject,
      severity: result.severity,
      value: result.value,
      threshold: result.threshold,
    },
  }).catch((error) => {
    logger.error('[NOTIFICATION_DISPATCH] Falha ao disparar notificação de alerta da plataforma:', error.message || error);
  });
}

// Resolves to the results, or to null when another run is still pending.
async function runPlatformAlertCheck(db, deps = {}) {
  if (inFlight) {
    logger.warn('[PLATFORM_ALERT] verificação anterior ainda em andamento, execução ignorada');
    return null;
  }
  inFlight = true;
  try {
    return await evaluateAndApply(db, deps);
  } finally {
    inFlight = false;
  }
}

async function evaluateAndApply(db, deps) {
  const snapshot = deps.snapshot || httpMetrics.snapshot;
  const readQueues = deps.readQueues || (() => queueDepth.readQueueDepths(queueDepth.inputsFrom()));
  const readResources = deps.readResources || (() => resourceUsage.readResourceUsage());

  const now = new Date();
  const http = snapshot();
  const queues = await readQueues();
  const deadLetter = await readDeadLetter(db);
  const backup = await readBackupRpo(db, now);
  const resources = await readResources();

  const results = evaluateAlerts({
    httpWindow: windowOf(prevTotals, prevSince, http.totals, http.since),
    queues,
    prevQueues,
    deadLetter,
    backup,
    resources,
    thresholds: thresholdsFrom(deps.env || env),
  });

  const alerts = db.collection(PLATFORM_ALERTS_COLLECTION);
  for (const result of results) {
    try {
      await applyEpisode(db, alerts, result, now);
    } catch (error) {
      logger.error(`[PLATFORM_ALERT] falha ao gravar o episódio ${result.key}:`, error.message);
    }
  }

  prevTotals = http.totals;
  prevSince = http.since;
  // A queue read as unavailable keeps its last `up` reading for QUEUE_FAILED.
  const byName = new Map(prevQueues.map((q) => [q.name, q]));
  for (const queue of queues) {
    if (queue.status === 'up') byName.set(queue.name, queue);
    else if (queue.status === 'not_initialized') byName.delete(queue.name);
  }
  prevQueues = [...byName.values()];
  lastEvaluation = { evaluatedAt: now.toISOString(), results };
  return results;
}

async function getAlertState(db) {
  const active = await db.collection(PLATFORM_ALERTS_COLLECTION)
    .find(
      { status: 'active' },
      {
        projection: {
          _id: 0, alertKey: 1, code: 1, subject: 1, severity: 1, value: 1, threshold: 1, openedAt: 1, lastSeenAt: 1,
        },
      }
    )
    .sort({ openedAt: -1 })
    .limit(100)
    .toArray();
  return {
    evaluatedAt: lastEvaluation ? lastEvaluation.evaluatedAt : null,
    results: lastEvaluation ? lastEvaluation.results : null,
    active,
  };
}

function _resetForTests() {
  prevTotals = null;
  prevSince = null;
  prevQueues = [];
  lastEvaluation = null;
  inFlight = false;
}

module.exports = {
  PLATFORM_ALERTS_COLLECTION,
  DEFAULT_THRESHOLDS,
  thresholdsFrom,
  runPlatformAlertCheck,
  getAlertState,
  _resetForTests,
};
