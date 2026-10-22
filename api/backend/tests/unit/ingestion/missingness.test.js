import { describe, it, expect } from 'vitest';
const {
  MISSING_DATA_REASON_CODES,
  isAbsent,
  validateMissingDataReasons,
  buildMissingDataReasons,
} = require('../../../src/ingestion/missingness');
const { INGESTION_TARGETS } = require('../../../src/ingestion/ingestionTargets');

// RF029 AC7, RNF011 C4/C5 (#1318): a reasoned absence, never a zero.

const DATASET = INGESTION_TARGETS.Dataset;
const WORKFLOW_RUN = INGESTION_TARGETS.WorkflowRun;
const RELEASES = { canonicalModelReleaseId: 'release-2.0.0', configurationReleaseId: 'cfg-release-7' };
const RECORDED_AT = new Date('2026-10-22T09:00:00.000Z');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function codesOf(violations) {
  return violations.map((v) => v.code);
}

describe('ingestion/missingness (RF029 AC7, RNF011 C4/C5, #1318)', () => {
  it('names the RNF011 C4 reason codes in order, frozen', () => {
    expect(MISSING_DATA_REASON_CODES).toEqual(['unknown', 'not_collected', 'not_applicable', 'withheld', 'error']);
    expect(Object.isFrozen(MISSING_DATA_REASON_CODES)).toBe(true);
  });

  it.each([
    ['undefined', true, undefined],
    ['null', true, null],
    ["''", true, ''],
    ['[]', true, []],
    ['0', false, 0],
    ['false', false, false],
    ['{}', false, {}],
    ["'x'", false, 'x'],
    ['[0]', false, [0]],
  ])('isAbsent(%s) is %s', (_label, absent, value) => {
    expect(isAbsent(value)).toBe(absent);
  });

  it('a valid declaration, an undefined one and a null one give no violations', () => {
    expect(validateMissingDataReasons(DATASET, {}, [{ fieldPath: 'doi', reasonCode: 'withheld' }])).toEqual([]);
    expect(validateMissingDataReasons(DATASET, {}, undefined)).toEqual([]);
    expect(validateMissingDataReasons(DATASET, {}, null)).toEqual([]);
  });

  it('a declaration that is not an array is MISSING_REASON_INVALID', () => {
    expect(validateMissingDataReasons(DATASET, {}, { fieldPath: 'doi', reasonCode: 'unknown' })).toEqual([
      { code: 'MISSING_REASON_INVALID', field: 'missingDataReasons', message: expect.any(String) },
    ]);
  });

  it.each([
    ['a string', 'doi'],
    ['null', null],
    ['an array', ['doi', 'unknown']],
    ['a missing reasonCode', { fieldPath: 'doi' }],
    ['an extra key', { fieldPath: 'doi', reasonCode: 'unknown', note: 'x' }],
    ['a numeric reasonCode', { fieldPath: 'doi', reasonCode: 0 }],
    ['a non-string fieldPath', { fieldPath: ['doi'], reasonCode: 'unknown' }],
  ])('an entry that is %s is MISSING_REASON_INVALID', (_label, entry) => {
    expect(validateMissingDataReasons(DATASET, {}, [entry])).toEqual([
      { code: 'MISSING_REASON_INVALID', field: 'missingDataReasons[0]', message: expect.any(String) },
    ]);
  });

  it.each(['datasetTitle', 'datasetId', '__proto__', 'toString', 'constructor', 'completedAt'])(
    'a Dataset fieldPath %s is MISSING_REASON_FIELD_NOT_APPLICABLE',
    (fieldPath) => {
      expect(codesOf(validateMissingDataReasons(DATASET, {}, [{ fieldPath, reasonCode: 'unknown' }]))).toEqual(['MISSING_REASON_FIELD_NOT_APPLICABLE']);
    }
  );

  it.each(['zero', '0', 'Unknown', 'missing'])('a reasonCode %s is MISSING_REASON_CODE_INVALID', (reasonCode) => {
    expect(codesOf(validateMissingDataReasons(DATASET, {}, [{ fieldPath: 'doi', reasonCode }]))).toEqual(['MISSING_REASON_CODE_INVALID']);
  });

  it('a fieldPath declared twice is MISSING_REASON_DUPLICATE on the second entry', () => {
    expect(validateMissingDataReasons(DATASET, {}, [
      { fieldPath: 'doi', reasonCode: 'unknown' },
      { fieldPath: 'doi', reasonCode: 'withheld' },
    ])).toEqual([{ code: 'MISSING_REASON_DUPLICATE', field: 'missingDataReasons[1]', message: expect.any(String) }]);
  });

  it.each([
    ['a string', { doi: '10.1/x' }, 'doi'],
    ['0', { completedAt: 0 }, 'completedAt'],
    ['false', { parameters: false }, 'parameters'],
    ['{}', { parameters: {} }, 'parameters'],
    ['[0]', { inputFileIds: [0] }, 'inputFileIds'],
  ])('a declared field holding %s is MISSING_REASON_FIELD_PRESENT', (_label, payload, fieldPath) => {
    const target = fieldPath === 'doi' ? DATASET : WORKFLOW_RUN;
    expect(codesOf(validateMissingDataReasons(target, payload, [{ fieldPath, reasonCode: 'not_applicable' }]))).toEqual(['MISSING_REASON_FIELD_PRESENT']);
  });

  it('a declared field holding null, an empty string or [] is absent and valid', () => {
    expect(validateMissingDataReasons(DATASET, { doi: null, roCrateManifest: '', distributionFiles: [] }, [
      { fieldPath: 'doi', reasonCode: 'withheld' },
      { fieldPath: 'roCrateManifest', reasonCode: 'error' },
      { fieldPath: 'distributionFiles', reasonCode: 'not_collected' },
    ])).toEqual([]);
  });

  it('buildMissingDataReasons records each absent field as unknown by default, in the target order', () => {
    const doc = { datasetId: 'ds-1', doi: null, distributionFiles: [], roCrateManifest: null };

    const rows = buildMissingDataReasons({ target: DATASET, entityType: 'Dataset', entityId: 'ds-1', doc, declared: undefined, releases: RELEASES, recordedAt: RECORDED_AT });

    expect(rows.map((r) => [r.fieldPath, r.reasonCode])).toEqual([['doi', 'unknown'], ['distributionFiles', 'unknown'], ['roCrateManifest', 'unknown']]);
    expect(rows[0]).toEqual({
      missingDataReasonId: expect.stringMatching(UUID),
      entityType: 'Dataset',
      entityId: 'ds-1',
      fieldPath: 'doi',
      reasonCode: 'unknown',
      recordedAt: RECORDED_AT,
      canonicalModelReleaseId: 'release-2.0.0',
      configurationReleaseId: 'cfg-release-7',
    });
    expect(new Set(rows.map((r) => r.missingDataReasonId)).size).toBe(3);
  });

  it('buildMissingDataReasons uses the declared code and skips present fields', () => {
    const doc = { datasetId: 'ds-1', doi: null, distributionFiles: ['f-1'], roCrateManifest: 'ro-crate.json' };

    const rows = buildMissingDataReasons({ target: DATASET, entityType: 'Dataset', entityId: 'ds-1', doc, declared: [{ fieldPath: 'doi', reasonCode: 'withheld' }], releases: RELEASES, recordedAt: RECORDED_AT });

    expect(rows.map((r) => [r.fieldPath, r.reasonCode])).toEqual([['doi', 'withheld']]);
  });

  it('buildMissingDataReasons never emits a row for a field holding 0', () => {
    const doc = { workflowRunId: 'wr-1', containerImageDigest: 'sha256:abc', softwareDependencies: [{ name: 'gatk' }], parameters: { depth: 0 }, inputFileIds: ['in'], outputFileIds: ['out'], completedAt: 0 };

    const rows = buildMissingDataReasons({ target: WORKFLOW_RUN, entityType: 'WorkflowRun', entityId: 'wr-1', doc, declared: [], releases: RELEASES, recordedAt: RECORDED_AT });

    expect(rows).toEqual([]);
  });
});
