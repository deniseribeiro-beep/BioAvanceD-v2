import { describe, it, expect } from 'vitest';
const { processRecords } = require('../../../src/reference-data/reference-imports/processRecords');
const { buildCoverageManifest, assessRelease, ASSESSMENT_VERSION } = require('../../../src/reference-data/reference-imports/coverage');
const ReferenceCoverageManifestModel = require('../../../src/models/ReferenceCoverageManifest');

const normalizeRecord = (raw, rowNumber) => (raw.code
  ? { ok: true, concept: { code: raw.code, display: raw.code }, parents: raw.parents || [] }
  : { ok: false, issue: { rowNumber, errorCode: 'MISSING_CODE', errorMessage: `Linha ${rowNumber} sem código.`, severity: 'error' } });

const rowsOf = (records) => records.map((record, index) => ({ rowNumber: index + 1, line: JSON.stringify(record) }));

const release = {
  referenceDatasetReleaseId: 'release-1',
  sourceId: 'SRC_TEST',
  datasetVersion: '1',
  retrievalUri: 'file:///test.jsonl',
  license: 'CC BY 4.0',
  sourceChecksum: 'abc',
  parserVersion: '1.0.0',
  mappingVersion: '1.0.0',
};

function coverageOf(records) {
  const { recordsRead, concepts, issues } = processRecords(rowsOf(records), normalizeRecord);
  const manifest = buildCoverageManifest({
    releaseId: release.referenceDatasetReleaseId,
    runId: 'run-1',
    datasetCode: 'TEST',
    assetUri: 'objstore://reference-releases/TEST/sha256/abc',
    recordsRead,
    obtainedCount: concepts.size,
    issues,
  });
  const fatalCount = issues.filter((issue) => issue.severity === 'fatal').length;
  const assessment = assessRelease({
    release,
    manifest,
    fatalCount,
    rejectionRate: issues.length / recordsRead,
    maxRejectionRate: 0.5,
    actorId: 'test-actor',
  });
  return { manifest, assessment };
}

describe('reference release coverage (RF028 AC6/AC7)', () => {
  it('a source row rejected by normalization is a justified exclusion, and the release passes', () => {
    const { manifest, assessment } = coverageOf([{ code: 'A' }, { code: 'B' }, {}]);

    expect(manifest).toMatchObject({ expectedCount: 3, obtainedCount: 2, coverageResult: 'justified', referenceImportRunId: 'run-1' });
    expect(manifest.exclusions).toEqual([{ rowNumber: 3, sourceRecordId: null, reason: 'MISSING_CODE', justification: 'Linha 3 sem código.' }]);
    expect(ReferenceCoverageManifestModel.validate(manifest).isValid).toBe(true);
    expect(assessment).toMatchObject({
      scopeType: 'dataset_release',
      scopeId: 'release-1',
      entityType: 'ReferenceDatasetRelease',
      assessmentVersion: ASSESSMENT_VERSION,
      dimensions: ['completeness', 'validity', 'provenance'],
      status: 'passed',
    });
  });

  it('two rows sharing one code leave an unexplained gap: incomplete, and a failed assessment', () => {
    const { manifest, assessment } = coverageOf([{ code: 'A' }, { code: 'A' }, { code: 'B' }]);

    expect(manifest).toMatchObject({ expectedCount: 3, obtainedCount: 2, exclusions: [], coverageResult: 'incomplete' });
    const completeness = assessment.results.find((result) => result.metric === 'completeness');
    expect(completeness.value).toBeLessThan(1);
    expect(assessment.status).toBe('failed');
  });

  it('an ORPHAN_RELATION issue is not an exclusion', () => {
    const { manifest } = coverageOf([{ code: 'A', parents: ['MISSING'] }, { code: 'B' }]);

    expect(manifest).toMatchObject({ expectedCount: 2, obtainedCount: 2, exclusions: [], coverageResult: 'complete' });
  });

  it.each([
    ['a blank errorMessage', { errorCode: 'MISSING_CODE', errorMessage: '' }, { reason: 'MISSING_CODE', justification: 'MISSING_CODE' }],
    ['a whitespace errorMessage', { errorCode: 'MISSING_CODE', errorMessage: '   ' }, { reason: 'MISSING_CODE', justification: 'MISSING_CODE' }],
    ['a blank errorCode', { errorCode: '', errorMessage: 'Linha 2 sem código.' }, { reason: 'UNSPECIFIED_REJECTION', justification: 'Linha 2 sem código.' }],
    ['neither errorCode nor errorMessage', {}, { reason: 'UNSPECIFIED_REJECTION', justification: 'UNSPECIFIED_REJECTION' }],
  ])('a row-level issue with %s is still a justified exclusion of a valid manifest (#1398)', (_label, fields, expected) => {
    const manifest = buildCoverageManifest({
      releaseId: release.referenceDatasetReleaseId,
      runId: 'run-1',
      datasetCode: 'TEST',
      assetUri: 'objstore://reference-releases/TEST/sha256/abc',
      recordsRead: 2,
      obtainedCount: 1,
      issues: [{ entityType: 'TerminologyConcept', rowNumber: 2, severity: 'error', ...fields }],
    });

    expect(manifest.exclusions).toEqual([{ rowNumber: 2, sourceRecordId: null, ...expected }]);
    expect(manifest.coverageResult).toBe('justified');
    expect(ReferenceCoverageManifestModel.validate(manifest).isValid).toBe(true);
  });

  it('a source with no row read fails completeness', () => {
    const { manifest, assessment } = coverageOf([]);

    expect(manifest.coverageResult).toBe('incomplete');
    expect(assessment.results.find((result) => result.metric === 'completeness').value).toBe(0);
    expect(assessment.status).toBe('failed');
  });
});
