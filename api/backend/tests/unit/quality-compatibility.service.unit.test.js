import { describe, it, expect } from 'vitest';
const { normalizeSample } = require('../../src/services/quality-compatibility.service');

describe('normalizeSample', () => {
  it('defaults to canonical field defaults when given no sample', () => {
    const result = normalizeSample();
    expect(result.rcs_score).toBeNull();
    expect(result.final_grade).toBe('');
    expect(result.p_bio).toBeNull();
    expect(result.grade_route).toBeNull();
    expect(result.calculation_trace).toEqual({ compatibility: 'mapped-from-legacy-fields' });
    expect(result.canonical).toBeUndefined();
  });

  it('does not touch legacy fields when none of rcsScore/scoreBasedGrade/axisPenalties are present', () => {
    const sample = { foo: 'bar' };
    const result = normalizeSample(sample);
    expect(result.canonical).toBeUndefined();
    expect(result.foo).toBe('bar');
  });

  it('promotes rcsScore alone into a fresh canonical namespace', () => {
    const result = normalizeSample({ rcsScore: 42 });
    expect(result.canonical).toEqual({ rcsScore: 42 });
  });

  it('promotes scoreBasedGrade alone into a fresh canonical namespace', () => {
    const result = normalizeSample({ scoreBasedGrade: 'B' });
    expect(result.canonical).toEqual({ scoreBasedGrade: 'B' });
  });

  it('promotes axisPenalties alone into a fresh canonical namespace', () => {
    const penalties = [{ axis: 'P', penalty: 5 }];
    const result = normalizeSample({ axisPenalties: penalties });
    expect(result.canonical).toEqual({ axisPenalties: penalties });
  });

  it('promotes all three legacy fields together', () => {
    const penalties = [{ axis: 'C', penalty: 10 }];
    const result = normalizeSample({
      rcsScore: 7,
      scoreBasedGrade: 'A',
      axisPenalties: penalties,
    });
    expect(result.canonical).toEqual({
      rcsScore: 7,
      scoreBasedGrade: 'A',
      axisPenalties: penalties,
    });
  });

  it('preserves an existing canonical object and merges promoted fields into it', () => {
    const result = normalizeSample({
      rcsScore: 1,
      canonical: { existing: true },
    });
    expect(result.canonical).toEqual({ existing: true, rcsScore: 1 });
  });

  it('does not overwrite already-set canonical fields (rcs_score, final_grade, p_bio, grade_route)', () => {
    const sample = {
      rcs_score: 88,
      final_grade: 'A',
      p_bio: 0.5,
      grade_route: 'primary',
    };
    const result = normalizeSample(sample);
    expect(result.rcs_score).toBe(88);
    expect(result.final_grade).toBe('A');
    expect(result.p_bio).toBe(0.5);
    expect(result.grade_route).toBe('primary');
  });

  it('preserves an existing calculation_trace.compatibility value instead of overwriting it', () => {
    const result = normalizeSample({
      calculation_trace: { compatibility: 'already-set', other: 'value' },
    });
    expect(result.calculation_trace).toEqual({
      compatibility: 'already-set',
      other: 'value',
    });
  });

  it('falls back to the default compatibility marker when calculation_trace exists but has no compatibility key', () => {
    const result = normalizeSample({
      calculation_trace: { other: 'value' },
    });
    expect(result.calculation_trace).toEqual({
      other: 'value',
      compatibility: 'mapped-from-legacy-fields',
    });
  });

  it('does not mutate the original sample object', () => {
    const sample = { rcsScore: 1 };
    normalizeSample(sample);
    expect(sample).toEqual({ rcsScore: 1 });
    expect(sample.canonical).toBeUndefined();
  });
});
