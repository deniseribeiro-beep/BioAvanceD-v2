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

// #1313 (V2E-0605): the projector a GraphProjectionCheckpoint names.
const PROJECTOR_NAME = 'neo4j-canonical-projection';

// #1040: observability-only, matching this file's own fatal-error style
// (logger.error + process.exit(1), same as the require.main block's
// runProjectionWorker().catch() below). The process must still die -- do NOT
// turn this into a swallow/continue path. Three call sites deliberately
// depend on "an unhandled rejection kills the process" staying true:
// src/services/auth.service.js:540, src/services/consent.service.js:911 and
// src/utils/collectionResolver.js:23.
//
// Registered before any other startup work in this module. Guarded on
// `process`, not on this module, since server.js and the other two worker
// entrypoints register the same pair of handlers -- the guard keeps a single
// registration if any of them ever end up sharing a process (as worker.js
// and import-worker.js already do).
if (!process.__BIOAVANCE_1040_PROCESS_HANDLERS_INSTALLED__) {
  process.__BIOAVANCE_1040_PROCESS_HANDLERS_INSTALLED__ = true;

  process.on('unhandledRejection', (reason) => {
    logger.error('[GRAPH_OUTBOX] [#1040] unhandledRejection não tratada -- encerrando worker:', reason?.message || reason);
    process.exit(1);
  });

  process.on('uncaughtException', (err) => {
    logger.error('[GRAPH_OUTBOX] [#1040] uncaughtException -- encerrando worker:', err?.message || err);
    process.exit(1);
  });
}

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
    return { processed: 0, projected: 0, failed: 0, skipped: 0, deferred: 0 };
  }

  let projected = 0;
  let failed = 0;
  let skipped = 0;
  let deferred = 0;
  const session = neo4jDriver.session({ database: env.NEO4J_DATABASE || 'neo4j' });

  try {
    for (const event of events) {
      // #1313 (RF023 AC4, RNF019 C3/C4): a versioned event is applied in its
      // aggregate's version order, once per projector. Events appended
      // before the versioned contract carry no aggregateVersion and are
      // applied as they come.
      const versioned = Number.isInteger(event.aggregateVersion);
      try {
        if (versioned) {
          const checkpoint = await outboxService.getCheckpoint(
            db,
            PROJECTOR_NAME,
            Neo4jOutboxService.partitionKeyOf(event)
          );
          if (checkpoint && Number(checkpoint.lastAggregateVersion) >= event.aggregateVersion) {
            await outboxService.markProjected(db, event.eventId);
            skipped += 1;
            continue;
          }
          const blocker = await outboxService.findEarlierUnprojectedVersion(db, event);
          if (blocker) {
            await outboxService.markDeferred(db, event.eventId, {
              blockedByDeadLetter: blocker.status === 'DEAD_LETTER',
            });
            deferred += 1;
            continue;
          }
        }
        await projector.applyEvent(session, event);
        // The checkpoint before the mark: a crash between them leaves an
        // event the next lease skips, not one it applies twice.
        if (versioned) {
          await outboxService.recordCheckpoint(db, PROJECTOR_NAME, event);
        }
        await outboxService.markProjected(db, event.eventId);
        projected += 1;
      } catch (error) {
        failed += 1;
        // #1501: leaseNextBatch already counted this try in event.attempts.
        const nextAttempts = Number(event.attempts || 0);
        if (nextAttempts >= maxAttempts) {
          await outboxService.markDeadLetter(db, event.eventId, error);
          // #1313 (RNF019 C5/C7): a dead letter holds its aggregate's later
          // versions until it is repaired (scripts/graph-projection-reconcile.js),
          // so it is logged as an error, not a warning.
          logger.error('[GRAPH_OUTBOX] DEAD_LETTER: evento parou após o limite de tentativas', {
            eventId: event.eventId,
            eventType: event.eventType,
            aggregateType: event.aggregateType,
            aggregateId: event.aggregateId,
            aggregateVersion: event.aggregateVersion ?? null,
            attempts: nextAttempts,
            error: String(error?.message || error),
          });
        } else {
          await outboxService.markRetrying(db, event.eventId, error, { attempts: nextAttempts });
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
    skipped,
    deferred,
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
  PROJECTOR_NAME,
};
