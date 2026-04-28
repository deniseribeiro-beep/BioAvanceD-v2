const QUALITY_RULE_VERSION = 'quality-domain-governance-aware-v2';
const QUALITY_RULE_TABLE_VERSION = 'quality-rule-table-article-v1';

const SPREC_REQUIRED_FIELDS = [
  'sampleType',
  'primaryContainer',
  'preCentrifugation',
  'centrifugation',
  'secondCentrifugation',
  'postCentrifugationDelay',
  'longTermStorage',
];

const SOLID_FIELD_ALIASES = {
  warmIschemia: ['warmIschemia', 'preCentrifugation'],
  coldIschemia: ['coldIschemia', 'centrifugation'],
  fixationType: ['fixationType', 'secondCentrifugation'],
  fixationTime: ['fixationTime', 'postCentrifugationDelay'],
  longTermStorage: ['longTermStorage'],
};

const RECOGNIZED_MATRIX_TYPES = ['fluid', 'solid'];

const QUALITY_RULE_TABLE = Object.freeze({
  version: QUALITY_RULE_TABLE_VERSION,
  fluid: Object.freeze({
    P_pre: Object.freeze({
      reason: 'pre_centrifugation_delay_and_thermal_context',
      tiers: Object.freeze({
        A: 0, B: 0, C: 15, D: 15, E: 30, F: 30, G: 45, H: 45, I: 60, J: 60, K: 75, L: 75, M: 90, N: 90, O: 30,
        default: 0,
      }),
      governanceFailureCodes: Object.freeze(['X']),
      manualReviewCodes: Object.freeze(['Z']),
      field: 'preCentrifugation',
    }),
    P_cent1: Object.freeze({
      reason: 'primary_centrifugation',
      tiers: Object.freeze({
        A: 0, B: 0, C: 0, D: 0, E: 10, F: 10, G: 20, H: 20, I: 30, J: 30, M: 15, N: 0,
        default: 0,
      }),
      governanceFailureCodes: Object.freeze(['X']),
      manualReviewCodes: Object.freeze(['Z']),
      field: 'centrifugation',
    }),
    P_cent2: Object.freeze({
      reason: 'second_centrifugation',
      tiers: Object.freeze({
        A: 0, B: 0, C: 0, D: 0, E: 5, F: 5, G: 10, H: 10, I: 15, J: 15, N: 0,
        default: 0,
      }),
      governanceFailureCodes: Object.freeze(['X']),
      manualReviewCodes: Object.freeze(['Z']),
      field: 'secondCentrifugation',
    }),
    P_post: Object.freeze({
      reason: 'post_centrifugation_delay',
      tiers: Object.freeze({
        A: 0, B: 0, C: 10, D: 10, E: 20, F: 20, G: 35, H: 35, I: 50, J: 50, N: 0,
        default: 0,
      }),
      governanceFailureCodes: Object.freeze(['X']),
      manualReviewCodes: Object.freeze(['Z']),
      field: 'postCentrifugationDelay',
    }),
    P_store: Object.freeze({
      reason: 'long_term_storage',
      tiers: Object.freeze({
        cryogenic_or_ultralow_workflow_appropriate: 0,
        minus35_to_minus18: 20,
        non_cryogenic_or_room_temperature_molecular_workflow: 40,
        default: 0,
      }),
      governanceFailureCodes: Object.freeze(['X']),
      manualReviewCodes: Object.freeze(['Z']),
      field: 'longTermStorage',
    }),
  }),
  solid: Object.freeze({
    P_warm: Object.freeze({
      reason: 'warm_ischemia',
      tiers: Object.freeze({
        A: 0, B: 10, C: 20, D: 30, E: 45, F: 60, N: 0,
        default: 0,
      }),
      governanceFailureCodes: Object.freeze(['X']),
      manualReviewCodes: Object.freeze(['Z']),
      field: 'warmIschemia',
    }),
    P_cold: Object.freeze({
      reason: 'cold_ischemia',
      tiers: Object.freeze({
        A: 0, B: 10, C: 20, D: 30, E: 45, F: 60, N: 0,
        default: 0,
      }),
      governanceFailureCodes: Object.freeze(['X']),
      manualReviewCodes: Object.freeze(['Z']),
      field: 'coldIschemia',
    }),
    P_fix: Object.freeze({
      reason: 'fixation_or_stabilization_type',
      tiers: Object.freeze({
        SNP: 0, PXT: 0, RNL: 0, ALL: 0, HST: 0,
        OCT: 10, NBF: 10,
        FOR: 20, ALD: 20, ETH: 20, ACA: 20, NAA: 20,
        default: 0,
      }),
      governanceFailureCodes: Object.freeze(['XXX']),
      manualReviewCodes: Object.freeze(['ZZZ']),
      field: 'fixationType',
    }),
    P_fixTime: Object.freeze({
      reason: 'fixation_time',
      tiers: Object.freeze({
        A: 15, B: 0, C: 5, D: 10, E: 15, F: 20, G: 30, N: 0,
        default: 0,
      }),
      governanceFailureCodes: Object.freeze(['X']),
      manualReviewCodes: Object.freeze(['Z']),
      field: 'fixationTime',
    }),
    P_store: Object.freeze({
      reason: 'long_term_storage',
      tiers: Object.freeze({
        cryogenic_or_ultralow_workflow_appropriate: 0,
        minus35_to_minus18: 20,
        room_temperature_or_non_cryogenic_molecular_workflow: 40,
        default: 0,
      }),
      governanceFailureCodes: Object.freeze(['X']),
      manualReviewCodes: Object.freeze(['Z']),
      field: 'longTermStorage',
    }),
  }),
});

