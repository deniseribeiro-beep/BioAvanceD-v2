/**
 * Worker Principal
 * Inicia o worker de importação
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const fs = require('fs');
const { initWorker } = require('./import-worker');
const { testConnection } = require('../config/queue');
const { validateEncryptionAndHalt, validateAuditSigningAndWarn, validateRedisOnly } = require('../config/validateEnv');
const logger = require('../utils/logger');

// #992: heartbeat file probed by the container healthcheck (mtime-based).
// Not a new env var -- a module-level constant, per #992's decision to avoid
// tripping the env-declaration architecture test. /tmp is the one path
// writable in every compose variant this runs under (prod is read_only with
// a /tmp tmpfs; dev/test have no read_only at all).
const HEARTBEAT_PATH = '/tmp/worker-heartbeat';
// #979: backoff between Redis connectivity attempts at boot. Constants, not
// env vars, for the same reason as HEARTBEAT_PATH above.
const REDIS_RETRY_BASE_MS = 1000;
const REDIS_RETRY_MAX_MS = 30000;
// #979: client errors that no wait can cure -- bad or missing credentials,
// a wrong-type reply, or a non-Redis service on the port. Any other error
// (ECONNREFUSED, ETIMEDOUT, ENOTFOUND, EAI_AGAIN, a closed connection) is
// retried.
const REDIS_FATAL_ERROR_PATTERN = /^(WRONGPASS|NOAUTH|WRONGTYPE)\b|^Protocol error/;

// #1040: observability-only, matching this file's own fatal-error style
// (logger.error + optional stack line + process.exit(1), same as the catch
// in startWorker() below). The process must still die -- do NOT turn this
// into a swallow/continue path. Three call sites deliberately depend on "an
// unhandled rejection kills the process" staying true:
// src/services/auth.service.js:540, src/services/consent.service.js:911 and
// src/utils/collectionResolver.js:23.
//
// Registered before any other startup work (background jobs, startWorker())
// so a rejection during startup is also caught. Guarded on `process`, not on
// this module, because this file requires ./import-worker directly (line 9
// above), so both files' handler-registration code runs in the SAME worker
// process -- the guard is what keeps that a single registration instead of
// two. server.js and neo4jProjection.worker.js register the same pair in
// their own processes.
if (!process.__BIOAVANCE_1040_PROCESS_HANDLERS_INSTALLED__) {
  process.__BIOAVANCE_1040_PROCESS_HANDLERS_INSTALLED__ = true;

  process.on('unhandledRejection', (reason) => {
    logger.error('[ERROR] [#1040] unhandledRejection não tratada -- encerrando worker:', reason?.message || reason);
    if (reason?.stack) {
      logger.error(`Rastreamento: ${reason.stack}`);
    }
    process.exit(1);
  });

  process.on('uncaughtException', (err) => {
    logger.error('[ERROR] [#1040] uncaughtException -- encerrando worker:', err.message || err);
    if (err?.stack) {
      logger.error(`Rastreamento: ${err.stack}`);
    }
    process.exit(1);
  });
}

// Register background jobs
try {
  const dailyMerkleJob = require('./jobs/daily-merkle.job');
  if (dailyMerkleJob && typeof dailyMerkleJob.scheduleNextRun === 'function') {
    dailyMerkleJob.scheduleNextRun();
  }
} catch (err) {
  logger.warn('Job daily-merkle não registrado:', err.message || err);
}

try {
  const consentExpiryJob = require('./jobs/consent-expiry.job');
  if (consentExpiryJob && typeof consentExpiryJob.scheduleNextRun === 'function') {
    consentExpiryJob.scheduleNextRun();
  }
} catch (err) {
  logger.warn('Job de vencimento do TCLE não registrado:', err.message || err);
}

// #977/#979: deliberate posture. A Redis configuration fault is fatal whether
// or not Redis answers: validateRedisOnly() and getRedisInstance() run before
// the connectivity loop, so an invalid REDIS_URL, a missing production
// REDIS_PASSWORD or a missing REDIS_HOST/REDIS_PORT reaches the catch in
// startWorker() and process.exit(1), as does initRedis failing inside
// initWorker(). So is a client error no wait can cure (WRONGPASS, NOAUTH,
// WRONGTYPE, a protocol error; REDIS_FATAL_ERROR_PATTERN). A connectivity
// loss at boot (testRedisConnection() false) is not: the worker waits for Redis with a
// capped backoff, and since the heartbeat below starts only once Redis
// answers, the heartbeat file stays stale and the container healthcheck
// reports the worker unhealthy meanwhile (#979). The backend likewise keeps
// serving through a down Redis (server.js, the "Iniciar fila (Redis)" block).
/**
 * Inicializa worker com testes automáticos
 */
