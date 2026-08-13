const { streamJsonLines, checksumFile } = require('./parseJsonLines');
const { processRecords } = require('./processRecords');
const ReferenceDatasetReleaseModel = require('../../models/ReferenceDatasetRelease');
const ReferenceImportRunModel = require('../../models/ReferenceImportRun');
const ReferenceImportIssueModel = require('../../models/ReferenceImportIssue');
const TerminologyConceptModel = require('../../models/TerminologyConcept');
const TerminologyRelationModel = require('../../models/TerminologyRelation');
const { CANONICAL_COLLECTIONS } = require('../../config/collections');
const { GraphProjectionService } = require('../../services/graphProjection.service');

// AC 10-style gate: a batch this bad blocks promotion outright rather than
// letting a mostly-broken parse silently become an "active" release.
const REJECTION_RATE_BLOCK_THRESHOLD = 0.5;

// AC 7 checkpoint/resume: a run in one of these statuses is finished and
// short-circuits on retry (existing idempotency behavior). 'running' is the
// one non-terminal status this pipeline ever persists — anything else found
// there is a prior attempt that was interrupted before finishing and is
// resumed from its checkpoint instead.
const TERMINAL_RUN_STATUSES = ['validated', 'completed', 'failed', 'cancelled', 'rolled_back'];
const DEFAULT_BATCH_SIZE = 500;

/**
 * Runs the RF028 universal import pipeline (Plano Integrado §7.2) for one
 * source against one Mongo `db` handle. Only the HPO source is wired up
 * this slice — `source`/`normalizeRecord` are already generic so the
 * remaining 15 Fase 2 sources can reuse this runner directly.
 */
