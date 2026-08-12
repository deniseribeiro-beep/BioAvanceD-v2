import { describe, it, expect } from 'vitest';
const { normalizeRecord } = require('../../../src/reference-data/reference-imports/normalizeHgnc');

describe('normalizeHgnc.normalizeRecord', () => {
  it('normalizes a valid HGNC record with parents and synonyms', () => {
    const result = normalizeRecord(
      { id: 'HGNC:1100', lbl: 'BRCA1', is_a: ['HGNCFAM:TSG'], synonyms: ['RNF53'] },
      4,
    );

    expect(result.ok).toBe(true);
    expect(result.concept).toMatchObject({
      code: 'HGNC:1100',
      display: 'BRCA1',
      sourceRecordId: 'HGNC:1100',
      conceptStatus: 'active',
      semanticType: ['gene'],
    });
    expect(result.concept.synonyms).toEqual([{ term: 'RNF53', scope: 'exact' }]);
    expect(result.parents).toEqual(['HGNCFAM:TSG']);
  });

  it('marks an obsolete record with conceptStatus obsolete', () => {
    const result = normalizeRecord({ id: 'HGNC:0000', lbl: 'gene, unspecified', is_a: [], obsolete: true }, 1);
    expect(result.ok).toBe(true);
    expect(result.concept.conceptStatus).toBe('obsolete');
  });

  it('treats a root record (no is_a) as an empty parents list', () => {
    const result = normalizeRecord({ id: 'HGNC:0000', lbl: 'gene, unspecified', is_a: [] }, 1);
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
    const result = normalizeRecord({ id: 'HGNC:0001', lbl: '', is_a: [] }, 10);
    expect(result.ok).toBe(false);
    expect(result.issue).toMatchObject({
      rowNumber: 10,
      sourceRecordId: 'HGNC:0001',
      fieldPath: 'lbl',
      errorCode: 'MISSING_DISPLAY',
      severity: 'error',
    });
  });

  it('drops non-string entries from is_a and synonyms rather than crashing', () => {
    const result = normalizeRecord({ id: 'HGNC:1100', lbl: 'BRCA1', is_a: ['HGNCFAM:TSG', null, 42], synonyms: ['RNF53', null] }, 4);
    expect(result.ok).toBe(true);
    expect(result.parents).toEqual(['HGNCFAM:TSG']);
    expect(result.concept.synonyms).toEqual([{ term: 'RNF53', scope: 'exact' }]);
  });
});
