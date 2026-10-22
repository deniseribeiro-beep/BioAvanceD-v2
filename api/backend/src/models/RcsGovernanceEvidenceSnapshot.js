const crypto = require('crypto');

// Canonical Data Model v2.0.0 RCSGovernanceEvidenceSnapshot
// (V2E-0524..0537), RF018 AC7, AC8 and AC10 (#1320): the six governance
// criteria of an RCS assessment, each kept individually, with their evidence,
// the version and checksum of the rule set and the aggregate gate result
// (eq:governance_product, G_gov = product of g_j).
//
// No flow writes this model yet. A later #1320 slice wires it into the
// assessment write, so no score, grade or route changes here (see
// docs/decisions/2026-10-22-rcs-input-snapshot-structures.md).

// V2E-0534's vocabulary is SHA-256. The synthetic examples write digests as
// `sha256:<hex>`; a bare 64-hex digest is the same value.
const SHA256 = /^(sha256:)?[a-f0-9]{64}$/i;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

const GOVERNANCE_FLAGS = [
  'metadataComplete', 'terminologyValid', 'traceabilityOk', 'monitoringOk', 'documentationOk', 'semanticCompatible',
];

// INFERENCE, not a citation: V2E-0536's cell reads only `pass`; the set
// reuses RCSAssessment.governanceGateResult's (ENUM-0069..0071).
const GATE_RESULTS = ['pass', 'fail', 'review_required'];

const REQUIRED_STRINGS = ['governanceEvidenceSnapshotId', 'snapshotId'];

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const isPlainObject = (value) => value !== null && typeof value === 'object'
  && !Array.isArray(value) && !(value instanceof Date);
const isValidDate = (value) => value instanceof Date && !Number.isNaN(value.getTime());

// Object.freeze is shallow, so each array and plain object is copied and
// frozen level by level. A Date is kept as it is.
const deepFreeze = (value) => {
  if (Array.isArray(value)) return Object.freeze(value.map(deepFreeze));
  if (isPlainObject(value)) {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, deepFreeze(entry)])));
  }
  return value;
};

class RcsGovernanceEvidenceSnapshotModel {
  static fieldsOf(data = {}) {
    return {
      governanceEvidenceSnapshotId: data.governanceEvidenceSnapshotId || crypto.randomUUID(),
      snapshotId: data.snapshotId ?? null,
      metadataComplete: data.metadataComplete ?? null,
      terminologyValid: data.terminologyValid ?? null,
      traceabilityOk: data.traceabilityOk ?? null,
      monitoringOk: data.monitoringOk ?? null,
      documentationOk: data.documentationOk ?? null,
      semanticCompatible: data.semanticCompatible ?? null,
      evidenceRefs: Array.isArray(data.evidenceRefs) ? data.evidenceRefs : [],
      validationRuleSetVersion: data.validationRuleSetVersion ?? null,
      validationRuleSetChecksum: data.validationRuleSetChecksum ?? null,
      evaluatedAt: data.evaluatedAt ? new Date(data.evaluatedAt) : null,
      gateResult: data.gateResult ?? null,
      failureReasons: Array.isArray(data.failureReasons) ? data.failureReasons : [],
    };
  }

  static validate(data = {}) {
    const fields = this.fieldsOf(data);
    const errors = [];
    for (const field of REQUIRED_STRINGS) {
      if (!isNonEmptyString(fields[field])) errors.push(`${field} é obrigatório para RCSGovernanceEvidenceSnapshot (1..1)`);
    }
    // RF018 AC7: each criterion is kept individually; a missing one is an
    // error, never read as false.
    for (const flag of GOVERNANCE_FLAGS) {
      if (typeof fields[flag] !== 'boolean') errors.push(`${flag} é obrigatório para RCSGovernanceEvidenceSnapshot (1..1, boolean)`);
    }
    if (fields.evidenceRefs.length === 0 || !fields.evidenceRefs.every(isNonEmptyString)) {
      errors.push('evidenceRefs é obrigatório para RCSGovernanceEvidenceSnapshot (1..*, Reference)');
    }
    if (!isNonEmptyString(fields.validationRuleSetVersion) || !SEMVER.test(fields.validationRuleSetVersion)) {
      errors.push(`validationRuleSetVersion deve ser SemVer (MAJOR.MINOR.PATCH): ${fields.validationRuleSetVersion}`);
    }
    if (!isNonEmptyString(fields.validationRuleSetChecksum) || !SHA256.test(fields.validationRuleSetChecksum)) {
      errors.push(`validationRuleSetChecksum deve ser um digest SHA-256: ${fields.validationRuleSetChecksum}`);
    }
    if (!isValidDate(fields.evaluatedAt)) {
      errors.push('evaluatedAt é obrigatório para RCSGovernanceEvidenceSnapshot (1..1, ISO 8601)');
    }
    if (!GATE_RESULTS.includes(fields.gateResult)) {
      errors.push(`gateResult inválido: ${fields.gateResult}`);
    } else if (fields.gateResult === 'pass') {
      // eq:governance_product: G_gov = product of g_j, so one criterion not
      // true refuses pass; the gate is not compensable.
      if (!GOVERNANCE_FLAGS.every((flag) => fields[flag] === true)) {
        errors.push('gateResult pass exige os seis critérios de governança true');
      }
    } else if (fields.failureReasons.length === 0 || !fields.failureReasons.every(isNonEmptyString)) {
      // V2E-0537: failureReasons is required when gateResult is not pass.
      errors.push(`failureReasons é obrigatório quando gateResult é ${fields.gateResult}`);
    }
    return { isValid: errors.length === 0, errors };
  }

  static create(data = {}) {
    const fields = this.fieldsOf({ ...data, evaluatedAt: data.evaluatedAt || new Date() });
    const { isValid, errors } = this.validate(fields);
    if (!isValid) throw new Error(errors.join('; '));
    return deepFreeze(fields);
  }
}

module.exports = RcsGovernanceEvidenceSnapshotModel;
module.exports.GOVERNANCE_FLAGS = GOVERNANCE_FLAGS;
module.exports.GATE_RESULTS = GATE_RESULTS;
