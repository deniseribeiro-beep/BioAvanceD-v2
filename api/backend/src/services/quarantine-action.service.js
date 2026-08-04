const { getCollection } = require('../utils/collectionResolver');
const QuarantineActionModel = require('../models/QuarantineAction');

/**
 * Persists one QuarantineAction event referenced by specimenIds (1..* — one
 * action may cover a batch, e.g. every specimen tied to one cold-chain
 * sensor incident). Append-only, per dict-02's QuarantineAction entity —
 * mirrors #383/#388's RcsAssessment/SpecimenPreanalytics pattern.
 */
async function recordAction(db, data) {
  const collection = await getCollection(db, 'quarantineActions');
  const action = QuarantineActionModel.create(data);
  await collection.insertOne(action);
  return action;
}

/** All quarantine actions covering a specimen, newest first. */
async function getActionsForSpecimen(db, specimenId) {
  const collection = await getCollection(db, 'quarantineActions');
  return collection
    .find({ specimenIds: String(specimenId) })
    .sort({ startedAt: -1 })
    .toArray();
}

/**
 * RF019 AC#7/AC#8 — release only by an authorized actor, audited. Releases
 * the most recent still-active action covering the specimen, if any.
 */
async function releaseActiveAction(db, specimenId, authorizedBy, releasedAt = new Date()) {
  const collection = await getCollection(db, 'quarantineActions');
  const active = await collection
    .find({ specimenIds: String(specimenId), actionStatus: 'active' })
    .sort({ startedAt: -1 })
    .toArray();
  const current = active[0];
  if (!current) return null;

  const released = QuarantineActionModel.release(current, releasedAt);
  released.authorizedBy = authorizedBy ?? current.authorizedBy;
  await collection.updateOne(
    { quarantineActionId: current.quarantineActionId },
    { $set: { actionStatus: released.actionStatus, releasedAt: released.releasedAt, authorizedBy: released.authorizedBy } }
  );
  return released;
}

module.exports = {
  recordAction,
  getActionsForSpecimen,
  releaseActiveAction,
};
