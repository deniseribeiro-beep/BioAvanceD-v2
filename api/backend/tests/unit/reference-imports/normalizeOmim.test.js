import { describe, it, expect } from 'vitest';
const { normalizeRecord } = require('../../../src/reference-data/reference-imports/normalizeOmim');

describe('normalizeOmim.normalizeRecord', () => {
  it('normalizes a valid OMIM record with parents and synonyms', () => {
    const result = normalizeRecord(
      { id: '219700', lbl: 'cystic fibrosis', is_a: ['PS100100'], synonyms: ['CF'] },
      2,
    );

    expect(result.ok).toBe(true);
    expect(result.concept).toMatchObject({
      code: '219700',
      display: 'cystic fibrosis',
      sourceRecordId: '219700',
      conceptStatus: 'active',
      semanticType: ['disease'],
    });
    expect(result.concept.synonyms).toEqual([{ term: 'CF', scope: 'exact' }]);
    expect(result.parents).toEqual(['PS100100']);
  });

  it('marks an obsolete record with conceptStatus obsolete', () => {
    const result = normalizeRecord({ id: 'PS100100', lbl: 'mendelian phenotype, unspecified', is_a: [], obsolete: true }, 1);
    expect(result.ok).toBe(true);
    expect(result.concept.conceptStatus).toBe('obsolete');
  });

  it('treats a root record (no is_a) as an empty parents list', () => {
    const result = normalizeRecord({ id: 'PS100100', lbl: 'mendelian phenotype, unspecified', is_a: [] }, 1);
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
    const result = normalizeRecord({ id: '999999', lbl: '', is_a: [] }, 10);
    expect(result.ok).toBe(false);
    expect(result.issue).toMatchObject({
      rowNumber: 10,
      sourceRecordId: '999999',
      fieldPath: 'lbl',
      errorCode: 'MISSING_DISPLAY',
      severity: 'error',
    });
  });

  it('drops non-string entries from is_a and synonyms rather than crashing', () => {
    const result = normalizeRecord({ id: '219700', lbl: 'cystic fibrosis', is_a: ['PS100100', null, 42], synonyms: ['CF', null] }, 2);
    expect(result.ok).toBe(true);
    expect(result.parents).toEqual(['PS100100']);
    expect(result.concept.synonyms).toEqual([{ term: 'CF', scope: 'exact' }]);
  });
});
