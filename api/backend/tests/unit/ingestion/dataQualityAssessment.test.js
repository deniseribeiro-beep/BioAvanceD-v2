import { describe, it, expect } from 'vitest';
const {
  ASSESSMENT_VERSION,
  assessIngestedRecord,
  findSourceDuplicate,
  insertDataQualityAssessment,
} = require('../../../src/ingestion/dataQualityAssessment');
const DataQualityAssessmentModel = require('../../../src/models/DataQualityAssessment');
const { INGESTION_TARGETS } = require('../../../src/ingestion/ingestionTargets');
const { createFakeDb } = require('./testHelpers');

// RNF011 C3 (#1318): the six metrics of an ingested record's assessment.

const ASSESSED_AT = new Date('2026-10-22T12:00:00.000Z');
const DATASET = { datasetTitle: 'Coorte A', datasetVersion: '1.0', creators: ['Equipe A'], license: 'CC-BY-4.0' };

function envelope(overrides = {}) {
  return {
    sourceSystem: 'urn:system:lims',
    createdBy: 'Actor/u-1',
    retrievedAt: new Date('2026-10-22T11:00:00.000Z'),
    purpose: 'operational_registration',
    sourceRecordId: 'LIMS-DS-42',
    ...overrides,
  };
}

function assess(overrides = {}) {
  return assessIngestedRecord({
    target: INGESTION_TARGETS.Dataset,
    entityType: 'Dataset',
    payload: DATASET,
    violations: [],
    envelope: envelope(),
    duplicateFound: false,
    scopeId: 'Dataset/ds-1',
    releases: { canonicalModelReleaseId: 'release-2.0.0', configurationReleaseId: 'cfg-release-7' },
    actorId: 'u-1',
    assessedAt: ASSESSED_AT,
    ...overrides,
  });
}

const resultOf = (doc, metric) => doc.results.find((r) => r.metric === metric);

