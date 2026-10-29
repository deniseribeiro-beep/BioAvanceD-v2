/**
 * ConsentAuthorizationDecision (RF010 AC7; dict v2.0.0 V2E-0140..0150): what
 * a consent in force says about one requested use -- permit, deny or
 * review_required -- with the rules applied and the reasons. It is recorded
 * where a use is evaluated against a consent (an access request's
 * compatibility evaluation) and never updated.
 */
const crypto = require('crypto');
const { DUO_SYSTEM_URI } = require('./ConsentPermission');

// V2E-0148's example is `permit`; RF010 AC7 names the three.
const RESULTS = ['permit', 'deny', 'review_required'];
// Bump whenever the rules in `evaluateConsentAuthorization` change, so a
// stored decision names the rules it stood on (V2E-0145).
const CONSENT_AUTHORIZATION_POLICY_VERSION = 'rf010-consent-authorization/1.1.0';

/**
 * Evaluate a consent in force for a requested use. Pure: the caller found
 * the consent (status ACTIVE) and records the result.
 *
 * - consent_study_scope: a consent given for one study permits no other.
 * - consent_partial_revocation: a consent with permissions revoked by scope
 *   is judged on the requested purpose where it is computable (#1347):
 *   the request names a DUO code and every permission the consent granted
 *   names one. A granted permission covers the request when its code is the
 *   request's or an `is_a` ancestor of it (GA4GH DUO matching). Covered by
 *   one still in effect: no restriction; covered only by revoked ones: deny;
 *   covered by none, or not computable: review.
 *
 * `context.permissions` are the consent's ConsentPermission rows and
 * `context.requestedPurposeCodes` the request's DUO code with its ancestors;
 * the caller reads both.
 */
function purposeCoverage(consent, use, { permissions = [], requestedPurposeCodes = null } = {}) {
  if (!use.duoCode || !requestedPurposeCodes || requestedPurposeCodes.size === 0) {
    return 'not_computable';
  }
  const granted = permissions.filter((row) => row.decision === 'permit');
  if (granted.length === 0 || granted.some((row) => row.purpose?.system !== DUO_SYSTEM_URI || !row.purpose?.code)) {
    return 'not_computable';
  }
  const covering = granted.filter((row) => requestedPurposeCodes.has(row.purpose.code));
  if (covering.length === 0) {
    return 'not_covered';
  }
  const effective = consent.effectivePermissions || {};
  return covering.some((row) => effective[row.permissionCode] === true) ? 'permitted' : 'revoked';
}

function evaluateConsentAuthorization(consent, use = {}, context = {}) {
  const appliedRules = ['consent_in_force', 'consent_study_scope', 'consent_partial_revocation'];
  const denials = [];
  const reviews = [];

  if (consent.studyId && use.studyId && String(consent.studyId) !== String(use.studyId)) {
    denials.push(`consentimento restrito ao estudo ${consent.studyId}, uso solicitado para o estudo ${use.studyId}`);
  }
  if (consent.currentStateDerived === 'partially_revoked') {
    const scope = Array.isArray(consent.withdrawalScope) ? consent.withdrawalScope.join(', ') : '';
    const coverage = purposeCoverage(consent, use, context);
    if (coverage === 'revoked') {
      denials.push(`a finalidade solicitada (${use.duoCode}) foi revogada pelo participante (${scope})`);
    } else if (coverage === 'not_covered') {
      reviews.push(`permissões revogadas (${scope}); nenhuma permissão concedida cobre a finalidade solicitada (${use.duoCode})`);
    } else if (coverage === 'not_computable') {
      reviews.push(`permissões revogadas (${scope}); a finalidade solicitada não é computável contra elas`);
    }
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
