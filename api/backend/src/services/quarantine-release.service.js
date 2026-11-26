const { getCollection } = require('../utils/collectionResolver');
const { SampleModel } = require('../models/Sample');
const QuarantineActionModel = require('../models/QuarantineAction');
const quarantineActionService = require('./quarantine-action.service');
const operationalStateDecisionService = require('./operationalStateDecision.service');
const consentService = require('./consent.service');
const { isConsentOwned } = require('./consentQuarantine.service');
const { GraphProjectionService } = require('./graphProjection.service');
const { withTransactionWhereSupported } = require('../utils/mongoTransaction');

const graphProjection = new GraphProjectionService();

// #1315 (RF019 AC5/AC6): a quarantined specimen is released only by an
// authorized actor (the route's gate), with evidence, and only once the rule
// behind each quarantine still open on it is satisfied. The release closes
// every open QuarantineAction, audits each with the evidence, returns the
// specimen to available and appends its OperationalStateDecision.
//
// The rules the system can check:
// - a consent quarantine needs the participant's consent active again;
// - a cold-chain quarantine needs its incident resolved, which moves the
//   action to pending_review (equipment-sensor-quarantine.service.js).
// Any other source (a nonconformance, the compliance graph, intake, a
// manual quarantine) is judged by the actor on the evidence. [inference]

const OPEN_STATUSES = ['active', 'pending_review'];
// The specimen consent states the update route already treats as a release
// (sample.routes.js, PUT /:id).
const CONSENT_STATUSES_SATISFYING = ['SIGNED', 'EXTERNAL_ATTACHED'];

class QuarantineReleaseError extends Error {
  constructor(message, statusCode, code, details = {}) {
    super(message);
    this.name = 'QuarantineReleaseError';
    this.statusCode = statusCode;
    this.code = code;
    Object.assign(this, details);
  }
}

async function unsatisfiedRuleOf(db, sample, action) {
  if (isConsentOwned(action)) {
    // A consent signed on paper, or an external consent document attached to
    // the specimen, satisfies the rule as the recorded consent does.
    if (CONSENT_STATUSES_SATISFYING.includes(String(sample.consentStatus || '').toUpperCase())) return null;
    const consent = sample.participantId ? await consentService.getPatientConsent(db, sample.participantId) : null;
    return String(consent?.status || '').toUpperCase() === 'ACTIVE' ? null : 'consent_not_active';
  }
  if ((action.reasonCodes || []).includes('COLD_CHAIN_INCIDENT') && action.actionStatus === 'active') {
    return 'cold_chain_incident_open';
  }
  return null;
}

async function releaseQuarantine(db, sample, { actorId, evidenceIds, reason = null, req = null, now = new Date() } = {}) {
  const evidence = Array.isArray(evidenceIds) ? evidenceIds.map((id) => String(id || '').trim()).filter(Boolean) : [];
  if (evidence.length === 0) {
    throw new QuarantineReleaseError('A liberação exige evidência (evidenceIds)', 422, 'EVIDENCE_REQUIRED');
  }
  const previousStatus = SampleModel.resolveSpecimenStatus(sample);
  if (previousStatus !== 'quarantined') {
    throw new QuarantineReleaseError(`A amostra não está em quarentena (specimenStatus=${previousStatus})`, 409, 'NOT_QUARANTINED');
  }

  const open = (await quarantineActionService.getActionsForSpecimen(db, sample))
    .filter((action) => OPEN_STATUSES.includes(action.actionStatus));
  const unsatisfied = [];
  for (const action of open) {
    const rule = await unsatisfiedRuleOf(db, sample, action);
    if (rule) unsatisfied.push({ quarantineActionId: action.quarantineActionId, rule });
  }
  if (unsatisfied.length) {
    throw new QuarantineReleaseError('A regra de uma quarentena ainda não foi satisfeita', 409, 'QUARANTINE_RULE_UNSATISFIED', { unsatisfied });
  }

  const actions = await getCollection(db, 'quarantineActions');
  const released = [];
  for (const action of open) {
    const closed = { ...QuarantineActionModel.release(action, now), authorizedBy: actorId };
    // #1510 (RF019 AC6): the close and its outbox event share one write.
    await withTransactionWhereSupported(db, async (session) => {
      await actions.updateOne(
        { quarantineActionId: action.quarantineActionId },
        { $set: { actionStatus: closed.actionStatus, releasedAt: closed.releasedAt, authorizedBy: closed.authorizedBy } },
        session ? { session } : undefined
      );
      await graphProjection.appendQuarantineReleaseEvent(db, {
        quarantineActionId: closed.quarantineActionId,
        specimenIds: closed.specimenIds,
        reasonCodes: closed.reasonCodes,
        actionStatus: closed.actionStatus,
        releasedAt: closed.releasedAt,
        authorizedBy: closed.authorizedBy,
        evidenceIds: evidence,
        sourceService: 'quarantine-release',
      }, session ? { session } : {});
    });
    await quarantineActionService.auditDecision(db, { decision: 'released', action: closed, req, details: { evidenceIds: evidence, reason } });
    released.push(closed);
  }

  const specimenId = quarantineActionService.canonicalSpecimenId(sample);
  await (await getCollection(db, 'samples')).updateOne(
    { _id: sample._id },
    { $set: { specimenStatus: 'available', quarantineReason: null, updatedAt: now } }
  );
  await operationalStateDecisionService.recordStatusChange(db, {
    specimenId,
    previousStatus,
    newStatus: 'available',
    triggerEventId: released.length ? released[released.length - 1].quarantineActionId : `quarantine-release:${specimenId}:${now.toISOString()}`,
    rulesApplied: ['quarantine_release'],
    reasonCodes: ['QUARANTINE_RELEASED'],
    occurredAt: now,
  });

  return { specimenId, specimenStatus: 'available', releasedActions: released, evidenceIds: evidence };
}

module.exports = {
  releaseQuarantine,
  QuarantineReleaseError,
};
