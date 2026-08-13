const { streamJsonLines, checksumFile } = require('./parseJsonLines');
const { processRecords } = require('./processRecords');
const ReferenceDatasetReleaseModel = require('../../models/ReferenceDatasetRelease');
const ReferenceImportRunModel = require('../../models/ReferenceImportRun');
const ReferenceImportIssueModel = require('../../models/ReferenceImportIssue');
const TerminologyConceptModel = require('../../models/TerminologyConcept');
const TerminologyRelationModel = require('../../models/TerminologyRelation');
const { CANONICAL_COLLECTIONS } = require('../../config/collections');

// AC 10-style gate: a batch this bad blocks promotion outright rather than
// letting a mostly-broken parse silently become an "active" release.
const REJECTION_RATE_BLOCK_THRESHOLD = 0.5;

/**
 * Runs the RF028 universal import pipeline (Plano Integrado §7.2) for one
 * source against one Mongo `db` handle. Only the HPO source is wired up
 * this slice — `source`/`normalizeRecord` are already generic so the
 * remaining 15 Fase 2 sources can reuse this runner directly.
 */
async function runImport({ db, source, normalizeRecord, dryRun = false, initiatedBy = 'system:reference-data-bootstrap' }) {
  const releases = db.collection(CANONICAL_COLLECTIONS.referenceDatasetReleases);
  const runs = db.collection(CANONICAL_COLLECTIONS.referenceImportRuns);
  const issuesCollection = db.collection(CANONICAL_COLLECTIONS.referenceImportIssues);
  const staging = db.collection(CANONICAL_COLLECTIONS.referenceImportStaging);
  const concepts = db.collection(CANONICAL_COLLECTIONS.terminologyConcepts);
  const relations = db.collection(CANONICAL_COLLECTIONS.terminologyRelations);

  // 7.2 step 2 "Acquire" + step 3 "Integrity"
  const { checksum, fileSize } = await checksumFile(source.fixturePath);
  const importMode = dryRun ? 'dry_run' : 'full';
  const idempotencyKey = `${source.datasetCode}:${source.datasetVersion}:sha256:${checksum}`;

  // AC 7 idempotency: an identical prior attempt (same source content,
  // version, and mode) is not re-processed at all — matching the
  // $setOnInsert-driven "safe to re-run" contract RF022's bootstrap uses.
  // Filtered on importMode too: a dry run and a full run of identical
  // content are distinct attempts and must not short-circuit each other.
  const existingRun = await runs.findOne({ idempotencyKey, importMode });
  if (existingRun) {
    return { run: existingRun, idempotent: true };
  }

  const startedAt = new Date();
  const integrityOk = checksum === source.expectedChecksum;

  let recordsRead = 0;
  let stagedConcepts = new Map();
  let stagedRelations = [];
  let issues = [];

  if (integrityOk) {
    const rawLines = [];
    for await (const entry of streamJsonLines(source.fixturePath)) {
      rawLines.push(entry);
    }
    ({ recordsRead, concepts: stagedConcepts, relations: stagedRelations, issues } = processRecords(rawLines, normalizeRecord));
  } else {
    issues.push({
      entityType: 'ReferenceDatasetRelease',
      errorCode: 'CHECKSUM_MISMATCH',
      errorMessage: `Checksum calculado (${checksum}) diverge do checksum esperado (${source.expectedChecksum}) para ${source.datasetCode}.`,
      severity: 'fatal',
      rawValue: { checksum, expectedChecksum: source.expectedChecksum },
    });
  }

  // 7.2 step 7 "Stage": isolated, disposable staging area tagged by run —
  // written even for a dry run so the stage itself is provable.
  const runIdForStaging = `pending-${idempotencyKey}`;
  if (stagedConcepts.size > 0) {
    await staging.insertMany(
      Array.from(stagedConcepts.values()).map((candidate) => ({
        referenceImportRunId: runIdForStaging,
        datasetCode: source.datasetCode,
        stagedAt: new Date(),
        candidate,
      })),
    );
  }

  const fatalIssues = issues.filter((issue) => issue.severity === 'fatal');
  const rejectionRate = recordsRead > 0 ? issues.length / recordsRead : 0;
  const approved = integrityOk && fatalIssues.length === 0 && rejectionRate <= REJECTION_RATE_BLOCK_THRESHOLD && Boolean(source.license);

  let releaseId = null;
  let recordsInserted = 0;
  let recordsUpdated = 0;
  let recordsSkipped = 0;

  if (approved && !dryRun) {
    const promotion = await promote({ releases, concepts, relations, source, stagedConcepts, stagedRelations, checksum, fileSize });
    releaseId = promotion.releaseId;
    recordsInserted = promotion.recordsInserted;
    recordsUpdated = promotion.recordsUpdated;
    recordsSkipped = promotion.recordsSkipped;
    issues.push(...promotion.issues);
  }

  const runStatus = !integrityOk || fatalIssues.length > 0 || rejectionRate > REJECTION_RATE_BLOCK_THRESHOLD
    ? 'failed'
    : dryRun
      ? 'validated'
      : 'completed';

  const runDoc = ReferenceImportRunModel.create({
    referenceDatasetReleaseId: releaseId,
    datasetCode: source.datasetCode,
    importMode,
    idempotencyKey,
    startedAt,
    completedAt: new Date(),
    runStatus,
    batchSize: stagedConcepts.size || 1,
    recordsRead,
    recordsValidated: stagedConcepts.size,
    recordsInserted,
    recordsUpdated,
    recordsSkipped,
    recordsRejected: issues.filter((issue) => issue.entityType !== undefined).length,
    inputChecksum: checksum,
    validationSummary: {
      fatal: fatalIssues.length,
      errors: issues.filter((issue) => issue.severity === 'error').length,
      warnings: issues.filter((issue) => issue.severity === 'warning').length,
      rejectionRate,
      approved,
    },
    initiatedBy,
  });

  await runs.insertOne(runDoc);

  if (issues.length > 0) {
    await issuesCollection.insertMany(
      issues.map((issue) =>
        ReferenceImportIssueModel.create({
          ...issue,
          referenceImportRunId: runDoc.referenceImportRunId,
          referenceDatasetReleaseId: releaseId || 'unresolved',
        }),
      ),
    );
  }

  return { run: runDoc, releaseId, approved, idempotent: false };
}

