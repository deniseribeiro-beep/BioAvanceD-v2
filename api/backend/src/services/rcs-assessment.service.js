const crypto = require('crypto');
const { getCollection } = require('../utils/collectionResolver');
const logger = require('../utils/logger');
const RcsAssessmentModel = require('../models/RcsAssessment');
const RcsInputSnapshotModel = require('../models/RcsInputSnapshot');

const isPlainObject = (value) => value !== null && typeof value === 'object'
  && !Array.isArray(value) && !(value instanceof Date);

/**
 * Persists one versioned RCS certification snapshot referenced by
 * specimenId. Sample.js keeps its own embedded copy of the same result for
 * backward compatibility (#383's foundational slice does not remove it) —
 * this is the canonical, referenced source going forward per dict-07's
 * "usar referências e snapshots versionados" guidance.
 */
async function recordAssessment(db, specimenId, certificationResult) {
  const rcsAssessmentId = crypto.randomUUID();
  // RF018 AC3 (#1320): the input the result was computed from is frozen,
  // and the assessment references it by id, URI and hash. Both documents
  // are built before either is written, so a build failure writes nothing.
  // A result with no rcs_input (one computed before the capture existed)
  // writes no snapshot and carries null references.
  const snapshot = isPlainObject(certificationResult?.rcs_input)
    ? RcsInputSnapshotModel.capture({
      rcsAssessmentId,
      specimenId: String(specimenId || '').trim(),
      matrix: certificationResult.matrix_type,
      sprecVersion: certificationResult.calculation_trace?.sprec_version ?? null,
      inputs: certificationResult.rcs_input,
    })
    : null;
  const assessment = RcsAssessmentModel.fromCertificationResult(specimenId, certificationResult, {
    rcsAssessmentId,
    inputSnapshotId: snapshot?.rcsInputSnapshotId ?? null,
    inputSnapshotUri: snapshot?.snapshotUri ?? null,
    inputSnapshotHash: snapshot?.snapshotHash ?? null,
  });

  let snapshots = null;
  if (snapshot) {
    snapshots = await getCollection(db, 'rcsInputSnapshots');
    // A shallow copy: the driver writes _id onto the object it is given, and
    // the snapshot is frozen.
    await snapshots.insertOne({ ...snapshot });
  }
  try {
    const collection = await getCollection(db, 'rcsAssessments');
    await collection.insertOne(assessment);
  } catch (error) {
    // No snapshot is left without the assessment it was captured for. A
    // failed delete is logged, and the insert error stays the one thrown.
    if (snapshot) {
      try {
        await snapshots.deleteOne({ rcsInputSnapshotId: snapshot.rcsInputSnapshotId });
      } catch (deleteError) {
        logger.error(`Falha ao remover o RCSInputSnapshot ${snapshot.rcsInputSnapshotId} sem avaliação:`, deleteError.message || deleteError);
      }
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
  getAssessmentsForSpecimen,
  getAssessmentById,
  getCurrentAssessmentsForSpecimens,
  findSpecimenIdsWithCurrentAssessmentMatching,
};
