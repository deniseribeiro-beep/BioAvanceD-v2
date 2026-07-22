import { describe, it, expect } from 'vitest';
const { SampleModel: Sample } = require('../../src/models/Sample');
const { SAMPLE_ORIGIN_IDS, EXTRACTION_PROTOCOL_IDS, SPECIMEN_TYPE_IDS } = require('../../src/config/constants/specimen.constants');

const validData = {
  specimenId: 'SPEC-001',
  participantId: '12345678',
  sampleType: SPECIMEN_TYPE_IDS[0],
  sampleOrigin: SAMPLE_ORIGIN_IDS[0],
  extractionProtocol: EXTRACTION_PROTOCOL_IDS[0],
  quantity: 10,
  unit: 'mL',
  quality: 'GOOD',
  linkedProject: 'PROJ-001',
  registeredAt: new Date().toISOString(),
};

describe('Sample.validate - quantity branch', () => {
  it('rejects when quantity is missing', () => {
    const { quantity: _q, ...data } = validData;
    const result = Sample.validate(data);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('quantity deve ser maior que zero'))).toBe(true);
  });

  it('rejects zero or negative quantity', () => {
    expect(Sample.validate({ ...validData, quantity: 0 }).isValid).toBe(false);
    expect(Sample.validate({ ...validData, quantity: -1 }).isValid).toBe(false);
  });

  it('accepts a positive quantity', () => {
    expect(Sample.validate({ ...validData, quantity: 1 }).isValid).toBe(true);
  });
});

describe('Sample.validate - quality branch (MIABIS scale)', () => {
  it('accepts a valid quality value', () => {
    ['GOOD', 'COMPROMISED', 'UNKNOWN'].forEach((quality) => {
      expect(Sample.validate({ ...validData, quality }).isValid).toBe(true);
    });
  });

  it('rejects an invalid quality value', () => {
    const result = Sample.validate({ ...validData, quality: 'BOGUS' });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('quality deve estar na escala MIABIS'))).toBe(true);
  });

  it('allows quality to be omitted', () => {
    const { quality: _q, ...data } = validData;
    expect(Sample.validate(data).isValid).toBe(true);
  });
});

describe('Sample.validate - lifecycleStatus branch', () => {
  it('accepts a valid lifecycleStatus', () => {
    expect(Sample.validate({ ...validData, lifecycleStatus: 'AVAILABLE' }).isValid).toBe(true);
  });

  it('rejects an invalid lifecycleStatus', () => {
    const result = Sample.validate({ ...validData, lifecycleStatus: 'BOGUS' });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('lifecycleStatus inválido'))).toBe(true);
  });

  it('allows lifecycleStatus to be omitted', () => {
    expect(Sample.validate(validData).isValid).toBe(true);
  });
});

describe('Sample.validate - sampleType/sampleOrigin/extractionProtocol MIABIS guards', () => {
  it('rejects an invalid sampleType', () => {
    const result = Sample.validate({ ...validData, sampleType: 'BOGUS' });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('sampleType inválido conforme MIABIS'))).toBe(true);
  });

  it('rejects an invalid sampleOrigin', () => {
    const result = Sample.validate({ ...validData, sampleOrigin: 'BOGUS' });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('sampleOrigin inválido conforme MIABIS'))).toBe(true);
  });

  it('rejects an invalid extractionProtocol', () => {
    const result = Sample.validate({ ...validData, extractionProtocol: 'BOGUS' });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('extractionProtocol inválido conforme MIABIS'))).toBe(true);
  });
});

describe('Sample.validate - registeredAt requirement', () => {
  it('rejects when registeredAt is missing', () => {
    const { registeredAt: _r, ...data } = validData;
    const result = Sample.validate(data);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('registeredAt é obrigatório'))).toBe(true);
  });
});

