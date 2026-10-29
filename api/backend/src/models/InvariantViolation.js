const crypto = require('crypto');

// Canonical Data Model v2.0.0 InvariantViolation (V2E-0060..0066), RF019
// AC1/AC4: one record per governance invariant a change broke, naming the
// invariant, where it was detected, what was done about it, the evidence and
// the correlation that ties it to the refused change. Append-only: nothing
// updates or deletes one.
//
// - outcome is the invariant's own violationOutcome (CFG-003 makes every
//   catalogued invariant `block`); the dictionary lists no other value.
// - evidenceUri is optional (0..1); every other field is 1..1.
const OUTCOME_VALUES = ['block'];

class InvariantViolationModel {
  static fieldsOf(data = {}) {
    return {
      invariantViolationId: data.invariantViolationId || crypto.randomUUID(),
      invariantId: data.invariantId ? String(data.invariantId) : null,
      detectedAt: data.detectedAt ? new Date(data.detectedAt) : null,
      sourceComponent: data.sourceComponent ? String(data.sourceComponent) : null,
      outcome: data.outcome ? String(data.outcome).trim().toLowerCase() : null,
      evidenceUri: data.evidenceUri ? String(data.evidenceUri) : null,
      correlationId: data.correlationId ? String(data.correlationId) : null,
    };
  }

  static create(data = {}) {
    const fields = this.fieldsOf(data);
    for (const field of ['invariantId', 'sourceComponent', 'outcome', 'correlationId']) {
      if (!fields[field]) {
        throw new Error(`${field} é obrigatório para InvariantViolation (1..1)`);
      }
    }
    if (!OUTCOME_VALUES.includes(fields.outcome)) {
      throw new Error(`outcome inválido para InvariantViolation: ${fields.outcome}`);
    }
    return { ...fields, detectedAt: fields.detectedAt || new Date() };
  }
}

module.exports = InvariantViolationModel;
module.exports.OUTCOME_VALUES = OUTCOME_VALUES;
