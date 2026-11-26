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
const ReferenceCoverageManifestModel = require('../models/ReferenceCoverageManifest');
const { CANONICAL_COLLECTIONS } = require('../config/collections');
const { GraphProjectionService } = require('./graphProjection.service');
const { withTransactionWhereSupported } = require('../utils/mongoTransaction');
const auditLogger = require('../utils/auditLogger');
const { ensureTerminologyConceptIndexes, ensureTerminologyRelationIndexes } = require('../utils/terminologyIndexes');

// A promotion claim older than this is taken to be from a crashed promotion,
// and another call may retake it.
const PROMOTION_CLAIM_STALE_MS = 10 * 60 * 1000;

// #1561: records are looked up, inserted and their outbox events appended
// this many at a time, one transaction per batch where the deployment runs
// one.
const PROMOTION_BATCH_SIZE = 500;

function chunksOf(items, size) {
  const chunks = [];
  for (let start = 0; start < items.length; start += size) chunks.push(items.slice(start, start + size));
  return chunks;
}

const relationKey = ({ sourceConceptId, targetConceptId, relationType }) => `${sourceConceptId}|${targetConceptId}|${relationType}`;

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

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';

/**
 * RF028 AC6/AC7, RULE-017 "Block promotion": the refusal reason of a release
 * without a valid, justified coverage manifest (V2E-0489) and a passed
 * quality assessment of its own, or null when it has both. Only positive
 * evidence promotes.
 */
async function refuseWithoutCoverageAndQuality({ db, releaseDoc, releaseId }) {
  const manifest = isNonEmptyString(releaseDoc.coverageManifestId)
    ? await db.collection(CANONICAL_COLLECTIONS.referenceCoverageManifests).findOne({ referenceCoverageManifestId: releaseDoc.coverageManifestId })
    : null;
  if (!manifest) return 'coverage_manifest_missing';
  if (!ReferenceCoverageManifestModel.validate(manifest).isValid
    || manifest.referenceDatasetReleaseId !== releaseId
    || manifest.checksum !== ReferenceCoverageManifestModel.checksumOf(manifest)) {
    return 'coverage_manifest_invalid';
  }
  if (!['complete', 'justified'].includes(manifest.coverageResult)) return 'coverage_incomplete';

  const assessment = isNonEmptyString(releaseDoc.dataQualityAssessmentId)
    ? await db.collection(CANONICAL_COLLECTIONS.dataQualityAssessments).findOne({ dataQualityAssessmentId: releaseDoc.dataQualityAssessmentId })
    : null;
  if (!assessment || assessment.scopeType !== 'dataset_release' || assessment.scopeId !== releaseId) {
    return 'quality_assessment_missing';
  }
  if (assessment.status !== 'passed') return 'quality_assessment_failed';
  return null;
}

/**
 * Promotes an `approved` release: writes the concepts and relations its
 * approved full run staged, then sets it `active` with V2E-0490
 * `promotionApprovedBy` and supersedes the dataset's previous active release.
 * The records are written before the status flip, so a crash leaves the
 * release `approved` and a retry re-runs the idempotent record writes.
 */
