import { describe, it, expect } from 'vitest';
const DataQualityAssessmentModel = require('../../../src/models/DataQualityAssessment');

// RNF011 C3 (#1318): DataQualityAssessment, V2E-0270..0279.

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

function valid() {
  return DataQualityAssessmentModel.create({
    scopeType: 'ingested_record',
    scopeId: 'Dataset/ds-1',
    dimensions: ['completeness', 'provenance'],
    metrics: [{ metric: 'completeness', definition: 'required presentes', denominator: 'required fields' }],
    thresholds: [{ metric: 'completeness', minimum: 1 }],
    results: [{ metric: 'completeness', value: 1, numerator: 4, denominator: 4 }],
    assessmentVersion: '1.0.0',
    status: 'passed',
    assessedAt: new Date('2026-10-22T10:00:00.000Z'),
    entityType: 'Dataset',
  });
}

describe('DataQualityAssessmentModel (RNF011 C3, #1318)', () => {
  it('fieldsOf returns exactly the ten canonical fields, and create adds the record context', () => {
    expect(Object.keys(DataQualityAssessmentModel.fieldsOf())).toEqual(FIELDS);
    expect(Object.keys(valid())).toEqual([...FIELDS, 'entityType', 'canonicalModelReleaseId', 'configurationReleaseId', 'createdBy']);
  });

  it('accepts a valid document', () => {
    expect(DataQualityAssessmentModel.validate(valid())).toEqual({ isValid: true, errors: [] });
  });

  it.each(FIELDS)('rejects a document without %s', (field) => {
    const doc = { ...valid(), [field]: undefined };

    const result = DataQualityAssessmentModel.validate(doc);

    expect(result.isValid).toBe(false);
    expect(result.errors.join(' ')).toContain(field);
  });

  it.each([
    ['scopeType', { scopeType: 'patient' }, 'scopeType deve ser um de'],
    ['status', { status: 'pass' }, 'status deve ser um de'],
    ['dimension', { dimensions: ['completeness', 'accuracy'] }, 'dimensions deve ser'],
    ['assessmentVersion', { assessmentVersion: '1.0' }, 'assessmentVersion deve ter a forma X.Y.Z'],
  ])('rejects a bad %s', (_label, override, message) => {
    const result = DataQualityAssessmentModel.validate({ ...valid(), ...override });

    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual([expect.stringContaining(message)]);
  });

  it('rejects an assessedAt that is not a valid Date', () => {
    const result = DataQualityAssessmentModel.validate({ ...valid(), assessedAt: new Date('not-a-date') });

    expect(result.errors).toEqual(['assessedAt deve ser uma data válida']);
  });
});
