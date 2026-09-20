import { describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';

const SampleGraphValidator = require('../../src/services/SampleGraphValidator');
const h = SampleGraphValidator._test;

describe('SampleGraphValidator helper residual branch coverage', () => {
  it('normalizes strings, numbers and canonical keys', () => {
    expect(h.normalizeString(null)).toBe('');
    expect(h.normalizeString(' x ')).toBe('x');
    expect(h.normalizeNumber('2.5')).toBe(2.5);
    expect(h.normalizeNumber('x')).toBeNull();
    expect(h.normalizeKey('  a b-c__d  ')).toBe('A_B_C_D');
    expect(h.normalizeKey('---')).toBe('');
  });

  it('creates stable objects for arrays, objects, dates and primitives', () => {
    const date = new Date('2026-01-02T03:04:05.000Z');
    expect(h.stableObject([{ b: 2, a: 1 }, date, 'x'])).toEqual([
      { a: 1, b: 2 },
      '2026-01-02T03:04:05.000Z',
      'x',
    ]);
    expect(h.stableObject(null)).toBeNull();
    expect(h.stableObject(3)).toBe(3);
  });

  it('hashes only clinical/pharmacology object content with stable key ordering', () => {
    const first = h.hashSampleIntegrityPayload({
      clinicalData: { b: 2, a: 1 },
      pharmacologyData: { z: 3 },
    });
    const second = h.hashSampleIntegrityPayload({
      clinicalData: { a: 1, b: 2 },
      pharmacologyData: { z: 3 },
    });
    expect(first).toBe(second);
    expect(h.hashSampleIntegrityPayload({ clinicalData: 'invalid', pharmacologyData: null }))
      .toBe(h.hashSampleIntegrityPayload({ clinicalData: {}, pharmacologyData: {} }));
  });

  it('normalizes ORPHA codes and biomarker maps defensively', () => {
    expect(h.normalizeOrpha(' ORPHA:558 ')).toBe('558');
    expect(h.normalizeOrpha('558')).toBe('558');

    expect(h.normalizeBiomarkerMap(null)).toEqual({});
    expect(h.normalizeBiomarkerMap('invalid')).toEqual({});
    expect(h.normalizeBiomarkerMap({
      ' CRP value ': 1,
      '---': 2,
      'IL-6': 3,
    })).toEqual({
      CRP_VALUE: 1,
      IL_6: 3,
    });
  });

  it('returns independent default requirements with the expected governance defaults', () => {
    const a = h.defaultRequirements();
    const b = h.defaultRequirements();
    expect(a).toMatchObject({
      miabis: { requireTreatmentStatus: true },
      biomarkers: { required: [], recommended: [] },
      pharmacology: {
        required: ['treatmentStatus'],
        recommended: ['medicationName', 'lastDoseDate'],
        treatmentStatuses: ['NAIVE', 'TREATED', 'WASHOUT'],
      },
    });
    a.biomarkers.required.push('CRP');
    expect(b.biomarkers.required).toEqual([]);
  });

  it('resolves suggested status with hard failures taking precedence over quality quarantine', () => {
    const allValid = {
      ethics: { valid: true },
      clinical: { valid: true },
      pharmacology: { valid: true },
      integrity: { valid: true },
      quality: { valid: true },
    };
    expect(h.resolveSuggestedStatus(allValid)).toBe('AVAILABLE');
    expect(h.resolveSuggestedStatus({ ...allValid, quality: { valid: false } })).toBe('QUARANTINE');
    expect(h.resolveSuggestedStatus({ ...allValid, ethics: { valid: false } })).toBe('BLOCKED');
    expect(h.resolveSuggestedStatus({ ...allValid, clinical: { valid: false } })).toBe('BLOCKED');
    expect(h.resolveSuggestedStatus({ ...allValid, pharmacology: { valid: false } })).toBe('BLOCKED');
    expect(h.resolveSuggestedStatus({ ...allValid, integrity: { valid: false } })).toBe('BLOCKED');
  });

  it('generates one compliance reason per failing graph node', () => {
    const graph = {
      ethics: { valid: false },
      clinical: { valid: false },
      pharmacology: { valid: false },
      integrity: { valid: false },
      quality: { valid: false },
    };
    expect(h.complianceGraphReasonCodes(graph)).toEqual([
      'COMPLIANCE_GRAPH_ETHICS',
      'COMPLIANCE_GRAPH_CLINICAL',
      'COMPLIANCE_GRAPH_PHARMACOLOGY',
      'COMPLIANCE_GRAPH_INTEGRITY',
      'COMPLIANCE_GRAPH_QUALITY',
    ]);
    expect(h.complianceGraphReasonCodes({
      ethics: { valid: true },
      clinical: { valid: true },
      pharmacology: { valid: true },
      integrity: { valid: true },
      quality: { valid: true },
    })).toEqual([]);
  });

  it('recognizes only non-empty actions wholly owned by the compliance graph', () => {
    expect(h.isComplianceGraphOwnedAction(null)).toBe(false);
    expect(h.isComplianceGraphOwnedAction({ reasonCodes: 'x' })).toBe(false);
    expect(h.isComplianceGraphOwnedAction({ reasonCodes: [] })).toBe(false);
    expect(h.isComplianceGraphOwnedAction({ reasonCodes: ['COMPLIANCE_GRAPH_ETHICS'] })).toBe(true);
    expect(h.isComplianceGraphOwnedAction({
      reasonCodes: ['COMPLIANCE_GRAPH_ETHICS', 'COLD_CHAIN'],
    })).toBe(false);
  });

  it('normalizes sample filters to ObjectId first, then canonical specimenId plus legacy fallback', () => {
    const id = new ObjectId();
    const objectFilter = h.normalizeSampleIdFilter(id.toString());
    expect(objectFilter._id.toString()).toBe(id.toString());

    expect(h.normalizeSampleIdFilter(' specimen-1 ')).toEqual({
      $or: [{ specimenId: 'specimen-1' }, { sampleID: 'specimen-1' }],
    });
    expect(h.normalizeSampleIdFilter(null)).toEqual({
      $or: [{ specimenId: '' }, { sampleID: '' }],
    });
  });
});
