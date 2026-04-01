const Redis = require('ioredis');
const defaultLogger = require('../../utils/logger');

class Neo4jQuarantineService {
  constructor({ redisClient, redisOptions, queueKey, logger } = {}) {
    this.logger = logger || defaultLogger;
    this.queueKey = queueKey || process.env.NEO4J_QUARANTINE_QUEUE_KEY || 'neo4j:topological:quarantine';
    const nodeEnv = String(process.env.NODE_ENV || 'development').toLowerCase();
    const isLocalEnv = nodeEnv === 'development' || nodeEnv === 'test';
    const redisTlsRaw = String(process.env.REDIS_TLS || '').toLowerCase();
    const redisTlsEnabled = redisTlsRaw === 'true' || redisTlsRaw === '1';
    const shouldUseTls = redisTlsEnabled && !isLocalEnv;
    const redisUrl = String(process.env.REDIS_URL || '').trim();

    const defaultRedisOptions = {
      host: process.env.REDIS_HOST,
      port: Number(process.env.REDIS_PORT || 6379),
      username: process.env.REDIS_USERNAME || 'default',
      password: process.env.REDIS_PASSWORD,
      maxRetriesPerRequest: null,
      enableReadyCheck: false
    };

    if (shouldUseTls) {
      defaultRedisOptions.tls = {};
    }

    if (redisOptions && Object.prototype.hasOwnProperty.call(redisOptions, 'tls') && !shouldUseTls) {
      delete redisOptions.tls;
    }

    const effectiveOptions = redisOptions || defaultRedisOptions;
    this.redis = redisClient || (redisUrl ? new Redis(redisUrl, effectiveOptions) : new Redis(effectiveOptions));
    this.shouldCloseClient = !redisClient;
  }

  async enqueueTopologicalTransaction(transaction, context = {}) {
    if (!transaction || typeof transaction !== 'object') {
      throw new Error('Transação topológica inválida para quarentena');
    }

    const sampleId = transaction.sampleId || transaction.sampleMongoId;
    if (!sampleId) {
      throw new Error('sampleId é obrigatório para quarentena topológica');
    }

    const item = {
      sampleId: String(sampleId),
      transaction,
      context: {
        reason: context.reason || 'neo4j_unavailable_permissive_mode',
        strictMode: context.strictMode === true,
        neo4jError: context.neo4jError || null,
        attempt: Number(context.attempt || 0)
      },
      createdAt: new Date().toISOString()
    };

    try {
      await this.redis.rpush(this.queueKey, JSON.stringify(item));
      this.logger.warn(
        `[SMART-BLOCKING][QUARANTINE] Transação enfileirada. sampleId=${item.sampleId}, reason=${item.context.reason}`
      );
      return { queued: true, queueKey: this.queueKey, item };
    } catch (error) {
      this.logger.error('[SMART-BLOCKING][QUARANTINE] Falha ao enfileirar transação:', error.message || error);
      throw error;
    }
  }

  async close() {
    if (!this.shouldCloseClient || !this.redis) {
      return;
    }

    try {
      await this.redis.quit();
    } catch (error) {
      this.logger.warn('[SMART-BLOCKING][QUARANTINE] Falha ao encerrar cliente Redis:', error.message || error);
    }
  }
}

module.exports = Neo4jQuarantineService;
