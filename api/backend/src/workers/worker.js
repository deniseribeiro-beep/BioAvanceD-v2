/**
 * Worker Principal
 * Inicia o worker de importação
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { initWorker } = require('./import-worker');
const { testConnection } = require('../config/queue');
const logger = require('../utils/logger');

// Register background jobs
try {
  const dailyMerkleJob = require('./jobs/daily-merkle.job');
  if (dailyMerkleJob && typeof dailyMerkleJob.scheduleNextRun === 'function') {
    dailyMerkleJob.scheduleNextRun();
  }
} catch (err) {
  logger.warn('Job daily-merkle não registrado:', err.message || err);
}

/**
 * Inicializa worker com testes automáticos
 */
async function startWorker() {
  try {
    logger.info('[INFO] Iniciando worker de importação...');

    // Testa conexão Redis diretamente (sem precisar da fila)
    logger.info('[INFO] Testando conexão Redis...');
    const { testRedisConnection } = require('../config/redis');
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