async function runImport({
  db,
  source,
  normalizeRecord,
  dryRun = false,
  initiatedBy = 'system:reference-data-bootstrap',
  batchSize = DEFAULT_BATCH_SIZE,
  graphProjection = new GraphProjectionService(),
}) {
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

  // AC 7 idempotency vs. resume: an existing *terminal* attempt (same
  // source content, version, and mode) is not re-processed at all —
  // matching the $setOnInsert-driven "safe to re-run" contract RF022's
  // bootstrap uses. An existing attempt still in 'running' status is a
  // prior run that was interrupted before finishing — resumed below from
  // its checkpoint, not restarted or treated as a fresh idempotent no-op.
  // Filtered on importMode too: a dry run and a full run of identical
  // content are distinct attempts and must not short-circuit each other.
  const existingRun = await runs.findOne({ idempotencyKey, importMode });
  if (existingRun && TERMINAL_RUN_STATUSES.includes(existingRun.runStatus)) {
    return { run: existingRun, idempotent: true };
  }

  const integrityOk = checksum === source.expectedChecksum;

  if (!integrityOk) {
    // No staging/checkpoint machinery needed for a doomed run — nothing was
    // ever going to be staged, so there's nothing to resume either.
    const issues = [
      {
        entityType: 'ReferenceDatasetRelease',
        errorCode: 'CHECKSUM_MISMATCH',
        errorMessage: `Checksum calculado (${checksum}) diverge do checksum esperado (${source.expectedChecksum}) para ${source.datasetCode}.`,
        severity: 'fatal',
        rawValue: { checksum, expectedChecksum: source.expectedChecksum },
      },
    ];
    const runDoc = ReferenceImportRunModel.create({
      referenceDatasetReleaseId: null,
      datasetCode: source.datasetCode,
      importMode,
      idempotencyKey,
      startedAt: new Date(),
      completedAt: new Date(),
      runStatus: 'failed',
      inputChecksum: checksum,
      validationSummary: { fatal: 1, errors: 0, warnings: 0, rejectionRate: 0, approved: false },
      initiatedBy,
    });
    await runs.insertOne(runDoc);
    await issuesCollection.insertMany(
      issues.map((issue) =>
        ReferenceImportIssueModel.create({ ...issue, referenceImportRunId: runDoc.referenceImportRunId, referenceDatasetReleaseId: 'unresolved' }),
      ),
    );
    return { run: runDoc, releaseId: null, approved: false, idempotent: false };
  }

  // Resuming an interrupted run reuses its own doc/id; a fresh attempt
  // creates one now (not at the end) so staging can be tagged with its
  // real referenceImportRunId from the very first batch — the earlier
  // `pending-<idempotencyKey>` placeholder made every batch's staging rows
  // orphaned from the run that actually produced them.
  const resuming = Boolean(existingRun) && existingRun.runStatus === 'running';
  let runDoc = resuming ? existingRun : null;
  if (!runDoc) {
    runDoc = ReferenceImportRunModel.create({
      referenceDatasetReleaseId: null,
      datasetCode: source.datasetCode,
      importMode,
      idempotencyKey,
      startedAt: new Date(),
      runStatus: 'running',
      checkpoint: null,
      batchSize,
      inputChecksum: checksum,
      initiatedBy,
    });
    await runs.insertOne(runDoc);
  }

  // Parsing is a pure, deterministic function of the (checksum-verified,
  // unchanged) source content — re-parsing on resume reproduces the exact
  // same concepts/relations/issues a first attempt would have, so nothing
  // about cross-record validation (e.g. relation-orphan checks) changes
  // between a fresh run and a resumed one.
  const rawLines = [];
  for await (const entry of streamJsonLines(source.fixturePath)) {
    rawLines.push(entry);
  }
  const { recordsRead, concepts: parsedConcepts, relations: parsedRelations, issues } = processRecords(rawLines, normalizeRecord);

  // 7.2 step 7 "Stage", batched (#551 AC 7 checkpoint/resume): a single
  // order-stable list covering *both* concepts and relations (§7.3 "no
  // silent loss" — relations used to live only in an in-memory array and
  // were never persisted, so a resumed run silently lost batch-1's
  // relations). Written in batchSize-sized chunks, checkpointing the run
  // doc's offset after each chunk so a crash mid-stage leaves a resumable
  // position instead of losing the whole attempt. Resuming continues from
  // the existing checkpoint instead of re-staging (and thus duplicating)
  // what a prior, interrupted attempt already committed.
  const stagingItems = [
    ...Array.from(parsedConcepts.values()).map((candidate) => ({ entityType: 'TerminologyConcept', candidate })),
    ...parsedRelations.map((candidate) => ({ entityType: 'TerminologyRelation', candidate })),
  ];
  let offset = (runDoc.checkpoint && runDoc.checkpoint.offset) || 0;
  while (offset < stagingItems.length) {
    const chunk = stagingItems.slice(offset, offset + batchSize);
    await staging.insertMany(
      chunk.map((item) => ({
        referenceImportRunId: runDoc.referenceImportRunId,
        datasetCode: source.datasetCode,
        entityType: item.entityType,
        stagedAt: new Date(),
        candidate: item.candidate,
      })),
    );
    offset += chunk.length;
    const checkpoint = { offset };
    await runs.updateOne({ referenceImportRunId: runDoc.referenceImportRunId }, { $set: { checkpoint, updatedAt: new Date() } });
    runDoc = { ...runDoc, checkpoint };
  }

  // The staging collection, not the in-memory parse, is the source of truth
  // for promotion — identical whether this call staged everything itself or
  // resumed a prior attempt's partial work.
  const stagedDocs = await staging.find({ referenceImportRunId: runDoc.referenceImportRunId }).toArray();
  const stagedConcepts = new Map(
    stagedDocs.filter((doc) => doc.entityType === 'TerminologyConcept').map((doc) => [doc.candidate.code, doc.candidate]),
  );
  const stagedRelations = stagedDocs.filter((doc) => doc.entityType === 'TerminologyRelation').map((doc) => doc.candidate);

  const fatalIssues = issues.filter((issue) => issue.severity === 'fatal');
  const rejectionRate = recordsRead > 0 ? issues.length / recordsRead : 0;
  const approved = fatalIssues.length === 0 && rejectionRate <= REJECTION_RATE_BLOCK_THRESHOLD && Boolean(source.license);

  let releaseId = null;
  let recordsInserted = 0;
  let recordsUpdated = 0;
  let recordsSkipped = 0;

  if (approved && !dryRun) {
    const promotion = await promote({ db, releases, concepts, relations, source, stagedConcepts, stagedRelations, checksum, fileSize, graphProjection });
    releaseId = promotion.releaseId;
    recordsInserted = promotion.recordsInserted;
    recordsUpdated = promotion.recordsUpdated;
    recordsSkipped = promotion.recordsSkipped;
    issues.push(...promotion.issues);
  }

  const runStatus = fatalIssues.length > 0 || rejectionRate > REJECTION_RATE_BLOCK_THRESHOLD
    ? 'failed'
    : dryRun
      ? 'validated'
      : 'completed';

  const finalFields = {
    referenceDatasetReleaseId: releaseId,
    completedAt: new Date(),
    runStatus,
    recordsRead,
    recordsValidated: stagedConcepts.size,
    recordsInserted,
    recordsUpdated,
    recordsSkipped,
    recordsRejected: issues.filter((issue) => issue.entityType !== undefined).length,
    validationSummary: {
      fatal: fatalIssues.length,
      errors: issues.filter((issue) => issue.severity === 'error').length,
      warnings: issues.filter((issue) => issue.severity === 'warning').length,
      rejectionRate,
      approved,
    },
    updatedAt: new Date(),
  };
  await runs.updateOne({ referenceImportRunId: runDoc.referenceImportRunId }, { $set: finalFields });
  runDoc = { ...runDoc, ...finalFields };

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

async function promote({ db, releases, concepts, relations, source, stagedConcepts, stagedRelations, checksum, fileSize, graphProjection }) {
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
    // AC9: Mongo write is the source of truth, appended on the same request
    // the concept is actually inserted — never for the skip-existing branch
    // above, mirroring RF023's "append on write" outbox discipline.
    await graphProjection.appendTerminologyConceptEvent(db, {
      terminologyConceptId: conceptDoc.terminologyConceptId,
      systemUri: conceptDoc.systemUri,
      code: conceptDoc.code,
      version: conceptDoc.version,
      display: conceptDoc.display,
      conceptStatus: conceptDoc.conceptStatus,
      referenceDatasetReleaseId: conceptDoc.referenceDatasetReleaseId,
      sourceService: 'reference-imports-pipeline',
    });
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
    await graphProjection.appendTerminologyRelationEvent(db, {
      terminologyRelationId: relationDoc.terminologyRelationId,
      sourceConceptId: relationDoc.sourceConceptId,
      targetConceptId: relationDoc.targetConceptId,
      relationType: relationDoc.relationType,
      relationVersion: relationDoc.relationVersion,
      referenceDatasetReleaseId: relationDoc.referenceDatasetReleaseId,
      sourceService: 'reference-imports-pipeline',
    });
  }

  return { releaseId: releaseDoc.referenceDatasetReleaseId, recordsInserted, recordsUpdated, recordsSkipped, issues };
}

