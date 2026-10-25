const env = require('../../config/env');
const { getInfluxConfig } = require('../database/influxdb/connection');

// RNF003 AC3 (#1323): /api/health probes each dependency in parallel, each
// under one timeout, so a hung dependency answers in under 1 s -- below the
// frontend port probe's 1000 ms abort and every compose healthcheck timeout.
const PROBE_TIMEOUT_MS = 800;

const TIMEOUT = Symbol('timeout');

// The route is unauthenticated: a result carries only this fixed vocabulary,
// never an error message, URI, host or token.
const REASON = Object.freeze({
  TIMEOUT: 'timeout',
  UNREACHABLE: 'unreachable',
  NOT_CONNECTED: 'not_connected',
  INCOMPLETE_CONFIGURATION: 'incomplete_configuration',
});

function withTimeout(promise, timeoutMs, onTimeout) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      if (onTimeout) onTimeout();
      resolve(TIMEOUT);
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Runs one probe and turns its outcome into a check. A probe resolves to
// { status, reason? }; a rejection is down/unreachable, the timeout down/timeout.
async function runCheck(critical, timeoutMs, probe) {
  const started = Date.now();
  let outcome;
  try {
    const controller = new AbortController();
    const result = await withTimeout(probe(controller.signal), timeoutMs, () => controller.abort());
    outcome = result === TIMEOUT ? { status: 'down', reason: REASON.TIMEOUT } : result;
  } catch {
    outcome = { status: 'down', reason: REASON.UNREACHABLE };
  }
  const check = { status: outcome.status, critical, latencyMs: Date.now() - started };
  if (outcome.reason) check.reason = outcome.reason;
  return check;
}

async function probeMongo({ db }) {
  if (!db) return { status: 'down', reason: REASON.NOT_CONNECTED };
  await db.command({ ping: 1 });
  return { status: 'up' };
}

async function probeNeo4j({ neo4jDriver, neo4jConfigured }) {
  if (!neo4jDriver) {
    return neo4jConfigured
      ? { status: 'down', reason: REASON.NOT_CONNECTED }
      : { status: 'not_configured' };
  }
  await neo4jDriver.verifyConnectivity();
  return { status: 'up' };
}

async function probeRedis({ redisClient, redisConfigured }) {
  if (!redisClient) {
    return redisConfigured
      ? { status: 'down', reason: REASON.NOT_CONNECTED }
      : { status: 'not_configured' };
  }
  // The client queues commands while reconnecting (maxRetriesPerRequest: null),
  // so a PING to a client that is not ready would pile up one per health call.
  if (redisClient.status !== 'ready') return { status: 'down', reason: REASON.NOT_CONNECTED };
  const reply = await redisClient.ping();
  return reply === 'PONG' ? { status: 'up' } : { status: 'down', reason: REASON.UNREACHABLE };
}

async function probeInflux({ influx, fetchImpl }, signal) {
  if (!influx || !influx.url) return { status: 'not_configured' };
  if (!influx.token || !influx.org || !influx.bucket) {
    return { status: 'down', reason: REASON.INCOMPLETE_CONFIGURATION };
  }
  // InfluxDB 2.x serves /health unauthenticated, so no token is sent.
  const res = await fetchImpl(`${influx.url.replace(/\/+$/, '')}/health`, { signal });
  return res.ok ? { status: 'up' } : { status: 'down', reason: REASON.UNREACHABLE };
}

async function checkDependencies(inputs) {
  const timeoutMs = inputs.timeoutMs || PROBE_TIMEOUT_MS;
  const [mongodb, neo4j, redis, influxdb] = await Promise.all([
    runCheck(true, timeoutMs, () => probeMongo(inputs)),
    runCheck(!!inputs.neo4jCritical, timeoutMs, () => probeNeo4j(inputs)),
    // #977: a down Redis degrades import enqueueing only, never the server.
    runCheck(false, timeoutMs, () => probeRedis(inputs)),
    runCheck(false, timeoutMs, (signal) => probeInflux(inputs, signal)),
  ]);
  const checks = { mongodb, neo4j, redis, influxdb };
  const all = Object.values(checks);
  return {
    critical: all.some((c) => c.critical && c.status === 'down'),
    degraded: all.some((c) => !c.critical && c.status === 'down'),
    checks,
  };
}

// Builds the inputs from live state only: it creates no connection.
function inputsFrom(app) {
  return {
    db: app.locals.db,
    neo4jDriver: app.locals.neo4jDriver || null,
    neo4jConfigured: !!env.NEO4J_URI,
    // The same test as the boot posture in server.js.
    neo4jCritical:
      String(env.LINEAGE_MODE || 'fail-open').toLowerCase() === 'fail-closed' ||
      !!env.NEO4J_REQUIRED,
    redisClient: require('../../config/redis').peekRedisInstance(),
    redisConfigured: !!(env.REDIS_URL || env.REDIS_HOST),
    influx: getInfluxConfig(),
    fetchImpl: globalThis.fetch,
    timeoutMs: PROBE_TIMEOUT_MS,
  };
}

module.exports = { checkDependencies, inputsFrom, PROBE_TIMEOUT_MS };
