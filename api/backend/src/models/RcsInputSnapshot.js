const crypto = require('crypto');
const { canonicalJson } = require('./ConfigurationRelease');

// Canonical Data Model v2.0.0 RCSInputSnapshot (V2E-0497..0512), RF018 AC3,
// AC4, AC5 and AC10 (#1320): the one immutable, resolvable snapshot of the
// inputs an RCS assessment is computed from, with its matrix, its five
// preanalytical axis inputs, its governance evidence, its sources and its
// hash. create returns it deep-frozen: the frozen inputs of AC10.
//
// The RCS assessment write (services/rcs-assessment.service.js) freezes one
// before each assessment, and no score, grade or route reads it (see
// docs/decisions/2026-10-22-rcs-input-snapshot-structures.md and
// 2026-10-23-rcs-input-snapshot-write.md).

// V2E-0510's vocabulary is SHA-256. The synthetic examples write digests as
// `sha256:<hex>`; a bare 64-hex digest is the same value.
const SHA256 = /^(sha256:)?[a-f0-9]{64}$/i;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

const MATRICES = ['fluid', 'solid'];

// The serialization version of a capture() document: its fieldsOf keys plus
// `inputs`, hashed as canonical JSON.
const CAPTURE_SCHEMA_VERSION = '1.0.0';

// RF018 AC5, RULE-019 and RULE-020: the five axes of each matrix.
// INFERENCE, not a citation: the codes take the requisitos' and V2E-0515's
// `P_pre` spelling, not rcs-certification.service.js's `Ppre`; the service's
// codes are mapped when the assessment write is wired.
const AXIS_CODES = Object.freeze({
  fluid: Object.freeze(['P_pre', 'P_cent1', 'P_cent2', 'P_post', 'P_store']),
  solid: Object.freeze(['P_warm', 'P_cold', 'P_fix', 'P_fixTime', 'P_store']),
});

const REQUIRED_STRINGS = [
  'rcsInputSnapshotId', 'rcsAssessmentId', 'specimenId', 'matrixMappingReleaseId',
  'governanceEvidenceId', 'sprecVersion', 'sprecMappingReleaseId', 'snapshotUri',
];

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const isPlainObject = (value) => value !== null && typeof value === 'object'
  && !Array.isArray(value) && !(value instanceof Date);
const isValidDate = (value) => value instanceof Date && !Number.isNaN(value.getTime());
// INFERENCE, not a citation: materialTypeCode (V2E-0501) is a CodeableConcept,
// and the repo has no CodeableConcept shape; it takes the {systemUri, code,
// version, display} Coding shape LabelDefinition.js uses.
const isCoding = (value) => isPlainObject(value) && isNonEmptyString(value.systemUri) && isNonEmptyString(value.code);

// Object.freeze is shallow, so each array and plain object is copied and
// frozen level by level. A Date is kept as it is.
const deepFreeze = (value) => {
  if (Array.isArray(value)) return Object.freeze(value.map(deepFreeze));
  if (isPlainObject(value)) {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, deepFreeze(entry)])));
  }
  return value;
};

class RcsInputSnapshotModel {
  static fieldsOf(data = {}) {
    return {
      rcsInputSnapshotId: data.rcsInputSnapshotId || crypto.randomUUID(),
      rcsAssessmentId: data.rcsAssessmentId ?? null,
      specimenId: data.specimenId ?? null,
      matrix: data.matrix ?? null,
      materialTypeCode: data.materialTypeCode ?? null,
      matrixMappingReleaseId: data.matrixMappingReleaseId ?? null,
      preanalyticalAxes: Array.isArray(data.preanalyticalAxes) ? data.preanalyticalAxes : [],
      governanceEvidenceId: data.governanceEvidenceId ?? null,
      sprecVersion: data.sprecVersion ?? null,
      sprecMappingReleaseId: data.sprecMappingReleaseId ?? null,
      capturedAt: data.capturedAt ? new Date(data.capturedAt) : null,
      sourceEventIds: Array.isArray(data.sourceEventIds) ? data.sourceEventIds : [],
      snapshotUri: data.snapshotUri ?? null,
      snapshotHash: data.snapshotHash ?? null,
      schemaVersion: data.schemaVersion ?? null,
      immutable: data.immutable ?? true,
    };
  }

