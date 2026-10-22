const referenceData = require('./rcs-reference-data');

const AXES = Object.freeze({
  fluid: Object.freeze([
    { axis_code: 'Ppre', field: 'preCentrifugation', aliases: ['preCentrifugation'] },
    { axis_code: 'Pcent1', field: 'centrifugation', aliases: ['centrifugation', 'centrifugation1'] },
    { axis_code: 'Pcent2', field: 'secondCentrifugation', aliases: ['secondCentrifugation', 'centrifugation2'] },
    { axis_code: 'Ppost', field: 'postCentrifugationDelay', aliases: ['postCentrifugationDelay', 'postCentrifugation'] },
    { axis_code: 'Pstore', field: 'longTermStorage', aliases: ['longTermStorage'] },
  ]),
  solid: Object.freeze([
    { axis_code: 'Pwarm', field: 'warmIschemia', aliases: ['warmIschemia', 'preCentrifugation'] },
    { axis_code: 'Pcold', field: 'coldIschemia', aliases: ['coldIschemia', 'centrifugation'] },
    { axis_code: 'Pfix', field: 'fixationType', aliases: ['fixationType', 'secondCentrifugation'] },
    { axis_code: 'PfixTime', field: 'fixationTime', aliases: ['fixationTime', 'postCentrifugationDelay'] },
    { axis_code: 'Pstore', field: 'longTermStorage', aliases: ['longTermStorage'] },
  ]),
});

const METADATA_AXES = Object.freeze(['sampleType', 'primaryContainer']);
const UNKNOWN_CODES = new Set(['X', 'XXX', 'UNKNOWN', 'UNK']);
const OTHER_CODES = new Set(['Z', 'ZZZ', 'OTHER']);

const GOVERNANCE_RULE_BY_REASON = Object.freeze({
  'Missing or invalid matrix type': 'MISSING_CRITICAL_METADATA',
  'Missing critical metadata': 'MISSING_CRITICAL_METADATA',
  'Unknown SPREC code': 'UNKNOWN_SPREC_CODE',
  'Invalid SPREC code': 'INVALID_SPREC_CODE',
  'SPREC code incompatible with matrix or axis': 'MATRIX_INCOMPATIBLE_CODE',
  'Other SPREC code without validated local interpretation': 'OTHER_WITHOUT_LOCAL_INTERPRETATION',
  'Insufficient documentation': 'INSUFFICIENT_DOCUMENTATION',
  'Insufficient traceability': 'INSUFFICIENT_TRACEABILITY',
  'Missing required monitoring': 'MISSING_REQUIRED_MONITORING',
  'Semantic incompatibility between matrix, SPREC axis, event, or context': 'SEMANTIC_INCOMPATIBILITY',
  'Missing analytical workflow context': 'MISSING_ANALYTICAL_WORKFLOW',
  'Analytical workflow context does not match seeded severity mapping': 'SEMANTIC_INCOMPATIBILITY',
  'Not scored SPREC condition': 'NOT_SCORED',
});

function normalizeString(value) {
  return String(value ?? '').trim();
}

function unwrapCode(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value.code ?? value.value ?? '';
  }
  return value;
}

