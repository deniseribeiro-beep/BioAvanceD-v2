const crypto = require('crypto');
const referenceData = require('./rcs-reference-data');
const { canonicalJson } = require('../models/ConfigurationRelease');

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
const SPREC_CODE_PATTERN = /^[A-Z0-9]{1,12}$/;

// RF018 AC11 (#1320): what an RCS result is and is not, stated on every
// assessment's justifications.
const RCS_SCOPE_STATEMENT = 'RCS qualifies the pre-analytical history of this specimen for the stated use context; it is not clinical validity, analytical assay quality or a universal quality measure.';

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

// RF018 AC7 (#1320): the rule codes that fail each governance criterion.
// INFERENCE, not a citation: read off the seeded rule descriptions and the
// Supplementary File 2 "Controlled terminology and context validation" row
// (see docs/decisions/2026-10-23-rcs-governance-evidence.md).
const TERMINOLOGY_FAILURE_CODES = Object.freeze(['UNKNOWN_SPREC_CODE', 'INVALID_SPREC_CODE', 'OTHER_WITHOUT_LOCAL_INTERPRETATION']);
const SEMANTIC_FAILURE_CODES = Object.freeze(['MATRIX_INCOMPATIBLE_CODE', 'SEMANTIC_INCOMPATIBILITY']);

// RNF018 AC5 (#1524): the evidence categories a request may present
// references for, each with the reason, rule code and flag a non-resolved
// reference fails. The references are resolved against the stored records
// before certify() (governance-evidence-resolver.service.js) and read here
// only from the frozen governanceEvidenceResolution (see
// docs/decisions/2026-11-09-rcs-governance-evidence-readers.md).
const EVIDENCE_CATEGORIES = Object.freeze({
  traceability: Object.freeze({ reason: 'Insufficient traceability', ruleCode: 'INSUFFICIENT_TRACEABILITY', flag: 'traceabilityOk' }),
  monitoring: Object.freeze({ reason: 'Missing required monitoring', ruleCode: 'MISSING_REQUIRED_MONITORING', flag: 'monitoringOk' }),
  documentation: Object.freeze({ reason: 'Insufficient documentation', ruleCode: 'INSUFFICIENT_DOCUMENTATION', flag: 'documentationOk' }),
});

// Why a criterion this calculation does not read stays null, never true.
const UNRESOLVED_REASONS = Object.freeze({
  terminologyValid: 'códigos SPREC não verificados: matriz não resolvida',
  traceabilityOk: 'nenhuma referência de identificação, custódia ou linhagem foi apresentada (V2E-0528)',
  monitoringOk: 'nenhuma referência de monitoramento ou telemetria foi apresentada (V2E-0529)',
  documentationOk: 'nenhum registro, SOP ou evidência documental foi apresentado (V2E-0530)',
  semanticCompatible: 'eventos não são lidos por este cálculo (V2E-0531)',
  gateResult: 'nem todos os seis critérios têm evidência; nenhum falhou',
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
  // RNF018 AC5 (#1524): set only by the server's evidence resolver.
  'governanceEvidenceResolution',
  ...[...new Set(Object.values(AXES).flat().map((axis) => axis.axis_code))]
    .flatMap((axisCode) => [`${axisCode}_workflow_rule`, `${axisCode}WorkflowRule`]),
]);

// The payload certify() reads: its `sample` when that is a non-empty
// object, else the payload itself.
const samplePayloadOf = (payload) => {
  const normalizedPayload = normalizeObject(payload);
  return Object.keys(normalizeObject(normalizedPayload.sample)).length
    ? normalizeObject(normalizedPayload.sample)
    : normalizedPayload;
};

class RcsCertificationService {
  constructor(data = referenceData) {
    this.data = data;
  }

