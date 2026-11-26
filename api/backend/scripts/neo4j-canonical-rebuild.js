require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

// #1550: also removes what the reconcile reports for a rebuild, a donor edge
// Mongo does not hold and an open position Mongo holds nowhere, through the outbox.

const logger = require('../src/utils/logger');
const env = require('../src/config/env');
const { connectDB } = require('../src/database/mongo');
const { connectNeo4j } = require('../src/infrastructure/database/neo4j/connection');
const { Neo4jOutboxService } = require('../src/services/neo4jOutbox.service');
const { Neo4jCanonicalProjectionService } = require('../src/services/neo4jCanonicalProjection.service');
const { runProjectionOnce } = require('../src/workers/neo4jProjection.worker');
const rcsAssessmentService = require('../src/services/rcs-assessment.service');
const { findSamplesDriftedFromGraph, planDriftRepair } = require('./graph-projection-reconcile');

async function seedCanonicalOutbox(db, outbox) {
  const patients = await db.collection('patients').find({}, { projection: { _id: 1, participantId: 1, participantId: 1 } }).toArray();
  const consents = await db.collection('consents').find({}, { projection: { _id: 1, participantId: 1, participantId: 1, status: 1, signedAt: 1, updatedAt: 1 } }).toArray();
  const samples = await db.collection('samples').find({}, { projection: { _id: 1, participantId: 1, specimenId: 1, quality: 1, rcsScore: 1, sealedRcsAssessmentId: 1, updatedAt: 1, parentSpecimenIds: 1 } }).toArray();
  // #525: rcsScore for the QUALITY_ASSESSED event below resolves through the
  // canonical RcsAssessment entity (#383) instead of trusting the legacy
  // embedded Sample.rcsScore copy, same sealed-pin-else-newest precedent
  // MerkleService/specimen-preanalytics.service.js use — falling back to the
  // embedded field only for samples with no recorded snapshot yet.
  // #1371: each stored parent re-emits its LINEAGE_REGISTERED (DERIVED_FROM).
  const currentAssessmentsBySpecimenId = await rcsAssessmentService.getCurrentAssessmentsForSpecimens(db, samples);

  const donorKeyByPatient = new Map();
  for (const patient of patients) {
    const donorKey = String(patient.participantId || patient.participantId || patient._id).trim();
    donorKeyByPatient.set(String(patient.participantId || patient.participantId || patient._id), donorKey);
  }

  for (const consent of consents) {
    const donorKey = String(consent.participantId || consent.participantId || '').trim();
    await outbox.appendEvent(db, {
      eventType: consent.status === 'REVOKED' ? 'CONSENT_REVOKED' : 'CONSENT_UPSERTED',
      aggregateType: 'EthicalConsent',
      aggregateId: String(consent._id),
      payload: {
        ethicalConsentId: String(consent._id),
        donorKey,
        participantId: donorKey,
        status: consent.status || 'ACTIVE',
        signedAt: consent.signedAt || consent.updatedAt || new Date(),
      },
      sourceService: 'neo4j-canonical-rebuild'
    });
  }

  for (const sample of samples) {
    const donorKey = String(sample.participantId || sample.participantId || '').trim();
    const donorIdentity = donorKeyByPatient.get(donorKey) || donorKey;
    // #1225: a sample's event is SPECIMEN_UPSERTED. It used to be a
    // CONSENT_UPSERTED keyed by the sample id, which minted an ACTIVE
    // EthicalConsent per sample and governed the sample by it.
    await outbox.appendEvent(db, {
      eventType: 'SPECIMEN_UPSERTED',
      aggregateType: 'Sample',
      aggregateId: String(sample._id),
      payload: {
        specimenId: String(sample._id),
        participantId: donorIdentity || donorKey || null,
      },
      sourceService: 'neo4j-canonical-rebuild'
    });
    if (sample.quality !== undefined) {
      const currentAssessment = currentAssessmentsBySpecimenId.get(String(sample.specimenId || ''));
      await outbox.appendEvent(db, {
        eventType: 'QUALITY_ASSESSED',
        aggregateType: 'Sample',
        aggregateId: String(sample._id),
        payload: {
          specimenId: String(sample._id),
          qualityAssessmentId: `QA_${String(sample._id)}`,
          status: String(sample.quality || 'UNKNOWN'),
          score: currentAssessment?.rcsScore ?? sample.rcsScore ?? null,
          evaluatedAt: sample.updatedAt || new Date(),
        },
        sourceService: 'neo4j-canonical-rebuild'
      });
    }
  }

  // #1371: a sample stores its parents' specimenIds; the lineage event carries
  // each parent's _id, the key the graph holds a Sample under.
  const sampleIdBySpecimenId = new Map();
  for (const sample of samples) {
    if (sample.specimenId) {
      sampleIdBySpecimenId.set(String(sample.specimenId), String(sample._id));
    }
  }
  for (const sample of samples) {
    const childId = String(sample._id);
    const parentSpecimenIds = [...new Set((Array.isArray(sample.parentSpecimenIds) ? sample.parentSpecimenIds : [])
      .map((parentId) => String(parentId).trim())
      .filter(Boolean))];
    for (const parentSpecimenId of parentSpecimenIds) {
      const parentId = sampleIdBySpecimenId.get(parentSpecimenId);
      if (!parentId || parentId === childId) {
        logger.warn('[GRAPH_OUTBOX] Linhagem ignorada: parentSpecimenId não resolve para outra amostra', { specimenId: childId, parentSpecimenId });
        continue;
      }
      await outbox.appendEvent(db, {
        eventType: 'LINEAGE_REGISTERED',
        aggregateType: 'Sample',
        aggregateId: childId,
        payload: {
          specimenId: childId,
          parentSpecimenId: parentId,
        },
        sourceService: 'neo4j-canonical-rebuild'
      });
    }
  }
}

