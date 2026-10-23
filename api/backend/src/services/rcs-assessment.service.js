const crypto = require('crypto');
const { getCollection } = require('../utils/collectionResolver');
const logger = require('../utils/logger');
const RcsAssessmentModel = require('../models/RcsAssessment');
const RcsInputSnapshotModel = require('../models/RcsInputSnapshot');
const RcsGovernanceEvidenceSnapshotModel = require('../models/RcsGovernanceEvidenceSnapshot');
const rcsCertificationService = require('./rcs-certification.service');
const { RCS_SCOPE_STATEMENT } = require('./rcs-certification.service');
const env = require('../config/env');
const { canonicalJson } = require('../models/ConfigurationRelease');

const isPlainObject = (value) => value !== null && typeof value === 'object'
  && !Array.isArray(value) && !(value instanceof Date);

// RF018 AC1 (#1320): the result keys a recomputation must reproduce before
// the SPREC mapping release is named as the one that gave the result. They
// are the keys the FHIR staging preview keeps, so a preview-shaped result
// qualifies.
const REPRODUCED_KEYS = Object.freeze([
  'model_version', 'matrix_type', 'governance_status', 'p_bio',
  'rcs_score', 'final_grade', 'grade_route', 'axis_penalties',
]);
const reproducedKeysOf = (result) => canonicalJson(Object.fromEntries(
  REPRODUCED_KEYS.map((key) => [key, result?.[key] ?? null]),
));

// INFERENCE, not a citation: a release or rule package is named only on
// positive evidence that its tables give the stored result, i.e. certify()
// over the captured input reproduces it; otherwise null, never fabricated
// (see docs/decisions/2026-10-23-rcs-sprec-mapping-release.md and
// docs/decisions/2026-10-23-rcs-rule-package-and-scope.md).
function reproduces(certificationResult) {
  const recomputed = rcsCertificationService.certify(certificationResult.rcs_input);
  return reproducedKeysOf(recomputed) === reproducedKeysOf(certificationResult);
}

/**
 * Persists one versioned RCS certification snapshot referenced by
 * specimenId. Sample.js keeps its own embedded copy of the same result for
 * backward compatibility (#383's foundational slice does not remove it) —
 * this is the canonical, referenced source going forward per dict-07's
 * "usar referências e snapshots versionados" guidance.
 */
