import { describe, it, expect } from 'vitest';
const { normalizeRecord } = require('../../../src/reference-data/reference-imports/normalizeEdam');

describe('normalizeEdam.normalizeRecord', () => {
  it('normalizes a valid EDAM record with parents and synonyms', () => {
    const result = normalizeRecord(
      { id: 'data_2044', lbl: 'Sequence', is_a: ['data_0006'], synonyms: ['bio sequence'] },
      2,
    );

    expect(result.ok).toBe(true);
    expect(result.concept).toMatchObject({
      code: 'data_2044',
      display: 'Sequence',
      sourceRecordId: 'data_2044',
      conceptStatus: 'active',
      semanticType: ['bioinformatics'],
    });
    expect(result.concept.synonyms).toEqual([{ term: 'bio sequence', scope: 'exact' }]);
    expect(result.parents).toEqual(['data_0006']);
  });

  it('marks an obsolete record with conceptStatus obsolete', () => {
    const result = normalizeRecord({ id: 'data_0006', lbl: 'Data', is_a: [], obsolete: true }, 1);
    expect(result.ok).toBe(true);
    expect(result.concept.conceptStatus).toBe('obsolete');
  });

  it('treats a root record (no is_a) as an empty parents list', () => {
    const result = normalizeRecord({ id: 'topic_0003', lbl: 'Topic', is_a: [] }, 8);
    expect(result.ok).toBe(true);
    expect(result.parents).toEqual([]);
  });

  it('rejects a record with a missing/blank id', () => {
    const result = normalizeRecord({ id: '  ', lbl: 'Missing code term', is_a: [] }, 12);
    expect(result.ok).toBe(false);
    expect(result.issue).toMatchObject({
      rowNumber: 12,
      fieldPath: 'id',
      errorCode: 'MISSING_CODE',
      severity: 'error',
    });
  });

  it('rejects a record with a missing/blank label', () => {
    const result = normalizeRecord({ id: 'data_9999', lbl: '', is_a: [] }, 13);
    expect(result.ok).toBe(false);
    expect(result.issue).toMatchObject({
      rowNumber: 13,
      sourceRecordId: 'data_9999',
      fieldPath: 'lbl',
      errorCode: 'MISSING_DISPLAY',
      severity: 'error',
    });
  });

  it('drops non-string entries from is_a and synonyms rather than crashing', () => {
    const result = normalizeRecord({ id: 'data_2977', lbl: 'Nucleic acid sequence', is_a: ['data_2044', null, 42], synonyms: ['bio sequence', null] }, 3);
    expect(result.ok).toBe(true);
    expect(result.parents).toEqual(['data_2044']);
    expect(result.concept.synonyms).toEqual([{ term: 'bio sequence', scope: 'exact' }]);
  });
});
