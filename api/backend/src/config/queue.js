const { Queue, QueueEvents } = require('bullmq');
const logger = require('../utils/logger');
const redis = require('./redis');
const { validateRedisOnly } = require('./validateEnv');

/**
 * Configuração da Fila de Processamento (BullMQ + Redis)
 * Suporta processamento assíncrono de importações
 */

let redisConnection = null;
let importQueue = null;
let queueEvents = null;

/**
 * Inicializa conexão Redis
 */
function initRedis() {
  if (redisConnection) {
    return redisConnection;
  }

  try {
    // Valida variáveis de ambiente. validateRedisOnly(allowDevelopment=NODE_ENV==='development', true)
    // only ever returns false in development (any other NODE_ENV with an invalid
    // config throws instead) — so the check below only needs !isValid, not a
    // redundant NODE_ENV re-check for a branch that can't otherwise occur.
    const isValid = validateRedisOnly(process.env.NODE_ENV === 'development', true);

    if (!isValid) {
      logger.warn('[WARN] Redis não será inicializado devido a configuração faltante');
      return null;
    }

    // Usa instância Redis do redis.js
    redisConnection = redis;

    return redisConnection;
  } catch (error) {
    logger.error('[ERROR] Erro ao inicializar Redis:', error.message);
    throw error;
  }
}

/**
 * Inicializa fila de importação
 */
function initQueue() {
  if (importQueue) {
    return importQueue;
  }

  // Inicializa Redis
  const connection = initRedis();
  
  // Se Redis não foi inicializado (dev sem config), não cria fila
  if (!connection) {
    logger.warn('[WARN] Fila de importação não será inicializada (Redis não configurado)');
    return null;
  }

  importQueue = new Queue('import-queue', {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: {
        age: 24 * 3600, // Mantém jobs completos por 24 horas
        count: 1000, // Mantém últimos 1000 jobs
      },
      removeOnFail: {
        age: 7 * 24 * 3600, // Mantém jobs falhos por 7 dias
      },
    },
  });

  queueEvents = new QueueEvents('import-queue', { connection });

  queueEvents.on('completed', ({ jobId }) => {
    logger.info(`✅ Job ${jobId} completado`);
  });

  queueEvents.on('failed', ({ jobId, failedReason }) => {
    logger.error(`❌ Job ${jobId} falhou: ${failedReason}`);
  });

  queueEvents.on('progress', ({ jobId, data }) => {
    logger.debug(`📊 Job ${jobId} progresso: ${data}%`);
  });

  queueEvents.on('stalled', ({ jobId }) => {
    logger.warn(`⚠️ Job ${jobId} travado`);
  });

  logger.info('✅ Fila de importação inicializada');

  return importQueue;
}

/**
 * Obtém instância da fila
 */
function getQueue() {
  if (!importQueue) {
    return initQueue();
  }
  return importQueue;
}

/**
 * Obtém eventos da fila
 */
function getQueueEvents() {
  if (!queueEvents) {
    initQueue();
  }
  return queueEvents;
}

/**
 * Fecha conexões
 */
async function closeConnections() {
  try {
    if (queueEvents) {
      await queueEvents.close();
      queueEvents = null;
    }
    if (importQueue) {
      await importQueue.close();
      importQueue = null;
    }
    if (redisConnection) {
      const { closeRedisConnection } = require('./redis');
      await closeRedisConnection();
      redisConnection = null;
    }
    logger.info('[INFO] Conexões Redis fechadas');
  } catch (error) {
    logger.error('[ERROR] Erro ao fechar conexões Redis:', error.message);
  }
}

/**
 * Testa conexão Redis e fila
 */
async function testConnection() {
  try {
    // Testa conexão Redis primeiro (sem precisar da fila)
    const { testRedisConnection } = require('./redis');
    const redisTest = await testRedisConnection();
    if (!redisTest) {
      throw new Error('Teste de conexão Redis falhou');
    }

    // Se a fila não foi inicializada, inicializa agora
    if (!importQueue) {
      initQueue();
    }

    // Aguarda um pouco para a fila estar pronta
    await new Promise(resolve => setTimeout(resolve, 500));

    // Testa disponibilidade da fila sem enfileirar job de teste
    // (evita falhas no worker por payload incompleto)
    if (importQueue) {
      await importQueue.getJobCounts('waiting', 'active', 'completed', 'failed');
      logger.info('[INFO] Teste de conexão Redis e fila: SUCESSO');
    } else {
      logger.warn('[WARN] Fila não disponível, mas Redis está funcionando');
    }

    return true;
  } catch (error) {
    logger.error('[ERROR] Teste de conexão Redis e fila falhou:', error.message);
    return false;
  }
}

module.exports = {
  initRedis,
  initQueue,
  getQueue,
  getQueueEvents,
  closeConnections,
  testConnection,
};