async function promote({ releases, concepts, relations, source, stagedConcepts, stagedRelations, checksum, fileSize }) {
  const issues = [];

  const existingActive = await releases.findOne({ datasetCode: source.datasetCode, releaseStatus: 'active' });
  const sameRelease = existingActive
    && existingActive.systemUri === source.systemUri
    && existingActive.datasetVersion === source.datasetVersion
    && existingActive.sourceChecksum === checksum;

  let releaseDoc;
  if (sameRelease) {
    releaseDoc = existingActive;
  } else {
    releaseDoc = ReferenceDatasetReleaseModel.create({
      sourceId: source.sourceId,
      datasetCode: source.datasetCode,
      datasetName: source.datasetName,
      systemUri: source.systemUri,
      datasetVersion: source.datasetVersion,
      retrievalUri: source.retrievalUri,
      accessMethod: source.accessMethod,
      sourceFormat: source.sourceFormat,
      license: source.license,
      licenseUri: source.licenseUri,
      sourceChecksum: checksum,
      fileSize,
      parserVersion: source.parserVersion,
      mappingVersion: source.mappingVersion,
      releaseStatus: 'active',
      previousReleaseId: existingActive ? existingActive.referenceDatasetReleaseId : null,
    });
    await releases.insertOne(releaseDoc);
    // Preserve history — supersede, never delete (Plano Integrado §7.2 step 10).
    if (existingActive) {
      await releases.updateOne(
        { referenceDatasetReleaseId: existingActive.referenceDatasetReleaseId },
        { $set: { releaseStatus: 'superseded', updatedAt: new Date() } },
      );
    }
  }

  const codeToConceptId = new Map();
  let recordsInserted = 0;
  let recordsUpdated = 0;
  let recordsSkipped = 0;

  for (const candidate of stagedConcepts.values()) {
    const filter = { systemUri: source.systemUri, code: candidate.code, version: source.datasetVersion };
    const existingConcept = await concepts.findOne(filter);
    if (existingConcept) {
      codeToConceptId.set(candidate.code, existingConcept.terminologyConceptId);
      recordsSkipped += 1;
      continue;
    }
    const conceptDoc = TerminologyConceptModel.create({
      ...candidate,
      systemUri: source.systemUri,
      version: source.datasetVersion,
      referenceDatasetReleaseId: releaseDoc.referenceDatasetReleaseId,
    });
    await concepts.insertOne(conceptDoc);
    codeToConceptId.set(candidate.code, conceptDoc.terminologyConceptId);
    recordsInserted += 1;
  }

  for (const candidate of stagedRelations) {
    const sourceConceptId = codeToConceptId.get(candidate.sourceCode);
    const targetConceptId = codeToConceptId.get(candidate.targetCode);
    if (!sourceConceptId || !targetConceptId) {
      // Endpoint existed in this run's concepts but wasn't newly promoted
      // (e.g. reused from an existing release without a fresh lookup) —
      // record rather than silently drop, per §7.3's no-orphan rule.
      issues.push({
        entityType: 'TerminologyRelation',
        sourceRecordId: `${candidate.sourceCode}>${candidate.targetCode}`,
        errorCode: 'ORPHAN_RELATION',
        errorMessage: `Não foi possível resolver terminologyConceptId para ${candidate.sourceCode} ou ${candidate.targetCode}.`,
        severity: 'error',
      });
      continue;
    }
    const filter = {
      sourceConceptId,
      targetConceptId,
      relationType: candidate.relationType,
      relationVersion: source.datasetVersion,
    };
    const existingRelation = await relations.findOne(filter);
    if (existingRelation) {
      recordsSkipped += 1;
      continue;
    }
    const relationDoc = TerminologyRelationModel.create({
      sourceConceptId,
      targetConceptId,
      relationType: candidate.relationType,
      relationVersion: source.datasetVersion,
      relationSystem: 'http://www.w3.org/2000/01/rdf-schema#subClassOf',
      referenceDatasetReleaseId: releaseDoc.referenceDatasetReleaseId,
    });
    await relations.insertOne(relationDoc);
    recordsInserted += 1;
  }

  return { releaseId: releaseDoc.referenceDatasetReleaseId, recordsInserted, recordsUpdated, recordsSkipped, issues };
}

module.exports = { runImport };
