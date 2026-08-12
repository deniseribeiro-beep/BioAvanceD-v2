import { describe, it, expect } from 'vitest';
const { normalizeRecord } = require('../../../src/reference-data/reference-imports/normalizeDuo');

describe('normalizeDuo.normalizeRecord', () => {
  it('normalizes a valid DUO record with parents and synonyms', () => {
    const result = normalizeRecord(
      { id: 'DUO:0000006', lbl: 'health or medical or biomedical research use', is_a: ['DUO:0000001'], synonyms: ['HMB'] },
      3,
    );

    expect(result.ok).toBe(true);
    expect(result.concept).toMatchObject({
      code: 'DUO:0000006',
      display: 'health or medical or biomedical research use',
      sourceRecordId: 'DUO:0000006',
      conceptStatus: 'active',
      semanticType: ['consent'],
    });
    expect(result.concept.synonyms).toEqual([{ term: 'HMB', scope: 'exact' }]);
    expect(result.parents).toEqual(['DUO:0000001']);
  });

  it('marks an obsolete record with conceptStatus obsolete', () => {
    const result = normalizeRecord({ id: 'DUO:0000001', lbl: 'data use permission', is_a: [], obsolete: true }, 1);
    expect(result.ok).toBe(true);
    expect(result.concept.conceptStatus).toBe('obsolete');
  });

  it('treats a root record (no is_a) as an empty parents list', () => {
    const result = normalizeRecord({ id: 'DUO:0000001', lbl: 'data use permission', is_a: [] }, 1);
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
    const result = normalizeRecord({ id: 'DUO:9999', lbl: '', is_a: [] }, 10);
    expect(result.ok).toBe(false);
    expect(result.issue).toMatchObject({
      rowNumber: 10,
      sourceRecordId: 'DUO:9999',
      fieldPath: 'lbl',
      errorCode: 'MISSING_DISPLAY',
      severity: 'error',
    });
  });

  it('drops non-string entries from is_a and synonyms rather than crashing', () => {
    const result = normalizeRecord({ id: 'DUO:0000006', lbl: 'health or medical or biomedical research use', is_a: ['DUO:0000001', null, 42], synonyms: ['HMB', null] }, 3);
    expect(result.ok).toBe(true);
    expect(result.parents).toEqual(['DUO:0000001']);
    expect(result.concept.synonyms).toEqual([{ term: 'HMB', scope: 'exact' }]);
  });
});