  // The input certify() is computed from, as a JSON-safe deep copy: the same
  // `sample` wrapper rule as certify, then only the READ_KEYS present.
  readInput(payload = {}) {
    const samplePayload = samplePayloadOf(payload);
    const input = {};
    for (const key of READ_KEYS) {
      if (samplePayload[key] !== undefined) input[key] = samplePayload[key];
    }
    return JSON.parse(JSON.stringify(input));
  }

  // RF018 AC7 (#1320): the version and checksum of the rules the gate
  // applies, as canonical JSON over the seeded rules, the catalogs and the
  // code constants evaluateGovernance reads. The version is the seed's own
  // model code, not a SemVer.
  governanceRuleSet() {
    if (!this.ruleSet) {
      const rules = {
        model_code: this.data.model_code,
        sprec_version: this.data.sprec_version,
        governance_rules: this.data.governanceRules,
        catalogs: this.data.catalogs,
        metadata_axes: METADATA_AXES,
        axes: AXES,
        unknown_codes: [...UNKNOWN_CODES].sort(),
        other_codes: [...OTHER_CODES].sort(),
        code_pattern: SPREC_CODE_PATTERN.source,
      };
      this.ruleSet = {
        version: this.data.model_code,
        checksum: `sha256:${crypto.createHash('sha256').update(canonicalJson(rules)).digest('hex')}`,
      };
    }
    return this.ruleSet;
  }

  // RF018 AC7 (#1320): the six governance criteria of an input, read from
  // the gate's own trace and from certify's per-axis workflow-context
  // mismatch. A criterion is true only where the gate checked every input
  // its dictionary row names, false where the gate failed it, and otherwise
  // null with its reason, never true from a client-sent boolean (see
  // docs/decisions/2026-10-23-rcs-governance-evidence.md).
  evaluateGovernanceEvidence(input = {}) {
    const samplePayload = samplePayloadOf(input);
    const sprec = this.normalizeSprec(samplePayload);
    const matrixType = this.detectMatrixType(samplePayload, sprec);
    const gate = this.evaluateGovernance(samplePayload, sprec, matrixType);
    const result = this.certify(samplePayload);
    const codes = new Set(gate.trace.map((item) => item.rule_code));
    const failed = (ruleCodes) => ruleCodes.some((ruleCode) => codes.has(ruleCode));
    const falseOrNull = (isFailed) => (isFailed ? false : null);
    // RNF018 AC5 (#1524): true only where references were presented and
    // every one resolved against its stored record.
    const resolution = normalizeObject(samplePayload.governanceEvidenceResolution);
    const evidenceFlag = (category) => {
      const { ruleCode } = EVIDENCE_CATEGORIES[category];
      if (codes.has(ruleCode)) return false;
      const entries = resolution[category];
      return Array.isArray(entries) && entries.length > 0
        && entries.every((entry) => normalizeObject(entry).status === 'resolved')
        ? true
        : null;
    };

    let terminologyValid = null;
    if (failed(TERMINOLOGY_FAILURE_CODES)) terminologyValid = false;
    else if (matrixType && AXES[matrixType]) terminologyValid = true;

    const flags = {
      metadataComplete: !codes.has('MISSING_CRITICAL_METADATA'),
      terminologyValid,
      traceabilityOk: evidenceFlag('traceability'),
      monitoringOk: evidenceFlag('monitoring'),
      documentationOk: evidenceFlag('documentation'),
      semanticCompatible: falseOrNull(failed(SEMANTIC_FAILURE_CODES)
        || result.governance_rule_codes.includes('SEMANTIC_INCOMPATIBILITY')),
    };
    const unresolvedReasons = {};
    for (const [flag, value] of Object.entries(flags)) {
      if (value === null) unresolvedReasons[flag] = UNRESOLVED_REASONS[flag];
    }
    // eq:governance_product: one failed criterion fails the gate. With none
    // failed and some unread, the aggregate stays unresolved, never pass.
    const gateFailed = Object.values(flags).includes(false);
    if (!gateFailed) unresolvedReasons.gateResult = UNRESOLVED_REASONS.gateResult;
    const ruleSet = this.governanceRuleSet();
    return {
      ...flags,
      unresolvedReasons,
      gateResult: gateFailed ? 'fail' : null,
      failureReasons: gateFailed ? [...result.governance_failure_reasons] : [],
      validationRuleSetVersion: ruleSet.version,
      validationRuleSetChecksum: ruleSet.checksum,
    };
  }

