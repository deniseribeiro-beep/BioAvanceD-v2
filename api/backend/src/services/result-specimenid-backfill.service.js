const { ObjectId } = require('mongodb');
const { getCollection } = require('../utils/collectionResolver');

/**
 * #628 — one-time backfill: `Result.specimenId` replaces the legacy
 * `sampleID`/`sampleId` field (banned by canonical-data-contract-v1.md's
 * naming convention), which had stored inconsistent shapes depending on
 * write path — the Sample's Mongo `_id` string (POST /upload), a raw
 * caller-supplied value (POST /, PUT /:id/link-sample, pre-#628), or
 * occasionally the Sample's own legacy numeric `sampleID` field.
 *
 * Resolves each affected Result's linked Sample the same way
 * result.routes.js's live write paths now do (_id, then Sample.specimenId),
 * sets `specimenId` to that Sample's own canonical `specimenId`, and
 * removes the legacy field. A Result holding a numeric Sample.sampleID
 * stays unresolved: nothing writes that key to the samples collection, so
 * no lookup on it can match.
 *
 * Only touches Result documents missing the `specimenId` own-property
 * (same idempotency check `sealed-snapshot-backfill.service.js` uses) —
 * safe to run more than once. A Result whose legacy identifier doesn't
 * resolve to any Sample is left untouched and counted as unresolved,
 * for manual follow-up rather than a silent drop.
 */
async function backfillResultSpecimenIds(db) {
  // The same resolver result.routes.js and the sample writers use, so this
  // resolves against the physical collection samples are written to.
  const resultsCollection = db.collection('results');
  const samplesCollection = getCollection(db, 'samples');

  const results = await resultsCollection.find({}).toArray();

  const summary = { resultsProcessed: 0, migrated: 0, alreadyMigrated: 0, unresolved: 0 };

  for (const result of results) {
    summary.resultsProcessed += 1;

    if (Object.prototype.hasOwnProperty.call(result, 'specimenId')) {
      summary.alreadyMigrated += 1;
      continue;
    }

    const legacyId = result.sampleID ?? result.sampleId;
    if (legacyId === undefined || legacyId === null || legacyId === '') {
      summary.unresolved += 1;
      continue;
    }

    let sample = null;
    if (ObjectId.isValid(String(legacyId))) {
      sample = await samplesCollection.findOne({ _id: new ObjectId(legacyId) });
    }
    if (!sample) {
      sample = await samplesCollection.findOne({ specimenId: String(legacyId) });
    }

    if (!sample || !sample.specimenId) {
      summary.unresolved += 1;
      continue;
    }

    await resultsCollection.updateOne(
      { _id: result._id },
      { $set: { specimenId: sample.specimenId }, $unset: { sampleID: '', sampleId: '' } }
    );
    summary.migrated += 1;
  }

  return { summary };
}

module.exports = { backfillResultSpecimenIds };
