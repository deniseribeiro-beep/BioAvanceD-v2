const { getCollection } = require('../utils/collectionResolver');
const rcsAssessmentService = require('./rcs-assessment.service');
const specimenPreanalyticsService = require('./specimen-preanalytics.service');

/**
 * #504 — one-time backfill: pins `sealedRcsAssessmentId`/
 * `sealedSpecimenPreanalyticsId` on samples written before #502 introduced
 * the seal-time pin, closing MerkleService.generateSampleHashFromSample's
 * backward-compat "resolve newest" fallback for them (that fallback stays
 * exposed to the original false-tamper bug if a re-assessment/re-import ever
 * records a newer snapshot for one of these specimenIds).
 *
 * Only touches samples missing the pin own-property (`hasOwnProperty`, same
 * check `generateSampleHashFromSample` uses) that also have a resolvable
 * snapshot for their specimenId; safe to run more than once — already-pinned
 * samples and samples with no snapshot are left untouched.
 */
async function backfillSealedSnapshotPins(db) {
  const samplesCollection = await getCollection(db, 'Specimen');
  const samples = await samplesCollection.find({}).toArray();

  const summary = { samplesProcessed: 0, rcsPinned: 0, sprecPinned: 0 };

  for (const sample of samples) {
    summary.samplesProcessed += 1;
    const specimenId = sample.specimenId;
    if (!specimenId) continue;

    const hasPinnedRcs = Object.prototype.hasOwnProperty.call(sample, 'sealedRcsAssessmentId');
    if (!hasPinnedRcs) {
      const [latestAssessment] = await rcsAssessmentService.getAssessmentsForSpecimen(db, specimenId);
      if (latestAssessment) {
        await samplesCollection.updateOne(
          { _id: sample._id },
          { $set: { sealedRcsAssessmentId: latestAssessment._id } }
        );
        summary.rcsPinned += 1;
      }
    }

    const hasPinnedSprec = Object.prototype.hasOwnProperty.call(sample, 'sealedSpecimenPreanalyticsId');
    if (!hasPinnedSprec) {
      const [latestProfile] = await specimenPreanalyticsService.getProfilesForSpecimen(db, specimenId);
      if (latestProfile) {
        await samplesCollection.updateOne(
          { _id: sample._id },
          { $set: { sealedSpecimenPreanalyticsId: latestProfile._id } }
        );
        summary.sprecPinned += 1;
      }
    }
  }

  return { summary };
}

module.exports = { backfillSealedSnapshotPins };
