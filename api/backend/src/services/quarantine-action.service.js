const { getCollection } = require('../utils/collectionResolver');
const QuarantineActionModel = require('../models/QuarantineAction');

/**
 * Persists one QuarantineAction event referenced by specimenIds (1..* — one
 * action may cover a batch, e.g. every specimen tied to one cold-chain
 * sensor incident). Append-only, per dict-02's QuarantineAction entity —
 * mirrors #383/#388's RcsAssessment/SpecimenPreanalytics pattern.
 */
async function recordAction(db, data, session) {
  const collection = await getCollection(db, 'quarantineActions');
  const action = QuarantineActionModel.create(data);
  await collection.insertOne(action, session ? { session } : undefined);
  return action;
}

/** All quarantine actions covering a specimen, newest first. */
async function getActionsForSpecimen(db, specimenId, session) {
  const collection = await getCollection(db, 'quarantineActions');
  return collection
    .find({ specimenIds: String(specimenId) }, session ? { session } : undefined)
    .sort({ startedAt: -1 })
    .toArray();
}

/**
 * RF019 AC#7/AC#8 — release only by an authorized actor, audited. Releases
 * the most recent still-active action covering the specimen, if any.
 */
async function releaseActiveAction(db, specimenId, authorizedBy, releasedAt = new Date(), session) {
  const collection = await getCollection(db, 'quarantineActions');
  const sessionOptions = session ? { session } : undefined;
  const active = await collection
    .find({ specimenIds: String(specimenId), actionStatus: 'active' }, sessionOptions)
    .sort({ startedAt: -1 })
    .toArray();
  const current = active[0];
  if (!current) return null;

  const released = QuarantineActionModel.release(current, releasedAt);
  released.authorizedBy = authorizedBy ?? current.authorizedBy;
  await collection.updateOne(
    { quarantineActionId: current.quarantineActionId },
    { $set: { actionStatus: released.actionStatus, releasedAt: released.releasedAt, authorizedBy: released.authorizedBy } },
    sessionOptions
  );
  return released;
}

/**
 * Cold-chain incident resolved but samples still need human review before
 * release (RF019's AC#7 authorized-release gate isn't satisfied yet) —
 * moves the most recent still-active action covering the specimen to
 * `pending_review` without releasing it.
 */
async function markPendingReview(db, specimenId, session) {
  const collection = await getCollection(db, 'quarantineActions');
  const sessionOptions = session ? { session } : undefined;
  const active = await collection
    .find({ specimenIds: String(specimenId), actionStatus: 'active' }, sessionOptions)
    .sort({ startedAt: -1 })
    .toArray();
  const current = active[0];
  if (!current) return null;

  const updated = { ...current, actionStatus: 'pending_review' };
  await collection.updateOne(
    { quarantineActionId: current.quarantineActionId },
    { $set: { actionStatus: updated.actionStatus } },
    sessionOptions
  );
  return updated;
}

module.exports = {
  recordAction,
  getActionsForSpecimen,
  releaseActiveAction,
  markPendingReview,
};