  // RF018 AC6 and AC9 (#1320): each axis of the input's matrix with its
  // observed code, severity, maximum weight, weighted penalty and resolution
  // status, computed beside certify() and agreeing with its axis_penalties.
  // An unresolved axis carries null severity, penalty and context, never 0
  // (RULE-011). A resolved axis names the SPREC mapping release whose
  // tables gave its severity and weight (RF018 AC1); any other axis, and any
  // axis with no release in the data, carries a null severityMappingReleaseId.
  // No axis evidence exists yet, so evidenceIds is empty, never fabricated
  // (see docs/decisions/2026-10-23-rcs-axis-results-and-route-reasons.md and
  // 2026-10-23-rcs-sprec-mapping-release.md).
  evaluateAxisResults(input = {}) {
    const samplePayload = samplePayloadOf(input);
    const sprec = this.normalizeSprec(samplePayload);
    const matrix = this.detectMatrixType(samplePayload, sprec);
    if (!AXES[matrix]) return { matrix: matrix || null, axes: [] };

    const axes = AXES[matrix].map((axis) => {
      const code = sprec[axis.field];
      const weight = this.data.weights.find((item) => item.matrix_type === matrix && item.axis_code === axis.axis_code);
      let severity = null;
      let resolutionStatus;
      if (!code) resolutionStatus = 'absent';
      else if (UNKNOWN_CODES.has(code)) resolutionStatus = 'unknown';
      else if (OTHER_CODES.has(code)) resolutionStatus = 'not_scored';
      else if (!SPREC_CODE_PATTERN.test(code)) resolutionStatus = 'invalid';
      else if (!this.catalogHas(matrix, axis.axis_code, code)) resolutionStatus = 'incompatible';
      else {
        severity = this.resolveSeverity(samplePayload, matrix, axis.axis_code, code);
        if (!severity || severity.is_scored !== true || severity.severity_value === null || !weight) {
          resolutionStatus = severity?.failure_reason === 'Analytical workflow context does not match seeded severity mapping'
            ? 'incompatible'
            : 'not_scored';
        } else {
          resolutionStatus = 'resolved';
        }
      }
      const resolved = resolutionStatus === 'resolved';
      return {
        axisCode: axis.axis_code.replace(/^P/, 'P_'),
        sprecCode: code || null,
        severity: resolved ? Number(severity.severity_value) : null,
        maximumWeight: weight ? Number(weight.weight) : null,
        weightedPenalty: resolved ? round(Number(weight.weight) * Number(severity.severity_value)) : null,
        severityMappingReleaseId: resolved ? this.sprecMappingRelease()?.sprecMappingReleaseId ?? null : null,
        resolutionStatus,
        applicabilityContext: resolved && severity.requires_workflow_context ? { workflowRule: severity.workflow_rule } : null,
        evidenceIds: [],
      };
    });
    return { matrix, axes };
  }

  // RF018 AC8 (#1320): the reasons for a certify() result's route. A result
  // with no recognised route gets none, never a fabricated one.
  routeReasons(result = {}) {
    const scoreRoutes = ['Score-based certification', 'Score critical penalty'];
    if (result.governance_status === 1 && scoreRoutes.includes(result.grade_route)
      && typeof result.score_based_grade === 'string' && result.score_based_grade !== '') {
      // INFERENCE, not a citation: V2E-0543's example reads "governance gate
      // passed", but the gate reads traceability, monitoring and
      // documentation evidence only where references are presented (#1524),
      // never semantic events, and evaluateGovernanceEvidence leaves its
      // aggregate unresolved, never pass; so only no failure was found.
      return ['no governance failure found', `score threshold ${result.score_based_grade}`];
    }
    if (result.governance_status === 0 && result.grade_route === 'Governance failure') {
      const reasons = Array.isArray(result.governance_failure_reasons) ? result.governance_failure_reasons : [];
      return ['governance failure', ...reasons];
    }
    return [];
  }