function normalizeString(value) {
  return String(value || '').trim();
}

function unwrapSprecCode(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value.code ?? value.value ?? '';
  }
  return value;
}

function unwrapSprecLabel(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return normalizeString(value.label ?? value.description ?? '');
  }
  return '';
}

function normalizeCode(value) {
  const raw = normalizeString(unwrapSprecCode(value));
  return raw.includes('_') ? raw.toLowerCase() : raw.toUpperCase();
}

function normalizeNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function pickFirst(object = {}, keys = []) {
  for (const key of keys) {
    const value = object[key];
    if (value !== undefined && value !== null && normalizeString(unwrapSprecCode(value))) {
      return value;
    }
  }
  return '';
}

function normalizeStoragePenaltyCode(value, matrixType = 'fluid') {
  const code = normalizeCode(value);
  const label = unwrapSprecLabel(value).toLowerCase();
  const source = `${code} ${label}`;

  if (!code) return '';
  if (code === 'X') return 'X';
  if (code === 'Z') return 'Z';

  const minus35Codes = new Set(['B', 'H', 'K', 'M', 'T']);
  const idealCodes = new Set(['A', 'C', 'D', 'E', 'F', 'G', 'I', 'J', 'L', 'N', 'O', 'Q', 'S', 'V', 'W']);

  if (minus35Codes.has(code) || source.includes('-35') || source.includes('(-35')) {
    return 'minus35_to_minus18';
  }

  if (
    code === 'P'
    || code === 'R'
    || source.includes('paraffin')
    || source.includes('parafina')
    || source.includes('dry technology')
    || source.includes('secagem')
    || source.includes('room temperature')
    || source.includes('temperatura ambiente')
    || /\brt\b/.test(source)
  ) {
    return matrixType === 'solid'
      ? 'room_temperature_or_non_cryogenic_molecular_workflow'
      : 'non_cryogenic_or_room_temperature_molecular_workflow';
  }

  if (code === 'Y') {
    return source.includes('-35') || source.includes('-18')
      ? 'minus35_to_minus18'
      : 'cryogenic_or_ultralow_workflow_appropriate';
  }

  if (
    idealCodes.has(code)
    || source.includes('liquid nitrogen')
    || source.includes('nitrogenio liquido')
    || source.includes('nitrogênio líquido')
    || source.includes('-85')
    || source.includes('-60')
    || source.includes('< -135')
    || source.includes('<-135')
  ) {
    return 'cryogenic_or_ultralow_workflow_appropriate';
  }

  return code;
}

