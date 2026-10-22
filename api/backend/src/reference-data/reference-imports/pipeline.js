const { streamJsonLines, checksumFile } = require('./parseJsonLines');
const { processRecords } = require('./processRecords');
const ReferenceDatasetReleaseModel = require('../../models/ReferenceDatasetRelease');
const ReferenceImportRunModel = require('../../models/ReferenceImportRun');
const ReferenceImportIssueModel = require('../../models/ReferenceImportIssue');
const { CANONICAL_COLLECTIONS } = require('../../config/collections');
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
  assetStorageRoot = STORAGE_BASE,
}) {
  const releases = db.collection(CANONICAL_COLLECTIONS.referenceDatasetReleases);
  const runs = db.collection(CANONICAL_COLLECTIONS.referenceImportRuns);
  const issuesCollection = db.collection(CANONICAL_COLLECTIONS.referenceImportIssues);
  const staging = db.collection(CANONICAL_COLLECTIONS.referenceImportStaging);

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
  // approved | rejected is read off RELEASE_STATUSES' order in the model;
  // promoteRelease (RF028 AC8) alone moves an approved release to active.
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

  const fatalIssues = issues.filter((issue) => issue.severity === 'fatal');
  const rejectionRate = recordsRead > 0 ? issues.length / recordsRead : 0;
  const approved = fatalIssues.length === 0 && rejectionRate <= REJECTION_RATE_BLOCK_THRESHOLD && Boolean(source.license);

  // Records are written only when promoteRelease promotes the release.
  const recordsInserted = 0;
  const recordsUpdated = 0;
  const recordsSkipped = 0;

  if (approved && !dryRun) {
    // RF028 AC8: an approved run promotes nothing. Its release waits,
    // `approved`, for promoteRelease. Written before the run's final update:
    // a crash between the two leaves a `running` run, whose resume registers
    // a fresh release, never a `completed` run beside a `staged` release.
    if (releaseDoc.releaseStatus !== 'active') {
      await releases.updateOne({ referenceDatasetReleaseId: releaseId }, { $set: { releaseStatus: 'approved', updatedAt: new Date() } });
    }
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

module.exports = { runImport };