  certify(payload = {}) {
    const samplePayload = samplePayloadOf(payload);
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
    return this.resolveMatrix(payload, sprec).matrix;
  }

  // RF018 AC4 (#1320): the matrix of an input, either stated by the payload
  // or resolved by the versioned matrix mapping release, never by an
  // unversioned rule. The release's rules are walked in order and the first
  // match wins; `sprec` is the normalized SPREC certify passes.
  // INFERENCE, not a citation: an explicit matrix is resolved by no release,
  // so its matrixMappingReleaseId (V2E-0502) is null, never fabricated (see
  // docs/decisions/2026-10-23-rcs-versioned-matrix-mapping.md).
  resolveMatrix(payload = {}, sprec = {}) {
    const explicit = normalizeString(payload.matrix_type || payload.matrixType || sprec.matrix_type).toLowerCase();
    if (explicit === 'fluid' || explicit === 'solid') {
      return { matrix: explicit, resolvedBy: 'explicit', matrixMappingReleaseId: null, ruleId: null };
    }

    const mapping = this.data.matrixMapping;
    const sampleText = normalizeString(payload.sampleType || payload.sampleOrigin).toLowerCase();
    const matches = (rule) => {
      if (!Object.keys(AXES).includes(rule.matrix_type)) return false;
      if (rule.source === 'sample_text') {
        return Array.isArray(rule.contains_any) && rule.contains_any.some((term) => sampleText.includes(term));
      }
      if (rule.source === 'sprec_axis_present') {
        return Array.isArray(rule.fields_any) && rule.fields_any.some((field) => sprec[field]);
      }
      return false;
    };
    const rule = (mapping?.rules ?? []).find(matches);
    if (!rule) return { matrix: null, resolvedBy: null, matrixMappingReleaseId: null, ruleId: null };
    return {
      matrix: rule.matrix_type,
      resolvedBy: 'mapping',
      matrixMappingReleaseId: mapping.sprec_mapping_release_id,
      ruleId: rule.rule_id,
    };
  }

  // RF018 AC4 (#1320): the matrix, its resolution and its materialTypeCode
  // (V2E-0500..0502) for the input certify() reads.
  // INFERENCE, not a citation: materialTypeCode is the SPREC 2.0 type of
  // sample, kept only when it is in the resolved matrix's seeded catalog.
  matrixResolution(input = {}) {
    const samplePayload = samplePayloadOf(input);
    const sprec = this.normalizeSprec(samplePayload);
    const resolution = this.resolveMatrix(samplePayload, sprec);
    let materialTypeCode = null;
    if (resolution.matrix && AXES[resolution.matrix]) {
      const entry = (this.data.catalogs?.[resolution.matrix] ?? [])
        .find((item) => item.axis_code === 'sampleType' && item.sprec_code === sprec.sampleType);
      const systemUri = this.data.matrixMapping?.material_type_system;
      if (entry && sprec.sampleType && systemUri) {
        materialTypeCode = {
          systemUri,
          code: entry.sprec_code,
          version: this.data.sprec_version,
          display: entry.description,
        };
      }
    }
    return { ...resolution, materialTypeCode };
  }

  // RF018 AC4 (#1320): the matrix mapping release's identity and checksum,
  // as canonical JSON over the seeded release. It is not part of
  // governanceRuleSet(), whose checksum stays the gate's own. With no
  // release in the data it is null, as matrixResolution resolves nothing.
  matrixMappingRelease() {
    if (!this.mappingRelease) {
      const mapping = this.data.matrixMapping;
      if (!mapping) return null;
      this.mappingRelease = {
        sprecMappingReleaseId: mapping.sprec_mapping_release_id,
        sprecVersion: mapping.sprec_version,
        mappingVersion: mapping.mapping_version,
        compatibilityStatus: mapping.compatibility_status,
        status: mapping.status,
        checksum: `sha256:${crypto.createHash('sha256').update(canonicalJson(mapping)).digest('hex')}`,
      };
    }
    return this.mappingRelease;
  }

