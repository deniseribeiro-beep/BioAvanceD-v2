/**
 * Worker Principal
 * Inicia o worker de importação
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const fs = require('fs');
const { initWorker } = require('./import-worker');
const { testConnection } = require('../config/queue');
const { validateEncryptionAndHalt, validateAuditSigningAndWarn } = require('../config/validateEnv');
const logger = require('../utils/logger');

// #992: heartbeat file probed by the container healthcheck (mtime-based).
// Not a new env var -- a module-level constant, per #992's decision to avoid
// tripping the env-declaration architecture test. /tmp is the one path
// writable in every compose variant this runs under (prod is read_only with
// a /tmp tmpfs; dev/test have no read_only at all).
const HEARTBEAT_PATH = '/tmp/worker-heartbeat';

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

// #977: deliberate posture -- for THIS process any Redis failure is fatal,
// whether it is a configuration policy failure (validateRedisOnly), an
// uninitialised client (initRedis) or plain connectivity
// (testRedisConnection). The worker has no job other than draining BullMQ
// queues, so staying up without Redis would be a "healthy" container that
// processes nothing. Hence the process.exit(1) calls below plus the compose
// restart policy, rather than a degraded mode.
//
// The backend makes the OPPOSITE choice over the same three checks and only
// logs (server.js, the "Iniciar fila (Redis)" block). Read #977 before
// aligning the two ends, and change both or neither.
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
    const redisTest = await testRedisConnection();
    
    if (!redisTest) {
      logger.error('[ERROR] Teste de conexão Redis falhou. Worker não será iniciado.');
      logger.error('[ERROR] Verifique:');
      logger.error('[ERROR]   1. Verifique se REDIS_HOST e REDIS_PORT estão configurados corretamente no .env para ambiente local/dev.');
      process.exit(1);
    }

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

