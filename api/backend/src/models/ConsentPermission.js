/**
 * ConsentPermission (RF010 AC3; dict v2.0.0 V2E-0113..0120): one computable
 * permission of a Consent -- its code, the purpose it covers, permit or deny,
 * the term version it was given under and its validity. Written once, when
 * the consent is recorded, from the answers to the term's granular
 * permissions; a later revocation narrows the consent's derived state and
 * never rewrites these rows.
 */
const crypto = require('crypto');

// V2E-0117's example is `permit`; an answer is a grant or a refusal.
const PERMISSION_DECISIONS = ['permit', 'deny'];
// #1347: the governed vocabulary of purposes, GA4GH DUO, as the reference
// data imports it (SRC_DUO) and an access request's duoCode is read.
const DUO_SYSTEM_URI = 'http://purl.obolibrary.org/obo/duo.owl';

class ConsentPermissionModel {
  /** The canonical element names, for the catalog conformance test. */
  static fieldsOf(data = {}) {
    return {
      consentPermissionId: data.consentPermissionId,
      consentId: data.consentId,
      permissionCode: data.permissionCode,
      purpose: data.purpose,
      decision: data.decision,
      conditions: data.conditions,
      policyVersion: data.policyVersion,
      validityPeriod: data.validityPeriod,
    };
  }

  /**
   * The rows for a consent's answers. `purpose` is the DUO concept the
   * term's permission names (#1347); a permission that names none keeps the
   * term's own label coded by its key, which no decision can compute on.
   */
  static fromAnswers({ consentId, participantId, responses = {}, template = {}, signedAt }) {
    const definitions = new Map((template.permissions || []).map((permission) => [permission.key, permission]));
    return Object.keys(responses).map((key) => ({
      consentPermissionId: crypto.randomUUID(),
      consentId,
      participantId: participantId ?? null,
      permissionCode: key,
      purpose: definitions.get(key)?.purposeCode
        ? { system: DUO_SYSTEM_URI, code: definitions.get(key).purposeCode, display: definitions.get(key).label || key }
        : { code: key, display: definitions.get(key)?.label || key },
      decision: responses[key] === true ? 'permit' : 'deny',
      conditions: [],
      policyVersion: template.version != null ? String(template.version) : null,
      validityPeriod: {
        start: template.validFrom ? new Date(template.validFrom) : new Date(signedAt),
        end: template.validTo ? new Date(template.validTo) : null,
      },
      recordedAt: new Date(),
    }));
  }
}

module.exports = ConsentPermissionModel;
module.exports.PERMISSION_DECISIONS = PERMISSION_DECISIONS;
module.exports.DUO_SYSTEM_URI = DUO_SYSTEM_URI;