/**
 * AC 7 rollback: reactivates the release immediately before the dataset's
 * current active one, one step at a time. Never deletes anything (Plano
 * Integrado §7.2 step 12 / §7.3 "preserve history") — both releases stay in
 * `referenceDatasetReleases`, only `releaseStatus` moves. The just-active
 * release becomes `rolled_back` (not `superseded` — that status already
 * means "an ordinary newer promotion replaced this one," a different event
 * than an operator explicitly reverting it), and the one before it becomes
 * `active` again. TerminologyConcept/TerminologyRelation docs are untouched:
 * they're deduped by systemUri+code+version, not owned by one release, so
 * nothing about them needs to change for a release-status rollback.
 */
async function rollbackRelease({ db, datasetCode, initiatedBy = 'system:reference-data-bootstrap' }) {
  const releases = db.collection(CANONICAL_COLLECTIONS.referenceDatasetReleases);
  const runs = db.collection(CANONICAL_COLLECTIONS.referenceImportRuns);

  const activeRelease = await releases.findOne({ datasetCode, releaseStatus: 'active' });
  if (!activeRelease) {
    return { rolledBack: false, reason: 'no_active_release' };
  }
  if (!activeRelease.previousReleaseId) {
    return { rolledBack: false, reason: 'no_previous_release' };
  }
  const previousRelease = await releases.findOne({ referenceDatasetReleaseId: activeRelease.previousReleaseId });
  if (!previousRelease) {
    return { rolledBack: false, reason: 'previous_release_not_found' };
  }

  await releases.updateOne(
    { referenceDatasetReleaseId: activeRelease.referenceDatasetReleaseId },
    { $set: { releaseStatus: 'rolled_back', updatedAt: new Date() } },
  );
  await releases.updateOne(
    { referenceDatasetReleaseId: previousRelease.referenceDatasetReleaseId },
    { $set: { releaseStatus: 'active', updatedAt: new Date() } },
  );

  const startedAt = new Date();
  const runDoc = ReferenceImportRunModel.create({
    referenceDatasetReleaseId: previousRelease.referenceDatasetReleaseId,
    datasetCode,
    importMode: 'rollback',
    idempotencyKey: `${datasetCode}:rollback:${activeRelease.referenceDatasetReleaseId}`,
    startedAt,
    completedAt: new Date(),
    runStatus: 'rolled_back',
    inputChecksum: activeRelease.sourceChecksum,
    validationSummary: { fatal: 0, errors: 0, warnings: 0, rejectionRate: 0, approved: true },
    initiatedBy,
  });
  await runs.insertOne(runDoc);

  return { rolledBack: true, run: runDoc, activeReleaseId: previousRelease.referenceDatasetReleaseId, rolledBackReleaseId: activeRelease.referenceDatasetReleaseId };
}

module.exports = { runImport, rollbackRelease };
