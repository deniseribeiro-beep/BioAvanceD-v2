import { describe, it, expect } from 'vitest';
const { normalizeRecord } = require('../../../src/reference-data/reference-imports/normalizeAtc');

describe('normalizeAtc.normalizeRecord', () => {
  it('normalizes a valid ATC record with parents and synonyms', () => {
    const result = normalizeRecord(
      { id: 'N02BE01', lbl: 'paracetamol', is_a: ['N02B'], synonyms: ['acetaminophen'] },
      6,
    );

    expect(result.ok).toBe(true);
    expect(result.concept).toMatchObject({
      code: 'N02BE01',
      display: 'paracetamol',
      sourceRecordId: 'N02BE01',
      conceptStatus: 'active',
      semanticType: ['medication'],
    });
    expect(result.concept.synonyms).toEqual([{ term: 'acetaminophen', scope: 'exact' }]);
    expect(result.parents).toEqual(['N02B']);
  });

  it('marks an obsolete record with conceptStatus obsolete', () => {
    const result = normalizeRecord({ id: 'ATC:0', lbl: 'medicamento, não classificado', is_a: [], obsolete: true }, 1);
    expect(result.ok).toBe(true);
    expect(result.concept.conceptStatus).toBe('obsolete');
  });

  it('treats a root record (no is_a) as an empty parents list', () => {
    const result = normalizeRecord({ id: 'ATC:0', lbl: 'medicamento, não classificado', is_a: [] }, 1);
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
    const result = normalizeRecord({ id: 'ZZZZZZZ', lbl: '', is_a: [] }, 10);
    expect(result.ok).toBe(false);
    expect(result.issue).toMatchObject({
      rowNumber: 10,
      sourceRecordId: 'ZZZZZZZ',
      fieldPath: 'lbl',
      errorCode: 'MISSING_DISPLAY',
      severity: 'error',
    });
  });

  it('drops non-string entries from is_a and synonyms rather than crashing', () => {
    const result = normalizeRecord({ id: 'N02BE01', lbl: 'paracetamol', is_a: ['N02B', null, 42], synonyms: ['acetaminophen', null] }, 6);
    expect(result.ok).toBe(true);
    expect(result.parents).toEqual(['N02B']);
    expect(result.concept.synonyms).toEqual([{ term: 'acetaminophen', scope: 'exact' }]);
  });
});