async function promoteRelease({ db, releaseId, approvedBy, req = null, graphProjection = new GraphProjectionService(), batchSize = PROMOTION_BATCH_SIZE }) {
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

  const coverageRefusal = await refuseWithoutCoverageAndQuality({ db, releaseDoc, releaseId });
  if (coverageRefusal) {
    return { promoted: false, reason: coverageRefusal };
  }

  const stagedDocs = await staging.find({ referenceImportRunId: approvedRun.referenceImportRunId }).toArray();
  const stagedConcepts = new Map(
    stagedDocs.filter((doc) => doc.entityType === 'TerminologyConcept').map((doc) => [doc.candidate.code, doc.candidate]),
  );
  const stagedRelations = stagedDocs.filter((doc) => doc.entityType === 'TerminologyRelation').map((doc) => doc.candidate);

  // #1561: the natural-key indexes every lookup below reads, built before
  // the claim; a failed build throws and the release stays approved.
  await ensureTerminologyConceptIndexes(concepts);
  await ensureTerminologyRelationIndexes(relations);

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

  const size = Math.max(1, Number(batchSize) || PROMOTION_BATCH_SIZE);
  const sessionOptions = (session) => (session ? { session } : {});

  for (const batch of chunksOf([...stagedConcepts.values()], size)) {
    const existing = await concepts.find({
      systemUri: releaseDoc.systemUri,
      version: releaseDoc.datasetVersion,
      code: { $in: batch.map((candidate) => candidate.code) },
    }).toArray();
    const existingByCode = new Map(existing.map((concept) => [concept.code, concept]));
    const conceptDocs = [];
    for (const candidate of batch) {
      const existingConcept = existingByCode.get(candidate.code);
      if (existingConcept) {
        codeToConceptId.set(candidate.code, existingConcept.terminologyConceptId);
        recordsSkipped += 1;
        continue;
      }
      conceptDocs.push(TerminologyConceptModel.create({
        ...candidate,
        systemUri: releaseDoc.systemUri,
        version: releaseDoc.datasetVersion,
        referenceDatasetReleaseId: releaseDoc.referenceDatasetReleaseId,
      }));
    }
    if (conceptDocs.length === 0) continue;
    // AC9: Mongo write is the source of truth, appended on the same request
    // the concept is actually inserted — never for the skip-existing branch
    // above, mirroring RF023's "append on write" outbox discipline. #1313
    // (RF023 AC3): the inserts and their events share one transaction, one
    // per batch (#1561).
    await withTransactionWhereSupported(db, async (session) => {
      await concepts.insertMany(conceptDocs, { ordered: true, ...sessionOptions(session) });
      await graphProjection.appendTerminologyConceptEvents(db, conceptDocs.map((conceptDoc) => ({
        terminologyConceptId: conceptDoc.terminologyConceptId,
        systemUri: conceptDoc.systemUri,
        code: conceptDoc.code,
        version: conceptDoc.version,
        display: conceptDoc.display,
        conceptStatus: conceptDoc.conceptStatus,
        referenceDatasetReleaseId: conceptDoc.referenceDatasetReleaseId,
        sourceService: 'reference-imports-pipeline',
      })), { session });
    });
    for (const conceptDoc of conceptDocs) codeToConceptId.set(conceptDoc.code, conceptDoc.terminologyConceptId);
    recordsInserted += conceptDocs.length;
  }

  // A relation staged twice in this run is inserted once; the later copy
  // counts as skipped, as its lookup found the first.
  const promotedRelationKeys = new Set();
  for (const batch of chunksOf(stagedRelations, size)) {
    const resolved = [];
    for (const candidate of batch) {
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
      resolved.push({ sourceConceptId, targetConceptId, relationType: candidate.relationType });
    }
    if (resolved.length === 0) continue;
    const existing = await relations.find({
      relationVersion: releaseDoc.datasetVersion,
      sourceConceptId: { $in: [...new Set(resolved.map((relation) => relation.sourceConceptId))] },
    }).toArray();
    const existingKeys = new Set(existing.map(relationKey));
    const relationDocs = [];
    for (const relation of resolved) {
      const key = relationKey(relation);
      if (existingKeys.has(key) || promotedRelationKeys.has(key)) {
        recordsSkipped += 1;
        continue;
      }
      promotedRelationKeys.add(key);
      relationDocs.push(TerminologyRelationModel.create({
        ...relation,
        relationVersion: releaseDoc.datasetVersion,
        relationSystem: 'http://www.w3.org/2000/01/rdf-schema#subClassOf',
        referenceDatasetReleaseId: releaseDoc.referenceDatasetReleaseId,
      }));
    }
    if (relationDocs.length === 0) continue;
    await withTransactionWhereSupported(db, async (session) => {
      await relations.insertMany(relationDocs, { ordered: true, ...sessionOptions(session) });
      await graphProjection.appendTerminologyRelationEvents(db, relationDocs.map((relationDoc) => ({
        terminologyRelationId: relationDoc.terminologyRelationId,
        sourceConceptId: relationDoc.sourceConceptId,
        targetConceptId: relationDoc.targetConceptId,
        relationType: relationDoc.relationType,
        relationVersion: relationDoc.relationVersion,
        referenceDatasetReleaseId: relationDoc.referenceDatasetReleaseId,
        sourceService: 'reference-imports-pipeline',
      })), { session });
    });
    recordsInserted += relationDocs.length;
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

  // A run that staged nothing (the essential loader's, whose own job wrote
  // its records) keeps its counts.
  if (stagedDocs.length > 0) {
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
  }
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

module.exports = { promoteRelease, rollbackRelease, PROMOTION_BATCH_SIZE };
