import { describe, it, expect } from 'vitest';
const { normalizeRecord } = require('../../../src/reference-data/reference-imports/normalizeUcum');

describe('normalizeUcum.normalizeRecord', () => {
  it('normalizes a valid UCUM record with parents and synonyms', () => {
    const result = normalizeRecord(
      { id: 'mg', lbl: 'milligram', is_a: ['UCUM:MASS'], synonyms: ['milligrams'] },
      4,
    );

    expect(result.ok).toBe(true);
    expect(result.concept).toMatchObject({
      code: 'mg',
      display: 'milligram',
      sourceRecordId: 'mg',
      conceptStatus: 'active',
      semanticType: ['unit'],
    });
    expect(result.concept.synonyms).toEqual([{ term: 'milligrams', scope: 'exact' }]);
    expect(result.parents).toEqual(['UCUM:MASS']);
  });

  it('marks an obsolete record with conceptStatus obsolete', () => {
    const result = normalizeRecord({ id: 'UCUM:0', lbl: 'unit, unspecified', is_a: [], obsolete: true }, 1);
    expect(result.ok).toBe(true);
    expect(result.concept.conceptStatus).toBe('obsolete');
  });

  it('treats a root record (no is_a) as an empty parents list', () => {
    const result = normalizeRecord({ id: 'UCUM:0', lbl: 'unit, unspecified', is_a: [] }, 1);
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
    const result = normalizeRecord({ id: 'ZZZ', lbl: '', is_a: [] }, 10);
    expect(result.ok).toBe(false);
    expect(result.issue).toMatchObject({
      rowNumber: 10,
      sourceRecordId: 'ZZZ',
      fieldPath: 'lbl',
      errorCode: 'MISSING_DISPLAY',
      severity: 'error',
    });
  });

  it('drops non-string entries from is_a and synonyms rather than crashing', () => {
    const result = normalizeRecord({ id: 'mg', lbl: 'milligram', is_a: ['UCUM:MASS', null, 42], synonyms: ['milligrams', null] }, 4);
    expect(result.ok).toBe(true);
    expect(result.parents).toEqual(['UCUM:MASS']);
    expect(result.concept.synonyms).toEqual([{ term: 'milligrams', scope: 'exact' }]);
  });
});
