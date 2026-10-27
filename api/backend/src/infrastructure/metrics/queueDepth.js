// RNF015 C1/C2 (#1323): the BullMQ queue depths for GET /api/monitoring/metrics.
// A read creates no queue and no Redis connection, and sends no command to a
// client that is not ready.

const QUEUE_TIMEOUT_MS = 800;

const TIMEOUT = Symbol('timeout');

// A result carries only this fixed vocabulary, never an error message or
// connection detail.
const REASON = Object.freeze({
  TIMEOUT: 'timeout',
  UNREACHABLE: 'unreachable',
  NOT_CONNECTED: 'not_connected',
});

const JOB_STATES = Object.freeze(['waiting', 'delayed', 'active', 'failed', 'paused']);

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT), timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function readOne({ name, queue }, redisClient, timeoutMs) {
  if (!queue) return { name, status: 'not_initialized' };
  // The client queues commands while reconnecting, so a read on a client that
  // is not ready would pile up one per call (as dependencyHealth.probeRedis).
  if (!redisClient || redisClient.status !== 'ready') {
    return { name, status: 'unavailable', reason: REASON.NOT_CONNECTED };
  }
  try {
    const counts = await withTimeout(Promise.resolve().then(() => queue.getJobCounts(...JOB_STATES)), timeoutMs);
    if (counts === TIMEOUT) return { name, status: 'unavailable', reason: REASON.TIMEOUT };
    const picked = {};
    for (const state of JOB_STATES) picked[state] = Number(counts && counts[state]) || 0;
    return { name, status: 'up', counts: picked };
  } catch {
    return { name, status: 'unavailable', reason: REASON.UNREACHABLE };
  }
}

async function readQueueDepths(inputs) {
  const timeoutMs = inputs.timeoutMs || QUEUE_TIMEOUT_MS;
  return Promise.all(inputs.queues.map((q) => readOne(q, inputs.redisClient, timeoutMs)));
}

// Builds the inputs from live state only: it initialises no queue.
function inputsFrom() {
  const queueConfig = require('../../config/queue');
  const notificationService = require('../../services/NotificationService');
  const redisConfig = require('../../config/redis');
  return {
    queues: [
      { name: 'import-queue', queue: typeof queueConfig.peekQueue === 'function' ? queueConfig.peekQueue() : null },
      { name: 'notification-queue', queue: notificationService.notificationQueue || null },
    ],
    redisClient: typeof redisConfig.peekRedisInstance === 'function' ? redisConfig.peekRedisInstance() : null,
    timeoutMs: QUEUE_TIMEOUT_MS,
  };
}

module.exports = { readQueueDepths, inputsFrom, QUEUE_TIMEOUT_MS };
