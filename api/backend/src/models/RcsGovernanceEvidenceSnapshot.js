const crypto = require('crypto');

// Canonical Data Model v2.0.0 RCSGovernanceEvidenceSnapshot
// (V2E-0524..0537), RF018 AC7, AC8 and AC10 (#1320): the six governance
// criteria of an RCS assessment, each kept individually, with their evidence,
// the version and checksum of the rule set and the aggregate gate result
// (eq:governance_product, G_gov = product of g_j).
//
// capture is what the assessment write records: the six criteria the gate
// evaluated on the frozen input, each true, false or null with its reason,
// with the references its evidence resolution resolved (none where the input
// presents no evidence), so no score, grade or route changes (see
// docs/decisions/2026-10-22-rcs-input-snapshot-structures.md and
// docs/decisions/2026-10-23-rcs-governance-evidence.md).

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

  // RF018 AC7 (#1320): the evidence an assessment write records. A criterion
  // the calculation did not read is null with its reason in
  // `unresolvedReasons`, kept outside fieldsOf as RcsInputSnapshot.capture
  // keeps `inputs`; a null gateResult carries its reason there too.
  // RNF018 AC5 (#1524), V2E-0532: evidenceRefs keeps the references the
  // input's evidence resolution resolved, else it is empty, so a captured
  // document with none still does not pass validate(). A present value that
  // is not a list of non-empty references is refused.
  static capture(data = {}) {
    if (data.evidenceRefs !== undefined && (!Array.isArray(data.evidenceRefs) || !data.evidenceRefs.every(isNonEmptyString))) {
      throw new Error('evidenceRefs deve ser uma lista de referências não vazias para RCSGovernanceEvidenceSnapshot.capture');
    }
    const fields = this.fieldsOf({ ...data, evaluatedAt: data.evaluatedAt || new Date() });
    if (!isValidDate(fields.evaluatedAt)) {
      throw new Error('evaluatedAt deve ser uma data válida para RCSGovernanceEvidenceSnapshot.capture');
    }
    for (const field of REQUIRED_STRINGS) {
      if (!isNonEmptyString(data[field])) throw new Error(`${field} é obrigatório para RCSGovernanceEvidenceSnapshot.capture`);
    }
    for (const flag of GOVERNANCE_FLAGS) {
      if (![true, false, null].includes(data[flag])) {
        throw new Error(`${flag} deve ser true, false ou null para RCSGovernanceEvidenceSnapshot.capture`);
      }
    }
    const { unresolvedReasons } = data;
    if (!isPlainObject(unresolvedReasons)) {
      throw new Error('unresolvedReasons deve ser um objeto para RCSGovernanceEvidenceSnapshot.capture');
    }
    const expectedKeys = [
      ...GOVERNANCE_FLAGS.filter((flag) => fields[flag] === null),
      ...(fields.gateResult === null ? ['gateResult'] : []),
    ].sort();
    const keys = Object.keys(unresolvedReasons).sort();
    if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
      throw new Error(`unresolvedReasons deve nomear exatamente: ${expectedKeys.join(', ')}`);
    }
    if (!Object.values(unresolvedReasons).every(isNonEmptyString)) {
      throw new Error('unresolvedReasons deve dar uma razão não vazia a cada chave');
    }
    if (fields.gateResult !== null) {
      if (!GATE_RESULTS.includes(fields.gateResult)) throw new Error(`gateResult inválido: ${fields.gateResult}`);
      if (fields.gateResult === 'pass') {
        // eq:governance_product: pass needs all six criteria true.
        if (!GOVERNANCE_FLAGS.every((flag) => fields[flag] === true)) {
          throw new Error('gateResult pass exige os seis critérios de governança true');
        }
      } else if (fields.failureReasons.length === 0 || !fields.failureReasons.every(isNonEmptyString)) {
        throw new Error(`failureReasons é obrigatório quando gateResult é ${fields.gateResult}`);
      }
    }
    // eq:governance_product: one false criterion gives G_gov = 0, so the
    // gate is fail, never null or review_required.
    if (GOVERNANCE_FLAGS.some((flag) => fields[flag] === false) && fields.gateResult !== 'fail') {
      throw new Error('gateResult deve ser fail quando um critério de governança é false (eq:governance_product)');
    }
    return deepFreeze({ ...fields, unresolvedReasons });
  }
}

module.exports = RcsGovernanceEvidenceSnapshotModel;
module.exports.GOVERNANCE_FLAGS = GOVERNANCE_FLAGS;
module.exports.GATE_RESULTS = GATE_RESULTS;
