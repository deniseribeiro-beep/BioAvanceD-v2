require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const logger = require('../src/utils/logger');
const { connectDB } = require('../src/database/mongo');
const { connectNeo4j } = require('../src/infrastructure/database/neo4j/connection');
const { Neo4jOutboxService } = require('../src/services/neo4jOutbox.service');
const { Neo4jCanonicalProjectionService } = require('../src/services/neo4jCanonicalProjection.service');
const { runProjectionOnce } = require('../src/workers/neo4jProjection.worker');

async function seedCanonicalOutbox(db, outbox) {
  const patients = await db.collection('patients').find({}, { projection: { _id: 1, patientID: 1, patientId: 1 } }).toArray();
  const consents = await db.collection('consents').find({}, { projection: { _id: 1, patientId: 1, patientID: 1, status: 1, signedAt: 1, updatedAt: 1 } }).toArray();
  const samples = await db.collection('samples').find({}, { projection: { _id: 1, patientID: 1, sampleID: 1, quality: 1, updatedAt: 1 } }).toArray();

  const donorKeyByPatient = new Map();
  for (const patient of patients) {
    const donorKey = String(patient.patientID || patient.patientId || patient._id).trim();
    donorKeyByPatient.set(String(patient.patientID || patient.patientId || patient._id), donorKey);
  }

  for (const consent of consents) {
    const donorKey = String(consent.patientId || consent.patientID || '').trim();
    await outbox.appendEvent(db, {
      eventType: consent.status === 'REVOKED' ? 'CONSENT_REVOKED' : 'CONSENT_UPSERTED',
      aggregateType: 'EthicalConsent',
      aggregateId: String(consent._id),
      payload: {
        ethicalConsentId: String(consent._id),
        donorKey,
        patientId: donorKey,
        status: consent.status || 'ACTIVE',
        signedAt: consent.signedAt || consent.updatedAt || new Date(),
      },
      sourceService: 'neo4j-canonical-rebuild'
    });
  }

  for (const sample of samples) {
    const donorKey = String(sample.patientID || sample.patientId || '').trim();
    const donorIdentity = donorKeyByPatient.get(donorKey) || donorKey;
    await outbox.appendEvent(db, {
      eventType: 'CONSENT_UPSERTED',
      aggregateType: 'Sample',
      aggregateId: String(sample._id),
      payload: {
        sampleId: String(sample._id),
        donorKey: donorIdentity || donorKey,
      },
      sourceService: 'neo4j-canonical-rebuild'
    });
    if (sample.quality !== undefined) {
      await outbox.appendEvent(db, {
        eventType: 'QUALITY_ASSESSED',
        aggregateType: 'Sample',
        aggregateId: String(sample._id),
        payload: {
          sampleId: String(sample._id),
          qualityAssessmentId: `QA_${String(sample._id)}`,
          status: String(sample.quality || 'UNKNOWN'),
          score: sample.quality_score ?? null,
          evaluatedAt: sample.updatedAt || new Date(),
        },
        sourceService: 'neo4j-canonical-rebuild'
      });
    }
  }
}

async function main() {
  const db = await connectDB();
  const neo4jDriver = await connectNeo4j();
  const outboxService = new Neo4jOutboxService();
  const projector = new Neo4jCanonicalProjectionService();

  await outboxService.ensureIndexes(db);
  await seedCanonicalOutbox(db, outboxService, projector);

  let iterations = 0;
  while (iterations < 100) {
    const result = await runProjectionOnce({ db, neo4jDriver, outboxService, projector, once: true, batchSize: 100 });
    iterations += 1;
    if (!result.processed) {
      break;
    }
  }

  logger.info('[GRAPH_OUTBOX] Reconstrução canônica concluída', { iterations });
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('[GRAPH_OUTBOX] Falha na reconstrução canônica:', error.message);
    process.exit(1);
  });
}

module.exports = {
  seedCanonicalOutbox,
};
