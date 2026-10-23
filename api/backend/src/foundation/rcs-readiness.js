/**
 * RF022 AC3, plano §9 "RCS" and §11's RCS tests (#1320): the Foundation
 * job's `rcs` readiness gate. It checks, over this build's rule package and
 * with no database, that the releases are named and checksummed, that each
 * matrix has its five weighted axes, that the six governance criteria are
 * evaluated and capturable, that an input snapshot's hash is stable and
 * pinned, and that golden vectors recalculate to their expected scores,
 * grades, routes and reasons (see
 * docs/decisions/2026-10-23-foundation-rcs-readiness-gate.md).
 *
 * Any throw fails the gate closed, with its message as evidence.
 */
const rcsCertificationService = require('../services/rcs-certification.service');
const { AXES } = require('../services/rcs-certification.service');
const RcsInputSnapshotModel = require('../models/RcsInputSnapshot');
const RcsGovernanceEvidenceSnapshotModel = require('../models/RcsGovernanceEvidenceSnapshot');
const { canonicalJson } = require('../models/ConfigurationRelease');

const { AXIS_CODES } = RcsInputSnapshotModel;
const { GOVERNANCE_FLAGS } = RcsGovernanceEvidenceSnapshotModel;

const CHECKSUM = /^sha256:[0-9a-f]{64}$/;
const GATE_ID = 'foundation-rcs-gate';
const FIXED_AT = new Date('2026-01-01T00:00:00Z');
const MATRICES = ['fluid', 'solid'];

const FLUID = {
  matrixType: 'fluid', sampleType: 'BLD', primaryContainer: 'SST', preCentrifugation: 'A', centrifugation: 'A',
  secondCentrifugation: 'A', postCentrifugationDelay: 'A', longTermStorage: 'C',
};
const SOLID = {
  matrixType: 'solid', sampleType: 'TIS', collectionType: 'SRG', primaryContainer: 'SRG', warmIschemia: 'A',
  coldIschemia: 'A', fixationType: 'SNP', fixationTime: 'B', longTermStorage: 'C',
};

const scored = (rcsScore, finalGrade, gradeRoute = 'Score-based certification') => ({
  rcs_score: rcsScore, final_grade: finalGrade, grade_route: gradeRoute, governance_failure_reasons: [],
});
const governanceFailure = (reason) => ({
  rcs_score: null, final_grade: 'E', grade_route: 'Governance failure', governance_failure_reasons: [reason],
});

// Plano §11: golden vectors for both matrices, classes A to E, the
// governance failures and the unknown and Not scored codes.
const RCS_GOLDEN_VECTORS = Object.freeze([
  { name: 'fluid-ideal', sprec: FLUID, expected: scored(100, 'A') },
  { name: 'solid-ideal', sprec: SOLID, expected: scored(100, 'A') },
  { name: 'solid-b', sprec: { ...SOLID, warmIschemia: 'C', fixationType: 'NBF' }, expected: scored(85.05, 'B') },
  { name: 'fluid-mid', sprec: { ...FLUID, preCentrifugation: 'E', longTermStorage: 'B' }, expected: scored(73, 'C') },
  { name: 'fluid-d', sprec: { ...FLUID, preCentrifugation: 'M', postCentrifugationDelay: 'I' }, expected: scored(50, 'D') },
  {
    name: 'fluid-e',
    sprec: { ...FLUID, preCentrifugation: 'M', postCentrifugationDelay: 'I', centrifugation: 'I' },
    expected: scored(35, 'E', 'Score critical penalty'),
  },
  { name: 'fluid-unknown', sprec: { ...FLUID, preCentrifugation: 'X' }, expected: governanceFailure('Unknown SPREC code') },
  {
    name: 'fluid-other',
    sprec: { ...FLUID, preCentrifugation: 'Z' },
    expected: governanceFailure('Other SPREC code without validated local interpretation'),
  },
  {
    name: 'fluid-incompatible',
    sprec: { ...FLUID, preCentrifugation: 'SNP' },
    expected: governanceFailure('SPREC code incompatible with matrix or axis'),
  },
  { name: 'no-matrix', sprec: { sampleType: 'QQQ' }, expected: governanceFailure('Missing or invalid matrix type') },
].map((vector) => Object.freeze(vector)));

const EXPECTED_KEYS = ['rcs_score', 'final_grade', 'grade_route', 'governance_failure_reasons'];

const vectorNamed = (name) => RCS_GOLDEN_VECTORS.find((vector) => vector.name === name);
const payloadOf = ({ sprec }) => (sprec.matrixType ? { matrixType: sprec.matrixType, sprec } : { sprec });
const deepCopy = (value) => JSON.parse(JSON.stringify(value));

function releasesCheck(releases) {
  const failures = [];
  for (const [name, release] of Object.entries(releases)) {
    if (!release) failures.push(`${name} is null`);
    else if (!CHECKSUM.test(release.checksum ?? '')) failures.push(`${name} checksum ${release.checksum}`);
  }
  for (const name of ['matrixMappingRelease', 'sprecMappingRelease']) {
    const status = releases[name]?.status;
    if (status !== 'active') failures.push(`${name} status ${status}, expected active`);
  }
  return failures;
}

