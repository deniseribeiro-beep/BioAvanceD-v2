import { describe, it, expect } from 'vitest';
const { normalizeRecord } = require('../../../src/reference-data/reference-imports/normalizeUberon');

describe('normalizeUberon.normalizeRecord', () => {
  it('normalizes a valid Uberon record with parents and synonyms', () => {
    const result = normalizeRecord(
      { id: 'UBERON:0002082', lbl: 'cardiac ventricle', is_a: ['UBERON:0000948'], synonyms: ['ventricle of heart'] },
      6,
    );

    expect(result.ok).toBe(true);
    expect(result.concept).toMatchObject({
      code: 'UBERON:0002082',
      display: 'cardiac ventricle',
      sourceRecordId: 'UBERON:0002082',
      conceptStatus: 'active',
      semanticType: ['anatomy'],
    });
    expect(result.concept.synonyms).toEqual([{ term: 'ventricle of heart', scope: 'exact' }]);
    expect(result.parents).toEqual(['UBERON:0000948']);
  });

  it('marks an obsolete record with conceptStatus obsolete', () => {
    const result = normalizeRecord({ id: 'UBERON:0001062', lbl: 'anatomical entity', is_a: [], obsolete: true }, 1);
    expect(result.ok).toBe(true);
    expect(result.concept.conceptStatus).toBe('obsolete');
  });

  it('treats a root record (no is_a) as an empty parents list', () => {
    const result = normalizeRecord({ id: 'UBERON:0001062', lbl: 'anatomical entity', is_a: [] }, 1);
    expect(result.ok).toBe(true);
    expect(result.parents).toEqual([]);
  });

  it('rejects a record with a missing/blank id', () => {
    const result = normalizeRecord({ id: '  ', lbl: 'Missing code term', is_a: [] }, 9);
    expect(result.ok).toBe(false);
    expect(result.issue).toMatchObject({
      rowNumber: 9,
      fieldPath: 'id',
      errorCode: 'MISSING_CODE',
      severity: 'error',
    });
  });

  it('rejects a record with a missing/blank label', () => {
    const result = normalizeRecord({ id: 'UBERON:9999', lbl: '', is_a: [] }, 10);
    expect(result.ok).toBe(false);
    expect(result.issue).toMatchObject({
      rowNumber: 10,
      sourceRecordId: 'UBERON:9999',
      fieldPath: 'lbl',
      errorCode: 'MISSING_DISPLAY',
      severity: 'error',
    });
  });

  it('drops non-string entries from is_a and synonyms rather than crashing', () => {
    const result = normalizeRecord({ id: 'UBERON:0002082', lbl: 'cardiac ventricle', is_a: ['UBERON:0000948', null, 42], synonyms: ['ventricle of heart', null] }, 6);
    expect(result.ok).toBe(true);
    expect(result.parents).toEqual(['UBERON:0000948']);
    expect(result.concept.synonyms).toEqual([{ term: 'ventricle of heart', scope: 'exact' }]);
  });
});
