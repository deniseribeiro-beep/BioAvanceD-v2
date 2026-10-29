/**
 * RNF011 C3 (#1318): DataQualityAssessment, V2E-0270..0279. One assessment
 * scores a scope on completeness, validity, consistency, uniqueness,
 * timeliness and provenance against versioned thresholds. Every field is
 * Core and 1..1 or 1..*. Shape of IngestionQuarantineRecord.js; the
 * fieldsOf()/create() split of TelemetryIngestionEvent.js.
 *
 * INFERENCE, not a citation: the vocabularies extend one-value dictionary
 * cells, as docs/decisions/2026-10-22-ingestion-data-quality-assessment.md
 * records: scopeType adds `ingested_record`, status adds `failed`.
 */
const crypto = require('crypto');

// RNF011 C3, in its order.
const DIMENSIONS = ['completeness', 'validity', 'consistency', 'uniqueness', 'timeliness', 'provenance'];
const SCOPE_TYPES = ['dataset_release', 'dataset_snapshot', 'ingested_record'];
const STATUSES = ['passed', 'failed'];
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

const FIELDS = [
  'dataQualityAssessmentId',
  'scopeType',
  'scopeId',
  'dimensions',
  'metrics',
  'thresholds',
  'results',
  'assessmentVersion',
  'status',
  'assessedAt',
];

const isMissing = (value) => value === undefined || value === null || value === '';
const isNonEmptyArray = (value) => Array.isArray(value) && value.length > 0;

class DataQualityAssessmentModel {
  /** The ten canonical fields (V2E-0270..0279), and nothing else. */
  static fieldsOf(data = {}) {
    return {
      dataQualityAssessmentId: data.dataQualityAssessmentId || crypto.randomUUID(),
      scopeType: data.scopeType ?? null,
      scopeId: data.scopeId ?? null,
      dimensions: Array.isArray(data.dimensions) ? [...data.dimensions] : [],
      metrics: Array.isArray(data.metrics) ? [...data.metrics] : [],
      thresholds: Array.isArray(data.thresholds) ? [...data.thresholds] : [],
      results: Array.isArray(data.results) ? [...data.results] : [],
      assessmentVersion: data.assessmentVersion ?? null,
      status: data.status ?? null,
      assessedAt: data.assessedAt ? new Date(data.assessedAt) : new Date(),
    };
  }

  static validate(data = {}) {
    const errors = [];

    for (const field of FIELDS) {
      if (isMissing(data[field])) errors.push(`${field} é obrigatório (1..1)`);
    }
    if (!isMissing(data.scopeType) && !SCOPE_TYPES.includes(data.scopeType)) {
      errors.push(`scopeType deve ser um de: ${SCOPE_TYPES.join('|')}`);
    }
    if (!isMissing(data.status) && !STATUSES.includes(data.status)) {
      errors.push(`status deve ser um de: ${STATUSES.join('|')}`);
    }
    if (!isNonEmptyArray(data.dimensions) || !data.dimensions.every((d) => DIMENSIONS.includes(d))) {
      errors.push(`dimensions deve ser um subconjunto não vazio de: ${DIMENSIONS.join('|')}`);
    }
    for (const field of ['metrics', 'thresholds', 'results']) {
      if (!isNonEmptyArray(data[field])) errors.push(`${field} deve ser um array não vazio (1..*)`);
    }
    if (!isMissing(data.assessmentVersion) && !(typeof data.assessmentVersion === 'string' && VERSION_PATTERN.test(data.assessmentVersion))) {
      errors.push('assessmentVersion deve ter a forma X.Y.Z');
    }
    if (!isMissing(data.assessedAt) && !(data.assessedAt instanceof Date && !Number.isNaN(data.assessedAt.getTime()))) {
      errors.push('assessedAt deve ser uma data válida');
    }

    return { isValid: errors.length === 0, errors };
  }

  static create(data = {}) {
    return {
      ...this.fieldsOf(data),
      entityType: data.entityType ?? null,
      canonicalModelReleaseId: data.canonicalModelReleaseId ?? null,
      configurationReleaseId: data.configurationReleaseId ?? null,
      createdBy: data.createdBy ?? null,
    };
  }
}

module.exports = DataQualityAssessmentModel;
module.exports.DIMENSIONS = DIMENSIONS;
module.exports.SCOPE_TYPES = SCOPE_TYPES;
module.exports.STATUSES = STATUSES;