async function startWorker() {
  try {
    logger.info('[INFO] Iniciando worker de importação...');

    // #1085: mesmo gate de criptografia do backend. Este processo drena a
    // fila de importação, que grava identidade de participante cifrada, então
    // uma chave ausente aqui tem exatamente a mesma consequência que no
    // backend -- e os dois containers compartilham o mesmo .env.production.
    // Aviso em dev/test, fatal em produção; o throw cai no catch abaixo, que
    // já encerra o processo com process.exit(1).
    validateEncryptionAndHalt();

    // #1154: este é o processo que roda daily-merkle.job, então é aqui que a
    // configuração de assinatura importa de fato -- e era aqui que o único
    // sinal existente chegava, até 24h depois do boot, engolido pelo catch de
    // runOnce. Avisa e segue: #989 exige que o job noturno não rejeite.
    // NÃO aguardado de propósito: a checagem é um diagnóstico, não um portão,
    // e aguardá-la empurraria o require tardio de ../config/redis abaixo para
    // fora do tick de carga do módulo -- mudando a ordem do boot, que é
    // exatamente o que a direção 1 promete não mudar. O catch é defensivo:
    // uma rejeição não tratada aqui cairia no handler de #1040 e derrubaria
    // o processo, invertendo a postura desta função.
    validateAuditSigningAndWarn().catch(() => {});

    // Testa conexão Redis diretamente (sem precisar da fila)
    logger.info('[INFO] Testando conexão Redis...');
    const { testRedisConnection, getRedisInstance } = require('../config/redis');
    // #979: a configuration fault throws here and lands in the fatal catch
    // below, whether or not Redis answers: the same validateRedisOnly() call
    // initWorker() makes, then the client itself (no REDIS_HOST/REDIS_URL/
    // REDIS_PORT). testRedisConnection() would swallow either into `false`
    // and the loop would wait forever.
    if (!validateRedisOnly(process.env.NODE_ENV === 'development', true)) {
      throw new Error('Redis não configurado');
    }
    const redisClient = getRedisInstance();
    let lastRedisError = null;
    const recordRedisError = (err) => { lastRedisError = err; };
    redisClient.on('error', recordRedisError);
    let redisAttempt = 0;
    while (!(await testRedisConnection())) {
      // #979: NOAUTH and WRONGTYPE come back as a command reply, never as an
      // 'error' event, and testRedisConnection() swallows its PING's
      // rejection; so ask again. Only on a ready client: on any other status
      // ping() would queue until the connection returns.
      if (redisClient.status === 'ready') {
        await redisClient.ping().catch((err) => { lastRedisError = err; });
      }
      if (lastRedisError && REDIS_FATAL_ERROR_PATTERN.test(String(lastRedisError.message))) {
        redisClient.removeListener('error', recordRedisError);
        throw new Error(`Falha permanente do Redis, não será repetida: ${lastRedisError.message}`);
      }
      redisAttempt += 1;
      const delayMs = Math.min(REDIS_RETRY_BASE_MS * 2 ** (redisAttempt - 1), REDIS_RETRY_MAX_MS);
      logger.warn(`[WARN] Redis indisponível; worker aguardando reconexão (tentativa ${redisAttempt}, próxima em ${delayMs}ms)`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      // #979: a client that disconnect() ended (the local-dev ECONNREFUSED
      // handler in ../config/redis) never retries by itself. Only `end`:
      // on `reconnecting`, connect() would open a second stream beside
      // ioredis's own retry.
      if (redisClient.status === 'end') {
        redisClient.connect().catch(() => {});
      }
    }
    redisClient.removeListener('error', recordRedisError);

    logger.info('[INFO] ✅ Conexão Redis testada com sucesso');

    // Inicializa worker (que também inicializa a fila)
    await initWorker();

    logger.info('[INFO] 🚀 Worker de importação iniciado com sucesso');

    // #992: touch the heartbeat file only after asserting the Redis
    // connection is actually alive, so a zombie event loop can't keep the
    // healthcheck green. .unref() so this timer never keeps the process
    // (or vitest, which loads this module fresh at module scope) alive.
    //
    // A bare PING on the shared singleton, NOT testRedisConnection(): that
    // helper logs '[INFO] Teste de conexão Redis: SUCESSO' on every success
    // (one line per 15s per worker container, forever) and, on its failure
    // path, builds a multi-line diagnostic by parsing REDIS_URL -- which
    // would turn a Redis outage into a log flood at the same cadence. PING
    // is the whole assertion the heartbeat needs; getRedisInstance() is the
    // same memoized client testRedisConnection uses, so this opens no new
    // connection.
    const heartbeatInterval = setInterval(async () => {
      try {
        const pong = await getRedisInstance().ping();
        if (pong === 'PONG') {
          fs.writeFileSync(HEARTBEAT_PATH, String(Date.now()));
        }
      } catch (heartbeatError) {
        logger.warn('[WARN] Falha ao gravar heartbeat do worker:', heartbeatError.message || heartbeatError);
      }
    }, 15000);
    heartbeatInterval.unref();
  } catch (error) {
    logger.error('[ERROR] Erro ao iniciar worker:', error.message);
    if (error.stack) {
      logger.error(`Rastreamento: ${error.stack}`);
    }
    process.exit(1);
  }
}

// Inicializa worker
startWorker();

// #1047: guarded on `process`, not on this module, for the same reason as
// the #1040 pair above -- this file is deleted from require.cache and
// re-required repeatedly within a single vitest process (see
// tests/unit/process-fatal-handlers.1040.test.js and
// tests/unit/worker.entrypoint.test.js), and without a guard each reload
// adds another SIGINT/SIGTERM listener on the one real `process` object
// underneath every reload. Production never sees the duplication this
// guards against (server.js and this file run in separate containers and
// never share a process) -- this is a test-hygiene guard, not a production
// double-registration fix.
if (!process.__BIOAVANCE_1047_WORKER_SIGNAL_HANDLERS_INSTALLED__) {
  process.__BIOAVANCE_1047_WORKER_SIGNAL_HANDLERS_INSTALLED__ = true;

  // Trata encerramento gracioso
  process.on('SIGTERM', async () => {
    logger.info('[INFO] SIGTERM recebido, encerrando worker...');
    const { closeWorker } = require('./import-worker');
    await closeWorker();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    logger.info('[INFO] SIGINT recebido, encerrando worker...');
    const { closeWorker } = require('./import-worker');
    await closeWorker();
    process.exit(0);
  });
}

