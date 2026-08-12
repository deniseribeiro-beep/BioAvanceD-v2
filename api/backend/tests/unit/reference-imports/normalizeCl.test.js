import { describe, it, expect } from 'vitest';
const { normalizeRecord } = require('../../../src/reference-data/reference-imports/normalizeCl');

describe('normalizeCl.normalizeRecord', () => {
  it('normalizes a valid Cell Ontology record with parents and synonyms', () => {
    const result = normalizeRecord(
      { id: 'CL:0000738', lbl: 'leukocyte', is_a: ['CL:0000000'], synonyms: ['white blood cell'] },
      4,
    );

    expect(result.ok).toBe(true);
    expect(result.concept).toMatchObject({
      code: 'CL:0000738',
      display: 'leukocyte',
      sourceRecordId: 'CL:0000738',
      conceptStatus: 'active',
      semanticType: ['cell-type'],
    });
    expect(result.concept.synonyms).toEqual([{ term: 'white blood cell', scope: 'exact' }]);
    expect(result.parents).toEqual(['CL:0000000']);
  });

  it('marks an obsolete record with conceptStatus obsolete', () => {
    const result = normalizeRecord({ id: 'CL:0000000', lbl: 'cell', is_a: [], obsolete: true }, 1);
    expect(result.ok).toBe(true);
    expect(result.concept.conceptStatus).toBe('obsolete');
  });

  it('treats a root record (no is_a) as an empty parents list', () => {
    const result = normalizeRecord({ id: 'CL:0000000', lbl: 'cell', is_a: [] }, 1);
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
    const result = normalizeRecord({ id: 'CL:9999', lbl: '', is_a: [] }, 10);
    expect(result.ok).toBe(false);
    expect(result.issue).toMatchObject({
      rowNumber: 10,
      sourceRecordId: 'CL:9999',
      fieldPath: 'lbl',
      errorCode: 'MISSING_DISPLAY',
      severity: 'error',
    });
  });

  it('drops non-string entries from is_a and synonyms rather than crashing', () => {
    const result = normalizeRecord({ id: 'CL:0000542', lbl: 'lymphocyte', is_a: ['CL:0000738', null, 42], synonyms: ['white blood cell', null] }, 6);
    expect(result.ok).toBe(true);
    expect(result.parents).toEqual(['CL:0000738']);
    expect(result.concept.synonyms).toEqual([{ term: 'white blood cell', scope: 'exact' }]);
  });
});