  static validate(data = {}) {
    const fields = this.fieldsOf(data);
    const errors = [];
    for (const field of REQUIRED_STRINGS) {
      if (!isNonEmptyString(fields[field])) errors.push(`${field} é obrigatório para RCSInputSnapshot (1..1)`);
    }
    if (!MATRICES.includes(fields.matrix)) {
      errors.push(`matrix deve ser um de: ${MATRICES.join('|')} (RF018 AC4): ${fields.matrix}`);
    }
    if (!isCoding(fields.materialTypeCode)) errors.push('materialTypeCode deve ser um Coding com systemUri e code');
    if (fields.preanalyticalAxes.length !== 5 || !fields.preanalyticalAxes.every(isNonEmptyString)) {
      errors.push('preanalyticalAxes deve ter exatamente 5 referências a RCSPreanalyticalAxisInput (5..5)');
    }
    if (!isValidDate(fields.capturedAt)) errors.push('capturedAt é obrigatório para RCSInputSnapshot (1..1, ISO 8601)');
    if (fields.sourceEventIds.length === 0 || !fields.sourceEventIds.every(isNonEmptyString)) {
      errors.push('sourceEventIds é obrigatório para RCSInputSnapshot (1..*, Reference)');
    }
    if (!isNonEmptyString(fields.snapshotHash) || !SHA256.test(fields.snapshotHash)) {
      errors.push(`snapshotHash deve ser um digest SHA-256: ${fields.snapshotHash}`);
    }
    if (!isNonEmptyString(fields.schemaVersion) || !SEMVER.test(fields.schemaVersion)) {
      errors.push(`schemaVersion deve ser SemVer (MAJOR.MINOR.PATCH): ${fields.schemaVersion}`);
    }
    // V2E-0512: a correction is a new snapshot, never an edit of this one.
    if (fields.immutable !== true) errors.push('immutable deve ser true: uma correção exige um novo RCSInputSnapshot');
    return { isValid: errors.length === 0, errors };
  }

  static create(data = {}) {
    const fields = this.fieldsOf({ ...data, capturedAt: data.capturedAt || new Date() });
    const { isValid, errors } = this.validate(fields);
    if (!isValid) throw new Error(errors.join('; '));
    return deepFreeze(fields);
  }

  // RF018 AC3 (#1320): the capture an assessment write takes of the input it
  // was computed from. `inputs` is the payload read set certify() consumes,
  // kept outside fieldsOf as RcsAssessment.create keeps assessedAt. A
  // reference no release or event backs yet is null or empty, never
  // fabricated, so a captured snapshot does not pass validate() until a later
  // slice writes the mapping releases and axis inputs. governanceEvidenceId
  // names the RCSGovernanceEvidenceSnapshot the write records, or is null.
  // The hash covers every key but itself and the URI, `inputs` included, and
  // the URI names the snapshot by id and pins that hash, as ReadinessReport
  // does (see docs/decisions/2026-10-23-rcs-input-snapshot-write.md).
  static capture(data = {}) {
    if (!isPlainObject(data.inputs)) throw new Error('inputs deve ser um objeto para RCSInputSnapshot.capture');
    const fields = this.fieldsOf({
      ...data,
      matrix: MATRICES.includes(data.matrix) ? data.matrix : null,
      materialTypeCode: null,
      matrixMappingReleaseId: null,
      preanalyticalAxes: [],
      governanceEvidenceId: isNonEmptyString(data.governanceEvidenceId) ? data.governanceEvidenceId : null,
      sprecVersion: data.sprecVersion ?? null,
      sprecMappingReleaseId: null,
      capturedAt: data.capturedAt || new Date(),
      sourceEventIds: [],
      snapshotUri: null,
      snapshotHash: null,
      schemaVersion: CAPTURE_SCHEMA_VERSION,
    });
    for (const field of ['rcsInputSnapshotId', 'rcsAssessmentId', 'specimenId']) {
      if (!isNonEmptyString(fields[field])) throw new Error(`${field} é obrigatório para RCSInputSnapshot.capture`);
    }
    const { snapshotUri, snapshotHash, ...content } = { ...fields, inputs: data.inputs };
    const hex = crypto.createHash('sha256').update(canonicalJson(content)).digest('hex');
    return deepFreeze({
      ...fields,
      inputs: data.inputs,
      snapshotUri: `urn:bioavanced:rcs-input-snapshot:${fields.rcsInputSnapshotId}#sha256=${hex}`,
      snapshotHash: `sha256:${hex}`,
    });
  }

  // RULE-019 and RULE-020: a fluid snapshot carries exactly the five fluid
  // axes and a solid one exactly the five solid axes, none of the other
  // matrix's. A missing, duplicated or foreign axisCode blocks the assessment.
  static checkAxisSet(matrix, axisInputs) {
    const errors = [];
    const expected = AXIS_CODES[matrix];
    if (!MATRICES.includes(matrix)) {
      errors.push(`matrix deve ser um de: ${MATRICES.join('|')} (RF018 AC4): ${matrix}`);
      return { isValid: false, errors };
    }
    const codes = (Array.isArray(axisInputs) ? axisInputs : []).map((input) => input?.axisCode);
    if (codes.length !== expected.length) {
      errors.push(`a matriz ${matrix} exige exatamente ${expected.length} eixos: ${codes.length} recebidos`);
    }
    for (const code of expected) {
      const count = codes.filter((entry) => entry === code).length;
      if (count === 0) errors.push(`eixo ausente para a matriz ${matrix}: ${code}`);
      if (count > 1) errors.push(`eixo duplicado para a matriz ${matrix}: ${code}`);
    }
    for (const code of new Set(codes)) {
      if (!expected.includes(code)) errors.push(`eixo não pertence à matriz ${matrix}: ${code}`);
    }
    return { isValid: errors.length === 0, errors };
  }
}

module.exports = RcsInputSnapshotModel;
module.exports.AXIS_CODES = AXIS_CODES;
module.exports.MATRICES = MATRICES;
module.exports.CAPTURE_SCHEMA_VERSION = CAPTURE_SCHEMA_VERSION;