function axesCheck(service) {
  const failures = [];
  for (const matrix of MATRICES) {
    const axes = AXES[matrix] || [];
    if (axes.length !== 5) failures.push(`${matrix}: ${axes.length} axes, expected 5`);
    const weights = (service.data.weights || []).filter((item) => item.matrix_type === matrix);
    for (const { axis_code: axisCode } of axes) {
      const rows = weights.filter((item) => item.axis_code === axisCode).length;
      if (rows !== 1) failures.push(`${matrix}.${axisCode}: ${rows} weight rows, expected 1`);
    }
    const sum = weights.reduce((total, item) => total + Number(item.weight), 0);
    if (sum !== 100) failures.push(`${matrix}: weights sum ${sum}, expected 100`);
    const mapped = axes.map((axis) => axis.axis_code.replace(/^P/, 'P_'));
    if (JSON.stringify(mapped) !== JSON.stringify(AXIS_CODES[matrix])) {
      failures.push(`${matrix}: axis codes ${mapped.join(',')}, expected ${(AXIS_CODES[matrix] || []).join(',')}`);
    }
  }
  return failures;
}

function governanceEvidenceCheck(service) {
  const failures = [];
  if (GOVERNANCE_FLAGS.length !== 6) failures.push(`${GOVERNANCE_FLAGS.length} governance flags, expected 6`);
  const input = service.readInput(payloadOf(vectorNamed('fluid-ideal')));
  const evidence = service.evaluateGovernanceEvidence(input);
  for (const flag of GOVERNANCE_FLAGS) {
    if (![true, false, null].includes(evidence[flag])) failures.push(`${flag} is ${evidence[flag]}`);
  }
  const ruleSetChecksum = service.governanceRuleSet().checksum;
  if (evidence.validationRuleSetChecksum !== ruleSetChecksum) {
    failures.push(`validationRuleSetChecksum ${evidence.validationRuleSetChecksum}, expected ${ruleSetChecksum}`);
  }
  RcsGovernanceEvidenceSnapshotModel.capture({
    ...evidence, governanceEvidenceSnapshotId: GATE_ID, snapshotId: GATE_ID, evaluatedAt: FIXED_AT,
  });
  return failures;
}

function inputSnapshotCheck(service) {
  const failures = [];
  const capture = (inputs) => RcsInputSnapshotModel.capture({
    rcsInputSnapshotId: GATE_ID,
    rcsAssessmentId: GATE_ID,
    specimenId: GATE_ID,
    matrix: 'fluid',
    capturedAt: FIXED_AT,
    inputs,
    sprecVersion: 'SPREC-2.0',
    sprecMappingReleaseId: service.sprecMappingRelease().sprecMappingReleaseId,
    // The matrix release's id key is named sprecMappingReleaseId too.
    matrixMappingReleaseId: service.matrixMappingRelease().sprecMappingReleaseId,
  });
  const ideal = service.readInput(payloadOf(vectorNamed('fluid-ideal')));
  const first = capture(ideal);
  const again = capture(deepCopy(ideal));
  const mid = capture(service.readInput(payloadOf(vectorNamed('fluid-mid'))));
  if (first.snapshotHash !== again.snapshotHash) failures.push(`same input hashed ${first.snapshotHash} then ${again.snapshotHash}`);
  if (first.snapshotHash === mid.snapshotHash) failures.push(`fluid-ideal and fluid-mid share hash ${first.snapshotHash}`);
  const hex = String(first.snapshotHash).replace(/^sha256:/, '');
  if (!String(first.snapshotUri).endsWith(`#sha256=${hex}`)) failures.push(`snapshotUri ${first.snapshotUri} does not pin ${first.snapshotHash}`);
  if (!Object.isFrozen(first)) failures.push('captured snapshot is not frozen');
  return failures;
}

function goldenVectorsCheck(service) {
  const failures = [];
  for (const vector of RCS_GOLDEN_VECTORS) {
    const input = service.readInput(payloadOf(vector));
    const result = service.certify(input);
    const got = Object.fromEntries(EXPECTED_KEYS.map((key) => [key, result[key]]));
    if (JSON.stringify(got) !== JSON.stringify(vector.expected)) {
      failures.push(`${vector.name}: got ${JSON.stringify(got)}, expected ${JSON.stringify(vector.expected)}`);
    }
    if (canonicalJson(service.certify(deepCopy(input))) !== canonicalJson(result)) {
      failures.push(`${vector.name}: recalculation differs`);
    }
  }
  return failures;
}

function rcsReadinessGate({ service = rcsCertificationService } = {}) {
  const evidence = {
    rulePackage: null, governanceRuleSet: null, matrixMappingRelease: null, sprecMappingRelease: null, checks: [],
  };
  const { checks } = evidence;
  const run = (check, failures) => {
    checks.push({ check, passed: failures.length === 0, detail: failures.length === 0 ? 'ok' : failures.join('; ') });
  };
  try {
    evidence.rulePackage = service.rulePackage();
    evidence.governanceRuleSet = service.governanceRuleSet();
    evidence.matrixMappingRelease = service.matrixMappingRelease();
    evidence.sprecMappingRelease = service.sprecMappingRelease();
    const { rulePackage, governanceRuleSet, matrixMappingRelease, sprecMappingRelease } = evidence;
    run('releases', releasesCheck({ governanceRuleSet, matrixMappingRelease, sprecMappingRelease, rulePackage }));
    run('axes', axesCheck(service));
    run('governance-evidence', governanceEvidenceCheck(service));
    run('input-snapshot', inputSnapshotCheck(service));
    run('golden-vectors', goldenVectorsCheck(service));
  } catch (error) {
    evidence.error = String(error && error.message ? error.message : error).slice(0, 300);
  }
  const passed = !evidence.error && checks.length === 5 && checks.every((entry) => entry.passed);
  return { gate: 'rcs', result: passed ? 'pass' : 'fail', p0: true, evidence };
}

module.exports = { rcsReadinessGate, RCS_GOLDEN_VECTORS };
