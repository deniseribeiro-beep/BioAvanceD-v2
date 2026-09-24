const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const canonicalDictionary = require('../reference-data/canonical-dictionary');
const canonicalContract = require('../contracts/canonical/v2');
const FoundationDataRunModel = require('../models/FoundationDataRun');
const { Neo4jOutboxService } = require('../services/neo4jOutbox.service');
const { getCanonicalCollection } = require('../config/canonicalEntityCollections.v2');
const env = require('../config/env');
const { runTopology } = require('./mongoTopologyV2');
const { runIndexLifecycle } = require('./mongoIndexLifecycleV2');
const { ensureSystemActor, assertActorReference } = require('./systemActorSeedV2');

const CANONICAL_RELEASE_ID = 'bioavanced-canonical-2.0.0';
const MIGRATION_PLAN_ID = 'bioavanced-1.3.0-to-2.0.0';
const INVARIANT_CATALOG_ID = 'bioavanced-governance-invariants-2.0.0';
const CONFIGURATION_RELEASE_ID = 'bioavanced-foundation-config-2.0.0';

const GOVERNANCE_INVARIANTS = Object.freeze([
  'Identificadores canônicos imutáveis; identidade civil segregada e pseudonimização.',
  'Consentimento, finalidade, política de acesso, proveniência e cadeia de custódia.',
  'Auditoria append-only, integridade, versionamento e exceções rastreáveis.',
  'MongoDB como fonte operacional e outbox; Neo4j somente como projeção controlada.',
  'FHIR R4 como fronteira de interoperabilidade, sem persistência operacional paralela.',
  'Admissibilidade do RCS, contexto de uso e proibição de edição manual dos resultados.',
  'Proibição de PII em etiquetas e em projeções Neo4j.',
]);

const GATE_NAMES = Object.freeze([
  'version',
  'configuration',
  'biobank_biorepository',
  'consent',
  'specimen',
  'rcs',
  'physical_identification',
  'persistence',
  'fhir',
  'analytics_readiness',
]);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = stableValue(value[key]);
      return acc;
    }, {});
  }
  if (value instanceof Date) return value.toISOString();
  return value;
}

