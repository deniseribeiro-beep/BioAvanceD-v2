import { describe, it, expect } from 'vitest';
const { normalizeRecord } = require('../../../src/reference-data/reference-imports/normalizeNcbitax');

describe('normalizeNcbitax.normalizeRecord', () => {
  it('normalizes a valid NCBI Taxonomy record with parents and synonyms', () => {
    const result = normalizeRecord(
      { id: '2759', lbl: 'Eukaryota', is_a: ['131567'], synonyms: ['eucaryotes', 'eukaryotes'] },
      6,
    );

    expect(result.ok).toBe(true);
    expect(result.concept).toMatchObject({
      code: '2759',
      display: 'Eukaryota',
      sourceRecordId: '2759',
      conceptStatus: 'active',
      semanticType: ['organism'],
    });
    expect(result.concept.synonyms).toEqual([
      { term: 'eucaryotes', scope: 'exact' },
      { term: 'eukaryotes', scope: 'exact' },
    ]);
    expect(result.parents).toEqual(['131567']);
  });

  it('marks an obsolete record with conceptStatus obsolete', () => {
    const result = normalizeRecord({ id: '1', lbl: 'root', is_a: [], obsolete: true }, 1);
    expect(result.ok).toBe(true);
    expect(result.concept.conceptStatus).toBe('obsolete');
  });

  it('treats a root record (no is_a) as an empty parents list', () => {
    const result = normalizeRecord({ id: '1', lbl: 'root', is_a: [] }, 1);
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
    const result = normalizeRecord({ id: '9000099', lbl: '', is_a: [] }, 10);
    expect(result.ok).toBe(false);
    expect(result.issue).toMatchObject({
      rowNumber: 10,
      sourceRecordId: '9000099',
      fieldPath: 'lbl',
      errorCode: 'MISSING_DISPLAY',
      severity: 'error',
    });
  });

  it('drops non-string entries from is_a and synonyms rather than crashing', () => {
    const result = normalizeRecord({ id: '2759', lbl: 'Eukaryota', is_a: ['131567', null, 42], synonyms: ['eukaryotes', null] }, 6);
    expect(result.ok).toBe(true);
    expect(result.parents).toEqual(['131567']);
    expect(result.concept.synonyms).toEqual([{ term: 'eukaryotes', scope: 'exact' }]);
  });
});