describe('SampleModel.create - field normalization', () => {
  it('defaults governance/array fields when absent', () => {
    const sample = Sample.create({ ...validData });
    expect(sample.governanceFailureReasons).toEqual([]);
    expect(sample.governanceRuleCodes).toEqual([]);
    expect(sample.axisPenalties).toEqual([]);
    expect(sample.linkedFiles).toEqual([]);
  });

  it('preserves array fields when provided', () => {
    const sample = Sample.create({
      ...validData,
      governanceFailureReasons: ['low-volume'],
      governanceRuleCodes: ['R1'],
      axisPenalties: [{ axis: 'a' }],
      linkedFiles: [{ id: 'f1' }],
    });
    expect(sample.governanceFailureReasons).toEqual(['low-volume']);
    expect(sample.governanceRuleCodes).toEqual(['R1']);
    expect(sample.axisPenalties).toEqual([{ axis: 'a' }]);
    expect(sample.linkedFiles).toEqual([{ id: 'f1' }]);
  });

  it('defaults quality-scoring fields to null/empty when absent', () => {
    const sample = Sample.create({ ...validData });
    expect(sample.rcsScore).toBeNull();
    expect(sample.scoreBasedGrade).toBe('');
    expect(sample.finalGrade).toBe('');
    expect(sample.gradeRoute).toBeNull();
    expect(sample.calculationTrace).toBeNull();
    expect(sample.rcsEvaluation).toBeNull();
    expect(sample.externalQualityAssessment).toBeNull();
  });

  it('normalizes quality-scoring fields when provided', () => {
    const sample = Sample.create({
      ...validData,
      rcsScore: 80,
      finalGrade: 'A',
      gradeRoute: 'auto',
      calculationTrace: { step: 1 },
      externalQualityAssessment: { provider: 'lab-x' },
    });
    expect(sample.rcsScore).toBe(80);
    expect(sample.finalGrade).toBe('A');
    expect(sample.gradeRoute).toBe('auto');
    expect(sample.calculationTrace).toEqual({ step: 1 });
    expect(sample.externalQualityAssessment).toEqual({ provider: 'lab-x' });
  });

  it('passes through clinicalData/pharmacologyData when provided, defaults to null otherwise', () => {
    const clinicalData = { orphaCode: 'ORPHA:1' };
    const pharmacologyData = { drug_name: 'DrugX' };
    const sample = Sample.create({ ...validData, clinicalData, pharmacologyData });
    expect(sample.clinicalData).toBe(clinicalData);
    expect(sample.pharmacologyData).toBe(pharmacologyData);

    const defaultSample = Sample.create({ ...validData });
    expect(defaultSample.clinicalData).toBeNull();
    expect(defaultSample.pharmacologyData).toBeNull();
  });

  it('passes through storageLocation when provided, defaults to null otherwise', () => {
    const withLocation = Sample.create({ ...validData, storageLocation: { boxId: 'box1', position: 'A1' } });
    expect(withLocation.storageLocation).toEqual({ boxId: 'box1', position: 'A1' });

    const withoutLocation = Sample.create({ ...validData });
    expect(withoutLocation.storageLocation).toBeNull();
  });

  it('uses receivedAt and processingStatus defaults/overrides', () => {
    const sample = Sample.create({ ...validData, receivedAt: '2026-02-01T00:00:00.000Z', processingStatus: 'completed' });
    expect(sample.receivedAt).toBeInstanceOf(Date);
    expect(sample.processingStatus).toBe('completed');

    const defaultSample = Sample.create({ ...validData });
    expect(defaultSample.processingStatus).toBeNull();
  });

  it('defaults lifecycleStatus to REGISTERED and respects an override', () => {
    expect(Sample.create({ ...validData }).lifecycleStatus).toBe('REGISTERED');
    expect(Sample.create({ ...validData, lifecycleStatus: 'AVAILABLE' }).lifecycleStatus).toBe('AVAILABLE');
  });

  it('defaults availableQuantity/originalQuantity to quantity when absent', () => {
    const sample = Sample.create({ ...validData, quantity: 5 });
    expect(sample.availableQuantity).toBe(5);
    expect(sample.originalQuantity).toBe(5);
  });

  it('respects explicit availableQuantity/originalQuantity overrides', () => {
    const sample = Sample.create({ ...validData, quantity: 10, availableQuantity: 3, originalQuantity: 10 });
    expect(sample.availableQuantity).toBe(3);
    expect(sample.originalQuantity).toBe(10);
  });

  it('defaults totalWithdrawn/totalReturned to 0', () => {
    const sample = Sample.create({ ...validData });
    expect(sample.totalWithdrawn).toBe(0);
    expect(sample.totalReturned).toBe(0);
  });
});
