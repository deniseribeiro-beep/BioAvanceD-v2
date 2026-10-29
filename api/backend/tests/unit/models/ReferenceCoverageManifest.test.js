import { describe, it, expect } from 'vitest';
const ReferenceCoverageManifestModel = require('../../../src/models/ReferenceCoverageManifest');

describe('ReferenceCoverageManifestModel (V2E-0261..0269)', () => {
  const exclusion = { rowNumber: 3, sourceRecordId: null, reason: 'MISSING_CODE', justification: 'Linha 3 sem código.' };
  const base = {
    referenceDatasetReleaseId: 'release-1',
    assets: ['objstore://reference-releases/HPO/sha256/abc'],
    expectedCount: 10,
    obtainedCount: 9,
    exclusions: [exclusion],
  };

  it('fieldsOf returns exactly the nine canonical fields', () => {
    expect(Object.keys(ReferenceCoverageManifestModel.fieldsOf()).sort()).toEqual([
      'assets',
      'checksum',
      'coverageResult',
      'exclusions',
      'expectedCount',
      'generatedAt',
      'obtainedCount',
      'referenceCoverageManifestId',
      'referenceDatasetReleaseId',
    ]);
  });

  it('create computes coverageResult and checksum, and validate accepts the result', () => {
    const doc = ReferenceCoverageManifestModel.create(base);

    expect(doc.coverageResult).toBe('justified');
    expect(doc.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(doc).toMatchObject({ datasetCode: null, referenceImportRunId: null });
    expect(ReferenceCoverageManifestModel.validate(doc)).toEqual({ isValid: true, errors: [] });
  });

  it.each([
    ['empty assets', { assets: [] }, 'assets deve ser um array não vazio de URIs (1..*)'],
    ['a negative count', { obtainedCount: -1 }, 'obtainedCount deve ser um inteiro não negativo'],
    ['an exclusion without justification', { exclusions: [{ reason: 'MISSING_CODE' }] }, 'cada exclusão deve ter reason e justification'],
    ['a coverageResult inconsistent with the counts', { coverageResult: 'complete' }, 'coverageResult não corresponde às contagens e exclusões'],
    ['a malformed checksum', { checksum: 'sha256:synthetic-coverage' }, 'checksum deve ter a forma sha256:<64 hex>'],
  ])('validate rejects %s', (_label, change, error) => {
    const doc = { ...ReferenceCoverageManifestModel.create(base), ...change };

    const result = ReferenceCoverageManifestModel.validate(doc);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain(error);
  });

  it.each([
    ['complete', { expectedCount: 10, obtainedCount: 10, exclusions: [] }],
    ['justified', { expectedCount: 10, obtainedCount: 9, exclusions: [exclusion] }],
    ['incomplete', { expectedCount: 10, obtainedCount: 8, exclusions: [exclusion] }],
    ['incomplete', { expectedCount: 0, obtainedCount: 0, exclusions: [] }],
    ['incomplete', { expectedCount: 10, obtainedCount: 11, exclusions: [] }],
  ])('coverageResultOf gives %s for %o', (expected, counts) => {
    expect(ReferenceCoverageManifestModel.coverageResultOf(counts)).toBe(expected);
  });

  it('checksumOf is stable over the id and time, and changed by a count', () => {
    const doc = ReferenceCoverageManifestModel.create(base);
    const other = ReferenceCoverageManifestModel.create({ ...base, generatedAt: new Date('2026-01-01T00:00:00Z') });

    expect(other.referenceCoverageManifestId).not.toBe(doc.referenceCoverageManifestId);
    expect(ReferenceCoverageManifestModel.checksumOf(other)).toBe(doc.checksum);
    expect(ReferenceCoverageManifestModel.checksumOf({ ...doc, expectedCount: 11 })).not.toBe(doc.checksum);
  });
});
