/**
 * ConsentDecisionEvent (RF010 AC4; dict v2.0.0 V2E-0121..0131): the
 * append-only record of one manifestation about a Consent -- its
 * acceptance, a revocation, or its supersession by a newer Consent of the
 * same participant. A Consent's current state is derived from these and its
 * ConsentRevocation rows (RF010 AC5); neither is ever updated.
 */
const crypto = require('crypto');

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

// The dictionary marks each vocabulary "internal governed" and names only an
// example: V2E-0124 `paper`, V2E-0126 `participant`, V2E-0127 `basic`,
// V2E-0128 `accepted`. The rest name the paths that record a manifestation.
const CHANNELS = ['paper', 'electronic_link', 'staff_portal', 'fhir_import', 'term_expiry'];
const SIGNER_ROLES = ['participant', 'legal_representative', 'staff_on_behalf'];
// basic: no authentication beyond the signature; token: a signed consent
// link; session: an authenticated staff session.
const AUTHENTICATION_LEVELS = ['basic', 'token', 'session'];
const DECISIONS = ['accepted', 'revoked', 'superseded'];

class ConsentDecisionEventModel {
  /** The canonical element names, for the catalog conformance test. */
  static fieldsOf(data = {}) {
    return {
      consentDecisionEventId: data.consentDecisionEventId,
      consentId: data.consentId,
      templateVersionId: data.templateVersionId,
      channel: data.channel,
      signerId: data.signerId,
      signerRole: data.signerRole,
      authenticationLevel: data.authenticationLevel,
      decision: data.decision,
      evidenceUri: data.evidenceUri,
      evidenceHash: data.evidenceHash,
      occurredAt: data.occurredAt,
    };
  }

  static validate(data = {}) {
    const errors = [];
    for (const field of ['consentId', 'templateVersionId', 'signerId', 'evidenceUri', 'evidenceHash']) {
      if (!isNonEmptyString(data[field])) errors.push(`${field} é obrigatório`);
    }
    if (!CHANNELS.includes(data.channel)) errors.push(`channel deve ser um de: ${CHANNELS.join(', ')}`);
    if (!SIGNER_ROLES.includes(data.signerRole)) errors.push(`signerRole deve ser um de: ${SIGNER_ROLES.join(', ')}`);
    if (!AUTHENTICATION_LEVELS.includes(data.authenticationLevel)) {
      errors.push(`authenticationLevel deve ser um de: ${AUTHENTICATION_LEVELS.join(', ')}`);
    }
    if (!DECISIONS.includes(data.decision)) errors.push(`decision deve ser um de: ${DECISIONS.join(', ')}`);
    return { isValid: errors.length === 0, errors };
  }

  static create(data = {}) {
    return {
      consentDecisionEventId: crypto.randomUUID(),
      consentId: data.consentId,
      participantId: data.participantId ?? null,
      templateVersionId: data.templateVersionId,
      channel: data.channel,
      signerId: data.signerId,
      signerRole: data.signerRole,
      authenticationLevel: data.authenticationLevel,
      decision: data.decision,
      evidenceUri: data.evidenceUri,
      evidenceHash: data.evidenceHash,
      occurredAt: data.occurredAt ? new Date(data.occurredAt) : new Date(),
      recordedAt: new Date(),
    };
  }
}

module.exports = ConsentDecisionEventModel;
module.exports.CHANNELS = CHANNELS;
module.exports.SIGNER_ROLES = SIGNER_ROLES;
module.exports.AUTHENTICATION_LEVELS = AUTHENTICATION_LEVELS;
module.exports.DECISIONS = DECISIONS;
module.exports.isNonEmptyString = isNonEmptyString;
