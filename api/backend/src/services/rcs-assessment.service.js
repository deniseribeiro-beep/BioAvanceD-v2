const { getCollection } = require('../utils/collectionResolver');
const RcsAssessmentModel = require('../models/RcsAssessment');

/**
 * Persists one versioned RCS certification snapshot referenced by
 * specimenId. Sample.js keeps its own embedded copy of the same result for
 * backward compatibility (#383's foundational slice does not remove it) —
 * this is the canonical, referenced source going forward per dict-07's
 * "usar referências e snapshots versionados" guidance.
 */
async function recordAssessment(db, specimenId, certificationResult) {
  const collection = await getCollection(db, 'rcsAssessments');
  const assessment = RcsAssessmentModel.fromCertificationResult(specimenId, certificationResult);
  await collection.insertOne(assessment);
  return assessment;
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

module.exports = {
  recordAssessment,
  getAssessmentsForSpecimen,
  getAssessmentById,
};
