const fs = require('fs');
const { connectDB } = require('../database/mongo');
const { connectNeo4j } = require('../infrastructure/database/neo4j/connection');
const logger = require('../utils/logger');
const env = require('../config/env');
const { Neo4jOutboxService } = require('../services/neo4jOutbox.service');
const { Neo4jCanonicalProjectionService } = require('../services/neo4jCanonicalProjection.service');

// #992: heartbeat file probed by the container healthcheck (mtime-based).
// Not a new env var -- a module-level constant, per #992's decision to avoid
// tripping the env-declaration architecture test. Distinct path from
// worker.js's heartbeat since both containers share the /tmp filesystem
// convention but not a container.
const HEARTBEAT_PATH = '/tmp/neo4j-projection-heartbeat';

async function runProjectionOnce(options = {}) {
  const db = options.db || await connectDB();
  const neo4jDriver = options.neo4jDriver || await connectNeo4j();
  const outboxService = options.outboxService || new Neo4jOutboxService();
  const projector = options.projector || new Neo4jCanonicalProjectionService();
  const maxAttempts = Number(options.maxAttempts || env.GRAPH_OUTBOX_MAX_ATTEMPTS || 8);

  await outboxService.rescheduleStaleProcessing(db, {
    leaseMs: options.leaseMs || env.GRAPH_OUTBOX_LEASE_MS || 5 * 60 * 1000
  });

  const events = await outboxService.leaseNextBatch(db, {
    batchSize: options.batchSize || env.GRAPH_OUTBOX_BATCH_SIZE || 100,
    leaseMs: options.leaseMs || env.GRAPH_OUTBOX_LEASE_MS || 5 * 60 * 1000,
    maxAttempts,
  });

  if (!events.length) {
    return { processed: 0, projected: 0, failed: 0 };
  }

  let projected = 0;
  let failed = 0;
  const session = neo4jDriver.session({ database: env.NEO4J_DATABASE || 'neo4j' });

  try {
    for (const event of events) {
      try {
        await projector.applyEvent(session, event);
        await outboxService.markProjected(db, event.eventId);
        projected += 1;
      } catch (error) {
        failed += 1;
        const nextAttempts = Number(event.attempts || 0) + 1;
        if (nextAttempts >= maxAttempts) {
          await outboxService.markDeadLetter(db, event.eventId, error);
        } else {
          await outboxService.markRetrying(db, event.eventId, error);
        }
        logger.warn('[GRAPH_OUTBOX] Falha ao projetar evento', {
          eventId: event.eventId,
          eventType: event.eventType,
          aggregateType: event.aggregateType,
          attempts: nextAttempts
        });
      }
    }
  } finally {
    await session.close();
  }

  return {
    processed: events.length,
    projected,
    failed,
  };
}

async function runProjectionWorker(options = {}) {
  const intervalMs = Number(options.intervalMs || env.GRAPH_OUTBOX_RETRY_BACKOFF_MS || 1000);
  const stopAfterOne = options.once === true;
  const shouldStop = typeof options.shouldStop === 'function' ? options.shouldStop : () => false;

  do {
    const result = await runProjectionOnce(options);
    if (options.heartbeatPath) {
      try {
        fs.writeFileSync(options.heartbeatPath, String(Date.now()));
      } catch (heartbeatError) {
        logger.warn('[GRAPH_OUTBOX] Falha ao gravar heartbeat', { error: heartbeatError.message || heartbeatError });
      }
    }
    if (stopAfterOne || shouldStop()) {
      return result;
    }
    if (!result.processed) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  } while (!stopAfterOne && !shouldStop());
}

if (require.main === module) {
  let stopRequested = false;
  const requestStop = (signal) => {
    logger.info(`[GRAPH_OUTBOX] ${signal} recebido, encerrando worker...`);
    stopRequested = true;
  };
  process.on('SIGTERM', () => requestStop('SIGTERM'));
  process.on('SIGINT', () => requestStop('SIGINT'));

  runProjectionWorker({ shouldStop: () => stopRequested, heartbeatPath: HEARTBEAT_PATH })
    .then(() => {
      logger.info('[GRAPH_OUTBOX] Worker finalizado');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('[GRAPH_OUTBOX] Worker falhou:', error.message);
      process.exit(1);
    });
}

module.exports = {
  runProjectionOnce,
  runProjectionWorker,
};
