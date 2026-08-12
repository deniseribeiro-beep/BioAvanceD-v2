import { describe, it, expect } from 'vitest';
const { normalizeRecord } = require('../../../src/reference-data/reference-imports/normalizeLoinc');

describe('normalizeLoinc.normalizeRecord', () => {
  it('normalizes a valid LOINC record with parents and synonyms', () => {
    const result = normalizeRecord(
      { id: '2160-0', lbl: 'Creatinine [Mass/volume] in Serum or Plasma', is_a: ['LOINC:CHEM'], synonyms: ['Creatinine'] },
      4,
    );

    expect(result.ok).toBe(true);
    expect(result.concept).toMatchObject({
      code: '2160-0',
      display: 'Creatinine [Mass/volume] in Serum or Plasma',
      sourceRecordId: '2160-0',
      conceptStatus: 'active',
      semanticType: ['observation'],
    });
    expect(result.concept.synonyms).toEqual([{ term: 'Creatinine', scope: 'exact' }]);
    expect(result.parents).toEqual(['LOINC:CHEM']);
  });

  it('marks an obsolete record with conceptStatus obsolete', () => {
    const result = normalizeRecord({ id: 'LOINC:0', lbl: 'observation, unspecified', is_a: [], obsolete: true }, 1);
    expect(result.ok).toBe(true);
    expect(result.concept.conceptStatus).toBe('obsolete');
  });

  it('treats a root record (no is_a) as an empty parents list', () => {
    const result = normalizeRecord({ id: 'LOINC:0', lbl: 'observation, unspecified', is_a: [] }, 1);
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
    const result = normalizeRecord({ id: '9999-9', lbl: '', is_a: [] }, 10);
    expect(result.ok).toBe(false);
    expect(result.issue).toMatchObject({
      rowNumber: 10,
      sourceRecordId: '9999-9',
      fieldPath: 'lbl',
      errorCode: 'MISSING_DISPLAY',
      severity: 'error',
    });
  });

  it('drops non-string entries from is_a and synonyms rather than crashing', () => {
    const result = normalizeRecord({ id: '2160-0', lbl: 'Creatinine [Mass/volume] in Serum or Plasma', is_a: ['LOINC:CHEM', null, 42], synonyms: ['Creatinine', null] }, 4);
    expect(result.ok).toBe(true);
    expect(result.parents).toEqual(['LOINC:CHEM']);
    expect(result.concept.synonyms).toEqual([{ term: 'Creatinine', scope: 'exact' }]);
  });
});