async function recordAssessment(db, specimenId, certificationResult) {
  const rcsAssessmentId = crypto.randomUUID();
  const now = new Date();
  // RF018 AC3 and AC7 (#1320): the input the result was computed from is
  // frozen, its six governance criteria are kept in one evidence record the
  // snapshot references, and the assessment references the snapshot by id,
  // URI and hash. Every document is built before any is written, so a build
  // failure writes nothing. A result with no rcs_input (one computed before
  // the capture existed) writes neither and carries null references.
  let snapshot = null;
  let evidence = null;
  // RF018 AC6 (#1320): each axis's resolution, kept only when the input's
  // matrix is this result's, as the AC4 resolution check below.
  let rcsAxisResults = [];
  // RF018 AC10 (#1320): the rule package and the environment it ran in, kept
  // only when the package reproduces this result.
  let rulePackage = null;
  let executionEnvironment = null;
  if (isPlainObject(certificationResult?.rcs_input)) {
    const axisResults = rcsCertificationService.evaluateAxisResults(certificationResult.rcs_input);
    if (axisResults.matrix === certificationResult.matrix_type) rcsAxisResults = axisResults.axes;
    const reproduced = reproduces(certificationResult);
    // RF018 AC1 (#1320): the SPREC mapping release, kept only when its tables
    // reproduce this result; otherwise no axis names a release the snapshot
    // does not.
    const sprecRelease = reproduced ? rcsCertificationService.sprecMappingRelease() : null;
    if (reproduced) rulePackage = rcsCertificationService.rulePackage();
    if (rulePackage) {
      executionEnvironment = {
        runtime: 'node',
        runtimeVersion: process.version,
        environment: env.NODE_ENV ?? null,
        packageVersion: rulePackage.version,
      };
    }
    if (!sprecRelease) {
      rcsAxisResults = rcsAxisResults.map((axis) => ({ ...axis, severityMappingReleaseId: null }));
    }
    const rcsInputSnapshotId = crypto.randomUUID();
    const governanceEvidenceSnapshotId = crypto.randomUUID();
    evidence = RcsGovernanceEvidenceSnapshotModel.capture({
      ...rcsCertificationService.evaluateGovernanceEvidence(certificationResult.rcs_input),
      governanceEvidenceSnapshotId,
      snapshotId: rcsInputSnapshotId,
      evaluatedAt: now,
    });
    // RF018 AC4 (#1320): the material and mapping release are kept only when the
    // resolution's matrix is this result's matrix.
    const resolution = rcsCertificationService.matrixResolution(certificationResult.rcs_input);
    const resolved = resolution.matrix === certificationResult.matrix_type;
    snapshot = RcsInputSnapshotModel.capture({
      rcsInputSnapshotId,
      rcsAssessmentId,
      specimenId: String(specimenId || '').trim(),
      matrix: certificationResult.matrix_type,
      materialTypeCode: resolved ? resolution.materialTypeCode : null,
      matrixMappingReleaseId: resolved ? resolution.matrixMappingReleaseId : null,
      sprecMappingReleaseId: sprecRelease ? sprecRelease.sprecMappingReleaseId : null,
      sprecVersion: certificationResult.calculation_trace?.sprec_version ?? null,
      governanceEvidenceId: governanceEvidenceSnapshotId,
      capturedAt: now,
      inputs: certificationResult.rcs_input,
    });
  }
  // RF018 AC8 (#1320): the reasons for the result's route.
  const routeReasons = rcsCertificationService.routeReasons(certificationResult);
  const assessment = RcsAssessmentModel.fromCertificationResult(specimenId, certificationResult, {
    rcsAssessmentId,
    inputSnapshotId: snapshot?.rcsInputSnapshotId ?? null,
    inputSnapshotUri: snapshot?.snapshotUri ?? null,
    inputSnapshotHash: snapshot?.snapshotHash ?? null,
    routeReasons,
    rcsAxisResults,
    rulePackageVersion: rulePackage?.version ?? null,
    rulePackageChecksum: rulePackage?.checksum ?? null,
    executionEnvironment,
    // RF018 AC10 and AC11 (#1320): the route's reasons, then the statement
    // that the RCS is not clinical validity, so the list is never empty.
    justifications: [...routeReasons, RCS_SCOPE_STATEMENT],
  });

  // No snapshot or evidence is left without the assessment it was captured
  // for. A failed delete is logged, and the insert error stays the one thrown.
  const removeSnapshot = async (snapshots) => {
    try {
      await snapshots.deleteOne({ rcsInputSnapshotId: snapshot.rcsInputSnapshotId });
    } catch (deleteError) {
      logger.error(`Falha ao remover o RCSInputSnapshot ${snapshot.rcsInputSnapshotId} sem avaliação:`, deleteError.message || deleteError);
    }
  };
  const removeEvidence = async (evidenceSnapshots) => {
    try {
      await evidenceSnapshots.deleteOne({ governanceEvidenceSnapshotId: evidence.governanceEvidenceSnapshotId });
    } catch (deleteError) {
      logger.error(`Falha ao remover o RCSGovernanceEvidenceSnapshot ${evidence.governanceEvidenceSnapshotId} sem avaliação:`, deleteError.message || deleteError);
    }
  };

  let snapshots = null;
  let evidenceSnapshots = null;
  if (snapshot) {
    snapshots = await getCollection(db, 'rcsInputSnapshots');
    // A shallow copy: the driver writes _id onto the object it is given, and
    // the snapshot and the evidence are frozen.
    await snapshots.insertOne({ ...snapshot });
    try {
      evidenceSnapshots = await getCollection(db, 'rcsGovernanceEvidenceSnapshots');
      await evidenceSnapshots.insertOne({ ...evidence });
    } catch (error) {
      await removeSnapshot(snapshots);
      throw error;
    }
  }
  try {
    const collection = await getCollection(db, 'rcsAssessments');
    await collection.insertOne(assessment);
  } catch (error) {
    if (snapshot) {
      await removeEvidence(evidenceSnapshots);
      await removeSnapshot(snapshots);
    }
    throw error;
  }
  return assessment;
}

/** The RCSInputSnapshot an assessment's inputSnapshotId names (RF018 AC3). */
async function getInputSnapshotById(db, rcsInputSnapshotId) {
  if (!rcsInputSnapshotId) return null;
  const collection = await getCollection(db, 'rcsInputSnapshots');
  return collection.findOne({ rcsInputSnapshotId });
}

/** The RCSGovernanceEvidenceSnapshot a snapshot's governanceEvidenceId names (RF018 AC7). */
async function getGovernanceEvidenceById(db, governanceEvidenceSnapshotId) {
  if (!governanceEvidenceSnapshotId) return null;
  const collection = await getCollection(db, 'rcsGovernanceEvidenceSnapshots');
  return collection.findOne({ governanceEvidenceSnapshotId });
}

