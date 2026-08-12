import { describe, it, expect } from 'vitest';
const { normalizeRecord } = require('../../../src/reference-data/reference-imports/normalizeDcb');

describe('normalizeDcb.normalizeRecord', () => {
  it('normalizes a valid DCB record with parents and synonyms', () => {
    const result = normalizeRecord(
      { id: 'DCB:0001', lbl: 'paracetamol', is_a: ['DCB:ANALG'], synonyms: ['acetaminofeno'] },
      4,
    );

    expect(result.ok).toBe(true);
    expect(result.concept).toMatchObject({
      code: 'DCB:0001',
      display: 'paracetamol',
      sourceRecordId: 'DCB:0001',
      conceptStatus: 'active',
      semanticType: ['medication'],
    });
    expect(result.concept.synonyms).toEqual([{ term: 'acetaminofeno', scope: 'exact' }]);
    expect(result.parents).toEqual(['DCB:ANALG']);
  });

  it('marks an obsolete record with conceptStatus obsolete', () => {
    const result = normalizeRecord({ id: 'DCB:0', lbl: 'fármaco, não especificado', is_a: [], obsolete: true }, 1);
    expect(result.ok).toBe(true);
    expect(result.concept.conceptStatus).toBe('obsolete');
  });

  it('treats a root record (no is_a) as an empty parents list', () => {
    const result = normalizeRecord({ id: 'DCB:0', lbl: 'fármaco, não especificado', is_a: [] }, 1);
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
    const result = normalizeRecord({ id: 'DCB:9999', lbl: '', is_a: [] }, 10);
    expect(result.ok).toBe(false);
    expect(result.issue).toMatchObject({
      rowNumber: 10,
      sourceRecordId: 'DCB:9999',
      fieldPath: 'lbl',
      errorCode: 'MISSING_DISPLAY',
      severity: 'error',
    });
  });

  it('drops non-string entries from is_a and synonyms rather than crashing', () => {
    const result = normalizeRecord({ id: 'DCB:0001', lbl: 'paracetamol', is_a: ['DCB:ANALG', null, 42], synonyms: ['acetaminofeno', null] }, 4);
    expect(result.ok).toBe(true);
    expect(result.parents).toEqual(['DCB:ANALG']);
    expect(result.concept.synonyms).toEqual([{ term: 'acetaminofeno', scope: 'exact' }]);
  });
});
