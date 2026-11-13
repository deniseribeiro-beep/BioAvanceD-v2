// RNF015 C2 (#1323): the platform alert rules over the request metrics, the
// BullMQ queue depths and the graph-outbox DEAD_LETTER count, and RNF010 C2
// (#1484): the age of the newest successful backup against the policy's
// rpoHours, and RNF015 C2 (#1468): the backend's memory and disk in use
// against their ratio thresholds. Pure: the readings come in, one row per
// alert key goes out.

const { LATENCY_BUCKETS_MS } = require('./httpMetrics');

const ALERT_CODES = Object.freeze({
  HTTP_ERROR_RATE: 'HTTP_ERROR_RATE',
  HTTP_LATENCY_P95: 'HTTP_LATENCY_P95',
  QUEUE_UNAVAILABLE: 'QUEUE_UNAVAILABLE',
  QUEUE_BACKLOG: 'QUEUE_BACKLOG',
  QUEUE_FAILED: 'QUEUE_FAILED',
  OUTBOX_DEAD_LETTER: 'OUTBOX_DEAD_LETTER',
  BACKUP_RPO: 'BACKUP_RPO',
  RESOURCE_MEMORY: 'RESOURCE_MEMORY',
  RESOURCE_DISK: 'RESOURCE_DISK',
});

// Below this many requests in a window, a rate or a percentile says nothing.
const MIN_REQUESTS = 20;

const BUCKET_KEYS = Object.freeze([...LATENCY_BUCKETS_MS.map(String), '+Inf']);

function windowView(totals) {
  const buckets = {};
  for (const key of BUCKET_KEYS) buckets[key] = Number(totals.latency.buckets[key]) || 0;
  return { requests: totals.requests, errors: totals.errors, buckets };
}

// The counters since the previous reading. A changed `since` (a reset) or a
// counter that went down means the previous reading no longer applies.
function windowOf(prevTotals, prevSince, curTotals, curSince) {
  const cur = windowView(curTotals);
  if (!prevTotals || prevSince !== curSince) return cur;
  const prev = windowView(prevTotals);
  const dropped = cur.requests < prev.requests
    || cur.errors < prev.errors
    || BUCKET_KEYS.some((key) => cur.buckets[key] < prev.buckets[key]);
  if (dropped) return cur;
  const buckets = {};
  for (const key of BUCKET_KEYS) buckets[key] = cur.buckets[key] - prev.buckets[key];
  return { requests: cur.requests - prev.requests, errors: cur.errors - prev.errors, buckets };
}

// httpMetrics.p95UpperBound's rule, over a window's keyed buckets.
function p95OfBuckets(buckets) {
  const count = BUCKET_KEYS.reduce((sum, key) => sum + buckets[key], 0);
  if (count === 0) return null;
  const rank = Math.ceil(count * 0.95);
  let seen = 0;
  for (const key of BUCKET_KEYS) {
    seen += buckets[key];
    if (seen >= rank) return key === '+Inf' ? '+Inf' : Number(key);
  }
  return '+Inf';
}

function row(code, subject, severity, state, value, threshold) {
  return { key: `${code}:${subject}`, code, subject, severity, state, value, threshold };
}

function httpRows(httpWindow, thresholds) {
  // A sparse window is unknown, not ok: an open episode stays open through a
  // quiet night instead of resolving and reopening with a new notification.
  if (httpWindow.requests < MIN_REQUESTS) {
    return [
      row(ALERT_CODES.HTTP_ERROR_RATE, 'http', 'critical', 'unknown', null, thresholds.httpErrorRate),
      row(ALERT_CODES.HTTP_LATENCY_P95, 'http', 'warning', 'unknown', null, thresholds.httpP95Ms),
    ];
  }
  const rate = httpWindow.errors / httpWindow.requests;
  const p95 = p95OfBuckets(httpWindow.buckets);
  const p95Firing = p95 === '+Inf' || p95 > thresholds.httpP95Ms;
  return [
    row(ALERT_CODES.HTTP_ERROR_RATE, 'http', 'critical',
      rate > thresholds.httpErrorRate ? 'firing' : 'ok', rate, thresholds.httpErrorRate),
    row(ALERT_CODES.HTTP_LATENCY_P95, 'http', 'warning',
      p95Firing ? 'firing' : 'ok', p95, thresholds.httpP95Ms),
  ];
}

