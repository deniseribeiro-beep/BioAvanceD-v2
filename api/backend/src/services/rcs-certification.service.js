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

function toSnakeCase(value) {
  return String(value).replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function normalizeGovernanceToken(value) {
  return normalizeString(value)
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function normalizeGovernanceOutcome(value) {
  const normalized = normalizeGovernanceToken(value);
  if (normalized === 'review_required') return 'review';
  return normalized;
}

function readEvidenceValue(source, key) {
  if (Object.prototype.hasOwnProperty.call(source, key)) return source[key];
  const snake = toSnakeCase(key);
  if (Object.prototype.hasOwnProperty.call(source, snake)) return source[snake];
  return undefined;
}

function normalizeEvidenceState(value) {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? (value.state ?? value.status ?? value.value)
    : value;
  return normalizeGovernanceToken(raw);
}

class RcsCertificationService {
  constructor(data = referenceData) {
    this.data = data;
  }

  certify(payload = {}) {
    const normalizedPayload = normalizeObject(payload);
    const samplePayload = Object.keys(normalizeObject(normalizedPayload.sample)).length
      ? normalizeObject(normalizedPayload.sample)
      : normalizedPayload;
    const sprec = this.normalizeSprec(samplePayload);
    const matrixType = sprec.matrix_type || null;

    if (!matrixType || !AXES[matrixType]) {
      return this.invalidInputResult(
        'unknown',
        ['Invalid or missing explicit matrixType'],
        sprec,
        null
      );
    }

    const sprecValidation = this.validateSprecReference(sprec, matrixType);
    const governance = this.evaluateGovernanceEvidence(samplePayload);

    if (!governance.valid) {
      return this.invalidInputResult(
        matrixType,
        governance.errors,
        sprec,
        governance
      );
    }

    if (governance.status !== 1) {
      return this.governanceFailureResult(
        matrixType,
        governance.reasons,
        sprec,
        governance.trace,
        {
          governanceOutcome: governance.outcome,
          governanceEvidence: governance.evidence,
        }
      );
    }

    if (sprecValidation.status !== 'scoreable') {
      return this.governanceFailureResult(
        matrixType,
        sprecValidation.reasons,
        sprec,
        sprecValidation.trace,
        {
          governanceOutcome: 'failed',
          governanceEvidence: governance.evidence,
        }
      );
    }

    const axisPenalties = [];
    const calculationTrace = {
      model_code: this.data.model_code,
      sprec_version: this.data.sprec_version,
      scientific_reference: this.data.scientific_reference,
      formula: 'RCS = 100 - Pbio; Pbio = sum(axis_weight * severity)',
      axes: [],
      sources: {
        severity: 'rcs-severity-mapping.RCS-GOV-1.0.json',
        weights: 'rcs-axis-weights.RCS-GOV-1.0.json',
        thresholds: 'rcs-grade-thresholds.RCS-GOV-1.0.json',
        governance_evidence: 'rcs-governance-evidence.RCS-GOV-1.0.json',
      },
      governance_outcome: governance.outcome,
      governance_evidence: governance.evidence,
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
          }],
          {
            governanceOutcome: 'failed',
            governanceEvidence: governance.evidence,
          }
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
      input_status: 'valid',
      input_errors: [],
      matrix_type: matrixType,
      governance_status: 1,
      governance_outcome: 'admissible',
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
    const matrixType = normalizeString(
      payload.matrix_type
      || payload.matrixType
      || sprec.matrix_type
      || sprec.matrixType
    ).toLowerCase();
    const normalized = {
      matrix_type: ['fluid', 'solid'].includes(matrixType) ? matrixType : '',
      sampleType: normalizeCode(sprec.sampleType),
      primaryContainer: normalizeCode(pickFirst(sprec, ['primaryContainer', 'collectionType'])),
    };

    for (const axis of [...AXES.fluid, ...AXES.solid]) {
      normalized[axis.field] = normalizeCode(pickFirst(sprec, axis.aliases));
    }

    return normalized;
  }

  /**
   * Compatibility helper only. The scientific certification path does not use
   * inference: certify() requires an explicit matrixType/matrix_type.
   */
  detectMatrixType(payload = {}, sprec = {}) {
    const explicit = normalizeString(
      payload.matrix_type
      || payload.matrixType
      || sprec.matrix_type
      || sprec.matrixType
    ).toLowerCase();
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

  validateSprecReference(sprec = {}, matrixType = null) {
    const reasons = [];
    const trace = [];

    if (!matrixType || !AXES[matrixType]) {
      reasons.push('Missing or invalid matrix type');
      trace.push({ rule_code: 'MISSING_CRITICAL_METADATA', reason: 'Missing or invalid matrix type' });
      return { status: 'not_scoreable', reasons, trace };
    }

    const requiredAxes = [...METADATA_AXES, ...AXES[matrixType].map((axis) => axis.field)];
    for (const field of requiredAxes) {
      const axisCode = this.axisCodeForField(matrixType, field);
      const code = sprec[field];

      if (!code) {
        reasons.push('Missing critical metadata');
        trace.push({
          field,
          axis_code: axisCode,
          rule_code: 'MISSING_CRITICAL_METADATA',
          reason: 'Missing critical metadata',
        });
        continue;
      }

      if (UNKNOWN_CODES.has(code)) {
        reasons.push('Unknown SPREC code');
        trace.push({
          field,
          axis_code: axisCode,
          sprec_code: code,
          rule_code: 'UNKNOWN_SPREC_CODE',
          reason: 'Unknown SPREC code',
        });
        continue;
      }

      if (OTHER_CODES.has(code)) {
        reasons.push('Other SPREC code without validated local interpretation');
        trace.push({
          field,
          axis_code: axisCode,
          sprec_code: code,
          rule_code: 'OTHER_WITHOUT_LOCAL_INTERPRETATION',
          reason: 'Other SPREC code without validated local interpretation',
        });
        continue;
      }

      if (!/^[A-Z0-9]{1,12}$/.test(code)) {
        reasons.push('Invalid SPREC code');
        trace.push({
          field,
          axis_code: axisCode,
          sprec_code: code,
          rule_code: 'INVALID_SPREC_CODE',
          reason: 'Invalid SPREC code',
        });
        continue;
      }

      if (!this.catalogHas(matrixType, axisCode || field, code)) {
        reasons.push('SPREC code incompatible with matrix or axis');
        trace.push({
          field,
          axis_code: axisCode,
          sprec_code: code,
          rule_code: 'MATRIX_INCOMPATIBLE_CODE',
          reason: 'SPREC code incompatible with matrix or axis',
        });
      }
    }

    return {
      status: reasons.length ? 'not_scoreable' : 'scoreable',
      reasons: unique(reasons),
      trace,
    };
  }

  evaluateGovernanceEvidence(payload = {}) {
    const source = normalizeObject(payload.governanceEvidence || payload.governance_evidence);
    const categories = Array.isArray(this.data.governanceEvidenceCategories)
      ? this.data.governanceEvidenceCategories
      : [];
    const allowedStates = new Set(this.data.governanceEvidenceStates || []);
    const allowedOutcomes = new Set(this.data.governanceOutcomes || []);
    const errors = [];
    const evidence = {};
    const trace = [];

    if (Object.keys(source).length === 0) {
      errors.push('Explicit governance evidence is required');
    }

    for (const category of categories) {
      const raw = readEvidenceValue(source, category.key);
      if (raw === undefined || raw === null || normalizeString(raw) === '') {
        errors.push(`Missing governance evidence: ${category.label}`);
        continue;
      }

      const state = normalizeEvidenceState(raw);
      if (!allowedStates.has(state)) {
        errors.push(`Invalid governance evidence state for ${category.label}`);
        continue;
      }

      evidence[category.key] = state;
      trace.push({
        evidence_category: category.key,
        evidence_label: category.label,
        evidence_state: state,
      });
    }

    let outcome = normalizeGovernanceOutcome(payload.governanceOutcome || payload.governance_outcome);
    const adverseEvidence = Object.entries(evidence)
      .filter(([, state]) => state === 'failed' || state === 'unresolved');

    if (outcome && !allowedOutcomes.has(outcome)) {
      errors.push('Invalid governance outcome');
    }

    if (!outcome && adverseEvidence.length === 0 && errors.length === 0) {
      outcome = 'admissible';
    }

    if (!outcome && adverseEvidence.length > 0) {
      errors.push('Explicit governance outcome is required for failed or unresolved evidence');
    }

    if (outcome === 'admissible' && adverseEvidence.length > 0) {
      errors.push('Admissible governance outcome conflicts with failed or unresolved evidence');
    }

    if (errors.length > 0) {
      return {
        valid: false,
        status: null,
        outcome: outcome || null,
        evidence,
        errors: unique(errors),
        reasons: [],
        trace,
      };
    }

    const status = outcome === 'admissible' ? 1 : 0;
    const reasons = status === 1
      ? []
      : unique([
        ...adverseEvidence.map(([key, state]) => {
          const category = categories.find((item) => item.key === key);
          return `${category?.label || key}: ${state}`;
        }),
        `Governance outcome: ${outcome}`,
      ]);

    return {
      valid: true,
      status,
      outcome,
      evidence,
      errors: [],
      reasons,
      trace,
    };
  }

  /**
   * Backward-compatible method name retained for callers/tests that invoke it
   * directly. It now evaluates the explicit governance-evidence layer only.
   */
  evaluateGovernance(payload = {}) {
    return this.evaluateGovernanceEvidence(payload);
  }

  axisCodeForField(matrixType, field) {
    const axis = AXES[matrixType]?.find((item) => item.field === field);
    return axis?.axis_code || field;
  }

  catalogHas(matrixType, axisCode, code) {
    return this.data.catalogs[matrixType].some(
      (item) => item.axis_code === axisCode && item.sprec_code === code
    );
  }

  findWeight(matrixType, axisCode) {
    const weight = this.data.weights.find(
      (item) => item.matrix_type === matrixType && item.axis_code === axisCode
    );
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

    const matched = candidates.find(
      (item) => normalizeWorkflowRule(item.workflow_rule) === workflowRule
    );
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
    const axisContext = normalizeObject(
      workflowContext[axisCode] || workflowContext[axisCode.toLowerCase()]
    );
    return normalizeWorkflowRule(
      axisContext.workflow_rule
        || axisContext.workflowRule
        || payload[`${axisCode}_workflow_rule`]
        || payload[`${axisCode}WorkflowRule`]
        || (code === 'N' && axisCode === 'Pcent1' && payload.primaryCentrifugationApplicable === false
          ? 'pcent1_no_centrifugation_acceptable'
          : '')
        || (code === 'N' && axisCode === 'Pcent2' && payload.secondCentrifugationRequired === false
          ? 'pcent2_not_required'
          : '')
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

  invalidInputResult(matrixType, errors = [], sprec = {}, governance = null) {
    return {
      model_version: this.data.model_code,
      input_status: 'invalid',
      input_errors: unique(errors),
      matrix_type: matrixType,
      governance_status: null,
      governance_outcome: governance?.outcome || null,
      governance_failure_reasons: [],
      governance_rule_codes: [],
      p_bio: null,
      rcs_score: null,
      score_based_grade: null,
      final_grade: null,
      grade_route: 'Invalid input',
      axis_penalties: [],
      calculation_trace: {
        model_code: this.data.model_code,
        sprec_version: this.data.sprec_version,
        scientific_reference: this.data.scientific_reference,
        formula: 'RCS = 100 - Pbio; invalid input is not scored',
        sprec,
        governance_outcome: governance?.outcome || null,
        governance_evidence: governance?.evidence || {},
        governance_trace: governance?.trace || [],
        input_errors: unique(errors),
      },
    };
  }

  governanceFailureResult(
    matrixType,
    reasons = [],
    sprec = {},
    trace = [],
    { governanceOutcome = 'failed', governanceEvidence = {} } = {}
  ) {
    const governanceRuleCodes = unique([
      ...reasons
        .map((reason) => GOVERNANCE_RULE_BY_REASON[reason])
        .filter(Boolean)
        .map((ruleCode) => {
          const seeded = this.data.governanceRules.some((rule) => rule.rule_code === ruleCode);
          if (!seeded) throw new Error(`Missing seeded governance rule: ${ruleCode}`);
          return ruleCode;
        }),
      ...trace.map((item) => item.rule_code).filter(Boolean),
    ]);

    const normalizedTrace = trace.map((item) => {
      if (item.rule_code) return { ...item };
      if (item.reason && GOVERNANCE_RULE_BY_REASON[item.reason]) {
        return {
          ...item,
          rule_code: this.ruleCodeForReason(item.reason),
        };
      }
      if (!item.reason && !item.evidence_category) {
        return {
          ...item,
          rule_code: this.ruleCodeForReason('Not scored SPREC condition'),
        };
      }
      return { ...item };
    });

    return {
      model_version: this.data.model_code,
      input_status: 'valid',
      input_errors: [],
      matrix_type: matrixType,
      governance_status: 0,
      governance_outcome: governanceOutcome,
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
        scientific_reference: this.data.scientific_reference,
        formula: 'RCS = 100 - Pbio; governance failure is non-compensable',
        sprec,
        governance_outcome: governanceOutcome,
        governance_evidence: governanceEvidence,
        governance_trace: normalizedTrace,
      },
    };
  }
}

module.exports = new RcsCertificationService();
module.exports.RcsCertificationService = RcsCertificationService;
module.exports.referenceData = referenceData;
module.exports.AXES = AXES;
module.exports.GOVERNANCE_EVIDENCE_CATEGORIES = referenceData.governanceEvidenceCategories;
module.exports.GOVERNANCE_EVIDENCE_STATES = referenceData.governanceEvidenceStates;
module.exports.GOVERNANCE_OUTCOMES = referenceData.governanceOutcomes;