describe('ingestion/dataQualityAssessment assessIngestedRecord (RNF011 C3, #1318)', () => {
  it('1. a complete, valid, unique, timely record passes on all six dimensions, as a valid document', () => {
    const doc = assess();

    expect(doc).toMatchObject({
      scopeType: 'ingested_record',
      scopeId: 'Dataset/ds-1',
      dimensions: DataQualityAssessmentModel.DIMENSIONS,
      assessmentVersion: ASSESSMENT_VERSION,
      status: 'passed',
      assessedAt: ASSESSED_AT,
      entityType: 'Dataset',
      canonicalModelReleaseId: 'release-2.0.0',
      configurationReleaseId: 'cfg-release-7',
      createdBy: 'Actor/u-1',
    });
    expect(doc.results.map((r) => [r.metric, r.value])).toEqual([
      ['completeness', 1], ['validity', 1], ['consistency', 1], ['uniqueness', 1], ['timeliness', 1], ['provenance', 1],
    ]);
    expect(doc.metrics.map((m) => m.metric)).toEqual(DataQualityAssessmentModel.DIMENSIONS);
    expect(doc.thresholds).toEqual(DataQualityAssessmentModel.DIMENSIONS.map((metric) => ({ metric, minimum: 1 })));
    expect(DataQualityAssessmentModel.validate(doc)).toEqual({ isValid: true, errors: [] });
  });

  it('2. completeness counts the schema required fields present; null, empty string and [] are absent', () => {
    expect(resultOf(assess(), 'completeness')).toEqual({ metric: 'completeness', value: 1, numerator: 4, denominator: 4 });
    const { license, ...withoutLicense } = DATASET;
    expect(resultOf(assess({ payload: withoutLicense }), 'completeness')).toEqual({ metric: 'completeness', value: 0.75, numerator: 3, denominator: 4 });
    expect(resultOf(assess({ payload: { ...DATASET, datasetTitle: '', creators: [], license: null } }), 'completeness'))
      .toEqual({ metric: 'completeness', value: 0.25, numerator: 1, denominator: 4 });
  });

  it('3. a WorkflowRun completeness is over its seven required fields', () => {
    const doc = assess({ target: INGESTION_TARGETS.WorkflowRun, entityType: 'WorkflowRun', payload: { workflowId: 'wf', workflowVersion: '1.0.0' } });

    expect(resultOf(doc, 'completeness')).toEqual({ metric: 'completeness', value: 2 / 7, numerator: 2, denominator: 7 });
  });

  it('4. provenance counts the four envelope fields, and a retrievedAt counts only as a valid Date', () => {
    expect(resultOf(assess(), 'provenance')).toEqual({ metric: 'provenance', value: 1, numerator: 4, denominator: 4 });
    const doc = assess({ envelope: envelope({ purpose: null, retrievedAt: new Date('nope') }) });
    expect(resultOf(doc, 'provenance')).toEqual({ metric: 'provenance', value: 0.5, numerator: 2, denominator: 4 });
  });

  it('5. validity is 0 for a contract violation, and ignores provenance and model violations', () => {
    const contract = assess({ violations: [{ code: 'SCHEMA_VALIDATION_FAILED' }, { code: 'PROVENANCE_FIELD_MISSING' }] });
    const other = assess({ violations: [{ code: 'PROVENANCE_FIELD_MISSING' }, { code: 'ENTITY_VALIDATION_FAILED' }] });

    expect(resultOf(contract, 'validity')).toEqual({ metric: 'validity', value: 0, numerator: null, denominator: null, violationCount: 1 });
    expect(resultOf(other, 'validity')).toEqual({ metric: 'validity', value: 1, numerator: null, denominator: null, violationCount: 0 });
  });

  it('6. consistency is 0 for an ENTITY_VALIDATION_FAILED violation, else 1', () => {
    const failed = assess({ violations: [{ code: 'ENTITY_VALIDATION_FAILED' }, { code: 'ENTITY_VALIDATION_FAILED' }] });

    expect(resultOf(failed, 'consistency')).toEqual({ metric: 'consistency', value: 0, numerator: null, denominator: null, violationCount: 2 });
    expect(resultOf(assess(), 'consistency')).toEqual({ metric: 'consistency', value: 1, numerator: null, denominator: null, violationCount: 0 });
  });

  it('7. uniqueness is 0 for a duplicate, 1 without one, and null, never 0, with no sourceRecordId (RNF011 C5)', () => {
    expect(resultOf(assess({ duplicateFound: true }), 'uniqueness')).toMatchObject({ value: 0 });
    expect(resultOf(assess({ duplicateFound: false }), 'uniqueness')).toMatchObject({ value: 1 });
    expect(resultOf(assess({ duplicateFound: null }), 'uniqueness')).toEqual({
      metric: 'uniqueness', value: null, numerator: null, denominator: null, notAssessed: 'no_source_record_id',
    });
  });

  it('8. timeliness is 1 up to 5 minutes past assessedAt, 0 beyond, and null with no retrievedAt', () => {
    const atTolerance = assess({ envelope: envelope({ retrievedAt: new Date('2026-10-22T12:05:00.000Z') }) });
    const beyond = assess({ envelope: envelope({ retrievedAt: new Date('2026-10-22T12:05:01.000Z') }) });

    expect(resultOf(assess(), 'timeliness')).toEqual({ metric: 'timeliness', value: 1, numerator: null, denominator: null, ageSeconds: 3600 });
    expect(resultOf(atTolerance, 'timeliness')).toMatchObject({ value: 1, ageSeconds: -300 });
    expect(resultOf(beyond, 'timeliness')).toMatchObject({ value: 0, ageSeconds: -301 });
    expect(resultOf(assess({ envelope: envelope({ retrievedAt: null }) }), 'timeliness')).toEqual({
      metric: 'timeliness', value: null, numerator: null, denominator: null, notAssessed: 'no_retrieved_at',
    });
  });

  it('timeliness uses the configured clock drift limit', () => {
    // #1520, RNF025 AC6: 3 minutes past assessedAt is beyond a 1-minute
    // limit and within the 5-minute default.
    const threeMinutesAhead = envelope({ retrievedAt: new Date('2026-10-22T12:03:00.000Z') });
    expect(resultOf(assess({ envelope: threeMinutesAhead, clockDriftLimitMs: 60000 }), 'timeliness')).toMatchObject({ value: 0, ageSeconds: -180 });
    expect(resultOf(assess({ envelope: threeMinutesAhead }), 'timeliness')).toMatchObject({ value: 1, ageSeconds: -180 });
  });

  it('9. a null result neither passes nor fails: an otherwise passing record stays passed', () => {
    const doc = assess({ duplicateFound: null });

    expect(resultOf(doc, 'uniqueness').value).toBeNull();
    expect(doc.status).toBe('passed');
  });

  it.each([
    ['completeness', { payload: { ...DATASET, license: undefined } }],
    ['validity', { violations: [{ code: 'SCHEMA_VALIDATION_FAILED' }] }],
    ['consistency', { violations: [{ code: 'ENTITY_VALIDATION_FAILED' }] }],
    ['uniqueness', { duplicateFound: true }],
    ['timeliness', { envelope: envelope({ retrievedAt: new Date('2026-10-23T00:00:00.000Z') }) }],
    ['provenance', { envelope: envelope({ purpose: null }) }],
  ])('10. one %s result under its minimum fails the status', (metric, overrides) => {
    const doc = assess(overrides);

    expect(doc.results.filter((r) => r.value !== null && r.value < 1).map((r) => r.metric)).toEqual([metric]);
    expect(doc.status).toBe('failed');
  });
});

describe('ingestion/dataQualityAssessment findSourceDuplicate and insertDataQualityAssessment (#1318)', () => {
  it('11. findSourceDuplicate is null without a sourceRecordId, and otherwise whether the target holds that source record', async () => {
    const db = createFakeDb({ datasets: [{ datasetId: 'ds-0', sourceSystem: 'urn:system:lims', sourceRecordId: 'LIMS-DS-42' }] });
    const target = INGESTION_TARGETS.Dataset;

    await expect(findSourceDuplicate(db, target, envelope({ sourceRecordId: null }))).resolves.toBeNull();
    await expect(findSourceDuplicate(db, target, envelope())).resolves.toBe(true);
    await expect(findSourceDuplicate(db, target, envelope({ sourceSystem: 'urn:system:other' }))).resolves.toBe(false);
  });

  it('12. insertDataQualityAssessment inserts a valid document, and throws on an invalid one with no insert', async () => {
    const db = createFakeDb({ dataQualityAssessments: [] });
    const doc = assess();

    await insertDataQualityAssessment(db, doc);
    await expect(insertDataQualityAssessment(db, { ...doc, status: 'pass' })).rejects.toThrow('DataQualityAssessment inválido');

    expect(db.collections.dataQualityAssessments.docs).toEqual([doc]);
  });
});
