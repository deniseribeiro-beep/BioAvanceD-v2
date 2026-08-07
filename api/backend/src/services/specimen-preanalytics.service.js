const { getCollection } = require('../utils/collectionResolver');
const SpecimenPreanalyticsModel = require('../models/SpecimenPreanalytics');

/**
 * Persists one versioned SPREC pre-analytic profile snapshot referenced by
 * specimenId. Sample.js keeps its own embedded copy of the same `sprec`
 * object for backward compatibility (#388's foundational slice does not
 * remove it) — this is the canonical, referenced source going forward per
 * dict-07's "usar referências e snapshots versionados" guidance (row 38
 * groups SPREC with RCS under the same directive #383 used).
 */
async function recordProfile(db, specimenId, sprecData) {
  const collection = await getCollection(db, 'specimenPreanalytics');
  const profile = SpecimenPreanalyticsModel.fromSprecData(specimenId, sprecData);
  await collection.insertOne(profile);
  return profile;
}

/** All snapshots for a specimen, newest first. */
async function getProfilesForSpecimen(db, specimenId) {
  const collection = await getCollection(db, 'specimenPreanalytics');
  return collection
    .find({ specimenId: String(specimenId) })
    .sort({ recordedAt: -1 })
    .toArray();
}

/**
 * One specific snapshot by its own _id — used to resolve the exact snapshot
 * a sample's merkleRoot was sealed against (#502), as opposed to
 * getProfilesForSpecimen's "newest" resolution which drifts if a later
 * snapshot is recorded for the same specimenId after sealing.
 */
async function getProfileById(db, id) {
  if (!id) return null;
  const collection = await getCollection(db, 'specimenPreanalytics');
  return collection.findOne({ _id: id });
}

module.exports = {
  recordProfile,
  getProfilesForSpecimen,
  getProfileById,
};
