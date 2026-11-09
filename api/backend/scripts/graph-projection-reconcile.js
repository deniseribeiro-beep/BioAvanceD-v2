require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

// #1313 (RNF019 C7): finds the projections that have stopped or gone
// missing and, with --repair, repairs them through the outbox:
// - an aggregate whose outbox events stopped: its dead letters are requeued.
//   One reported with no dead letter took a version no event holds (a write
//   that failed outside a transaction); neo4j:canonical:rebuild repairs it.
// - a Mongo sample with no Sample node in the graph: its SPECIMEN_UPSERTED
//   is appended again. The graph is only read.
// - a Sample node that drifted from its Mongo aggregate: a donor or an open
//   STORED_AT position that differs. The repair appends the sample's own
//   events again; what no event can remove is reported for
//   neo4j:canonical:rebuild.
//
//   npm run neo4j:projection:reconcile             report only
//   npm run neo4j:projection:reconcile -- --repair report, then requeue
//
// The optional specimenIds scope is the test-support route's (#1502).

const { ObjectId } = require('mongodb');
const logger = require('../src/utils/logger');
const env = require('../src/config/env');
const { connectDB } = require('../src/database/mongo');
const { connectNeo4j } = require('../src/infrastructure/database/neo4j/connection');
const { CANONICAL_COLLECTIONS } = require('../src/config/collections');
const { Neo4jOutboxService } = require('../src/services/neo4jOutbox.service');
const { GraphProjectionService } = require('../src/services/graphProjection.service');
const { Neo4jCanonicalProjectionService } = require('../src/services/neo4jCanonicalProjection.service');
const { PROJECTOR_NAME } = require('../src/workers/neo4jProjection.worker');
const { legacyPositionCode, splitPositionId } = require('../src/services/legacyPlacementChain.service');

const SAMPLE_BATCH_SIZE = 500;

// No scope reads every sample. A scope matches each id as written and, for
// a 24-hex id, as the ObjectId a sample's _id is stored as.
function sampleScopeFilter(specimenIds) {
  if (!Array.isArray(specimenIds)) return {};
  const keys = specimenIds.flatMap((id) => (
    ObjectId.isValid(id) && String(new ObjectId(id)) === id ? [id, new ObjectId(id)] : [id]
  ));
  return { _id: { $in: keys } };
}

