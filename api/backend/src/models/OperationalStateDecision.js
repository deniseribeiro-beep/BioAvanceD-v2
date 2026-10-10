const crypto = require('crypto');

// Canonical Data Model v2.0.0 OperationalStateDecision (V2E-0159..0167),
// RF006 AC7: one append-only record per change of a specimen's
// specimenStatus, naming the event that triggered it and the rules that
// decided it. Nothing updates or deletes one (operationalStateDecision.service.js).
//
// - previousStatus and newStatus are codes; the catalog's one example is
//   `available`. The values are whatever specimenStatus held and became,
//   so a decision records the v1.3.0 quantity values (`partial`,
//   `depleted`) until the specimenStatus set itself moves to v4 (#1201).
// - decisionResult accepts the catalog's one value, `permit`: a refused
//   change leaves the status as it was, and the refusal is the caller's
//   error, not a decision.
const DECISION_RESULT_VALUES = ['permit'];

function code(value) {
  return value ? String(value).trim().toLowerCase() : null;
}

class OperationalStateDecisionModel {
  static fieldsOf(data = {}) {
    return {
      operationalStateDecisionId: data.operationalStateDecisionId || crypto.randomUUID(),
      specimenId: data.specimenId ? String(data.specimenId) : null,
      previousStatus: code(data.previousStatus),
      newStatus: code(data.newStatus),
      triggerEventId: data.triggerEventId ? String(data.triggerEventId) : null,
      rulesApplied: Array.isArray(data.rulesApplied) ? data.rulesApplied.map(String) : [],
      decisionResult: code(data.decisionResult) || 'permit',
      reasonCodes: Array.isArray(data.reasonCodes) ? data.reasonCodes.filter(Boolean).map(String) : [],
      occurredAt: data.occurredAt ? new Date(data.occurredAt) : null,
    };
  }

  static create(data = {}) {
    const fields = this.fieldsOf(data);
    for (const field of ['specimenId', 'newStatus', 'triggerEventId']) {
      if (!fields[field]) {
        throw new Error(`${field} é obrigatório para OperationalStateDecision (1..1)`);
      }
    }
    if (!fields.rulesApplied.length) {
      throw new Error('rulesApplied é obrigatório para OperationalStateDecision (1..*)');
    }
    if (!DECISION_RESULT_VALUES.includes(fields.decisionResult)) {
      throw new Error(`decisionResult inválido: ${fields.decisionResult}`);
    }
    if (fields.previousStatus === fields.newStatus) {
      throw new Error('OperationalStateDecision registra uma mudança: newStatus igual a previousStatus');
    }
    return { ...fields, occurredAt: fields.occurredAt || new Date() };
  }
}

module.exports = OperationalStateDecisionModel;
module.exports.DECISION_RESULT_VALUES = DECISION_RESULT_VALUES;
