const { getCollection } = require('../utils/collectionResolver');
const QuarantineActionModel = require('../models/QuarantineAction');
const { GraphProjectionService } = require('./graphProjection.service');
const { withTransactionWhereSupported } = require('../utils/mongoTransaction');

const graphProjection = new GraphProjectionService();

/**
 * #1219: an action names its specimens by the canonical specimenId. Rows
 * written before #1219 carry the sample's Mongo _id instead, so a lookup
 * handed a sample document matches both forms. Handed a bare id, it
 * matches that id only.
 */
function isSampleDocument(value) {
  return Boolean(value) && Object.getPrototypeOf(value) === Object.prototype
    && ('specimenId' in value || '_id' in value);
}

function specimenKeys(sampleOrId) {
  const values = isSampleDocument(sampleOrId)
    ? [sampleOrId.specimenId, sampleOrId._id]
    : (Array.isArray(sampleOrId) ? sampleOrId : [sampleOrId]);
  return [...new Set(values.filter((v) => v !== undefined && v !== null && v !== '').map(String))];
}

function specimenFilter(sampleOrId) {
  const keys = specimenKeys(sampleOrId);
  return keys.length === 1 ? keys[0] : { $in: keys };
}

/** The id a new action records for a sample: its specimenId, else its _id. */
function canonicalSpecimenId(sample) {
  return String(sample.specimenId || sample._id);
}

/**
 * Persists one QuarantineAction event referenced by specimenIds (1..* — one
 * action may cover a batch, e.g. every specimen tied to one cold-chain
 * sensor incident). Append-only, per dict-02's QuarantineAction entity —
 * mirrors #383/#388's RcsAssessment/SpecimenPreanalytics pattern.
 */
async function recordAction(db, data, session) {
  const collection = await getCollection(db, 'quarantineActions');
  const action = QuarantineActionModel.create(data);
  // #1505 (RF019 AC6): the insert and its QUARANTINE_APPLIED outbox event
  // share one write: the caller's session when it passes one, else a
  // transaction where the deployment runs one.
  const write = async (s) => {
    await collection.insertOne(action, s ? { session: s } : undefined);
    await graphProjection.appendQuarantineApplyEvent(db, {
      quarantineActionId: action.quarantineActionId,
      specimenIds: action.specimenIds,
      reasonCodes: action.reasonCodes,
      actionStatus: action.actionStatus,
      startedAt: action.startedAt,
      authorizedBy: action.authorizedBy,
      sourceService: 'quarantine-action',
    }, s ? { session: s } : {});
  };
  if (session) await write(session);
  else await withTransactionWhereSupported(db, write);
  return action;
}

/** All quarantine actions covering a specimen, newest first. */
async function getActionsForSpecimen(db, specimenId, session) {
  const collection = await getCollection(db, 'quarantineActions');
  return collection
    .find({ specimenIds: specimenFilter(specimenId) }, session ? { session } : undefined)
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
    .find({ specimenIds: specimenFilter(specimenId), actionStatus: 'active' }, sessionOptions)
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
    .find({ specimenIds: specimenFilter(specimenId), actionStatus: 'active' }, sessionOptions)
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

/**
 * RF019 AC#6 — audits a quarantine decision, applied or released, in the
 * audit log. For a caller that writes no audit record of its own: the
 * sample and cold-chain paths audit through their hash-chained movement
 * instead. A missing action (nothing was active to release) audits
 * nothing. auditLogger never throws; a failed write raises its own
 * AUDIT_TRAIL_WRITE_FAILURE alert.
 */
async function auditDecision(db, { decision, action, req = null, details = null } = {}) {
  if (!db || !action) return;
  const released = decision === 'released';
  const auditLogger = require('../utils/auditLogger');
  auditLogger.init(db);
  await auditLogger.log({
    action: released ? 'QUARANTINE_RELEASED' : 'QUARANTINE_APPLIED',
    resourceType: 'QuarantineAction',
    resourceId: action.quarantineActionId,
    status: 'success',
    severity: 'warning',
    message: released
      ? `Quarentena liberada (${action.specimenIds.length} espécime(s))`
      : `Quarentena aplicada (${action.reasonCodes.join(', ')})`,
    payload: {
      specimenIds: action.specimenIds,
      reasonCodes: action.reasonCodes,
      actionStatus: action.actionStatus,
      authorizedBy: action.authorizedBy ?? null,
      // RF019 AC5: a release's evidence and reason, when it carries them.
      ...(details || {}),
    },
    req,
    module: 'Quarentena',
  });
}

module.exports = {
  recordAction,
  getActionsForSpecimen,
  releaseActiveAction,
  markPendingReview,
  auditDecision,
  specimenKeys,
  canonicalSpecimenId,
};
