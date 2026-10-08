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
   * The rows for a consent's answers. `purpose` is the term's own label for
   * the permission, coded by its key, until purposes are governed codes.
   */
  static fromAnswers({ consentId, participantId, responses = {}, template = {}, signedAt }) {
    const definitions = new Map((template.permissions || []).map((permission) => [permission.key, permission]));
    return Object.keys(responses).map((key) => ({
      consentPermissionId: crypto.randomUUID(),
      consentId,
      participantId: participantId ?? null,
      permissionCode: key,
      purpose: { code: key, display: definitions.get(key)?.label || key },
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