/** All snapshots for a specimen, newest first. */
async function getAssessmentsForSpecimen(db, specimenId) {
  const collection = await getCollection(db, 'rcsAssessments');
  return collection
    .find({ specimenId: String(specimenId) })
    .sort({ assessedAt: -1 })
    .toArray();
}

/**
 * One specific snapshot by its own _id — used to resolve the exact snapshot
 * a sample's merkleRoot was sealed against (#502), as opposed to
 * getAssessmentsForSpecimen's "newest" resolution which drifts if a later
 * snapshot is recorded for the same specimenId after sealing.
 */
async function getAssessmentById(db, id) {
  if (!id) return null;
  const collection = await getCollection(db, 'rcsAssessments');
  return collection.findOne({ _id: id });
}

/**
 * Batched "current assessment" resolution for a page of samples (#525),
 * mirroring specimen-preanalytics.service.js#getCurrentProfilesForSpecimens
 * (#517/#518): one rcsAssessments query across every specimenId on the page
 * instead of one getAssessmentsForSpecimen call per row, keyed by specimenId
 * string for O(1) attachment by callers.
 *
 * Same sealed-pin-else-newest precedent MerkleService.
 * generateSampleHashFromSample uses for integrity hashing: a sample with a
 * sealedRcsAssessmentId own-property resolves that exact snapshot, otherwise
 * the newest recorded one.
 * @param {import('mongodb').Db} db
 * @param {Array<{_id?: any, specimenId: string, sealedRcsAssessmentId?: any}>} samples
 * @returns {Promise<Map<string, object|null>>}
 */
async function getCurrentAssessmentsForSpecimens(db, samples) {
  const specimenIds = [...new Set(samples.map((s) => String(s.specimenId || '')).filter(Boolean))];
  const result = new Map();
  if (!specimenIds.length) return result;

  const collection = await getCollection(db, 'rcsAssessments');
  const assessments = await collection
    .find({ specimenId: { $in: specimenIds } })
    .sort({ assessedAt: -1 })
    .toArray();

  const assessmentsBySpecimenId = new Map();
  for (const assessment of assessments) {
    if (!assessmentsBySpecimenId.has(assessment.specimenId)) {
      assessmentsBySpecimenId.set(assessment.specimenId, []);
    }
    assessmentsBySpecimenId.get(assessment.specimenId).push(assessment);
  }

  for (const sample of samples) {
    const specimenId = String(sample.specimenId || '');
    const specimenAssessments = assessmentsBySpecimenId.get(specimenId) || [];
    const hasPinned = Object.prototype.hasOwnProperty.call(sample, 'sealedRcsAssessmentId')
      && sample.sealedRcsAssessmentId;
    const pinned = hasPinned
      ? specimenAssessments.find((a) => String(a._id) === String(sample.sealedRcsAssessmentId))
      : null;

    result.set(specimenId, pinned || specimenAssessments[0] || null);
  }

  return result;
}

/**
 * Specimen IDs whose *current* (newest-recorded) RcsAssessment snapshot
 * matches every given field condition — used by reports.routes.js's
 * final_grade filter builder (#525) to query through the canonical entity
 * instead of Sample's embedded finalGrade copy. Same "newest per specimenId,
 * not sealed-pin, resolved in application code" approach as
 * specimen-preanalytics.service.js#findSpecimenIdsWithCurrentProfileMatching
 * — see that function's doc comment for why.
 *
 * @param {import('mongodb').Db} db
 * @param {Record<string, unknown>} matchFields exact-equality field:value pairs
 * @returns {Promise<string[]|null>} matching specimenIds, or null if matchFields was empty
 */
async function findSpecimenIdsWithCurrentAssessmentMatching(db, matchFields = {}) {
  const fieldEntries = Object.entries(matchFields).filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (!fieldEntries.length) return null;

  const collection = await getCollection(db, 'rcsAssessments');
  const rows = await collection.find({}).sort({ assessedAt: -1 }).toArray();

  const seen = new Set();
  const matchingSpecimenIds = [];
  for (const row of rows) {
    if (seen.has(row.specimenId)) continue;
    seen.add(row.specimenId);
    if (fieldEntries.every(([field, value]) => row[field] === value)) {
      matchingSpecimenIds.push(row.specimenId);
    }
  }

  return matchingSpecimenIds;
}

module.exports = {
  recordAssessment,
  getInputSnapshotById,
  getGovernanceEvidenceById,
  getAssessmentsForSpecimen,
  getAssessmentById,
  getCurrentAssessmentsForSpecimens,
  findSpecimenIdsWithCurrentAssessmentMatching,
};