// #1550: what the reconcile reports for a rebuild has no re-appended event
// that removes it. A donor edge to any donor but the sample's own is
// unlinked, and the open position of a sample Mongo places nowhere is
// released. A drift an event repairs (a missing donor, a wrong but known
// position) is left to the re-appended SPECIMEN_UPSERTED and the reconcile.
async function appendExtraEdgeRemovals(db, outbox, neo4jSession, options = {}) {
  // Taken before the scan reads MongoDB: a sample stored after that read has
  // a validFrom at or after releasedAt, and the release leaves it open.
  const releasedAt = new Date().toISOString();
  const { drifted, donorCheck } = await findSamplesDriftedFromGraph(db, neo4jSession, options);
  let donorUnlinks = 0;
  let positionReleases = 0;
  for (const entry of drifted) {
    if (!planDriftRepair(entry).needsRebuild) continue;
    if (entry.donor) {
      const extraDonorIds = entry.donor.actual.filter((id) => id !== entry.donor.expected);
      for (const donorId of extraDonorIds) {
        await outbox.appendEvent(db, {
          eventType: 'SPECIMEN_DONOR_UNLINKED',
          aggregateType: 'Sample',
          aggregateId: entry.specimenId,
          payload: { specimenId: entry.specimenId, donorId },
          sourceService: 'neo4j-canonical-rebuild'
        });
        donorUnlinks += 1;
      }
    }
    if (entry.position && !entry.position.expected) {
      await outbox.appendEvent(db, {
        eventType: 'STORAGE_POSITION_RELEASED',
        aggregateType: 'Sample',
        aggregateId: entry.specimenId,
        payload: { specimenId: entry.specimenId, releasedAt },
        sourceService: 'neo4j-canonical-rebuild'
      });
      positionReleases += 1;
    }
  }
  return { donorUnlinks, positionReleases, donorCheck };
}

async function main() {
  const db = await connectDB();
  const neo4jDriver = await connectNeo4j();
  const outboxService = new Neo4jOutboxService();
  const projector = new Neo4jCanonicalProjectionService();

  await outboxService.ensureIndexes(db);
  await seedCanonicalOutbox(db, outboxService, projector);

  const neo4jSession = neo4jDriver.session({ database: env.NEO4J_DATABASE || 'neo4j', defaultAccessMode: 'READ' });
  let removals;
  try {
    removals = await appendExtraEdgeRemovals(db, outboxService, neo4jSession);
  } finally {
    await neo4jSession.close();
  }

  let iterations = 0;
  while (iterations < 100) {
    const result = await runProjectionOnce({ db, neo4jDriver, outboxService, projector, once: true, batchSize: 100 });
    iterations += 1;
    if (!result.processed) {
      break;
    }
  }

  logger.info('[GRAPH_OUTBOX] Reconstrução canônica concluída', {
    iterations,
    donorUnlinks: removals.donorUnlinks,
    positionReleases: removals.positionReleases,
    donorCheck: removals.donorCheck,
  });
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('[GRAPH_OUTBOX] Falha na reconstrução canônica:', error.message);
    process.exit(1);
  });
}

module.exports = {
  seedCanonicalOutbox,
  appendExtraEdgeRemovals,
};
