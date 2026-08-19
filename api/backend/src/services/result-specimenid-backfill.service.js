const { ObjectId } = require('mongodb');

/**
 * #628 — one-time backfill: `Result.specimenId` replaces the legacy
 * `sampleID`/`sampleId` field (banned by canonical-data-contract-v1.md's
 * naming convention), which had stored inconsistent shapes depending on
 * write path — the Sample's Mongo `_id` string (POST /upload), a raw
 * caller-supplied value (POST /, PUT /:id/link-sample, pre-#628), or
 * occasionally the Sample's own legacy numeric `sampleID` field.
 *
 * Resolves each affected Result's linked Sample the same three-tier way
 * result.routes.js's live write paths now do (_id, then Sample.specimenId,
 * then the legacy numeric Sample.sampleID), sets `specimenId` to that
 * Sample's own canonical `specimenId`, and removes the legacy field.
 *
 * Only touches Result documents missing the `specimenId` own-property
 * (same idempotency check `sealed-snapshot-backfill.service.js` uses) —
 * safe to run more than once. A Result whose legacy identifier doesn't
 * resolve to any Sample is left untouched and counted as unresolved,
 * for manual follow-up rather than a silent drop.
 */
async function backfillResultSpecimenIds(db) {
  // Same literal collection names result.routes.js's own write paths use
  // (not the config-driven `getCollection(db, 'samples')` resolver) --
  // this must resolve against the exact same physical collections those
  // live write paths do.
  const resultsCollection = db.collection('results');
  const samplesCollection = db.collection('amostras');

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
    if (!sample && !Number.isNaN(Number(legacyId))) {
      sample = await samplesCollection.findOne({ sampleID: Number(legacyId) });
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
