import { describe, it, expect } from 'vitest';
const { normalizeRecord } = require('../../../src/reference-data/reference-imports/normalizeHpo');

describe('normalizeHpo.normalizeRecord', () => {
  it('normalizes a valid HPO record with parents and synonyms', () => {
    const result = normalizeRecord(
      { id: 'HP:0001250', lbl: 'Seizure', is_a: ['HP:0012638'], synonyms: ['Seizures', 'Epileptic seizure'] },
      5,
    );

    expect(result.ok).toBe(true);
    expect(result.concept).toMatchObject({
      code: 'HP:0001250',
      display: 'Seizure',
      sourceRecordId: 'HP:0001250',
      conceptStatus: 'active',
      semanticType: ['phenotype'],
    });
    expect(result.concept.synonyms).toEqual([
      { term: 'Seizures', scope: 'exact' },
      { term: 'Epileptic seizure', scope: 'exact' },
    ]);
    expect(result.parents).toEqual(['HP:0012638']);
  });

  it('marks an obsolete record with conceptStatus obsolete', () => {
    const result = normalizeRecord({ id: 'HP:0000001', lbl: 'All', is_a: [], obsolete: true }, 1);
    expect(result.ok).toBe(true);
    expect(result.concept.conceptStatus).toBe('obsolete');
  });

  it('treats a root record (no is_a) as an empty parents list', () => {
    const result = normalizeRecord({ id: 'HP:0000001', lbl: 'All', is_a: [] }, 1);
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
    const result = normalizeRecord({ id: 'HP:9999999', lbl: '', is_a: [] }, 10);
    expect(result.ok).toBe(false);
    expect(result.issue).toMatchObject({
      rowNumber: 10,
      sourceRecordId: 'HP:9999999',
      fieldPath: 'lbl',
      errorCode: 'MISSING_DISPLAY',
      severity: 'error',
    });
  });

  it('drops non-string entries from is_a and synonyms rather than crashing', () => {
    const result = normalizeRecord({ id: 'HP:0001250', lbl: 'Seizure', is_a: ['HP:0012638', null, 42], synonyms: ['Seizures', null] }, 5);
    expect(result.ok).toBe(true);
    expect(result.parents).toEqual(['HP:0012638']);
    expect(result.concept.synonyms).toEqual([{ term: 'Seizures', scope: 'exact' }]);
  });
});
