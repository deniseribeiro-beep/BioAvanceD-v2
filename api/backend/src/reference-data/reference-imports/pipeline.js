const { streamJsonLines, checksumFile } = require('./parseJsonLines');
const { processRecords } = require('./processRecords');
const ReferenceDatasetReleaseModel = require('../../models/ReferenceDatasetRelease');
const ReferenceImportRunModel = require('../../models/ReferenceImportRun');
const ReferenceImportIssueModel = require('../../models/ReferenceImportIssue');
const TerminologyConceptModel = require('../../models/TerminologyConcept');
const TerminologyRelationModel = require('../../models/TerminologyRelation');
const { CANONICAL_COLLECTIONS } = require('../../config/collections');
const { GraphProjectionService } = require('../../services/graphProjection.service');
const { withTransactionWhereSupported } = require('../../utils/mongoTransaction');
const { STORAGE_BASE } = require('../../config/uploadConfig');
const { preserveReferenceAsset } = require('./preserveAsset');

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
// The release statuses a resumed run may keep loading into (RF028 AC1).
const RESUMABLE_RELEASE_STATUSES = ['downloaded', 'staged', 'active'];

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
  assetStorageRoot = STORAGE_BASE,
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
  let existingRun = await runs.findOne({ idempotencyKey, importMode });
  // RF028 AC2: a run failed only on preserving its asset is retried, never
  // returned as idempotent; the failure is environmental and the content was
  // never judged.
  const retryingAsset = Boolean(existingRun) && await failedOnAssetPreservation({ issuesCollection, run: existingRun });
  if (existingRun && TERMINAL_RUN_STATUSES.includes(existingRun.runStatus) && !retryingAsset) {
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
    return { run: runDoc, releaseId: null, approved: false, idempotent: false, assetUri: null };
  }

  if (retryingAsset) {
    // The retry reuses the failed run doc, so no second run carries the key.
    const retryFields = { runStatus: 'running', completedAt: null };
    await runs.updateOne(
      { referenceImportRunId: existingRun.referenceImportRunId },
      { $set: { ...retryFields, updatedAt: new Date() } },
    );
    existingRun = { ...existingRun, ...retryFields };
  }

  const resuming = Boolean(existingRun) && existingRun.runStatus === 'running';

  // RF028 AC1: origin, version, license, URI, checksum, format,
  // parserVersion and mappingVersion are registered before the load. The
  // registration is validated on every run, a dry run included, so a source
  // that could never be registered stages nothing.
  const registration = {
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
    releaseStatus: 'downloaded',
    previousReleaseId: null,
  };
  const registrationCheck = ReferenceDatasetReleaseModel.validate(registration);
  if (!registrationCheck.isValid) {
    const failedRun = await recordFatalRun({
      runs,
      issuesCollection,
      existingRun: resuming ? existingRun : null,
      newRun: { datasetCode: source.datasetCode, importMode, idempotencyKey, inputChecksum: checksum, initiatedBy },
      releaseId: null,
      issue: {
        entityType: 'ReferenceDatasetRelease',
        errorCode: 'RELEASE_REGISTRATION_INVALID',
        errorMessage: registrationCheck.errors.join('; '),
        severity: 'fatal',
      },
    });
    return { run: failedRun, releaseId: null, approved: false, idempotent: false, assetUri: null };
  }

  // INFERENCE, not a citation: a dry run registers no release. It loads
  // nothing, so AC1's "antes da carga" has nothing to precede. A checksum
  // mismatch (above) registers none either: integrity is the acquire gate,
  // and its run and fatal issue already record it.
  let releaseDoc = null;
  let asset = null;
  if (!dryRun) {
    releaseDoc = await resolveRelease({ releases, source, checksum, registration, existingRun: resuming ? existingRun : null });
    // RF028 AC2 / RNF032 C2: the source asset is preserved after its release
    // is registered and before the run's first staging write.
    asset = await preserveReferenceAsset({
      sourcePath: source.fixturePath,
      datasetCode: source.datasetCode,
      checksum,
      storageRoot: assetStorageRoot,
    });
  }
  const releaseId = releaseDoc ? releaseDoc.referenceDatasetReleaseId : null;

  if (asset && !asset.preserved) {
    // The release keeps its status: its content was never judged, and the
    // retry of this run reuses it through the run's referenceDatasetReleaseId.
    const failedRun = await recordFatalRun({
      runs,
      issuesCollection,
      existingRun: resuming ? existingRun : null,
      newRun: { datasetCode: source.datasetCode, importMode, idempotencyKey, inputChecksum: checksum, initiatedBy },
      releaseId,
      issue: {
        entityType: 'ReferenceDatasetRelease',
        errorCode: 'ASSET_PRESERVATION_FAILED',
        errorMessage: asset.reason,
        severity: 'fatal',
        rawValue: { assetUri: asset.assetUri, checksum },
      },
    });
    return { run: failedRun, releaseId, approved: false, idempotent: false, assetUri: null };
  }

  // Resuming an interrupted run reuses its own doc/id; a fresh attempt
  // creates one now (not at the end) so staging can be tagged with its
  // real referenceImportRunId from the very first batch — the earlier
  // `pending-<idempotencyKey>` placeholder made every batch's staging rows
  // orphaned from the run that actually produced them.
  let runDoc = resuming ? existingRun : null;
  if (runDoc && releaseId && runDoc.referenceDatasetReleaseId !== releaseId) {
    await runs.updateOne(
      { referenceImportRunId: runDoc.referenceImportRunId },
      { $set: { referenceDatasetReleaseId: releaseId, updatedAt: new Date() } },
    );
    runDoc = { ...runDoc, referenceDatasetReleaseId: releaseId };
  }
  if (!runDoc) {
    runDoc = ReferenceImportRunModel.create({
      referenceDatasetReleaseId: releaseId,
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
  // A full run parses the preserved copy, the bytes whose hash was verified.
  for await (const entry of streamJsonLines((asset && asset.assetPath) || source.fixturePath)) {
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

  // INFERENCE, not a citation: the status path downloaded → staged →
  // active | rejected is read off RELEASE_STATUSES' order in the model.
  if (releaseDoc && releaseDoc.releaseStatus !== 'active') {
    await releases.updateOne({ referenceDatasetReleaseId: releaseId }, { $set: { releaseStatus: 'staged', updatedAt: new Date() } });
    releaseDoc = { ...releaseDoc, releaseStatus: 'staged' };
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

  let recordsInserted = 0;
  let recordsUpdated = 0;
  let recordsSkipped = 0;

  if (approved && !dryRun) {
    const promotion = await promote({ db, releases, concepts, relations, source, releaseDoc, stagedConcepts, stagedRelations, graphProjection });
    recordsInserted = promotion.recordsInserted;
    recordsUpdated = promotion.recordsUpdated;
    recordsSkipped = promotion.recordsSkipped;
    issues.push(...promotion.issues);
  } else if (releaseDoc && releaseDoc.releaseStatus !== 'active') {
    // A release already active stays so: a rejected re-run of its content
    // never demotes it.
    await releases.updateOne({ referenceDatasetReleaseId: releaseId }, { $set: { releaseStatus: 'rejected', updatedAt: new Date() } });
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

  return { run: runDoc, releaseId, approved, idempotent: false, assetUri: asset ? asset.assetUri : null };
}

/**
 * True when `run` is `failed` and every fatal issue recorded on it is
 * ASSET_PRESERVATION_FAILED. A failed run with any other fatal issue, or with
 * none, is not retried.
 */
async function failedOnAssetPreservation({ issuesCollection, run }) {
  if (run.runStatus !== 'failed') return false;
  const fatalIssues = await issuesCollection.find({ referenceImportRunId: run.referenceImportRunId, severity: 'fatal' }).toArray();
  return fatalIssues.length > 0 && fatalIssues.every((issue) => issue.errorCode === 'ASSET_PRESERVATION_FAILED');
}

/**
 * Ends a run `failed` on one fatal issue before anything is staged: a
 * `running` run is set to failed, else a failed run is created. A non-null
 * `releaseId` is set on the run and on the issue.
 */
async function recordFatalRun({ runs, issuesCollection, existingRun, newRun, releaseId, issue }) {
  const failedFields = {
    ...(releaseId ? { referenceDatasetReleaseId: releaseId } : {}),
    completedAt: new Date(),
    runStatus: 'failed',
    validationSummary: { fatal: 1, errors: 0, warnings: 0, rejectionRate: 0, approved: false },
  };
  let failedRun;
  if (existingRun) {
    await runs.updateOne(
      { referenceImportRunId: existingRun.referenceImportRunId },
      { $set: { ...failedFields, updatedAt: new Date() } },
    );
    failedRun = { ...existingRun, ...failedFields };
  } else {
    failedRun = ReferenceImportRunModel.create({
      referenceDatasetReleaseId: releaseId,
      ...newRun,
      startedAt: new Date(),
      ...failedFields,
    });
    await runs.insertOne(failedRun);
  }
  await issuesCollection.insertMany([
    ReferenceImportIssueModel.create({ ...issue, referenceImportRunId: failedRun.referenceImportRunId, referenceDatasetReleaseId: releaseId || 'unresolved' }),
  ]);
  return failedRun;
}

/**
 * RF028 AC1: the release a full run loads into, registered before its first
 * staging write. A resumed run keeps the release it already registered; a
 * run of the content the dataset's active release already holds reuses that
 * one; anything else registers a new release in `downloaded` status.
 */
async function resolveRelease({ releases, source, checksum, registration, existingRun }) {
  if (existingRun && existingRun.referenceDatasetReleaseId) {
    const registered = await releases.findOne({ referenceDatasetReleaseId: existingRun.referenceDatasetReleaseId });
    // A superseded, rolled-back or rejected release is history: a resume
    // never reactivates it (or rewrites its previousReleaseId), so the run
    // registers a new release instead.
    if (registered && RESUMABLE_RELEASE_STATUSES.includes(registered.releaseStatus)) return registered;
  }

  const existingActive = await releases.findOne({ datasetCode: source.datasetCode, releaseStatus: 'active' });
  const sameRelease = existingActive
    && existingActive.systemUri === source.systemUri
    && existingActive.datasetVersion === source.datasetVersion
    && existingActive.sourceChecksum === checksum;
  if (sameRelease) return existingActive;

  const releaseDoc = ReferenceDatasetReleaseModel.create(registration);
  await releases.insertOne(releaseDoc);
  return releaseDoc;
}

async function promote({ db, releases, concepts, relations, source, releaseDoc, stagedConcepts, stagedRelations, graphProjection }) {
  const issues = [];

  if (releaseDoc.releaseStatus !== 'active') {
    // INFERENCE, not a citation: previousReleaseId is set here, at promotion,
    // since the dataset's active release can change between registration
    // and promotion.
    const existingActive = await releases.findOne({ datasetCode: source.datasetCode, releaseStatus: 'active' });
    await releases.updateOne(
      { referenceDatasetReleaseId: releaseDoc.referenceDatasetReleaseId },
      {
        $set: {
          releaseStatus: 'active',
          previousReleaseId: existingActive ? existingActive.referenceDatasetReleaseId : null,
          updatedAt: new Date(),
        },
      },
    );
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
    // AC9: Mongo write is the source of truth, appended on the same request
    // the concept is actually inserted — never for the skip-existing branch
    // above, mirroring RF023's "append on write" outbox discipline. #1313
    // (RF023 AC3): the insert and its event share one transaction.
    await withTransactionWhereSupported(db, async (session) => {
      await concepts.insertOne(conceptDoc, ...(session ? [{ session }] : []));
      await graphProjection.appendTerminologyConceptEvent(db, {
        terminologyConceptId: conceptDoc.terminologyConceptId,
        systemUri: conceptDoc.systemUri,
        code: conceptDoc.code,
        version: conceptDoc.version,
        display: conceptDoc.display,
        conceptStatus: conceptDoc.conceptStatus,
        referenceDatasetReleaseId: conceptDoc.referenceDatasetReleaseId,
        sourceService: 'reference-imports-pipeline',
      }, { session });
    });
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
    await withTransactionWhereSupported(db, async (session) => {
      await relations.insertOne(relationDoc, ...(session ? [{ session }] : []));
      await graphProjection.appendTerminologyRelationEvent(db, {
        terminologyRelationId: relationDoc.terminologyRelationId,
        sourceConceptId: relationDoc.sourceConceptId,
        targetConceptId: relationDoc.targetConceptId,
        relationType: relationDoc.relationType,
        relationVersion: relationDoc.relationVersion,
        referenceDatasetReleaseId: relationDoc.referenceDatasetReleaseId,
        sourceService: 'reference-imports-pipeline',
      }, { session });
    });
    recordsInserted += 1;
  }

  return { recordsInserted, recordsUpdated, recordsSkipped, issues };
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
