const redis = require('../../config/redis');
const logger = require('../../utils/logger');

/**
 * Fila de Quarentena Topológica (Self-Healing com Redis)
 * - Enfileira eventos de linhagem quando Neo4j falha em modo permissivo.
 * - Reprocessa periodicamente até o Neo4j voltar a responder.
 */
class TopologicalQuarantine {
  constructor(options = {}) {
    this.redis = options.redisClient || redis;
    this.queueKey = options.queueKey || process.env.NEO4J_RETRY_QUEUE_KEY || 'neo4j_retry_queue';
    this.retryIntervalMs = Number(options.retryIntervalMs || process.env.NEO4J_RETRY_INTERVAL_MS || 30000);
    this.maxBatchSize = Number(options.maxBatchSize || process.env.NEO4J_RETRY_BATCH_SIZE || 20);
    this.maxAttempts = Number(options.maxAttempts || process.env.NEO4J_RETRY_MAX_ATTEMPTS || 50);
    this.getLineageRepository = options.getLineageRepository;
    this.timer = null;
    this.running = false;
    this.processing = false;
    this.metrics = {
      enqueuedTotal: 0,
      replayAttemptsTotal: 0,
      replaySuccessTotal: 0,
      replayFailureTotal: 0,
      replayDurationMsTotal: 0,
      discardedTotal: 0,
      lastProcessedAt: null,
    };
  }

  async enqueue(payload, context = {}) {
    if (!payload || !payload.sampleId || !payload.eventType) {
      logger.warn('[ISO20387][QUARANTINE] Payload inválido ignorado');
      return false;
    }

    const item = {
      payload,
      reason: context.reason || 'neo4j_unavailable_permissive_mode',
      neo4jError: context.neo4jError || null,
      attempts: Number(context.attempts || 0),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      await this.redis.rpush(this.queueKey, JSON.stringify(item));
      this.metrics.enqueuedTotal += 1;
      logger.warn(`[ISO20387][QUARANTINE] Evento enfileirado para retry: sampleId=${payload.sampleId}, eventType=${payload.eventType}`);
      return true;
    } catch (error) {
      logger.error('[ISO20387][QUARANTINE] Falha ao enfileirar evento topológico:', error.message || error);
      return false;
    }
  }

  async startWorker() {
    if (this.running) return;

    this.running = true;
    this.timer = setInterval(() => {
      void this.processQueue();
    }, this.retryIntervalMs);

    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }

    logger.info(`[ISO20387][QUARANTINE] Worker iniciado. queue=${this.queueKey}, intervalo=${this.retryIntervalMs}ms`);

    void this.processQueue();
  }

  stopWorker() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info('[ISO20387][QUARANTINE] Worker parado');
  }

  async processQueue() {
    if (!this.running || this.processing) {
      return;
    }

    this.processing = true;
    try {
      for (let processed = 0; processed < this.maxBatchSize; processed += 1) {
        const rawItem = await this.redis.lpop(this.queueKey);
        if (!rawItem) {
          break;
        }

        let item = null;
        try {
          item = JSON.parse(rawItem);
        } catch (_) {
          logger.warn('[ISO20387][QUARANTINE] Item corrompido removido da fila');
          continue;
        }

        const ok = await this.reprocessItem(item);
        this.metrics.lastProcessedAt = new Date().toISOString();
        if (!ok) {
          const attempts = Number(item?.attempts || 0) + 1;
          if (attempts >= this.maxAttempts) {
            this.metrics.discardedTotal += 1;
            logger.error(`[ISO20387][QUARANTINE] Item descartado após ${attempts} tentativas: sampleId=${item?.payload?.sampleId || 'unknown'}`);
            continue;
          }

          item.attempts = attempts;
          item.updatedAt = new Date().toISOString();
          await this.redis.rpush(this.queueKey, JSON.stringify(item));
        }
      }
    } catch (error) {
      logger.error('[ISO20387][QUARANTINE] Erro no processamento da fila:', error.message || error);
    } finally {
      this.processing = false;
    }
  }

  async reprocessItem(item) {
    const startedAt = Date.now();
    try {
      if (!this.getLineageRepository || typeof this.getLineageRepository !== 'function') {
        throw new Error('Factory de LineageRepository não configurada');
      }

      const lineageRepository = await this.getLineageRepository();
      if (!lineageRepository) {
        throw new Error('LineageRepository indisponível para retry');
      }

      await lineageRepository.validateBeforePersistence({
        ...item.payload,
        requireEthicalConsent: item?.payload?.requireEthicalConsent !== false
      });

      await lineageRepository.recordCustodyEvent(item.payload);

      this.metrics.replaySuccessTotal += 1;
      logger.info(`[ISO20387][QUARANTINE] Reprocessamento OK: sampleId=${item.payload.sampleId}, eventType=${item.payload.eventType}`);
      return true;
    } catch (error) {
      this.metrics.replayFailureTotal += 1;
      logger.warn(`[ISO20387][QUARANTINE] Retry falhou: ${error.message || error}`);
      return false;
    } finally {
      this.metrics.replayAttemptsTotal += 1;
      this.metrics.replayDurationMsTotal += Date.now() - startedAt;
    }
  }

  async getObservabilityMetrics() {
    let queueDepth = null;

    try {
      if (this.redis && typeof this.redis.llen === 'function') {
        const rawDepth = await this.redis.llen(this.queueKey);
        queueDepth = Number(rawDepth);
      }
    } catch (_) {
      queueDepth = null;
    }

    const replayAttemptsTotal = Number(this.metrics.replayAttemptsTotal || 0);
    const replayDurationMsTotal = Number(this.metrics.replayDurationMsTotal || 0);
    const replayAverageMs = replayAttemptsTotal > 0
      ? Number((replayDurationMsTotal / replayAttemptsTotal).toFixed(2))
      : 0;

    const replaySuccessTotal = Number(this.metrics.replaySuccessTotal || 0);
    const discardedTotal = Number(this.metrics.discardedTotal || 0);
    const terminalOutcomes = replaySuccessTotal + discardedTotal;
    const discardRate = terminalOutcomes > 0
      ? Number(((discardedTotal / terminalOutcomes) * 100).toFixed(2))
      : 0;

    return {
      queue: {
        key: this.queueKey,
        depth: queueDepth,
        enqueuedTotal: Number(this.metrics.enqueuedTotal || 0),
      },
      replay: {
        attemptsTotal: replayAttemptsTotal,
        successTotal: replaySuccessTotal,
        failureTotal: Number(this.metrics.replayFailureTotal || 0),
        averageReplayTimeMs: replayAverageMs,
      },
      discard: {
        total: discardedTotal,
        ratePercent: discardRate,
      },
      lastProcessedAt: this.metrics.lastProcessedAt,
    };
  }
}

module.exports = TopologicalQuarantine;