function queueRows(queue, prevQueue, thresholds) {
  const { name } = queue;
  if (queue.status === 'not_initialized') {
    return [
      row(ALERT_CODES.QUEUE_UNAVAILABLE, name, 'critical', 'unknown', null, null),
      row(ALERT_CODES.QUEUE_BACKLOG, name, 'warning', 'unknown', null, thresholds.queueBacklog),
      row(ALERT_CODES.QUEUE_FAILED, name, 'warning', 'unknown', null, 0),
    ];
  }
  if (queue.status !== 'up') {
    return [
      row(ALERT_CODES.QUEUE_UNAVAILABLE, name, 'critical', 'firing', null, null),
      row(ALERT_CODES.QUEUE_BACKLOG, name, 'warning', 'unknown', null, thresholds.queueBacklog),
      row(ALERT_CODES.QUEUE_FAILED, name, 'warning', 'unknown', null, 0),
    ];
  }
  const counts = queue.counts || {};
  const backlog = (Number(counts.waiting) || 0) + (Number(counts.delayed) || 0);
  // removeOnFail keeps a failed job for days, so only a rise since the
  // previous reading is a new failure.
  let failedRow;
  if (!prevQueue || prevQueue.status !== 'up' || !prevQueue.counts) {
    failedRow = row(ALERT_CODES.QUEUE_FAILED, name, 'warning', 'unknown', null, 0);
  } else {
    const rise = Math.max(0, (Number(counts.failed) || 0) - (Number(prevQueue.counts.failed) || 0));
    failedRow = row(ALERT_CODES.QUEUE_FAILED, name, 'warning', rise > 0 ? 'firing' : 'ok', rise, 0);
  }
  return [
    row(ALERT_CODES.QUEUE_UNAVAILABLE, name, 'critical', 'ok', null, null),
    row(ALERT_CODES.QUEUE_BACKLOG, name, 'warning',
      backlog > thresholds.queueBacklog ? 'firing' : 'ok', backlog, thresholds.queueBacklog),
    failedRow,
  ];
}

function deadLetterRow(deadLetter) {
  if (deadLetter === null || deadLetter === undefined) {
    return row(ALERT_CODES.OUTBOX_DEAD_LETTER, 'graph_projection_outbox', 'critical', 'unknown', null, 0);
  }
  return row(ALERT_CODES.OUTBOX_DEAD_LETTER, 'graph_projection_outbox', 'critical',
    deadLetter > 0 ? 'firing' : 'ok', deadLetter, 0);
}

// RNF010 C2 (#1484): `backup` is { ageHours, anyRun, rpoHours }, ageHours
// null when no backupHistory row has status success. No row at all is a
// fresh install before its first run, unknown; runs with none succeeded fire.
function backupRpoRow(backup) {
  if (!backup || !Number.isFinite(backup.rpoHours) || backup.rpoHours <= 0) {
    return row(ALERT_CODES.BACKUP_RPO, 'backup', 'critical', 'unknown', null, null);
  }
  const { ageHours, rpoHours } = backup;
  if (ageHours === null) {
    return row(ALERT_CODES.BACKUP_RPO, 'backup', 'critical',
      backup.anyRun ? 'firing' : 'unknown', null, rpoHours);
  }
  return row(ALERT_CODES.BACKUP_RPO, 'backup', 'critical',
    ageHours > rpoHours ? 'firing' : 'ok', ageHours, rpoHours);
}

// RNF015 C2 (#1468): `resources` is { memory, disk }, each a ratio in [0, 1]
// or null when unreadable (resourceUsage.js). A missing reading is unknown.
function resourceRow(code, severity, value, threshold) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return row(code, 'backend', severity, 'unknown', null, threshold);
  }
  const rounded = Math.round(value * 10000) / 10000;
  return row(code, 'backend', severity, value > threshold ? 'firing' : 'ok', rounded, threshold);
}

function resourceRows(resources, thresholds) {
  const { memory = null, disk = null } = resources || {};
  return [
    resourceRow(ALERT_CODES.RESOURCE_MEMORY, 'warning', memory, thresholds.memoryRatio),
    resourceRow(ALERT_CODES.RESOURCE_DISK, 'critical', disk, thresholds.diskRatio),
  ];
}

function evaluateAlerts({ httpWindow, queues = [], prevQueues = [], deadLetter, backup, resources, thresholds }) {
  const prevByName = new Map((prevQueues || []).map((q) => [q.name, q]));
  return [
    ...httpRows(httpWindow, thresholds),
    ...queues.flatMap((queue) => queueRows(queue, prevByName.get(queue.name), thresholds)),
    deadLetterRow(deadLetter),
    backupRpoRow(backup),
    ...resourceRows(resources, thresholds),
  ];
}

module.exports = { ALERT_CODES, MIN_REQUESTS, windowOf, evaluateAlerts };
