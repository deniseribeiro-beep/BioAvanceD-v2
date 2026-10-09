require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

// #1313 (RNF019 C7): finds the projections that have stopped or gone
// missing and, with --repair, repairs them through the outbox:
// - an aggregate whose outbox events stopped: its dead letters are requeued.
//   One reported with no dead letter took a version no event holds (a write
//   that failed outside a transaction); neo4j:canonical:rebuild repairs it.
// - a Mongo sample with no Sample node in the graph: its SPECIMEN_UPSERTED
//   is appended again. The graph is only read.
//
//   npm run neo4j:projection:reconcile             report only
//   npm run neo4j:projection:reconcile -- --repair report, then requeue

const logger = require('../src/utils/logger');
const env = require('../src/config/env');
const { connectDB } = require('../src/database/mongo');
const { connectNeo4j } = require('../src/infrastructure/database/neo4j/connection');
const { CANONICAL_COLLECTIONS } = require('../src/config/collections');
const { Neo4jOutboxService } = require('../src/services/neo4jOutbox.service');
const { GraphProjectionService } = require('../src/services/graphProjection.service');
const { PROJECTOR_NAME } = require('../src/workers/neo4jProjection.worker');

const SAMPLE_BATCH_SIZE = 500;

// The graph side: a Mongo sample with no Sample node never reached the
// graph, whatever the outbox says. The graph is only read here; the repair
// appends the sample's SPECIMEN_UPSERTED to the outbox, as its create does.
async function findSamplesMissingFromGraph(db, neo4jSession) {
  const missing = [];
  const cursor = db.collection(CANONICAL_COLLECTIONS.samples).find({}, { projection: { _id: 1, participantId: 1 } });
  let batch = [];
  const flush = async () => {
    if (!batch.length) return;
    const ids = batch.map((sample) => String(sample._id));
    const result = await neo4jSession.run('MATCH (s:Sample) WHERE s.id IN $ids RETURN s.id AS id', { ids });
    const present = new Set(result.records.map((record) => record.get('id')));
    missing.push(...batch.filter((sample) => !present.has(String(sample._id))));
    batch = [];
  };
  for await (const sample of cursor) {
    batch.push(sample);
    if (batch.length >= SAMPLE_BATCH_SIZE) await flush();
  }
  await flush();
  return missing.map((sample) => ({
    specimenId: String(sample._id),
    participantId: sample.participantId ? String(sample.participantId) : null,
  }));
}

async function reconcile(db, options = {}) {
  const outbox = options.outboxService || new Neo4jOutboxService();
  const projectorName = options.projectorName || PROJECTOR_NAME;
  const unprojected = await outbox.findUnprojectedAggregates(db, projectorName);
  const deadLetterEventIds = unprojected.flatMap((aggregate) => aggregate.deadLetterEventIds);
  const requeued = options.repair ? await outbox.requeueDeadLetters(db, deadLetterEventIds) : 0;

  let samplesMissingFromGraph = [];
  let reappended = 0;
  if (options.neo4jSession) {
    samplesMissingFromGraph = await findSamplesMissingFromGraph(db, options.neo4jSession);
    if (options.repair) {
      const graphProjection = options.graphProjection || new GraphProjectionService({ outbox });
      for (const sample of samplesMissingFromGraph) {
        await graphProjection.appendSpecimenEvent(db, { ...sample, sourceService: 'graph-projection-reconcile' });
        reappended += 1;
      }
    }
  }

  return {
    projectorName,
    unprojected,
    needsRebuild: unprojected.filter((aggregate) => !aggregate.deadLetterEventIds.length),
    requeued,
    samplesMissingFromGraph,
    reappended,
  };
}

async function main(argv = process.argv.slice(2)) {
  const db = await connectDB();
  const neo4jDriver = await connectNeo4j();
  const neo4jSession = neo4jDriver.session({ database: env.NEO4J_DATABASE || 'neo4j', defaultAccessMode: 'READ' });
  try {
    const result = await reconcile(db, { repair: argv.includes('--repair'), neo4jSession });
    logger.info('[GRAPH_OUTBOX] Reconciliação da projeção', {
      projectorName: result.projectorName,
      unprojected: result.unprojected.length,
      needsRebuild: result.needsRebuild.length,
      requeued: result.requeued,
      samplesMissingFromGraph: result.samplesMissingFromGraph.length,
      reappended: result.reappended,
    });
    for (const aggregate of result.unprojected) {
      logger.info('[GRAPH_OUTBOX] Agregado sem projeção', aggregate);
    }
    return result;
  } finally {
    await neo4jSession.close();
  }
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
  findSamplesMissingFromGraph,
};
