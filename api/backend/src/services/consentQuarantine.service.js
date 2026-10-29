const { SampleModel } = require('../models/Sample');
const { getCollection } = require('../utils/collectionResolver');
const quarantineActionService = require('./quarantine-action.service');
const operationalStateDecisionService = require('./operationalStateDecision.service');

// #1315 (RF019 AC1, AC5; RF006 AC7): a relevant consent revocation
// quarantines the participant's specimens, and a restored consent releases
// only the quarantines consent opened. Each status change appends an
// OperationalStateDecision triggered by the QuarantineAction it applied or
// released.

const RULE = 'consent_revocation_quarantine';
// The reasons a consent decision quarantines under: a revocation here, a
// pending consent at intake (intakeWizard.routes.js).
const CONSENT_REASON_CODES = ['CONSENT_REVOKED', 'CONSENT_PENDING'];
// A consent change never rewrites a terminal specimen: `closed` (RF026
// AC7), or a not-yet-migrated destroyed/disposed document
// (SampleModel.isTerminalSpecimen).

function isConsentOwned(action) {
  return Array.isArray(action?.reasonCodes)
    && action.reasonCodes.length > 0
    && action.reasonCodes.every((code) => CONSENT_REASON_CODES.includes(String(code)));
}

async function quarantineForRevocation(db, participantId, { req = null } = {}) {
  const samplesCollection = await getCollection(db, 'samples');
  const samples = await samplesCollection.find({ participantId }).toArray();
  let quarantined = 0;

  for (const sample of samples) {
    const previousStatus = SampleModel.resolveSpecimenStatus(sample);
    if (SampleModel.isTerminalSpecimen(sample)) continue;
    await samplesCollection.updateOne(
      { _id: sample._id },
      { $set: { specimenStatus: 'quarantined', updatedAt: new Date() } }
    );
    if (previousStatus === 'quarantined') continue;

    const specimenId = quarantineActionService.canonicalSpecimenId(sample);
    const action = await quarantineActionService.recordAction(db, {
      specimenIds: [specimenId],
      reasonCodes: ['CONSENT_REVOKED'],
    });
    await quarantineActionService.auditDecision(db, { decision: 'applied', action, req });
    await operationalStateDecisionService.recordStatusChange(db, {
      specimenId,
      previousStatus,
      newStatus: 'quarantined',
      triggerEventId: action.quarantineActionId,
      rulesApplied: [RULE],
      reasonCodes: ['CONSENT_REVOKED'],
    });
    quarantined += 1;
  }
  return { matched: samples.length, quarantined };
}

// A specimen is released only when every quarantine still active on it is
// consent's own: a cold-chain, nonconformance or compliance quarantine stays
// until its own release. A quarantined specimen with no active action names
// no source, so it stays too. [inference] from the compliance graph's
// owned-action rule (SampleGraphValidator.js), applied to consent.
async function releaseForConsent(db, participantId, { req = null } = {}) {
  const samplesCollection = await getCollection(db, 'samples');
  const samples = await samplesCollection.find({ participantId, specimenStatus: 'quarantined' }).toArray();
  let released = 0;

  for (const sample of samples) {
    const actions = await quarantineActionService.getActionsForSpecimen(db, sample);
    const active = actions.filter((action) => action.actionStatus === 'active');
    if (active.length === 0 || !active.every(isConsentOwned)) continue;

    let lastReleased = null;
    for (let i = 0; i < active.length; i += 1) {
      lastReleased = await quarantineActionService.releaseActiveAction(db, sample, 'SYSTEM');
      await quarantineActionService.auditDecision(db, { decision: 'released', action: lastReleased, req });
    }
    await samplesCollection.updateOne(
      { _id: sample._id },
      { $set: { specimenStatus: 'available', updatedAt: new Date() } }
    );
    await operationalStateDecisionService.recordStatusChange(db, {
      specimenId: quarantineActionService.canonicalSpecimenId(sample),
      previousStatus: 'quarantined',
      newStatus: 'available',
      triggerEventId: lastReleased?.quarantineActionId || active[0].quarantineActionId,
      rulesApplied: [RULE],
      reasonCodes: ['CONSENT_RESTORED'],
    });
    released += 1;
  }
  return { matched: samples.length, released };
}

module.exports = {
  quarantineForRevocation,
  releaseForConsent,
  isConsentOwned,
  CONSENT_REASON_CODES,
};
