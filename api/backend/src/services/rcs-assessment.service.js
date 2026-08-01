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

module.exports = {
  recordAssessment,
  getAssessmentsForSpecimen,
};