function normalizeCode(value) {
  return normalizeString(unwrapCode(value)).toUpperCase();
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function round(value) {
  return Math.round(Number(value) * 1000000) / 1000000;
}

function pickFirst(source, aliases) {
  for (const alias of aliases) {
    const value = source[alias];
    if (value !== undefined && value !== null && normalizeString(unwrapCode(value)) !== '') {
      return value;
    }
  }
  return '';
}

function normalizeWorkflowRule(value) {
  return normalizeString(value).toLowerCase();
}

// RF018 AC3 (#1320): every payload key certify() reads, through
// normalizeSprec, detectMatrixType, evaluateGovernance and
// resolveWorkflowRule. readInput keeps exactly these, so certify(readInput(p))
// recalculates certify(p) and no other payload key is frozen.
const READ_KEYS = Object.freeze([
  'matrix_type', 'matrixType', 'sampleType', 'sampleOrigin', 'sprec',
  'documentationSufficient', 'documentation_insufficient',
  'traceabilitySufficient', 'traceability_insufficient', 'traceabilityBroken',
  'monitoringRequired', 'monitoring_required', 'monitoringPresent', 'monitoring_present',
  'semanticIncompatibility', 'semantic_incompatibility', 'workflow_context', 'workflowContext',
  'primaryCentrifugationApplicable', 'secondCentrifugationRequired',
  ...[...new Set(Object.values(AXES).flat().map((axis) => axis.axis_code))]
    .flatMap((axisCode) => [`${axisCode}_workflow_rule`, `${axisCode}WorkflowRule`]),
]);

class RcsCertificationService {
  constructor(data = referenceData) {
    this.data = data;
  }

  // The input certify() is computed from, as a JSON-safe deep copy: the same
  // `sample` wrapper rule as certify, then only the READ_KEYS present.
  readInput(payload = {}) {
    const normalizedPayload = normalizeObject(payload);
    const samplePayload = Object.keys(normalizeObject(normalizedPayload.sample)).length
      ? normalizeObject(normalizedPayload.sample)
      : normalizedPayload;
    const input = {};
    for (const key of READ_KEYS) {
      if (samplePayload[key] !== undefined) input[key] = samplePayload[key];
    }
    return JSON.parse(JSON.stringify(input));
  }

  certify(payload = {}) {
    const normalizedPayload = normalizeObject(payload);
    const samplePayload = Object.keys(normalizeObject(normalizedPayload.sample)).length
      ? normalizeObject(normalizedPayload.sample)
      : normalizedPayload;
    const sprec = this.normalizeSprec(samplePayload);
    const matrixType = this.detectMatrixType(samplePayload, sprec);
    const governance = this.evaluateGovernance(samplePayload, sprec, matrixType);

    if (governance.status === 0) {
      return this.governanceFailureResult(matrixType || 'unknown', governance.reasons, sprec, governance.trace);
    }

    const axisPenalties = [];
    const calculationTrace = {
      model_code: this.data.model_code,
      sprec_version: this.data.sprec_version,
      formula: 'RCS = 100 - Pbio; Pbio = sum(axis_weight * severity)',
      axes: [],
      sources: {
        severity: 'rcs-severity-mapping.RCS-GOV-1.0.json',
        weights: 'rcs-axis-weights.RCS-GOV-1.0.json',
        thresholds: 'rcs-grade-thresholds.RCS-GOV-1.0.json',
      },
      governance_trace: governance.trace,
    };

    for (const axis of AXES[matrixType]) {
      const code = sprec[axis.field];
      const weight = this.findWeight(matrixType, axis.axis_code);
      const severity = this.resolveSeverity(samplePayload, matrixType, axis.axis_code, code);

      if (!severity || severity.is_scored !== true || severity.severity_value === null) {
        const failureReason = severity?.failure_reason || 'Not scored SPREC condition';
        return this.governanceFailureResult(
          matrixType,
          [failureReason],
          sprec,
          [...governance.trace, {
            axis_code: axis.axis_code,
            sprec_code: code,
            rule_code: this.ruleCodeForReason(failureReason),
            severity,
          }]
        );
      }

      const penalty = round(Number(weight.weight) * Number(severity.severity_value));
      const item = {
        axis_code: axis.axis_code,
        sprec_code: code,
        weight: Number(weight.weight),
        severity: Number(severity.severity_value),
        penalty,
      };
      axisPenalties.push(item);
      calculationTrace.axes.push({
        ...item,
        severity_condition: severity.condition_description,
        severity_source: 'Supplementary Table S3',
        weight_source: 'RCS axis weights seed',
      });
    }

    const pBio = round(axisPenalties.reduce((sum, item) => sum + item.penalty, 0));
    const rcsScore = round(100 - pBio);
    const scoreBasedGrade = this.gradeFromScore(rcsScore);

    return {
      model_version: this.data.model_code,
      matrix_type: matrixType,
      governance_status: 1,
      governance_failure_reasons: [],
      governance_rule_codes: [],
      p_bio: pBio,
      rcs_score: rcsScore,
      score_based_grade: scoreBasedGrade,
      final_grade: scoreBasedGrade,
      grade_route: scoreBasedGrade === 'E' ? 'Score critical penalty' : 'Score-based certification',
      axis_penalties: axisPenalties,
      calculation_trace: calculationTrace,
    };
  }

  normalizeSprec(payload = {}) {
    const sprec = normalizeObject(payload.sprec);
    const matrixType = normalizeString(payload.matrix_type || payload.matrixType || sprec.matrix_type || sprec.matrixType).toLowerCase();
    const fluidAxes = AXES.fluid;
    const solidAxes = AXES.solid;
    const normalized = {
      matrix_type: ['fluid', 'solid'].includes(matrixType) ? matrixType : '',
      sampleType: normalizeCode(sprec.sampleType),
      primaryContainer: normalizeCode(pickFirst(sprec, ['primaryContainer', 'collectionType'])),
    };

    for (const axis of [...fluidAxes, ...solidAxes]) {
      normalized[axis.field] = normalizeCode(pickFirst(sprec, axis.aliases));
    }

    return normalized;
  }

  detectMatrixType(payload = {}, sprec = {}) {
    const explicit = normalizeString(payload.matrix_type || payload.matrixType || sprec.matrix_type).toLowerCase();
    if (explicit === 'fluid' || explicit === 'solid') return explicit;

    const sampleText = normalizeString(payload.sampleType || payload.sampleOrigin).toLowerCase();
    if (sampleText.includes('plasma') || sampleText.includes('serum') || sampleText.includes('blood') || sampleText.includes('urine')) {
      return 'fluid';
    }
    if (sampleText.includes('tissue') || sampleText.includes('tumor') || sampleText.includes('solid')) {
      return 'solid';
    }

    if (sprec.fixationType || sprec.fixationTime || sprec.warmIschemia || sprec.coldIschemia) return 'solid';
    return null;
  }

  evaluateGovernance(payload = {}, sprec = {}, matrixType = null) {
    const reasons = [];
    const trace = [];

    if (!matrixType || !AXES[matrixType]) {
      reasons.push('Missing or invalid matrix type');
      trace.push({ rule_code: 'MISSING_CRITICAL_METADATA', reason: 'Missing or invalid matrix type' });
    }

    if (matrixType && AXES[matrixType]) {
      const requiredAxes = [...METADATA_AXES, ...AXES[matrixType].map((axis) => axis.field)];
      for (const field of requiredAxes) {
        const axisCode = this.axisCodeForField(matrixType, field);
        const code = sprec[field];
        if (!code) {
          reasons.push('Missing critical metadata');
          trace.push({ field, axis_code: axisCode, rule_code: 'MISSING_CRITICAL_METADATA', reason: 'Missing critical metadata' });
          continue;
        }
        if (UNKNOWN_CODES.has(code)) {
          reasons.push('Unknown SPREC code');
          trace.push({ field, axis_code: axisCode, sprec_code: code, rule_code: 'UNKNOWN_SPREC_CODE', reason: 'Unknown SPREC code' });
          continue;
        }
        if (OTHER_CODES.has(code)) {
          reasons.push('Other SPREC code without validated local interpretation');
          trace.push({ field, axis_code: axisCode, sprec_code: code, rule_code: 'OTHER_WITHOUT_LOCAL_INTERPRETATION', reason: 'Other SPREC code without validated local interpretation' });
          continue;
        }
        if (!/^[A-Z0-9]{1,12}$/.test(code)) {
          reasons.push('Invalid SPREC code');
          trace.push({ field, axis_code: axisCode, sprec_code: code, rule_code: 'INVALID_SPREC_CODE', reason: 'Invalid SPREC code' });
          continue;
        }
        if (!this.catalogHas(matrixType, axisCode || field, code)) {
          reasons.push('SPREC code incompatible with matrix or axis');
          trace.push({ field, axis_code: axisCode, sprec_code: code, rule_code: 'MATRIX_INCOMPATIBLE_CODE', reason: 'SPREC code incompatible with matrix or axis' });
        }
      }
    }

    if (payload.documentationSufficient === false || payload.documentation_insufficient === true) {
      reasons.push('Insufficient documentation');
      trace.push({ rule_code: 'INSUFFICIENT_DOCUMENTATION', reason: 'Insufficient documentation' });
    }
    if (payload.traceabilitySufficient === false || payload.traceability_insufficient === true || payload.traceabilityBroken === true) {
      reasons.push('Insufficient traceability');
      trace.push({ rule_code: 'INSUFFICIENT_TRACEABILITY', reason: 'Insufficient traceability' });
    }
    if ((payload.monitoringRequired === true || payload.monitoring_required === true) && !(payload.monitoringPresent === true || payload.monitoring_present === true)) {
      reasons.push('Missing required monitoring');
      trace.push({ rule_code: 'MISSING_REQUIRED_MONITORING', reason: 'Missing required monitoring' });
    }
    if (payload.semanticIncompatibility === true || payload.semantic_incompatibility === true) {
      reasons.push('Semantic incompatibility between matrix, SPREC axis, event, or context');
      trace.push({ rule_code: 'SEMANTIC_INCOMPATIBILITY', reason: 'Semantic incompatibility between matrix, SPREC axis, event, or context' });
    }

    return {
      status: reasons.length ? 0 : 1,
      reasons: unique(reasons),
      trace,
    };
  }

  axisCodeForField(matrixType, field) {
    const axis = AXES[matrixType]?.find((item) => item.field === field);
    return axis?.axis_code || field;
  }

  catalogHas(matrixType, axisCode, code) {
    return this.data.catalogs[matrixType].some((item) => item.axis_code === axisCode && item.sprec_code === code);
  }

  findWeight(matrixType, axisCode) {
    const weight = this.data.weights.find((item) => item.matrix_type === matrixType && item.axis_code === axisCode);
    if (!weight) throw new Error(`Missing RCS axis weight for ${matrixType}.${axisCode}`);
    return weight;
  }

  resolveSeverity(payload = {}, matrixType, axisCode, code) {
    const candidates = this.data.severityMappings.filter((item) => {
      return item.matrix_type === matrixType
        && item.axis_code === axisCode
        && (item.sprec_codes.includes(code) || item.sprec_codes.includes('*'));
    });

    if (candidates.length === 0) {
      return {
        is_scored: false,
        severity_value: null,
        governance_action: 'governance_failure',
        failure_reason: 'Not scored SPREC condition',
      };
    }

    const workflowRule = this.resolveWorkflowRule(payload, axisCode, code);
    const nonConditional = candidates.find((item) => !item.requires_workflow_context);
    if (!workflowRule && nonConditional) return nonConditional;

    if (!workflowRule && candidates.some((item) => item.requires_workflow_context)) {
      return {
        is_scored: false,
        severity_value: null,
        governance_action: 'governance_failure',
        failure_reason: 'Missing analytical workflow context',
        matched_candidates: candidates,
      };
    }

    const matched = candidates.find((item) => normalizeWorkflowRule(item.workflow_rule) === workflowRule);
    if (matched) return matched;

    return {
      is_scored: false,
      severity_value: null,
      governance_action: 'governance_failure',
      failure_reason: 'Analytical workflow context does not match seeded severity mapping',
      matched_candidates: candidates,
    };
  }

  resolveWorkflowRule(payload = {}, axisCode, code) {
    const workflowContext = normalizeObject(payload.workflow_context || payload.workflowContext);
    const axisContext = normalizeObject(workflowContext[axisCode] || workflowContext[axisCode.toLowerCase()]);
    return normalizeWorkflowRule(
      axisContext.workflow_rule
        || axisContext.workflowRule
        || payload[`${axisCode}_workflow_rule`]
        || payload[`${axisCode}WorkflowRule`]
        || (code === 'N' && axisCode === 'Pcent1' && payload.primaryCentrifugationApplicable === false ? 'pcent1_no_centrifugation_acceptable' : '')
        || (code === 'N' && axisCode === 'Pcent2' && payload.secondCentrifugationRequired === false ? 'pcent2_not_required' : '')
    );
  }

  gradeFromScore(score) {
    const threshold = this.data.thresholds.find((item) => {
      const aboveMin = item.min_inclusive === null || score >= Number(item.min_inclusive);
      const belowMax = item.max_exclusive === null || score < Number(item.max_exclusive);
      return aboveMin && belowMax;
    });
    if (!threshold) throw new Error(`RCS score outside configured thresholds: ${score}`);
    return threshold.grade;
  }

  ruleCodeForReason(reason) {
    const ruleCode = GOVERNANCE_RULE_BY_REASON[reason] || 'NOT_SCORED';
    const seeded = this.data.governanceRules.some((rule) => rule.rule_code === ruleCode);
    if (!seeded) throw new Error(`Missing seeded governance rule: ${ruleCode}`);
    return ruleCode;
  }

  governanceFailureResult(matrixType, reasons = [], sprec = {}, trace = []) {
    const governanceRuleCodes = unique(reasons.map((reason) => this.ruleCodeForReason(reason)));
    const normalizedTrace = trace.map((item) => ({
      ...item,
      rule_code: item.rule_code || this.ruleCodeForReason(item.reason || 'Not scored SPREC condition'),
    }));
    return {
      model_version: this.data.model_code,
      matrix_type: matrixType,
      governance_status: 0,
      governance_failure_reasons: unique(reasons),
      governance_rule_codes: governanceRuleCodes,
      p_bio: null,
      rcs_score: null,
      score_based_grade: null,
      final_grade: 'E',
      grade_route: 'Governance failure',
      axis_penalties: [],
      calculation_trace: {
        model_code: this.data.model_code,
        sprec_version: this.data.sprec_version,
        formula: 'RCS = 100 - Pbio; governance failure is non-compensable',
        sprec,
        governance_trace: normalizedTrace,
      },
    };
  }

}

module.exports = new RcsCertificationService();
module.exports.RcsCertificationService = RcsCertificationService;
module.exports.referenceData = referenceData;
module.exports.AXES = AXES;
