/**
 * ConfigurationChangeEvent (RF014 AC7, CFG-008, RNF023 C6; dict v2.0.0
 * V2E-0052..0059): one append-only row per configuration lifecycle step.
 * Never updated: a rollback is its own event pointing at the activation it
 * undoes (`rollbackOf`).
 */
const crypto = require('crypto');

// V2E-0054's extraction keeps `proposed` as the vocabulary and `activated`
// as the example. RF014 AC7 names the steps to record: "proposta,
// aprovação, ativação, rollback e tentativa de violação".
const CHANGE_TYPES = ['proposed', 'approved', 'activated', 'rolled_back', 'violation_attempted'];

class ConfigurationChangeEventModel {
  /** The canonical element names, for the catalog conformance test. */
  static fieldsOf(data = {}) {
    return {
      configurationChangeEventId: data.configurationChangeEventId,
      releaseId: data.releaseId,
      changeType: data.changeType,
      actorId: data.actorId,
      approvalId: data.approvalId,
      impactSummary: data.impactSummary,
      occurredAt: data.occurredAt,
      rollbackOf: data.rollbackOf,
    };
  }

  static validate(data = {}) {
    const errors = [];
    for (const field of ['configurationChangeEventId', 'releaseId', 'actorId', 'impactSummary']) {
      if (!data[field] || typeof data[field] !== 'string') {
        errors.push(`${field} é obrigatório e deve ser string`);
      }
    }
    if (!CHANGE_TYPES.includes(data.changeType)) {
      errors.push(`changeType deve ser um de: ${CHANGE_TYPES.join('|')}`);
    }
    if (!(data.occurredAt instanceof Date)) {
      errors.push('occurredAt é obrigatório');
    }
    if (data.changeType === 'rolled_back' && !data.rollbackOf) {
      errors.push('um evento rolled_back precisa de rollbackOf');
    }
    return { isValid: errors.length === 0, errors };
  }

  static create({ releaseId, changeType, actorId, impactSummary, approvalId = null, rollbackOf = null, occurredAt = new Date() } = {}) {
    const event = {
      configurationChangeEventId: crypto.randomUUID(),
      releaseId,
      changeType,
      actorId,
      approvalId,
      impactSummary,
      occurredAt,
      rollbackOf,
    };
    const { isValid, errors } = ConfigurationChangeEventModel.validate(event);
    if (!isValid) throw new Error(`ConfigurationChangeEvent inválido: ${errors.join('; ')}`);
    return event;
  }
}

module.exports = ConfigurationChangeEventModel;
module.exports.CHANGE_TYPES = CHANGE_TYPES;
