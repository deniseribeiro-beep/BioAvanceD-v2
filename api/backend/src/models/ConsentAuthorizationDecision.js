/**
 * ConsentAuthorizationDecision (RF010 AC7; dict v2.0.0 V2E-0140..0150): what
 * a consent in force says about one requested use -- permit, deny or
 * review_required -- with the rules applied and the reasons. It is recorded
 * where a use is evaluated against a consent (an access request's
 * compatibility evaluation) and never updated.
 */
const crypto = require('crypto');

// V2E-0148's example is `permit`; RF010 AC7 names the three.
const RESULTS = ['permit', 'deny', 'review_required'];
// Bump whenever the rules in `evaluateConsentAuthorization` change, so a
// stored decision names the rules it stood on (V2E-0145).
const CONSENT_AUTHORIZATION_POLICY_VERSION = 'rf010-consent-authorization/1.0.0';

/**
 * Evaluate a consent in force for a requested use. Pure: the caller found
 * the consent (status ACTIVE) and records the result.
 *
 * - consent_study_scope: a consent given for one study permits no other.
 * - consent_partial_revocation: a consent with permissions revoked by scope
 *   goes to review, since a purpose is not yet computable against the
 *   template's untyped permission keys.
 */
function evaluateConsentAuthorization(consent, use = {}) {
  const appliedRules = ['consent_in_force', 'consent_study_scope', 'consent_partial_revocation'];
  const denials = [];
  const reviews = [];

  if (consent.studyId && use.studyId && String(consent.studyId) !== String(use.studyId)) {
    denials.push(`consentimento restrito ao estudo ${consent.studyId}, uso solicitado para o estudo ${use.studyId}`);
  }
  if (consent.currentStateDerived === 'partially_revoked') {
    const scope = Array.isArray(consent.withdrawalScope) ? consent.withdrawalScope.join(', ') : '';
    reviews.push(`permissões revogadas (${scope}); a finalidade solicitada não é computável contra elas`);
  }

  let result = 'permit';
  let reasons = ['consentimento vigente, sem restrição aplicável ao uso'];
  if (denials.length > 0) {
    result = 'deny';
    reasons = denials;
  } else if (reviews.length > 0) {
    result = 'review_required';
    reasons = reviews;
  }
  return { result, appliedRules, reasons };
}

class ConsentAuthorizationDecisionModel {
  /** The canonical element names, for the catalog conformance test. */
  static fieldsOf(data = {}) {
    return {
      consentAuthorizationDecisionId: data.consentAuthorizationDecisionId,
      consentId: data.consentId,
      purpose: data.purpose,
      studyId: data.studyId,
      protocolId: data.protocolId,
      policyVersion: data.policyVersion,
      configurationReleaseId: data.configurationReleaseId,
      decisionAt: data.decisionAt,
      result: data.result,
      appliedRules: data.appliedRules,
      reasons: data.reasons,
    };
  }

  static create(data = {}) {
    if (!RESULTS.includes(data.result)) {
      throw new Error(`result deve ser um de: ${RESULTS.join(', ')}`);
    }
    return {
      consentAuthorizationDecisionId: crypto.randomUUID(),
      consentId: data.consentId,
      participantId: data.participantId ?? null,
      purpose: data.purpose ?? null,
      studyId: data.studyId ?? null,
      protocolId: data.protocolId ?? null,
      // What asked: the access request and item evaluated.
      accessRequestId: data.accessRequestId ?? null,
      itemId: data.itemId ?? null,
      policyVersion: CONSENT_AUTHORIZATION_POLICY_VERSION,
      configurationReleaseId: data.configurationReleaseId ?? null,
      decisionAt: data.decisionAt ? new Date(data.decisionAt) : new Date(),
      result: data.result,
      appliedRules: [...data.appliedRules],
      reasons: [...data.reasons],
    };
  }
}

module.exports = ConsentAuthorizationDecisionModel;
module.exports.RESULTS = RESULTS;
module.exports.CONSENT_AUTHORIZATION_POLICY_VERSION = CONSENT_AUTHORIZATION_POLICY_VERSION;
module.exports.evaluateConsentAuthorization = evaluateConsentAuthorization;