function normalizeSprec(sprec = {}) {
  const direct = normalizeObject(sprec);
  const matrixType = normalizeString(direct.matrixType || direct.matrix || '').toLowerCase();
  const collectionType = pickFirst(direct, ['collectionType', 'primaryContainer']);
  const centrifugation = pickFirst(direct, ['centrifugation1', 'centrifugation']);
  const secondCentrifugation = pickFirst(direct, ['centrifugation2', 'secondCentrifugation']);
  const postCentrifugationDelay = pickFirst(direct, ['postCentrifugation', 'postCentrifugationDelay']);
  return {
    matrixType,
    sampleType: normalizeCode(direct.sampleType),
    primaryContainer: normalizeCode(collectionType),
    collectionType: normalizeCode(collectionType),
    preCentrifugation: normalizeCode(direct.preCentrifugation),
    centrifugation: normalizeCode(centrifugation),
    centrifugation1: normalizeCode(centrifugation),
    secondCentrifugation: normalizeCode(secondCentrifugation),
    centrifugation2: normalizeCode(secondCentrifugation),
    postCentrifugationDelay: normalizeCode(postCentrifugationDelay),
    postCentrifugation: normalizeCode(postCentrifugationDelay),
    longTermStorage: normalizeStoragePenaltyCode(direct.longTermStorage, matrixType),
    longTermStorageCode: normalizeCode(direct.longTermStorage),
    longTermStorageLabel: unwrapSprecLabel(direct.longTermStorage),
    warmIschemia: normalizeCode(pickFirst(direct, SOLID_FIELD_ALIASES.warmIschemia)),
    coldIschemia: normalizeCode(pickFirst(direct, SOLID_FIELD_ALIASES.coldIschemia)),
    fixationType: normalizeCode(pickFirst(direct, SOLID_FIELD_ALIASES.fixationType)),
    fixationTime: normalizeCode(pickFirst(direct, SOLID_FIELD_ALIASES.fixationTime)),
    primaryCentrifugationApplicable: Boolean(
      direct.primaryCentrifugationApplicable
      || direct.centrifugationApplicable
      || direct.centrifugation1?.applicable
      || direct.centrifugation?.applicable
    ),
    secondCentrifugationRequired: Boolean(direct.secondCentrifugationRequired || direct.centrifugation2?.required),
    secondCentrifugationApplicable: Boolean(direct.secondCentrifugationApplicable || direct.centrifugation2?.applicable),
    preAnalyticalUnknown: Boolean(direct.preAnalyticalUnknown),
  };
}

function isUnknownSprecCode(value) {
  return ['X', 'XXX', 'UNK', 'UNKNOWN', 'NA'].includes(normalizeCode(value));
}

function isInvalidSprecCode(value) {
  const code = normalizeCode(value);
  return Boolean(code) && !/^[A-Za-z0-9_-]{1,80}$/.test(code);
}

function classifyScore(score) {
  const numericScore = normalizeNumber(score, null);
  if (numericScore === null) return null;
  if (numericScore >= 85) return 'A';
  if (numericScore >= 65) return 'B';
  return 'C';
}

function normalizeCategory(value) {
  const category = normalizeString(value).toUpperCase();
  return ['A', 'B', 'C'].includes(category) ? category : null;
}

function buildSprecCode(sprec = {}) {
  const normalized = normalizeSprec(sprec);
  return SPREC_REQUIRED_FIELDS
    .map((field) => normalized[field] || 'X')
    .join('-');
}

function hasMeaningfulSprec(sprec = {}) {
  const normalized = normalizeSprec(sprec);
  return SPREC_REQUIRED_FIELDS.some((field) => normalized[field])
    || ['warmIschemia', 'coldIschemia', 'fixationType', 'fixationTime'].some((field) => normalized[field])
    || Boolean(normalized.preAnalyticalUnknown);
}

