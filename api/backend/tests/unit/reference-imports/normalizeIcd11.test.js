import { describe, it, expect } from 'vitest';
const { normalizeRecord } = require('../../../src/reference-data/reference-imports/normalizeIcd11');

describe('normalizeIcd11.normalizeRecord', () => {
  it('normalizes a valid ICD-11 record with parents and synonyms', () => {
    const result = normalizeRecord(
      { id: 'MMS:1C62', lbl: 'coronavirus disease 2019', is_a: ['MMS:1A00'], synonyms: ['COVID-19'] },
      5,
    );

    expect(result.ok).toBe(true);
    expect(result.concept).toMatchObject({
      code: 'MMS:1C62',
      display: 'coronavirus disease 2019',
      sourceRecordId: 'MMS:1C62',
      conceptStatus: 'active',
      semanticType: ['disease'],
    });
    expect(result.concept.synonyms).toEqual([{ term: 'COVID-19', scope: 'exact' }]);
    expect(result.parents).toEqual(['MMS:1A00']);
  });

  it('marks an obsolete record with conceptStatus obsolete', () => {
    const result = normalizeRecord({ id: 'MMS:XX00', lbl: 'disease, unspecified', is_a: [], obsolete: true }, 1);
    expect(result.ok).toBe(true);
    expect(result.concept.conceptStatus).toBe('obsolete');
  });

  it('treats a root record (no is_a) as an empty parents list', () => {
    const result = normalizeRecord({ id: 'MMS:XX00', lbl: 'disease, unspecified', is_a: [] }, 1);
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
    const result = normalizeRecord({ id: 'MMS:9999999', lbl: '', is_a: [] }, 10);
    expect(result.ok).toBe(false);
    expect(result.issue).toMatchObject({
      rowNumber: 10,
      sourceRecordId: 'MMS:9999999',
      fieldPath: 'lbl',
      errorCode: 'MISSING_DISPLAY',
      severity: 'error',
    });
  });

  it('drops non-string entries from is_a and synonyms rather than crashing', () => {
    const result = normalizeRecord({ id: 'MMS:1C62', lbl: 'coronavirus disease 2019', is_a: ['MMS:1A00', null, 42], synonyms: ['COVID-19', null] }, 5);
    expect(result.ok).toBe(true);
    expect(result.parents).toEqual(['MMS:1A00']);
    expect(result.concept.synonyms).toEqual([{ term: 'COVID-19', scope: 'exact' }]);
  });
});
