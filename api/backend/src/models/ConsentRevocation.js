/**
 * ConsentRevocation (RF010 AC6; dict v2.0.0 V2E-0132..0139): a revocation
 * with its scope and prospective effect. It blocks the uses its scope names
 * from `effectiveAt` on; uses made before it, and the history, are kept
 * (`priorUseDisposition`). It is materialized by one ConsentDecisionEvent
 * (V2E-0139) and, like it, never updated.
 */
const crypto = require('crypto');
const { isNonEmptyString } = require('./ConsentDecisionEvent');

// `all` blocks every use; any other entry is a permission key of the
// revoked Consent's responses (the template's granular permissions).
const SCOPE_ALL = 'all';
// V2E-0137's example is `retain_history`; a revocation under a legal
// retention obligation (V2E-0138) keeps what that obligation names.
const PRIOR_USE_DISPOSITIONS = ['retain_history', 'retain_legal_obligation'];

class ConsentRevocationModel {
  /** The canonical element names, for the catalog conformance test. */
  static fieldsOf(data = {}) {
    return {
      consentRevocationId: data.consentRevocationId,
      consentId: data.consentId,
      scope: data.scope,
      effectiveAt: data.effectiveAt,
      reason: data.reason,
      priorUseDisposition: data.priorUseDisposition,
      retentionObligationIds: data.retentionObligationIds,
      decisionEventId: data.decisionEventId,
    };
  }

  /**
   * @param data the revocation request
   * @param permissionKeys the revoked Consent's permission keys, which a
   *   scope entry other than `all` must name
   */
  static validate(data = {}, permissionKeys = []) {
    const errors = [];
    if (!isNonEmptyString(data.consentId)) errors.push('consentId é obrigatório');
    if (!isNonEmptyString(data.decisionEventId)) errors.push('decisionEventId é obrigatório');
    if (!Array.isArray(data.scope) || data.scope.length === 0 || !data.scope.every(isNonEmptyString)) {
      errors.push('scope é obrigatório (ao menos um uso bloqueado)');
    } else {
      const unknown = data.scope.filter((entry) => entry !== SCOPE_ALL && !permissionKeys.includes(entry));
      if (unknown.length > 0) {
        errors.push(`scope deve ser "${SCOPE_ALL}" ou permissões do consentimento: ${unknown.join(', ')} não reconhecido(s)`);
      }
    }
    if (!PRIOR_USE_DISPOSITIONS.includes(data.priorUseDisposition)) {
      errors.push(`priorUseDisposition deve ser um de: ${PRIOR_USE_DISPOSITIONS.join(', ')}`);
    }
    if (data.retentionObligationIds !== undefined && data.retentionObligationIds !== null
      && (!Array.isArray(data.retentionObligationIds) || !data.retentionObligationIds.every(isNonEmptyString))) {
      errors.push('retentionObligationIds deve ser uma lista de identificadores');
    }
    if (data.reason !== undefined && data.reason !== null && typeof data.reason !== 'string') {
      errors.push('reason deve ser texto');
    }
    return { isValid: errors.length === 0, errors };
  }

  static create(data = {}) {
    const scope = data.scope.includes(SCOPE_ALL) ? [SCOPE_ALL] : [...new Set(data.scope)];
    return {
      consentRevocationId: data.consentRevocationId || crypto.randomUUID(),
      consentId: data.consentId,
      participantId: data.participantId ?? null,
      scope,
      effectiveAt: data.effectiveAt ? new Date(data.effectiveAt) : new Date(),
      reason: isNonEmptyString(data.reason) ? data.reason.trim() : null,
      priorUseDisposition: data.priorUseDisposition,
      retentionObligationIds: Array.isArray(data.retentionObligationIds) ? [...data.retentionObligationIds] : [],
      decisionEventId: data.decisionEventId,
      recordedAt: new Date(),
    };
  }
}

module.exports = ConsentRevocationModel;
module.exports.SCOPE_ALL = SCOPE_ALL;
module.exports.PRIOR_USE_DISPOSITIONS = PRIOR_USE_DISPOSITIONS;