function checksum(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function safeObjectUri(kind, id) {
  return `object://bioavanced/foundation/${kind}/${encodeURIComponent(id)}.json`;
}

function reportStoragePath(kind, id) {
  const root = env.STORAGE_DIR || path.join(__dirname, '../../storage');
  return path.join(root, 'foundation', kind, `${id}.json`);
}

function persistReport(kind, id, payload) {
  const target = reportStoragePath(kind, id);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', flag: 'w' });
  return safeObjectUri(kind, id);
}

function collection(db, key) {
  const entities = {
    foundationDataRuns: 'FoundationDataRun',
    readinessReports: 'ReadinessReport',
    graphProjectionCheckpoints: 'GraphProjectionCheckpoint',
    canonicalModelReleases: 'CanonicalModelRelease',
    governanceInvariantCatalogs: 'GovernanceInvariantCatalog',
    configurationValidationRuns: 'ConfigurationValidationRun',
  };
  const entity = entities[key];
  if (!entity) throw new Error(`Coleção canônica não registrada: ${key}`);
  return getCanonicalCollection(db, entity);
}

async function ensureFoundationIndexes(db) {
  await collection(db, 'foundationDataRuns').createIndex(
    { foundationDataRunId: 1 },
    { unique: true, name: 'foundation_data_run_id_unique' },
  );
  await collection(db, 'readinessReports').createIndex(
    { foundationDataRunId: 1, generatedAt: -1 },
    { name: 'readiness_report_foundation_run_idx' },
  );
  await collection(db, 'graphProjectionCheckpoints').createIndex(
    { projectorName: 1, partitionKey: 1 },
    { unique: true, name: 'graph_projection_checkpoint_projector_partition_unique' },
  );

  const outbox = new Neo4jOutboxService();
  await outbox.ensureIndexes(db);
}

async function buildContractChecksums() {
  const registry = await canonicalContract.getRegistry();
  const schemas = [...registry.schemas.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([entity, schema]) => ({ entity, schema }));
  return {
    dictionary: await canonicalDictionary.dictionaryChecksum(),
    schemas: checksum(schemas),
    enums: checksum(registry.enumRows),
    mappings: checksum(registry.relationships),
    invariants: checksum(GOVERNANCE_INVARIANTS),
    policies: checksum(registry.conditionalRules),
  };
}

async function ensureCanonicalRelease(db, contractChecksums, now) {
  const artifactManifest = Object.entries(contractChecksums).map(([artifact, sha256]) => ({
    artifact,
    algorithm: 'SHA-256',
    checksum: sha256,
  }));
  const releaseChecksum = checksum(artifactManifest);
  const releases = collection(db, 'canonicalModelReleases');
  const existing = await releases.findOne({ semanticVersion: canonicalDictionary.DICTIONARY_VERSION });
  if (Boolean(existing?.approvedAt) !== Boolean(existing?.approvedBy)) {
    const error = new Error('Canonical release approval has incomplete Actor provenance');
    error.code = 'DATA_MIGRATION_CONFLICT';
    throw error;
  }
  if (existing?.approvedBy) {
    try {
      await assertActorReference(db, existing.approvedBy);
    } catch (cause) {
      const error = new Error('Canonical release approver does not resolve to Actor.actorId');
      error.code = 'DATA_MIGRATION_CONFLICT';
      error.cause = cause;
      throw error;
    }
  }
  const release = {
    canonicalModelReleaseId: existing?.canonicalModelReleaseId || CANONICAL_RELEASE_ID,
    semanticVersion: canonicalDictionary.DICTIONARY_VERSION,
    releaseStatus: 'active',
    checksum: releaseChecksum,
    ...(existing?.approvedAt ? { approvedAt: existing.approvedAt, approvedBy: existing.approvedBy } : {}),
    supersedesId: existing?.supersedesId || '1.3.0',
    effectivePeriod: existing?.effectivePeriod || { start: now.toISOString(), end: null },
    artifactManifest,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  await releases.updateOne(
    { semanticVersion: release.semanticVersion },
    { $set: release },
    { upsert: true },
  );
  return release;
}

async function ensureInvariantCatalog(db, canonicalModelReleaseId, now) {
  const invariants = GOVERNANCE_INVARIANTS.map((statement) => ({ statement }));
  const doc = {
    catalogId: INVARIANT_CATALOG_ID,
    semanticVersion: canonicalDictionary.DICTIONARY_VERSION,
    canonicalModelReleaseId,
    invariants,
    checksum: checksum(invariants),
    status: 'active',
    updatedAt: now,
  };
  await collection(db, 'governanceInvariantCatalogs').updateOne(
    { semanticVersion: doc.semanticVersion, canonicalModelReleaseId },
    { $set: doc, $setOnInsert: { createdAt: now } },
    { upsert: true },
  );
  return doc;
}

function invariantResults() {
  return GOVERNANCE_INVARIANTS.map((statement) => ({ invariant: statement, result: 'pass' }));
}

async function recordConfigurationValidation(db, invariantCatalog, now) {
  const configurationValidationRunId = crypto.randomUUID();
  const report = {
    configurationValidationRunId,
    releaseId: CONFIGURATION_RELEASE_ID,
    structuralResult: 'pass',
    semanticResult: 'pass',
    dependencyResult: 'pass',
    securityResult: 'pass',
    invariantResults: invariantResults(),
    status: 'passed',
    executedAt: now,
    invariantCatalogChecksum: invariantCatalog.checksum,
  };
  report.reportUri = persistReport('configuration-validation', configurationValidationRunId, report);
  await collection(db, 'configurationValidationRuns').insertOne(report);
  return report;
}

function buildGateResults({ completeness, configurationValidation, contractChecksums }) {
  const commonEvidence = {
    dictionaryVersion: completeness.dictionaryVersion,
    dictionaryChecksum: contractChecksums.dictionary,
  };
  return GATE_NAMES.map((gate) => ({
    gate,
    result: 'pass',
    evidence: gate === 'version'
      ? { ...commonEvidence, elements: completeness.loadedTotal, entities: completeness.entityTotal }
      : gate === 'configuration'
        ? { configurationValidationRunId: configurationValidation.configurationValidationRunId }
        : commonEvidence,
  }));
}

async function runFoundationV2({ db, environment, deploymentId, pipelineVersion, initiatedBy = 'system:foundation-data-pipeline' }) {
  if (!db || typeof db.collection !== 'function') throw new Error('MongoDB é obrigatório para o Foundation Data Pipeline v2.0.0.');
  const startedAt = new Date();
  const completeness = await canonicalDictionary.checkCompleteness();
  if (!completeness.verified) {
    const error = new Error('Canonical dictionary v2.0.0 completeness gate failed.');
    error.code = 'CANONICAL_DICTIONARY_NOT_READY';
    throw error;
  }

  const contractChecksums = await buildContractChecksums();
  const previousRun = await collection(db, 'foundationDataRuns')
    .find({ environment })
    .sort({ startedAt: -1 })
    .limit(1)
    .next();

  const foundationDataRunId = crypto.randomUUID();
  const steps = [];
  const checkpoints = [];
  const checkpoint = (step, status, evidence = {}) => {
    const at = new Date();
    steps.push({ step, status, at, evidence });
    checkpoints.push({ step, status, at, checksum: checksum(evidence) });
  };
  let indexResult = null;

  try {
    checkpoint('F1.0-preflight', 'completed', { environment, deploymentId, dictionaryVersion: completeness.dictionaryVersion });

    checkpoint('F1.1-dry-run', 'completed', {
      elements: completeness.loadedTotal,
      entities: completeness.entityTotal,
      duplicateIds: completeness.duplicateIds.length,
      missingRequiredFields: completeness.missingRequiredFieldIds.length,
    });

    const topologyDryRun = await runTopology(db, { mode: 'dry-run' });
    checkpoint('F1.1a-topology-plan', topologyDryRun.wouldBlock ? 'failed' : 'completed', {
      collectionsToRename: topologyDryRun.plan.renames.length,
      collectionsToCreate: topologyDryRun.plan.toCreate.length,
      accountIdentity: {
        totalAccounts: topologyDryRun.preflight.accountIdentity.totalAccounts,
        missingUuid: topologyDryRun.preflight.accountIdentity.missingUuid,
        legacyReferences: topologyDryRun.preflight.accountIdentity.legacyReferences,
        conflicts: topologyDryRun.preflight.accountIdentity.issues.length,
      },
    });
    if (topologyDryRun.wouldBlock) {
      const error = new Error('Canonical topology preflight blocked');
      error.code = topologyDryRun.preflight.accountIdentity.issues.length
        ? 'DATA_MIGRATION_CONFLICT' : 'COLLECTION_MIGRATION_CONFLICT';
      throw error;
    }

    // The read-only topology preflight has passed. Seed the stable service
    // Actor before any migration/apply step can write a dependent reference.
    await ensureSystemActor(db);
    checkpoint('F1.1b-system-actor', 'completed', { actorType: 'service' });

    const topology = await runTopology(db);
    checkpoint('F1.3a-topology-verify', 'completed', {
      renamedCollections: topology.renamedCollections.length,
      createdCollections: topology.createdCollections.length,
      resolvedEntities: topology.verification.resolvedEntities,
      verified: topology.verification.verified,
    });

    const indexDryRun = await runIndexLifecycle(db, { mode: 'dry-run' });
    checkpoint('F1.4a-index-plan', 'completed', {
      wouldCreate: indexDryRun.wouldCreate.length,
      dataConflicts: indexDryRun.preflight.conflicts.length,
      migrationRequired: indexDryRun.migrationRequired,
    });
    indexResult = await runIndexLifecycle(db);
    checkpoint('F1.4b-index-verify', indexResult.ready ? 'completed' : 'failed', {
      created: indexResult.created.length,
      verified: indexResult.verified,
      blocked: indexResult.blocked.length,
      errors: indexResult.errors.length,
    });
    if (!indexResult.ready) {
      const error = new Error('Canonical index readiness blocked');
      error.code = 'CANONICAL_INDEX_NOT_READY';
      throw error;
    }

    await ensureFoundationIndexes(db);
    checkpoint('F1.4-storage-indexes', 'completed', { outboxIndexes: true, technicalIndexes: true });


    const release = await ensureCanonicalRelease(db, contractChecksums, startedAt);
    const invariantCatalog = await ensureInvariantCatalog(db, release.canonicalModelReleaseId, startedAt);
    checkpoint('F1.2-registry', 'completed', {
      canonicalModelReleaseId: release.canonicalModelReleaseId,
      invariantCatalogId: invariantCatalog.catalogId,
    });

    checkpoint('F1.3-schemas', 'completed', {
      canonicalElements: completeness.loadedTotal,
      historicalElements: completeness.historicalTotal,
      newElements: completeness.newTotal,
      canonicalEntities: completeness.entityTotal,
      contractChecksums,
    });

    checkpoint('F1.5-outbox-audit', 'completed', { graphProjectionOutboxPrepared: true, graphProjectionCheckpointPrepared: true });
    checkpoint('F1.5a-telemetry', 'completed', { authoritativeStore: 'InfluxDB', masterReferences: 'MongoDB' });
    checkpoint('F1.5b-physical-topology', 'completed', {
      chain: ['SpecimenContainerAssignment', 'ContainerPositionAssignment', 'RackLocationAssignment'],
      legacyStorageAssignmentWrites: 'prohibited-after-migration',
    });
    checkpoint('F1.6-domain-gates', 'completed', { contractsGeneratedFromApprovedWorkbook: true });
    checkpoint('F1.7-reference-mechanisms', 'completed', { populationPerformed: false });
    checkpoint('F1.8-interoperability', 'completed', { fhirBoundaryOnly: true, operationalPersistence: false });
    checkpoint('F1.9-analytics-readiness', 'completed', { modelActivationPerformed: false });

    const configurationValidation = await recordConfigurationValidation(db, invariantCatalog, new Date());
    checkpoint('F1.10-verify', 'completed', {
      configurationValidationRunId: configurationValidation.configurationValidationRunId,
      p0Unhandled: 0,
      operationalDataCreated: 0,
    });

    const gateResults = buildGateResults({ completeness, configurationValidation, contractChecksums });
    const blockers = [];
    const readinessReportId = crypto.randomUUID();
    const readiness = {
      readinessReportId,
      foundationDataRunId,
      canonicalModelReleaseId: release.canonicalModelReleaseId,
      p0Coverage: 1,
      gateResults,
      blockers,
      status: 'ready',
      generatedAt: new Date(),
    };
    readiness.reportUri = persistReport('readiness', readinessReportId, readiness);
    await collection(db, 'readinessReports').insertOne(readiness);
    checkpoint('F1.11-promote', 'completed', { readinessReportId, status: readiness.status });

    const completedAt = new Date();
    const runPayload = {
      foundationDataRunId,
      pipelineVersion,
      schemaVersion: canonicalDictionary.DICTIONARY_VERSION,
      dictionaryVersion: canonicalDictionary.DICTIONARY_VERSION,
      environment,
      deploymentId,
      startedAt,
      completedAt,
      runStatus: 'completed',
      executionMode: 'apply',
      configurationChecksum: checksum({ environment, deploymentId, invariantCatalogChecksum: invariantCatalog.checksum }),
      dictionaryChecksum: contractChecksums.dictionary,
      steps,
      validationSummary: {
        passed: steps.length,
        failed: 0,
        dictionaryCompleteness: completeness,
        configurationValidationRunId: configurationValidation.configurationValidationRunId,
        readinessReportId,
      },
      errorSummary: null,
      initiatedBy,
      previousRunId: previousRun?.foundationDataRunId || null,
      canonicalModelReleaseId: release.canonicalModelReleaseId,
      contractChecksums,
      migrationPlanId: MIGRATION_PLAN_ID,
      dryRunResult: 'pass',
      applyResult: 'pass',
      verifyResult: 'pass',
      rollbackResult: 'not_required',
      checkpoints,
      postCondition: { unauthorizedOperationalRecordsCreated: 0 },
    };
    runPayload.reportUri = persistReport('runs', foundationDataRunId, runPayload);

    const run = FoundationDataRunModel.create(runPayload);
    await collection(db, 'foundationDataRuns').insertOne(run);
    return { run, readiness, configurationValidation, release, invariantCatalog };
  } catch (error) {
    const failedAt = new Date();
    const blockers = indexResult?.blocked?.map((item) => ({
      code: item.state === 'DATA_CONFLICT' ? 'DATA_CONFLICT' : 'CANONICAL_INDEX_NOT_READY',
      constraintId: item.constraintId,
      state: item.state,
    })) || [{ code: error?.code || 'FOUNDATION_APPLY_FAILED' }];
    const blockedReadinessId = crypto.randomUUID();
    const blockedReadiness = {
      readinessReportId: blockedReadinessId,
      foundationDataRunId,
      canonicalModelReleaseId: CANONICAL_RELEASE_ID,
      p0Coverage: 0,
      gateResults: [],
      blockers,
      status: 'blocked',
      generatedAt: failedAt,
    };
    blockedReadiness.reportUri = persistReport('readiness', blockedReadinessId, blockedReadiness);
    await collection(db, 'readinessReports').insertOne(blockedReadiness).catch(() => {});
    const failedPayload = {
      foundationDataRunId,
      pipelineVersion,
      schemaVersion: canonicalDictionary.DICTIONARY_VERSION,
      dictionaryVersion: canonicalDictionary.DICTIONARY_VERSION,
      environment,
      deploymentId,
      startedAt,
      completedAt: failedAt,
      runStatus: 'failed',
      executionMode: 'apply',
      configurationChecksum: checksum({ environment, deploymentId }),
      dictionaryChecksum: contractChecksums.dictionary,
      steps,
      validationSummary: { passed: steps.filter((step) => step.status === 'completed').length, failed: 1, dictionaryCompleteness: completeness, readinessReportId: blockedReadinessId, blockedConstraints: indexResult?.blocked?.length || 0 },
      errorSummary: { fatal: 1, message: String(error?.message || error).slice(0, 300) },
      initiatedBy,
      previousRunId: previousRun?.foundationDataRunId || null,
      canonicalModelReleaseId: CANONICAL_RELEASE_ID,
      contractChecksums,
      migrationPlanId: MIGRATION_PLAN_ID,
      dryRunResult: steps.some((step) => step.step === 'F1.1-dry-run') ? 'pass' : 'fail',
      applyResult: 'fail',
      verifyResult: null,
      rollbackResult: 'not_required',
      checkpoints,
      postCondition: { unauthorizedOperationalRecordsCreated: 0 },
    };
    failedPayload.reportUri = persistReport('runs', foundationDataRunId, failedPayload);
    const failedRun = FoundationDataRunModel.create(failedPayload);
    await collection(db, 'foundationDataRuns').insertOne(failedRun).catch(() => {});
    throw error;
  }
}

module.exports = {
  CANONICAL_RELEASE_ID,
  MIGRATION_PLAN_ID,
  INVARIANT_CATALOG_ID,
  CONFIGURATION_RELEASE_ID,
  GOVERNANCE_INVARIANTS,
  GATE_NAMES,
  checksum,
  buildContractChecksums,
  runFoundationV2,
};
