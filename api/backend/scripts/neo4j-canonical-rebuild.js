require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const logger = require('../src/utils/logger');
const { connectDB } = require('../src/database/mongo');
const { connectNeo4j } = require('../src/infrastructure/database/neo4j/connection');
const { Neo4jOutboxService } = require('../src/services/neo4jOutbox.service');
const { GraphProjectionService } = require('../src/services/graphProjection.service');
const { Neo4jCanonicalProjectionV2Service } = require('../src/services/neo4jCanonicalProjectionV2.service');
const { runProjectionOnce } = require('../src/workers/neo4jProjection.worker');
const rcsAssessmentService = require('../src/services/rcs-assessment.service');

function normalizeText(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function canonicalConsentStatus(consent) {
  const state = normalizeText(consent?.currentStateDerived).toLowerCase();
  if (state === 'active') return 'ACTIVE';
  if (state === 'revoked') return 'REVOKED';
  const consentId = normalizeText(consent?.consentId || consent?._id) || '<unknown>';
  throw new Error(`[GRAPH_OUTBOX] Consent ${consentId} sem currentStateDerived canônico ativo/revogado`);
}

function canonicalSpecimenId(sample) {
  return normalizeText(sample?.specimenId || sample?._id);
}

async function seedCanonicalOutbox(db, outbox) {
  const consents = await db.collection('consents').find({}, {
    projection: {
      _id: 1,
      consentId: 1,
      participantId: 1,
      currentStateDerived: 1,
      templateVersionId: 1,
      effectivePeriod: 1,
      createdAt: 1,
      updatedAt: 1,
    }
  }).toArray();
  const samples = await db.collection('samples').find({}, {
    projection: {
      _id: 1,
      participantId: 1,
      specimenId: 1,
      parentSpecimenIds: 1,
      barcode: 1,
      specimenStatus: 1,
      quality: 1,
      rcsScore: 1,
      sealedRcsAssessmentId: 1,
      updatedAt: 1,
    }
  }).toArray();

  // #525: rcsScore for the QUALITY_ASSESSED event below resolves through the
  // canonical RcsAssessment entity (#383) instead of trusting the legacy
  // embedded Sample.rcsScore copy, same sealed-pin-else-newest precedent
  // MerkleService/specimen-preanalytics.service.js use — falling back to the
  // embedded field only for samples with no recorded snapshot yet.
  const currentAssessmentsBySpecimenId = await rcsAssessmentService.getCurrentAssessmentsForSpecimens(db, samples);
  const graphProjectionService = new GraphProjectionService({ outbox });

  // #1026: consent projection is participant-scoped in v2. A Consent has no
  // specimenId authority; the V2 projector derives GOVERNED_BY by traversing
  // Donor-[:DONATED]->Specimen. Rebuild therefore emits exactly the same
  // consent event contract as runtime and refuses to invent ACTIVE when the
  // normalized canonical state is absent.
  for (const consent of consents) {
    const consentId = normalizeText(consent.consentId || consent._id);
    const participantId = normalizeText(consent.participantId);
    if (!consentId || !participantId) {
      throw new Error('[GRAPH_OUTBOX] Consent canônico sem consentId/participantId durante rebuild');
    }
    const status = canonicalConsentStatus(consent);
    await graphProjectionService.appendConsentEvent(db, {
      participantId,
      ethicalConsentId: consentId,
      consentTemplateId: normalizeText(consent.templateVersionId) || null,
      status,
      signedAt: consent.effectivePeriod?.start || consent.createdAt || consent.updatedAt || new Date(),
      revokedAt: status === 'REVOKED' ? (consent.updatedAt || new Date()) : null,
      sourceService: 'neo4j-canonical-rebuild'
    });
  }

  // #1026 / RF023 v2: specimens are rebuilt through SPECIMEN_UPSERTED, never
  // by fabricating a CONSENT_UPSERTED event keyed by a sample. This makes the
  // rebuild use the same donor/specimen/consent semantics as normal runtime.
  for (const sample of samples) {
    const specimenId = canonicalSpecimenId(sample);
    if (!specimenId) {
      throw new Error('[GRAPH_OUTBOX] Sample canônico sem specimenId/_id durante rebuild');
    }

    await graphProjectionService.appendSpecimenEvent(db, {
      specimenId,
      participantId: normalizeText(sample.participantId) || null,
      parentSpecimenIds: Array.isArray(sample.parentSpecimenIds) ? sample.parentSpecimenIds : [],
      barcode: sample.barcode || null,
      specimenStatus: sample.specimenStatus || null,
      sourceService: 'neo4j-canonical-rebuild'
    });

    if (sample.quality !== undefined) {
      const currentAssessment = currentAssessmentsBySpecimenId.get(specimenId);
      await graphProjectionService.appendQualityEvent(db, {
        specimenId,
        qualityAssessmentId: `QA_${specimenId}`,
        status: String(sample.quality || 'UNKNOWN'),
        score: currentAssessment?.rcsScore ?? sample.rcsScore ?? null,
        evaluatedAt: sample.updatedAt || new Date(),
        sourceService: 'neo4j-canonical-rebuild'
      });
    }
  }
}

async function main() {
  const db = await connectDB();
  const neo4jDriver = await connectNeo4j();
  const outboxService = new Neo4jOutboxService();
  const projector = new Neo4jCanonicalProjectionV2Service();

  await outboxService.ensureIndexes(db);
  await seedCanonicalOutbox(db, outboxService);

  let iterations = 0;
  while (iterations < 100) {
    const result = await runProjectionOnce({ db, neo4jDriver, outboxService, projector, once: true, batchSize: 100 });
    iterations += 1;
    if (!result.processed) {
      break;
    }
  }

  logger.info('[GRAPH_OUTBOX] Reconstrução canônica v2 concluída', { iterations });
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('[GRAPH_OUTBOX] Falha na reconstrução canônica:', error.message);
    process.exit(1);
  });
}

module.exports = {
  seedCanonicalOutbox,
  canonicalConsentStatus,
  canonicalSpecimenId,
};
