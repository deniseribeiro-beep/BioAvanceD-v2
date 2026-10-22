/**
 * RF028 AC8/AC9, RNF032 C8/C9: explicit promotion of an approved
 * ReferenceDatasetRelease and the rollback to the release before it, each
 * recorded as an AuditEvent. An import run leaves its release `approved`;
 * only promoteRelease makes it `active`.
 */
const ReferenceImportRunModel = require('../models/ReferenceImportRun');
const ReferenceImportIssueModel = require('../models/ReferenceImportIssue');
const TerminologyConceptModel = require('../models/TerminologyConcept');
const TerminologyRelationModel = require('../models/TerminologyRelation');
const { CANONICAL_COLLECTIONS } = require('../config/collections');
const { GraphProjectionService } = require('./graphProjection.service');
const { withTransactionWhereSupported } = require('../utils/mongoTransaction');
const auditLogger = require('../utils/auditLogger');

// A promotion claim older than this is taken to be from a crashed promotion,
// and another call may retake it.
const PROMOTION_CLAIM_STALE_MS = 10 * 60 * 1000;

async function auditRelease({ db, action, resourceId, message, payload, req }) {
  auditLogger.init(db);
  await auditLogger.log({
    action,
    resourceType: 'ReferenceDatasetRelease',
    resourceId,
    status: 'success',
    severity: 'critical',
    message,
    payload,
    req: req || undefined,
    module: 'Dados de referência',
    source: req ? 'api' : 'system',
  });
}

/**
 * Promotes an `approved` release: writes the concepts and relations its
 * approved full run staged, then sets it `active` with V2E-0490
 * `promotionApprovedBy` and supersedes the dataset's previous active release.
 * The records are written before the status flip, so a crash leaves the
 * release `approved` and a retry re-runs the idempotent record writes.
 */
