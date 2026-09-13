import { describe, it, expect } from 'vitest';
const { normalizeRecord } = require('../../../src/reference-data/reference-imports/normalizeMondo');

describe('normalizeMondo.normalizeRecord', () => {
  it('normalizes a valid MONDO record with parents and synonyms', () => {
    const result = normalizeRecord(
      { id: 'MONDO:0005148', lbl: 'type 2 diabetes mellitus', is_a: ['MONDO:0002025'], synonyms: ['T2D', 'non-insulin-dependent diabetes mellitus'] },
      5,
    );

    expect(result.ok).toBe(true);
    expect(result.concept).toMatchObject({
      code: 'MONDO:0005148',
      display: 'type 2 diabetes mellitus',
      sourceRecordId: 'MONDO:0005148',
      conceptStatus: 'active',
      semanticType: ['disease'],
    });
    expect(result.concept.synonyms).toEqual([
      { term: 'T2D', scope: 'exact' },
      { term: 'non-insulin-dependent diabetes mellitus', scope: 'exact' },
    ]);
    expect(result.parents).toEqual(['MONDO:0002025']);
  });

  it('marks an obsolete record with conceptStatus obsolete', () => {
    const result = normalizeRecord({ id: 'MONDO:0000001', lbl: 'disease or disorder', is_a: [], obsolete: true }, 1);
    expect(result.ok).toBe(true);
    expect(result.concept.conceptStatus).toBe('obsolete');
  });

  it('treats a root record (no is_a) as an empty parents list', () => {
    const result = normalizeRecord({ id: 'MONDO:0000001', lbl: 'disease or disorder', is_a: [] }, 1);
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
    const result = normalizeRecord({ id: 'MONDO:9999999', lbl: '', is_a: [] }, 10);
    expect(result.ok).toBe(false);
    expect(result.issue).toMatchObject({
      rowNumber: 10,
      sourceRecordId: 'MONDO:9999999',
      fieldPath: 'lbl',
      errorCode: 'MISSING_DISPLAY',
      severity: 'error',
    });
  });

  it('drops non-string entries from is_a and synonyms rather than crashing', () => {
    const result = normalizeRecord({ id: 'MONDO:0005148', lbl: 'type 2 diabetes mellitus', is_a: ['MONDO:0002025', null, 42], synonyms: ['T2D', null] }, 5);
    expect(result.ok).toBe(true);
    expect(result.parents).toEqual(['MONDO:0002025']);
    expect(result.concept.synonyms).toEqual([{ term: 'T2D', scope: 'exact' }]);
  });
});
