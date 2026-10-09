require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

// #1313 (RNF019 C7): finds the aggregates whose projection has stopped and,
// with --repair, requeues the dead letters that hold them. An aggregate
// reported with no dead letter took a version no event holds (a write that
// failed outside a transaction); neo4j:canonical:rebuild repairs that one.
//
//   npm run neo4j:projection:reconcile             report only
//   npm run neo4j:projection:reconcile -- --repair report, then requeue

const logger = require('../src/utils/logger');
const { connectDB } = require('../src/database/mongo');
const { Neo4jOutboxService } = require('../src/services/neo4jOutbox.service');
const { PROJECTOR_NAME } = require('../src/workers/neo4jProjection.worker');

async function reconcile(db, options = {}) {
  const outbox = options.outboxService || new Neo4jOutboxService();
  const projectorName = options.projectorName || PROJECTOR_NAME;
  const unprojected = await outbox.findUnprojectedAggregates(db, projectorName);
  const deadLetterEventIds = unprojected.flatMap((aggregate) => aggregate.deadLetterEventIds);
  const requeued = options.repair ? await outbox.requeueDeadLetters(db, deadLetterEventIds) : 0;
  return {
    projectorName,
    unprojected,
    needsRebuild: unprojected.filter((aggregate) => !aggregate.deadLetterEventIds.length),
    requeued,
  };
}

async function main(argv = process.argv.slice(2)) {
  const db = await connectDB();
  const result = await reconcile(db, { repair: argv.includes('--repair') });
  logger.info('[GRAPH_OUTBOX] Reconciliação da projeção', {
    projectorName: result.projectorName,
    unprojected: result.unprojected.length,
    needsRebuild: result.needsRebuild.length,
    requeued: result.requeued,
  });
  for (const aggregate of result.unprojected) {
    logger.info('[GRAPH_OUTBOX] Agregado sem projeção', aggregate);
  }
  return result;
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error('[GRAPH_OUTBOX] Falha na reconciliação:', error.message);
      process.exit(1);
    });
}

module.exports = {
  reconcile,
};
