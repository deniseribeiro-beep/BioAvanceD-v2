/**
 * CollectionGovernanceEvent (RF020 AC4; dict v2.0.0 V2E-0097..0104): the
 * append-only record of a collection's governance decision. `created` is the
 * first governance context a collection receives; `regime_change` converts
 * it between biobank and biorepository. Each names its justification and the
 * approvals it rests on (REL-0045, 1..*), and is never updated.
 */
const crypto = require('crypto');
const { GOVERNANCE_REGIMES } = require('./Collection');
const { isNonEmptyString } = require('./CollectionGovernanceApproval');

// V2E-0101's vocabulary cell names `created` and its example `regime_change`.
const DECISION_TYPES = ['created', 'regime_change'];

class CollectionGovernanceEventModel {
  /** The canonical element names, for the catalog conformance test. */
  static fieldsOf(data = {}) {
    return {
      collectionGovernanceEventId: data.collectionGovernanceEventId,
      collectionId: data.collectionId,
      previousRegime: data.previousRegime,
      newRegime: data.newRegime,
      decisionType: data.decisionType,
      approvalIds: data.approvalIds,
      justification: data.justification,
      occurredAt: data.occurredAt,
    };
  }

  static validate(data = {}) {
    const errors = [];
    if (!isNonEmptyString(data.collectionId)) errors.push('collectionId é obrigatório');
    if (!GOVERNANCE_REGIMES.includes(data.newRegime)) {
      errors.push(`newRegime deve ser um de: ${GOVERNANCE_REGIMES.join(', ')}`);
    }
    if (data.previousRegime !== null && data.previousRegime !== undefined && !GOVERNANCE_REGIMES.includes(data.previousRegime)) {
      errors.push(`previousRegime deve ser um de: ${GOVERNANCE_REGIMES.join(', ')}`);
    }
    if (!DECISION_TYPES.includes(data.decisionType)) {
      errors.push(`decisionType deve ser um de: ${DECISION_TYPES.join(', ')}`);
    }
    if (!Array.isArray(data.approvalIds) || data.approvalIds.length === 0 || !data.approvalIds.every(isNonEmptyString)) {
      errors.push('approvalIds é obrigatório (ao menos uma aprovação)');
    }
    if (!isNonEmptyString(data.justification)) errors.push('justification é obrigatório');
    return { isValid: errors.length === 0, errors };
  }

  static create(data = {}) {
    return {
      collectionGovernanceEventId: crypto.randomUUID(),
      collectionId: data.collectionId,
      previousRegime: data.previousRegime ?? null,
      newRegime: data.newRegime,
      decisionType: data.decisionType,
      approvalIds: [...new Set(data.approvalIds)],
      justification: data.justification.trim(),
      occurredAt: new Date(),
      recordedBy: data.recordedBy ?? null,
    };
  }
}

module.exports = CollectionGovernanceEventModel;
module.exports.DECISION_TYPES = DECISION_TYPES;
