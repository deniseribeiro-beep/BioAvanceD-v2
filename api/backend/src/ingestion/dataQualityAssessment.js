/**
 * RNF011 C3 (#1318): one DataQualityAssessment (V2E-0270..0279) per ingested
 * record, accepted or quarantined, scored on RNF011's six dimensions. The
 * assessment is recorded, never gating: a record is accepted or quarantined
 * by the gateway alone (docs/decisions/2026-10-22-ingestion-data-quality-assessment.md).
 *
 * INFERENCE, not a citation: the metric definitions and `minimum: 1` are
 * this slice's, versioned by ASSESSMENT_VERSION.
 */
const DataQualityAssessmentModel = require('../models/DataQualityAssessment');
const { CANONICAL_COLLECTIONS } = require('../config/collections');
const { schemas } = require('../contracts/canonical/v1');
const { REQUIRED_FIELDS } = require('./provenanceEnvelope');
const { isAbsent } = require('./missingness');
const { DEFAULT_CLOCK_DRIFT_LIMIT_MS } = require('../services/clockDriftLimit');

// 1.1.0 (#1520): timeliness reads the configured clock drift limit.
const ASSESSMENT_VERSION = '1.1.0';

// The codes the gateway raises for a provenance or model failure; every
// other code (contract, reference, code, missingness declaration) is validity.
const NON_VALIDITY_CODES = ['PROVENANCE_FIELD_MISSING', 'ENTITY_VALIDATION_FAILED'];

const METRICS = Object.freeze([
  { metric: 'completeness', definition: 'campos required do schema canônico presentes no payload', denominator: 'required fields' },
  { metric: 'validity', definition: '1 sem violação de contrato, referência ou código; senão 0', denominator: null },
  { metric: 'consistency', definition: '1 sem ENTITY_VALIDATION_FAILED do validate() do modelo (obrigatórios, formato e checagem cruzada); senão 0', denominator: null },
  { metric: 'uniqueness', definition: '1 sem outro registro de mesmo sourceSystem e sourceRecordId; senão 0; null sem sourceRecordId', denominator: null },
  { metric: 'timeliness', definition: '1 quando retrievedAt <= assessedAt + o limite de desvio de relógio configurado (telemetry.clockDriftLimitMinutes, padrão 5 min); senão 0; null sem retrievedAt', denominator: null },
  { metric: 'provenance', definition: 'campos obrigatórios do envelope de provenance presentes', denominator: 'provenance required fields' },
]);

function isValidDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function requiredFieldsOf(target) {
  const schema = Object.values(schemas).find((candidate) => candidate && candidate.$id === target.schemaId);
  return Array.isArray(schema?.required) ? schema.required : [];
}

function ratio(metric, numerator, denominator) {
  return { metric, value: denominator === 0 ? null : numerator / denominator, numerator, denominator };
}

function completenessOf(target, payload) {
  const data = payload && typeof payload === 'object' ? payload : {};
  const required = requiredFieldsOf(target);
  // An absent field counts absent; it is never filled in (RNF011 C5).
  return ratio('completeness', required.filter((field) => !isAbsent(data[field])).length, required.length);
}

function provenanceOf(envelope) {
  const source = envelope && typeof envelope === 'object' ? envelope : {};
  const present = REQUIRED_FIELDS.filter((field) => (field === 'retrievedAt' ? isValidDate(source[field]) : !isAbsent(source[field])));
  return ratio('provenance', present.length, REQUIRED_FIELDS.length);
}

function binary(metric, ok, extra) {
  return { metric, value: ok ? 1 : 0, numerator: null, denominator: null, ...extra };
}

function uniquenessOf(duplicateFound) {
  // RNF011 C5: an unassessable uniqueness is null, never 0.
  if (duplicateFound === null || duplicateFound === undefined) {
    return { metric: 'uniqueness', value: null, numerator: null, denominator: null, notAssessed: 'no_source_record_id' };
  }
  return binary('uniqueness', duplicateFound !== true);
}

// RNF025 AC6 (#1520): a retrievedAt past assessedAt by more than the
// configured clock drift limit is not timely.
function timelinessOf(envelope, assessedAt, limitMs) {
  const retrievedAt = envelope?.retrievedAt;
  if (!isValidDate(retrievedAt)) {
    return { metric: 'timeliness', value: null, numerator: null, denominator: null, notAssessed: 'no_retrieved_at' };
  }
  return binary('timeliness', retrievedAt.getTime() <= assessedAt.getTime() + limitMs, {
    ageSeconds: Math.round((assessedAt.getTime() - retrievedAt.getTime()) / 1000),
  });
}

/** Pure: the create()d assessment of one ingested record. */
function assessIngestedRecord({ target, entityType, payload, violations = [], envelope, duplicateFound, scopeId, releases = {}, actorId, assessedAt = new Date(), clockDriftLimitMs = DEFAULT_CLOCK_DRIFT_LIMIT_MS }) {
  const validityViolations = violations.filter((v) => !NON_VALIDITY_CODES.includes(v?.code));
  const consistencyViolations = violations.filter((v) => v?.code === 'ENTITY_VALIDATION_FAILED');

  const byMetric = {
    completeness: completenessOf(target, payload),
    validity: binary('validity', validityViolations.length === 0, { violationCount: validityViolations.length }),
    consistency: binary('consistency', consistencyViolations.length === 0, { violationCount: consistencyViolations.length }),
    uniqueness: uniquenessOf(duplicateFound),
    timeliness: timelinessOf(envelope, assessedAt, clockDriftLimitMs),
    provenance: provenanceOf(envelope),
  };
  const thresholds = DataQualityAssessmentModel.DIMENSIONS.map((metric) => ({ metric, minimum: 1 }));
  const results = DataQualityAssessmentModel.DIMENSIONS.map((metric) => byMetric[metric]);
  // A null result neither passes nor fails.
  const passed = results.every((result, index) => result.value === null || result.value >= thresholds[index].minimum);

  return DataQualityAssessmentModel.create({
    scopeType: 'ingested_record',
    scopeId,
    dimensions: [...DataQualityAssessmentModel.DIMENSIONS],
    metrics: METRICS.map((metric) => ({ ...metric })),
    thresholds,
    results,
    assessmentVersion: ASSESSMENT_VERSION,
    status: passed ? 'passed' : 'failed',
    assessedAt,
    entityType,
    canonicalModelReleaseId: releases.canonicalModelReleaseId ?? null,
    configurationReleaseId: releases.configurationReleaseId ?? null,
    createdBy: actorId ? `Actor/${actorId}` : null,
  });
}

/** null without a sourceRecordId (not assessable); else whether the target already stores that source record. */
async function findSourceDuplicate(db, target, envelope, opts = {}) {
  if (!envelope?.sourceRecordId) return null;
  return !!(await db.collection(target.collection).findOne({ sourceSystem: envelope.sourceSystem, sourceRecordId: envelope.sourceRecordId }, opts));
}

/** Validates and inserts; an invalid assessment throws, as quarantine.js does. */
async function insertDataQualityAssessment(db, doc, opts = {}) {
  const { isValid, errors } = DataQualityAssessmentModel.validate(doc);
  if (!isValid) {
    throw new Error(`DataQualityAssessment inválido: ${errors.join('; ')}`);
  }
  await db.collection(CANONICAL_COLLECTIONS.dataQualityAssessments).insertOne(doc, opts);
  return doc;
}

module.exports = {
  ASSESSMENT_VERSION,
  assessIngestedRecord,
  findSourceDuplicate,
  insertDataQualityAssessment,
};
