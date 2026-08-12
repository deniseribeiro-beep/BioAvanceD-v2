import { describe, it, expect } from 'vitest';
const { normalizeRecord } = require('../../../src/reference-data/reference-imports/normalizeOrpha');

describe('normalizeOrpha.normalizeRecord', () => {
  it('normalizes a valid ORPHA record with parents and synonyms', () => {
    const result = normalizeRecord(
      { id: 'ORPHA:586', lbl: 'Wilson disease', is_a: ['ORPHA:377788'], synonyms: ['Hepatolenticular degeneration'] },
      5,
    );

    expect(result.ok).toBe(true);
    expect(result.concept).toMatchObject({
      code: 'ORPHA:586',
      display: 'Wilson disease',
      sourceRecordId: 'ORPHA:586',
      conceptStatus: 'active',
      semanticType: ['disease'],
    });
    expect(result.concept.synonyms).toEqual([{ term: 'Hepatolenticular degeneration', scope: 'exact' }]);
    expect(result.parents).toEqual(['ORPHA:377788']);
  });

  it('marks an obsolete record with conceptStatus obsolete', () => {
    const result = normalizeRecord({ id: 'ORPHA:377794', lbl: 'rare disease', is_a: [], obsolete: true }, 1);
    expect(result.ok).toBe(true);
    expect(result.concept.conceptStatus).toBe('obsolete');
  });

  it('treats a root record (no is_a) as an empty parents list', () => {
    const result = normalizeRecord({ id: 'ORPHA:377794', lbl: 'rare disease', is_a: [] }, 1);
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
    const result = normalizeRecord({ id: 'ORPHA:9999999', lbl: '', is_a: [] }, 10);
    expect(result.ok).toBe(false);
    expect(result.issue).toMatchObject({
      rowNumber: 10,
      sourceRecordId: 'ORPHA:9999999',
      fieldPath: 'lbl',
      errorCode: 'MISSING_DISPLAY',
      severity: 'error',
    });
  });

  it('drops non-string entries from is_a and synonyms rather than crashing', () => {
    const result = normalizeRecord({ id: 'ORPHA:586', lbl: 'Wilson disease', is_a: ['ORPHA:377788', null, 42], synonyms: ['Hepatolenticular degeneration', null] }, 5);
    expect(result.ok).toBe(true);
    expect(result.parents).toEqual(['ORPHA:377788']);
    expect(result.concept.synonyms).toEqual([{ term: 'Hepatolenticular degeneration', scope: 'exact' }]);
  });
});
