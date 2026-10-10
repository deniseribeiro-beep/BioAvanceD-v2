const { getCollection } = require('../utils/collectionResolver');
const OperationalStateDecisionModel = require('../models/OperationalStateDecision');

// #1315 (RF006 AC7): the append-only history of a specimen's specimenStatus.
// This module only appends and reads; it exports no update or delete. A
// caller that changes specimenStatus inside a transaction passes its
// session, so the decision lands with the status or not at all.

// Appends the decision when the status changes, and returns it; returns
// null when the status stays, since a decision records a change.
async function recordStatusChange(db, { specimenId, previousStatus, newStatus, triggerEventId, rulesApplied, reasonCodes, occurredAt }, { session } = {}) {
  if (String(previousStatus || '').toLowerCase() === String(newStatus || '').toLowerCase()) return null;
  const decision = OperationalStateDecisionModel.create({
    specimenId, previousStatus, newStatus, triggerEventId, rulesApplied, reasonCodes, occurredAt, decisionResult: 'permit',
  });
  await (await getCollection(db, 'operationalStateDecisions')).insertOne(decision, session ? { session } : undefined);
  return decision;
}

// A specimen's decisions, oldest first.
async function historyOf(db, specimenId) {
  const rows = await (await getCollection(db, 'operationalStateDecisions')).find({ specimenId: String(specimenId) }).toArray();
  return rows.sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt));
}

module.exports = {
  recordStatusChange,
  historyOf,
};