// The graph side: a Mongo sample with no Sample node never reached the
// graph, whatever the outbox says. The graph is only read here; the repair
// appends the sample's SPECIMEN_UPSERTED to the outbox, as its create does.
async function findSamplesMissingFromGraph(db, neo4jSession, options = {}) {
  const missing = [];
  const cursor = db.collection(CANONICAL_COLLECTIONS.samples).find(sampleScopeFilter(options.specimenIds), { projection: { _id: 1, participantId: 1 } });
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

const DRIFT_CYPHER = `
  MATCH (s:Sample) WHERE s.id IN $ids
  OPTIONAL MATCH (d:Donor)-[:DONATED]->(s)
  WITH s, collect(DISTINCT d.id) AS donorIds
  OPTIONAL MATCH (s)-[r:STORED_AT]->(p:StoragePosition) WHERE r.validTo IS NULL
  RETURN s.id AS id, donorIds, collect(DISTINCT p.boxId + '/' + p.position) AS openPositions
`;

// The graph side, a node that exists but has drifted from its Mongo
// aggregate. The projection writes two facts about a sample: its donor
// (Donor-[:DONATED]->Sample, the participant pseudonymized) and its current
// position (the open STORED_AT edge). Mongo's truth for the position is the
// normalized chain first (#1314): the specimen's open
// SpecimenContainerAssignment, then its container's open
// ContainerPositionAssignment, read as `<storageRackId>/<legacy code>`. A
// specimen the chain does not place falls back to its open StorageAssignment.
// A sample with no node is findSamplesMissingFromGraph's, not this check's.
async function findSamplesDriftedFromGraph(db, neo4jSession, options = {}) {
  const pseudonymize = options.pseudonymizeDonorId
    || ((participantId) => new Neo4jCanonicalProjectionService().pseudonymizeDonorId(participantId));
  const drifted = [];
  let donorCheck = 'ran';
  const expectedDonor = (participantId) => {
    if (!participantId || donorCheck === 'skipped') return undefined;
    try {
      return pseudonymize(String(participantId));
    } catch (error) {
      // No pseudonymization salt: the projector cannot write a donor either.
      donorCheck = 'skipped';
      return undefined;
    }
  };

  const cursor = db.collection(CANONICAL_COLLECTIONS.samples).find(sampleScopeFilter(options.specimenIds), { projection: { _id: 1, participantId: 1, specimenId: 1 } });
  let batch = [];
  const flush = async () => {
    if (!batch.length) return;
    const ids = batch.map((sample) => String(sample._id));
    // #1220: an open StorageAssignment is keyed by the canonical specimenId
    // or, on legacy rows, by the sample's _id. Both map back to the _id the
    // graph is keyed on; where a sample has both, the canonical row wins.
    const keys = batch.flatMap((sample) => [String(sample._id), sample.specimenId].filter(Boolean));
    const sampleIdByKey = new Map();
    const canonicalKeys = new Set();
    for (const sample of batch) {
      const id = String(sample._id);
      for (const key of [id, sample.specimenId].filter(Boolean)) sampleIdByKey.set(String(key), id);
      if (sample.specimenId) canonicalKeys.add(String(sample.specimenId));
    }
    const openAssignments = await db.collection('storageAssignments')
      .find({ specimenId: { $in: keys }, removedAt: null }, { projection: { specimenId: 1, boxId: 1, positionCode: 1 } })
      .toArray();
    const expectedPosition = new Map();
    for (const a of openAssignments) {
      const key = String(a.specimenId);
      const id = sampleIdByKey.get(key);
      if (!id || (expectedPosition.has(id) && !canonicalKeys.has(key))) continue;
      expectedPosition.set(id, `${a.boxId}/${a.positionCode}`);
    }
    // #1314: the chain, keyed by the business specimenId, wins over any
    // legacy row for the same sample.
    const specimenIds = batch.map((sample) => sample.specimenId).filter(Boolean).map(String);
    const loads = specimenIds.length
      ? await db.collection(CANONICAL_COLLECTIONS.specimenContainerAssignments)
        .find({ specimenId: { $in: specimenIds }, assignmentStatus: 'active' }, { projection: { specimenId: 1, containerId: 1 } })
        .toArray()
      : [];
    const placements = loads.length
      ? await db.collection(CANONICAL_COLLECTIONS.containerPositionAssignments)
        .find({ containerId: { $in: loads.map((load) => String(load.containerId)) }, assignmentStatus: 'active' }, { projection: { containerId: 1, storagePositionId: 1 } })
        .toArray()
      : [];
    const positionIdByContainer = new Map(placements.map((p) => [String(p.containerId), p.storagePositionId]));
    for (const load of loads) {
      const id = sampleIdByKey.get(String(load.specimenId));
      const storagePositionId = positionIdByContainer.get(String(load.containerId));
      if (!id) continue;
      // #1374: loaded and not placed is released, whatever a stale open
      // legacy row for the same sample still says.
      if (!storagePositionId) {
        expectedPosition.delete(id);
        continue;
      }
      const { storageRackId, code } = splitPositionId(storagePositionId);
      if (storageRackId) expectedPosition.set(id, `${storageRackId}/${legacyPositionCode(code)}`);
    }
    const result = await neo4jSession.run(DRIFT_CYPHER, { ids });
    const nodes = new Map(result.records.map((record) => [record.get('id'), {
      donorIds: record.get('donorIds'),
      openPositions: record.get('openPositions'),
    }]));

    for (const sample of batch) {
      const specimenId = String(sample._id);
      const node = nodes.get(specimenId);
      if (!node) continue;
      const entry = { specimenId, participantId: sample.participantId ? String(sample.participantId) : null };

      const donor = expectedDonor(sample.participantId);
      if (donor !== undefined || !sample.participantId) {
        const expected = donor ?? null;
        const unexpected = node.donorIds.filter((id) => id !== expected);
        if ((expected && !node.donorIds.includes(expected)) || unexpected.length) {
          entry.donor = { expected, actual: node.donorIds };
        }
      }

      const position = expectedPosition.get(specimenId) ?? null;
      const positionMatches = position
        ? node.openPositions.length === 1 && node.openPositions[0] === position
        : node.openPositions.length === 0;
      if (!positionMatches) {
        entry.position = { expected: position, actual: node.openPositions };
      }

      if (entry.donor || entry.position) drifted.push(entry);
    }
    batch = [];
  };
  for await (const sample of cursor) {
    batch.push(sample);
    if (batch.length >= SAMPLE_BATCH_SIZE) await flush();
  }
  await flush();
  return { drifted, donorCheck };
}

// What the outbox can repair: a missing donor edge, by the sample's own
// SPECIMEN_UPSERTED, and a wrong position, by a STORAGE_POSITION_ASSIGNED
// for the Mongo position. That closes the open edge at the repair instant,
// since the graph never knew the true move time. A donor edge that should
// not exist, or an open edge for a sample Mongo holds nowhere, has no event
// that removes it: neo4j:canonical:rebuild does.
function planDriftRepair(entry) {
  const actions = [];
  let needsRebuild = false;
  if (entry.donor) {
    if (entry.donor.expected && !entry.donor.actual.includes(entry.donor.expected)) actions.push('specimen');
    if (entry.donor.actual.some((id) => id !== entry.donor.expected)) needsRebuild = true;
  }
  if (entry.position) {
    if (entry.position.expected) actions.push('position');
    else needsRebuild = true;
  }
  return { actions, needsRebuild };
}

async function reconcile(db, options = {}) {
  const outbox = options.outboxService || new Neo4jOutboxService();
  const projectorName = options.projectorName || PROJECTOR_NAME;
  let unprojected = await outbox.findUnprojectedAggregates(db, projectorName);
  if (Array.isArray(options.specimenIds)) {
    unprojected = unprojected.filter((aggregate) => (
      aggregate.aggregateType === 'Sample' && options.specimenIds.includes(String(aggregate.aggregateId))
    ));
  }
  const deadLetterEventIds = unprojected.flatMap((aggregate) => aggregate.deadLetterEventIds);
  const requeued = options.repair ? await outbox.requeueDeadLetters(db, deadLetterEventIds) : 0;

  let samplesMissingFromGraph = [];
  let reappended = 0;
  let samplesDriftedFromGraph = [];
  let donorCheck = null;
  let driftRepaired = 0;
  const driftNeedsRebuild = [];
  if (options.neo4jSession) {
    samplesMissingFromGraph = await findSamplesMissingFromGraph(db, options.neo4jSession, options);
    ({ drifted: samplesDriftedFromGraph, donorCheck } = await findSamplesDriftedFromGraph(db, options.neo4jSession, options));
    for (const entry of samplesDriftedFromGraph) {
      if (planDriftRepair(entry).needsRebuild) driftNeedsRebuild.push(entry);
    }
    if (options.repair) {
      const graphProjection = options.graphProjection || new GraphProjectionService({ outbox });
      for (const sample of samplesMissingFromGraph) {
        await graphProjection.appendSpecimenEvent(db, { ...sample, sourceService: 'graph-projection-reconcile' });
        reappended += 1;
      }
      for (const entry of samplesDriftedFromGraph) {
        const { actions } = planDriftRepair(entry);
        if (actions.includes('specimen')) {
          await graphProjection.appendSpecimenEvent(db, {
            specimenId: entry.specimenId, participantId: entry.participantId, sourceService: 'graph-projection-reconcile',
          });
        }
        if (actions.includes('position')) {
          const separator = entry.position.expected.lastIndexOf('/');
          await graphProjection.appendStoragePositionEvent(db, {
            specimenId: entry.specimenId,
            boxId: entry.position.expected.slice(0, separator),
            position: entry.position.expected.slice(separator + 1),
            sourceService: 'graph-projection-reconcile',
          });
        }
        if (actions.length) driftRepaired += 1;
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
    samplesDriftedFromGraph,
    donorCheck,
    driftRepaired,
    driftNeedsRebuild,
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
      samplesDriftedFromGraph: result.samplesDriftedFromGraph.length,
      donorCheck: result.donorCheck,
      driftRepaired: result.driftRepaired,
      driftNeedsRebuild: result.driftNeedsRebuild.length,
    });
    for (const aggregate of result.unprojected) {
      logger.info('[GRAPH_OUTBOX] Agregado sem projeção', aggregate);
    }
    for (const entry of result.samplesDriftedFromGraph) {
      logger.info('[GRAPH_OUTBOX] Nó Sample divergente do Mongo', entry);
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
  findSamplesDriftedFromGraph,
  planDriftRepair,
};