function penaltyLogKey(component) {
  return String(component || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

function buildPenaltyLog(qualityAssessment = {}) {
  const log = [];
  const breakdown = normalizeObject(qualityAssessment.breakdown);

  Object.entries(breakdown).forEach(([component, item]) => {
    const value = typeof item === 'object' ? item.penalty : item;
    if (Number(value || 0) > 0) {
      log.push(`${penaltyLogKey(component)}:+${value}`);
    }
  });

  if (Number(qualityAssessment.penaltyCriticalFailure || 0) > 0) {
    log.push(`metadata_critica_ausente:+${qualityAssessment.penaltyCriticalFailure}`);
  }
  if (Number(qualityAssessment.penaltyIschemia || 0) > 0) {
    log.push(`isquemia:+${qualityAssessment.penaltyIschemia}`);
  }
  if (Number(qualityAssessment.penaltyTemperature || 0) > 0) {
    log.push(`temperatura:+${qualityAssessment.penaltyTemperature}`);
  }
  if (Number(qualityAssessment.penaltyProtocolAlert || 0) > 0) {
    log.push(`protocolo_alta_rotacao:+${qualityAssessment.penaltyProtocolAlert}`);
  }
  if (qualityAssessment.forcedQuarantine) {
    log.push('quarentena_forcada:true');
  }

  return [...new Set(log)];
}

function detectMatrixType(payload = {}, sprec = normalizeSprec(payload.sprec)) {
  const warnings = [];
  const rawSprec = normalizeObject(payload.sprec);
  const explicitMatrix = normalizeString(payload.matrixType || payload.matrix_type || sprec.matrixType || payload.sampleMatrix).toLowerCase();
  const sourceText = normalizeString(payload.sampleOrigin || payload.sampleType).toLowerCase();

  if (explicitMatrix) {
    if (explicitMatrix.includes('solid')) {
      return { matrixType: 'solid', confidence: 'explicit', required: true, warnings };
    }
    if (explicitMatrix.includes('fluid')) {
      return { matrixType: 'fluid', confidence: 'explicit', required: true, warnings };
    }
    warnings.push('matrix_type_unrecognized');
    return { matrixType: null, confidence: 'invalid', required: true, warnings };
  }

  if (sourceText.includes('tissue') || sourceText.includes('tumor') || sourceText.includes('ffpe')) {
    return { matrixType: 'solid', confidence: 'inferred-from-legacy-context', required: false, warnings };
  }
  if (sourceText.includes('blood') || sourceText.includes('plasma') || sourceText.includes('serum') || sourceText.includes('urine')) {
    return { matrixType: 'fluid', confidence: 'inferred-from-legacy-context', required: false, warnings };
  }

  if (normalizeString(rawSprec.fixationType || rawSprec.fixationTime || rawSprec.warmIschemia || rawSprec.coldIschemia)
    || ['FFPE', 'OCT', 'FRZ', 'FROZEN'].includes(sprec.primaryContainer)) {
    return { matrixType: 'solid', confidence: 'inferred-from-solid-fields', required: false, warnings };
  }

  warnings.push('matrix_type_missing_no_safe_inference');
  return { matrixType: null, confidence: 'missing', required: true, warnings };
}

function codePenalty(code, tiers = {}) {
  const normalized = normalizeCode(code);
  if (!normalized) return tiers.default ?? 0;
  if (Object.prototype.hasOwnProperty.call(tiers, normalized)) return tiers[normalized];
  return tiers.default ?? 0;
}

function collectRuleGovernanceFindings(matrixType, sprec = {}) {
  const rules = QUALITY_RULE_TABLE[matrixType] || {};
  const governanceFailures = [];
  const manualReviews = [];

  Object.entries(rules).forEach(([component, rule]) => {
    const code = normalizeCode(sprec[rule.field]);
    if (!code) return;
    if (Array.isArray(rule.governanceFailureCodes) && rule.governanceFailureCodes.includes(code)) {
      governanceFailures.push({ component, field: rule.field, code, reason: `${component}_governance_failure_code_${code}` });
    }
    if (Array.isArray(rule.manualReviewCodes) && rule.manualReviewCodes.includes(code)) {
      manualReviews.push({ component, field: rule.field, code, reason: `${component}_manual_review_code_${code}` });
    }
  });

  return { governanceFailures, manualReviews };
}

function evaluateGovernanceGate(payload = {}, sprec = normalizeSprec(payload.sprec), matrixType = 'fluid') {
  const reasons = [];
  const traceabilityFlags = [];
  const warnings = [];

  if (!RECOGNIZED_MATRIX_TYPES.includes(matrixType)) {
    reasons.push('matrix_type_required');
  }

  const requiredMetadata = matrixType === 'solid'
    ? ['sampleType', 'primaryContainer', 'warmIschemia', 'coldIschemia', 'fixationType', 'fixationTime', 'longTermStorage']
    : SPREC_REQUIRED_FIELDS;

  const missing = requiredMetadata.filter((field) => !normalizeString(sprec[field]));
  const unknown = requiredMetadata.filter((field) => isUnknownSprecCode(sprec[field]));
  const invalidCodes = requiredMetadata.filter((field) => isInvalidSprecCode(sprec[field]));

  if (missing.length) reasons.push('mandatory_metadata_missing');
  if (unknown.length || sprec.preAnalyticalUnknown) reasons.push('critical_preanalytical_metadata_unknown');
  if (invalidCodes.length) reasons.push('invalid_or_unrecognized_terminology');

  if (!normalizeString(payload.patientID || payload.patientId) && normalizeString(payload.requirePatientId).toLowerCase() === 'true') {
    reasons.push('essential_patient_identifier_missing');
  }

  const temperatureUnknown = Boolean(payload.temperatureUnknown)
    || isUnknownSprecCode(payload.temperature)
    || isUnknownSprecCode(payload.thermalTraceability?.temperatureStatus);
  const requiresThermalTraceability = Boolean(payload.requiresThermalTraceability || payload.thermalTraceabilityRequired);
  if (requiresThermalTraceability && temperatureUnknown) {
    reasons.push('critical_temperature_unknown');
    traceabilityFlags.push('thermal_traceability_failed');
  }

  const traceabilityBroken = Boolean(payload.traceabilityBroken || payload.traceability?.broken);
  if (traceabilityBroken) {
    reasons.push('critical_traceability_break');
    traceabilityFlags.push('chain_traceability_broken');
  }

  const sensorOffline = Boolean(payload.sensorOffline)
    || normalizeString(payload.telemetry?.sensorStatus).toLowerCase() === 'offline';
  const monitoringRequired = Boolean(payload.monitoringRequired || payload.telemetry?.monitoringRequired);
  if (monitoringRequired && sensorOffline) {
    reasons.push('required_telemetry_unavailable');
    traceabilityFlags.push('sensor_offline');
  }

  if (matrixType === 'solid' && ['BLD', 'SER', 'PLAS', 'PLASMA', 'URN', 'URINE'].includes(sprec.sampleType)) {
    reasons.push('severe_matrix_sample_type_inconsistency');
  }
  if (matrixType === 'fluid' && ['TIS', 'TISSUE', 'FFPE'].includes(sprec.sampleType)) {
    reasons.push('severe_matrix_sample_type_inconsistency');
  }

  const ruleFindings = RECOGNIZED_MATRIX_TYPES.includes(matrixType)
    ? collectRuleGovernanceFindings(matrixType, sprec)
    : { governanceFailures: [], manualReviews: [] };
  ruleFindings.governanceFailures.forEach((failure) => {
    reasons.push(failure.reason);
    traceabilityFlags.push('quality_rule_governance_failure');
  });
  ruleFindings.manualReviews.forEach((review) => {
    warnings.push(review.reason);
  });

  if (reasons.length && traceabilityFlags.length === 0) {
    traceabilityFlags.push('governance_gate_failed');
  }

  return {
    gate: reasons.length ? 0 : 1,
    Ggov: reasons.length ? 0 : 1,
    passed: reasons.length === 0,
    status: reasons.length ? 'failed' : 'passed',
    reasons: [...new Set(reasons)],
    warnings,
    traceabilityFlags: [...new Set(traceabilityFlags)],
    metadataCompleteness: {
      required: requiredMetadata.length,
      missing,
      unknown,
      complete: missing.length === 0 && unknown.length === 0,
    },
    terminologyStatus: {
      valid: invalidCodes.length === 0,
      invalidCodes,
    },
    governanceFailures: ruleFindings.governanceFailures,
    manualReviews: ruleFindings.manualReviews,
  };
}

function scoreFluid(sprec = {}) {
  const normalized = normalizeSprec(sprec);
  const breakdown = Object.fromEntries(Object.entries(QUALITY_RULE_TABLE.fluid).map(([component, rule]) => [
    component,
    {
      penalty: codePenalty(normalized[rule.field], rule.tiers),
      code: normalized[rule.field],
      reason: rule.reason,
      ruleTableVersion: QUALITY_RULE_TABLE.version,
    },
  ]));

  if (normalized.centrifugation === 'N' && normalized.primaryCentrifugationApplicable) {
    breakdown.P_cent1.penalty = 20;
    breakdown.P_cent1.reason = 'primary_centrifugation_required_but_not_performed';
  }

  const totalPenalty = Object.values(breakdown).reduce((sum, item) => sum + Number(item.penalty || 0), 0);
  return {
    score: Math.max(0, 100 - Math.min(100, totalPenalty)),
    breakdown,
    reasons: totalPenalty > 0 ? ['fluid_matrix_penalties_applied'] : [],
  };
}

function scoreSolid(sprec = {}) {
  const normalized = normalizeSprec(sprec);
  const breakdown = Object.fromEntries(Object.entries(QUALITY_RULE_TABLE.solid).map(([component, rule]) => [
    component,
    {
      penalty: codePenalty(normalized[rule.field], rule.tiers),
      code: normalized[rule.field],
      reason: rule.reason,
      ruleTableVersion: QUALITY_RULE_TABLE.version,
    },
  ]));

  const totalPenalty = Object.values(breakdown).reduce((sum, item) => sum + Number(item.penalty || 0), 0);
  return {
    score: Math.max(0, 100 - Math.min(100, totalPenalty)),
    breakdown,
    reasons: totalPenalty > 0 ? ['solid_matrix_penalties_applied'] : [],
  };
}

function toLegacyFlatPenalties(breakdown = {}) {
  const values = Object.fromEntries(
    Object.entries(breakdown).map(([key, item]) => [key, Number(item?.penalty || 0)])
  );

  return {
    penaltyIschemia: Number(values.P_pre || 0) + Number(values.P_warm || 0) + Number(values.P_cold || 0),
    penaltyTemperature: Number(values.P_cent1 || 0) + Number(values.P_cent2 || 0) + Number(values.P_fix || 0),
    penaltyProtocolAlert: Number(values.P_post || 0) + Number(values.P_fixTime || 0) + Number(values.P_store || 0),
  };
}

/**
 * Canonical quality contract.
 *
 * Canonical fields: score, category, forcedQuarantine, quarantineReason,
 * governance, breakdown, reasons, matrixType, version, sprec and traceability.
 * Legacy flat penalty fields are kept only for compatibility with import/intake
 * consumers while the UI and import templates migrate to breakdown.
 */
function toCanonicalQualityResult(input = {}) {
  const forcedQuarantine = Boolean(input.forcedQuarantine);
  const score = forcedQuarantine ? null : normalizeNumber(input.score, null);
  const category = forcedQuarantine ? 'C' : (normalizeCategory(input.category) || classifyScore(score));
  const breakdown = normalizeObject(input.breakdown);
  const legacy = toLegacyFlatPenalties(breakdown);
  const penaltyCriticalFailure = Number(input.penaltyCriticalFailure || (forcedQuarantine ? 100 : 0));
  const penaltyLog = normalizeArray(input.penaltyLog).length
    ? normalizeArray(input.penaltyLog)
    : buildPenaltyLog({ ...input, ...legacy, penaltyCriticalFailure, breakdown });
  const reasons = normalizeArray(input.reasons);
  const warnings = normalizeArray(input.warnings);
  const sprec = normalizeObject(input.sprec);
  const matrixType = normalizeString(input.matrixType || sprec.matrixType || 'fluid').toLowerCase();
  const quarantineReason = input.quarantineReason || (forcedQuarantine ? 'Governance gate failed' : null);

  return {
    score,
    category,
    label: category ? `Categoria ${category}` : 'Indeterminada',
    forcedQuarantine,
    penaltyLog,
    reasons,
    matrixType,
    source: input.source || 'quality-domain',
    version: input.version || QUALITY_RULE_VERSION,
    ruleTableVersion: input.ruleTableVersion || QUALITY_RULE_TABLE.version,
    matrixDetection: input.matrixDetection || null,
    governance: input.governance || {
      gate: forcedQuarantine ? 0 : 1,
      Ggov: forcedQuarantine ? 0 : 1,
      passed: !forcedQuarantine,
      status: forcedQuarantine ? 'failed' : 'passed',
      reasons: forcedQuarantine ? reasons : [],
    },
    governanceFailures: input.governanceFailures || input.governance?.governanceFailures || [],
    decisionStatus: forcedQuarantine ? 'quarantine' : (category === 'C' ? 'technical_quarantine' : (category === 'B' ? 'restricted' : 'available')),
    sprec,
    miabisStatus: input.miabisStatus || {
      category,
      valid: !forcedQuarantine && (category === 'A' || category === 'B'),
    },
    warnings,
    quarantineReason,
    metadataCompleteness: input.metadataCompleteness || input.governance?.metadataCompleteness || null,
    traceabilityFlags: input.traceabilityFlags || input.governance?.traceabilityFlags || [],
    breakdown,
    penaltyIschemia: Number(input.penaltyIschemia ?? legacy.penaltyIschemia ?? 0),
    penaltyTemperature: Number(input.penaltyTemperature ?? legacy.penaltyTemperature ?? 0),
    penaltyProtocolAlert: Number(input.penaltyProtocolAlert ?? legacy.penaltyProtocolAlert ?? 0),
    penaltyCriticalFailure,
  };
}

function calculateMethodologyQualityFromSprec(sprec = {}, context = {}) {
  const normalizedSprec = normalizeSprec(sprec);
  const matrix = detectMatrixType(context, normalizedSprec);
  const governance = evaluateGovernanceGate(context, normalizedSprec, matrix.matrixType);
  const effectiveMatrixType = RECOGNIZED_MATRIX_TYPES.includes(matrix.matrixType) ? matrix.matrixType : 'fluid';
  const scoring = effectiveMatrixType === 'solid'
    ? scoreSolid(normalizedSprec)
    : scoreFluid(normalizedSprec);
  const category = classifyScore(scoring.score);

  return toCanonicalQualityResult({
    score: scoring.score,
    category,
    forcedQuarantine: !governance.passed,
    penaltyCriticalFailure: governance.passed ? 0 : 100,
    reasons: [...governance.reasons, ...scoring.reasons],
    matrixType: matrix.matrixType || 'unknown',
    source: 'article-governance-aware-rule',
    sprec: { ...normalizedSprec, matrixType: matrix.matrixType || '' },
    governance,
    warnings: [...matrix.warnings, ...governance.warnings],
    quarantineReason: governance.passed ? null : `Governance gate failed: ${governance.reasons.join(', ')}`,
    metadataCompleteness: governance.metadataCompleteness,
    traceabilityFlags: governance.traceabilityFlags,
    breakdown: scoring.breakdown,
    governanceFailures: governance.governanceFailures,
    matrixDetection: matrix,
  });
}

function resolveProvidedQuality(samplePayload = {}) {
  const qualityCategory = normalizeCategory(samplePayload.quality_category || samplePayload.qualityCategory);
  const qualityScore = normalizeNumber(samplePayload.quality_score ?? samplePayload.qualityScore, null);
  const penaltyLog = normalizeArray(samplePayload.penalty_log || samplePayload.penaltyLog);
  const hasCriticalMetadataFailure = penaltyLog.some((entry) => {
    const value = normalizeString(entry).toLowerCase();
    return value.includes('metadata_critica_ausente') || value.includes('quarentena_forcada:true');
  });

  if (qualityCategory || qualityScore !== null || penaltyLog.length) {
    return toCanonicalQualityResult({
      score: qualityScore,
      category: qualityCategory || classifyScore(qualityScore),
      forcedQuarantine: hasCriticalMetadataFailure,
      penaltyLog,
      reasons: hasCriticalMetadataFailure ? ['critical_metadata_penalty_log'] : [],
      matrixType: normalizeObject(samplePayload.sprec).matrixType,
      source: qualityCategory ? 'provided-category-compatibility' : 'score-threshold-compatibility',
      sprec: normalizeObject(samplePayload.sprec),
      quarantineReason: hasCriticalMetadataFailure ? 'Falha crítica registrada em penalty_log' : null,
      traceabilityFlags: hasCriticalMetadataFailure ? ['forced_quarantine'] : [],
      breakdown: {},
    });
  }

  return null;
}

function resolveMethodologicalQuality(samplePayload = {}) {
  const payload = normalizeObject(samplePayload);
  const sprec = normalizeObject(payload.sprec);

  if (hasMeaningfulSprec(sprec)) {
    return calculateMethodologyQualityFromSprec(sprec, payload);
  }

  const provided = resolveProvidedQuality(payload);
  if (provided) return provided;

  return toCanonicalQualityResult({
    score: null,
    category: null,
    source: 'undetermined',
    reasons: ['insufficient_quality_input'],
    warnings: ['quality_input_missing'],
    breakdown: {},
  });
}

function evaluateQuality(payload = {}) {
  const normalized = normalizeObject(payload);
  const samplePayload = normalizeObject(normalized.sample);
  return resolveMethodologicalQuality(Object.keys(samplePayload).length ? samplePayload : normalized);
}

function validateQualityForRelease(sample = {}) {
  const rawCategory = normalizeCategory(sample?.quality_category || sample?.qualityCategory);
  const rawScore = normalizeNumber(sample?.quality_score ?? sample?.qualityScore, null);
  const assessment = resolveMethodologicalQuality(sample);

  if (assessment.forcedQuarantine || Number(assessment.penaltyCriticalFailure || 0) > 0) {
    return {
      valid: false,
      reason: assessment.quarantineReason || 'Falha crítica de governança/rastreabilidade (quarentena técnica obrigatória)',
      assessment,
    };
  }

  if (rawScore !== null && rawCategory) {
    const expectedCategory = classifyScore(rawScore);
    if (rawCategory !== expectedCategory) {
      return {
        valid: false,
        reason: `Inconsistência score/categoria (${rawScore} => ${expectedCategory}, recebido ${rawCategory})`,
        assessment,
      };
    }
  }

  const category = assessment.category || rawCategory;
  const score = assessment.score !== null ? assessment.score : rawScore;

  if (category === 'A' || category === 'B') {
    return {
      valid: true,
      reason: score !== null ? `Qualidade ${category} aprovada (score ${score})` : `Qualidade ${category} aprovada`,
      assessment,
    };
  }

  if (score !== null) {
    return {
      valid: false,
      reason: `Qualidade insuficiente (score ${score}, quarentena técnica)`,
      assessment,
    };
  }

  return {
    valid: false,
    reason: 'Qualidade Insuficiente (Quarentena Técnica)',
    assessment,
  };
}

module.exports = {
  QUALITY_RULE_VERSION,
  QUALITY_RULE_TABLE_VERSION,
  QUALITY_RULE_TABLE,
  SPREC_REQUIRED_FIELDS,
  resolveMethodologicalQuality,
  evaluateQuality,
  calculateMethodologyQualityFromSprec,
  buildPenaltyLog,
  buildSprecCode,
  validateQualityForRelease,
  classifyScore,
  normalizeSprec,
  normalizeString,
  normalizeNumber,
  normalizeArray,
};
