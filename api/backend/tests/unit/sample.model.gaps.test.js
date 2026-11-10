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

describe('Sample.validate - specimenStatus branch', () => {
  it('accepts a valid specimenStatus', () => {
    expect(Sample.validate({ ...validData, specimenStatus: 'available' }).isValid).toBe(true);
  });

  it('rejects an invalid specimenStatus', () => {
    const result = Sample.validate({ ...validData, specimenStatus: 'BOGUS' });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('specimenStatus inválido'))).toBe(true);
  });

  it('allows specimenStatus to be omitted', () => {
    expect(Sample.validate(validData).isValid).toBe(true);
  });
});

describe('Sample.validate - specimenStatus branch (#405)', () => {
  it('accepts a valid specimenStatus, case-insensitively', () => {
    expect(Sample.validate({ ...validData, specimenStatus: 'available' }).isValid).toBe(true);
    expect(Sample.validate({ ...validData, specimenStatus: 'QUARANTINED' }).isValid).toBe(true);
    // RF006 AC2: a v1.3.0 value is not an operational state.
    expect(Sample.validate({ ...validData, specimenStatus: 'DISPOSED' }).isValid).toBe(false);
  });

  it('rejects an invalid specimenStatus', () => {
    const result = Sample.validate({ ...validData, specimenStatus: 'bogus' });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('specimenStatus inválido'))).toBe(true);
  });

  it('allows specimenStatus to be omitted', () => {
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

  it('defaults specimenStatus to available, folding REGISTERED (#405)', () => {
    const sample = Sample.create({ ...validData });
    expect(sample.specimenStatus).toBe('available');
  });

  it('respects an explicit specimenStatus override', () => {
    expect(Sample.create({ ...validData, specimenStatus: 'quarantined' }).specimenStatus).toBe('quarantined');
  });

  it('defaults currentQuantity/initialQuantity to quantity when absent', () => {
    const sample = Sample.create({ ...validData, quantity: 5 });
    expect(sample.currentQuantity).toBe(5);
    expect(sample.initialQuantity).toBe(5);
  });

  it('respects explicit currentQuantity/initialQuantity overrides', () => {
    const sample = Sample.create({ ...validData, quantity: 10, currentQuantity: 3, initialQuantity: 10 });
    expect(sample.currentQuantity).toBe(3);
    expect(sample.initialQuantity).toBe(10);
  });

  it('defaults totalWithdrawn/totalReturned to 0', () => {
    const sample = Sample.create({ ...validData });
    expect(sample.totalWithdrawn).toBe(0);
    expect(sample.totalReturned).toBe(0);
  });

  it('starts quantityLedgerVersion at 0 whatever the caller sent (RF006 AC4)', () => {
    expect(Sample.create({ ...validData, quantityLedgerVersion: 9 }).quantityLedgerVersion).toBe(0);
  });
});

describe('Sample.create - sourceRecordId (v2.0.0 ELM-0011)', () => {
  it('keeps the source system id apart from the internal specimenId', () => {
    const created = Sample.create({ ...validData, sourceRecordId: 'LIMS-0042' });
    expect(created.sourceRecordId).toBe('LIMS-0042');
    expect(created.specimenId).toBe('SPEC-001');
  });

  it('defaults sourceRecordId to null when none was imported', () => {
    expect(Sample.create(validData).sourceRecordId).toBeNull();
  });
});