async function promoteRelease({ db, releaseId, approvedBy, req = null, graphProjection = new GraphProjectionService() }) {
  if (typeof approvedBy !== 'string' || approvedBy.trim() === '') {
    return { promoted: false, reason: 'approver_required' };
  }

  const releases = db.collection(CANONICAL_COLLECTIONS.referenceDatasetReleases);
  const runs = db.collection(CANONICAL_COLLECTIONS.referenceImportRuns);
  const issuesCollection = db.collection(CANONICAL_COLLECTIONS.referenceImportIssues);
  const staging = db.collection(CANONICAL_COLLECTIONS.referenceImportStaging);
  const concepts = db.collection(CANONICAL_COLLECTIONS.terminologyConcepts);
  const relations = db.collection(CANONICAL_COLLECTIONS.terminologyRelations);

  const releaseDoc = releaseId ? await releases.findOne({ referenceDatasetReleaseId: releaseId }) : null;
  if (!releaseDoc) {
    return { promoted: false, reason: 'release_not_found' };
  }
  if (releaseDoc.releaseStatus !== 'approved') {
    return { promoted: false, reason: 'release_not_approved', releaseStatus: releaseDoc.releaseStatus };
  }

  // A run without a license also ends `completed`, with approved false, so
  // the approved run is picked by its validation summary, not by status.
  const completedRuns = await runs.find({ referenceDatasetReleaseId: releaseId, importMode: 'full', runStatus: 'completed' }).toArray();
  const approvedRun = completedRuns.find((run) => run.validationSummary && run.validationSummary.approved === true);
  if (!approvedRun) {
    return { promoted: false, reason: 'approved_run_not_found' };
  }

  const stagedDocs = await staging.find({ referenceImportRunId: approvedRun.referenceImportRunId }).toArray();
  const stagedConcepts = new Map(
    stagedDocs.filter((doc) => doc.entityType === 'TerminologyConcept').map((doc) => [doc.candidate.code, doc.candidate]),
  );
  const stagedRelations = stagedDocs.filter((doc) => doc.entityType === 'TerminologyRelation').map((doc) => doc.candidate);

  // The release is claimed before the first record write, so of two calls in
  // flight only one writes records; the other writes nothing.
  const claimedAt = new Date();
  const claim = await releases.updateOne(
    {
      referenceDatasetReleaseId: releaseId,
      releaseStatus: 'approved',
      $or: [
        { promotionClaimedAt: null },
        { promotionClaimedAt: { $exists: false } },
        { promotionClaimedAt: { $lt: new Date(claimedAt.getTime() - PROMOTION_CLAIM_STALE_MS) } },
      ],
    },
    { $set: { promotionClaimedAt: claimedAt } },
  );
  if (claim.matchedCount === 0) {
    const current = await releases.findOne({ referenceDatasetReleaseId: releaseId });
    if (current && current.releaseStatus !== 'approved') {
      return { promoted: false, reason: 'release_not_approved', releaseStatus: current.releaseStatus };
    }
    return { promoted: false, reason: 'promotion_in_progress' };
  }

  const issues = [];
  const codeToConceptId = new Map();
  let recordsInserted = 0;
  let recordsUpdated = 0;
  let recordsSkipped = 0;

  for (const candidate of stagedConcepts.values()) {
    const filter = { systemUri: releaseDoc.systemUri, code: candidate.code, version: releaseDoc.datasetVersion };
    const existingConcept = await concepts.findOne(filter);
    if (existingConcept) {
      codeToConceptId.set(candidate.code, existingConcept.terminologyConceptId);
      recordsSkipped += 1;
      continue;
    }
    const conceptDoc = TerminologyConceptModel.create({
      ...candidate,
      systemUri: releaseDoc.systemUri,
      version: releaseDoc.datasetVersion,
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
      relationVersion: releaseDoc.datasetVersion,
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
      relationVersion: releaseDoc.datasetVersion,
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

  // INFERENCE, not a citation: previousReleaseId is set here, at promotion,
  // since the dataset's active release can change between registration
  // and promotion.
  const existingActive = await releases.findOne({ datasetCode: releaseDoc.datasetCode, releaseStatus: 'active' });
  const previousReleaseId = existingActive ? existingActive.referenceDatasetReleaseId : null;
  const flipped = await releases.updateOne(
    { referenceDatasetReleaseId: releaseId, releaseStatus: 'approved' },
    {
      $set: {
        releaseStatus: 'active',
        previousReleaseId,
        promotionApprovedBy: approvedBy,
        promotionClaimedAt: null,
        updatedAt: new Date(),
      },
    },
  );
  if (flipped.matchedCount === 0) {
    // Another caller promoted it between the read above and this write.
    return { promoted: false, reason: 'release_not_approved' };
  }
  // Preserve history — supersede, never delete (Plano Integrado §7.2 step 10).
  if (existingActive) {
    await releases.updateOne(
      { referenceDatasetReleaseId: existingActive.referenceDatasetReleaseId },
      { $set: { releaseStatus: 'superseded', updatedAt: new Date() } },
    );
  }

  await runs.updateOne(
    { referenceImportRunId: approvedRun.referenceImportRunId },
    {
      $set: {
        recordsInserted,
        recordsUpdated,
        recordsSkipped,
        recordsRejected: (approvedRun.recordsRejected || 0) + issues.length,
        updatedAt: new Date(),
      },
    },
  );
  if (issues.length > 0) {
    await issuesCollection.insertMany(
      issues.map((issue) =>
        ReferenceImportIssueModel.create({ ...issue, referenceImportRunId: approvedRun.referenceImportRunId, referenceDatasetReleaseId: releaseId }),
      ),
    );
  }

  await auditRelease({
    db,
    action: 'PROMOTE',
    resourceId: releaseId,
    message: `Release de referência promovida (${releaseDoc.datasetCode} ${releaseDoc.datasetVersion})`,
    payload: { datasetCode: releaseDoc.datasetCode, datasetVersion: releaseDoc.datasetVersion, previousReleaseId, approvedBy },
    req,
  });

  return { promoted: true, releaseId, previousReleaseId, recordsInserted, recordsUpdated, recordsSkipped };
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
async function rollbackRelease({ db, datasetCode, initiatedBy = 'system:reference-data-bootstrap', req = null }) {
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

  // V2E-0491: the rolled-back release names the release it was rolled back to.
  await releases.updateOne(
    { referenceDatasetReleaseId: activeRelease.referenceDatasetReleaseId },
    { $set: { releaseStatus: 'rolled_back', rollbackTargetId: previousRelease.referenceDatasetReleaseId, updatedAt: new Date() } },
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

  await auditRelease({
    db,
    action: 'ROLLBACK',
    resourceId: activeRelease.referenceDatasetReleaseId,
    message: `Release de referência revertida (${datasetCode})`,
    payload: {
      datasetCode,
      rolledBackReleaseId: activeRelease.referenceDatasetReleaseId,
      activeReleaseId: previousRelease.referenceDatasetReleaseId,
      initiatedBy,
    },
    req,
  });

  return { rolledBack: true, run: runDoc, activeReleaseId: previousRelease.referenceDatasetReleaseId, rolledBackReleaseId: activeRelease.referenceDatasetReleaseId };
}

module.exports = { promoteRelease, rollbackRelease };
