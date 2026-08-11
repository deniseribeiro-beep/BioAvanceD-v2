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

/**
 * Batched "current profile" resolution for a page of samples (#517/#518,
 * SamplesPageView list view): one specimenPreanalytics query across every
 * specimenId on the page instead of one getProfilesForSpecimen call per
 * row, keyed by specimenId string for O(1) attachment by callers.
 *
 * Applies the same sealed-pin-else-newest precedent MerkleService.
 * generateSampleHashFromSample uses for integrity hashing: a sample with a
 * sealedSpecimenPreanalyticsId own-property resolves that exact snapshot
 * (so a later re-import doesn't drift what's shown for an already-sealed
 * sample), otherwise the newest recorded one.
 * @param {import('mongodb').Db} db
 * @param {Array<{_id?: any, specimenId: string, sealedSpecimenPreanalyticsId?: any}>} samples
 * @returns {Promise<Map<string, object|null>>}
 */
async function getCurrentProfilesForSpecimens(db, samples) {
  const specimenIds = [...new Set(samples.map((s) => String(s.specimenId || '')).filter(Boolean))];
  const result = new Map();
  if (!specimenIds.length) return result;

  const collection = await getCollection(db, 'specimenPreanalytics');
  const profiles = await collection
    .find({ specimenId: { $in: specimenIds } })
    .sort({ recordedAt: -1 })
    .toArray();

  const profilesBySpecimenId = new Map();
  for (const profile of profiles) {
    if (!profilesBySpecimenId.has(profile.specimenId)) {
      profilesBySpecimenId.set(profile.specimenId, []);
    }
    profilesBySpecimenId.get(profile.specimenId).push(profile);
  }

  for (const sample of samples) {
    const specimenId = String(sample.specimenId || '');
    const specimenProfiles = profilesBySpecimenId.get(specimenId) || [];
    const hasPinned = Object.prototype.hasOwnProperty.call(sample, 'sealedSpecimenPreanalyticsId')
      && sample.sealedSpecimenPreanalyticsId;
    const pinned = hasPinned
      ? specimenProfiles.find((p) => String(p._id) === String(sample.sealedSpecimenPreanalyticsId))
      : null;

    result.set(specimenId, pinned || specimenProfiles[0] || null);
  }

  return result;
}

module.exports = {
  recordProfile,
  getProfilesForSpecimen,
  getProfileById,
  getCurrentProfilesForSpecimens,
};