  // RF018 AC1 (#1320): the SPREC mapping release's identity and checksum.
  // V2E-0239 is the checksum of the tables, so it is canonical JSON over the
  // seeded release with the catalogs, severity mappings and weights it
  // names; the thresholds are not codes, severities or weights and stay out.
  // With no release in the data it is null.
  sprecMappingRelease() {
    if (!this.sprecRelease) {
      const release = this.data.sprecMapping;
      if (!release) return null;
      const tables = {
        release,
        catalogs: this.data.catalogs,
        severity_mappings: this.data.severityMappings,
        weights: this.data.weights,
      };
      this.sprecRelease = {
        sprecMappingReleaseId: release.sprec_mapping_release_id,
        sprecVersion: release.sprec_version,
        mappingVersion: release.mapping_version,
        compatibilityStatus: release.compatibility_status,
        status: release.status,
        checksum: `sha256:${crypto.createHash('sha256').update(canonicalJson(tables)).digest('hex')}`,
      };
    }
    return this.sprecRelease;
  }

  // RF018 AC10 (#1320): the rule package certify() runs, as the version and
  // checksum an assessment preserves. The checksum composes the gate's rule
  // set, the matrix mapping release and the SPREC mapping release checksums
  // with the grade thresholds, the one table none of them covers, so it
  // changes whenever any rule certify reads changes. The version is the
  // seed's own model code, as governanceRuleSet()'s is, not a SemVer. With
  // either release absent from the data it is null.
  rulePackage() {
    if (!this.rcsRulePackage) {
      const matrixRelease = this.matrixMappingRelease();
      const sprecRelease = this.sprecMappingRelease();
      if (!matrixRelease || !sprecRelease) return null;
      const rules = {
        model_code: this.data.model_code,
        sprec_version: this.data.sprec_version,
        governance_rule_set: this.governanceRuleSet().checksum,
        matrix_mapping_release: matrixRelease.checksum,
        sprec_mapping_release: sprecRelease.checksum,
        thresholds: this.data.thresholds,
      };
      this.rcsRulePackage = {
        version: this.data.model_code,
        checksum: `sha256:${crypto.createHash('sha256').update(canonicalJson(rules)).digest('hex')}`,
      };
    }
    return this.rcsRulePackage;
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
        if (!SPREC_CODE_PATTERN.test(code)) {
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

    // RNF018 AC5 (#1524): a presented evidence reference that did not
    // resolve (missing hash, unresolvable URI, hash mismatch) fails its
    // category. A resolved category adds nothing, so the trace of an input
    // with no resolution is unchanged; the client booleans above can fail a
    // category but never pass one.
    const resolution = normalizeObject(payload.governanceEvidenceResolution);
    for (const [category, { reason, ruleCode }] of Object.entries(EVIDENCE_CATEGORIES)) {
      const entries = resolution[category];
      if (!Array.isArray(entries)) continue;
      const failing = entries.filter((entry) => normalizeObject(entry).status !== 'resolved');
      if (!failing.length) continue;
      if (!reasons.includes(reason)) reasons.push(reason);
      trace.push({
        rule_code: ruleCode,
        reason,
        evidence: failing.map((entry) => ({ uri: normalizeObject(entry).uri ?? null, status: normalizeObject(entry).status ?? null })),
      });
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
module.exports.RCS_SCOPE_STATEMENT = RCS_SCOPE_STATEMENT;
module.exports.samplePayloadOf = samplePayloadOf;
module.exports.EVIDENCE_CATEGORIES = EVIDENCE_CATEGORIES;
