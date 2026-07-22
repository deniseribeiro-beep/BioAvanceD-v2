import { describe, it, expect } from 'vitest';
const { SampleModel: Sample } = require('../../src/models/Sample');

describe('Sample.validateLifecycleStatus', () => {
  it('returns true for AVAILABLE', () => {
    expect(Sample.validateLifecycleStatus('AVAILABLE')).toBe(true);
  });

  it('returns true for all valid statuses', () => {
    ['AVAILABLE', 'QUARANTINED', 'PARTIAL', 'DEPLETED', 'UNAVAILABLE'].forEach(s => {
      expect(Sample.validateLifecycleStatus(s)).toBe(true);
    });
  });

  it('returns false for unknown status', () => {
    expect(Sample.validateLifecycleStatus('BOGUS')).toBe(false);
    expect(Sample.validateLifecycleStatus(null)).toBe(false);
    expect(Sample.validateLifecycleStatus('')).toBe(false);
  });
});

describe('Sample.computeStatus', () => {
  it('returns DEPLETED when currentVolume <= 0', () => {
    expect(Sample.computeStatus(10, 0, 'AVAILABLE')).toBe('DEPLETED');
    expect(Sample.computeStatus(10, -1, 'AVAILABLE')).toBe('DEPLETED');
  });

  it('returns UNAVAILABLE when currentStatus is UNAVAILABLE', () => {
    expect(Sample.computeStatus(10, 5, 'UNAVAILABLE')).toBe('UNAVAILABLE');
  });

  it('returns PARTIAL when current < initial', () => {
    expect(Sample.computeStatus(10, 5, 'AVAILABLE')).toBe('PARTIAL');
  });

  it('returns AVAILABLE when volume is full', () => {
    expect(Sample.computeStatus(10, 10, 'AVAILABLE')).toBe('AVAILABLE');
  });

  it('returns AVAILABLE when initialVolume is 0', () => {
    // init = 0 means condition "init > 0 && curr < init" is false
    expect(Sample.computeStatus(0, 5, 'AVAILABLE')).toBe('AVAILABLE');
  });
});

describe('Sample.validateWithdrawalType', () => {
  it('returns true for Parcial', () => {
    expect(Sample.validateWithdrawalType('Parcial')).toBe(true);
  });

  it('returns true for Total', () => {
    expect(Sample.validateWithdrawalType('Total')).toBe(true);
  });

  it('returns false for unknown type', () => {
    expect(Sample.validateWithdrawalType('Complete')).toBe(false);
    expect(Sample.validateWithdrawalType(null)).toBe(false);
  });
});

describe('Sample.validateResponsibleName', () => {
  it('returns true for full name with space', () => {
    expect(Sample.validateResponsibleName('João Silva')).toBe(true);
  });

  it('returns false for single word', () => {
    expect(Sample.validateResponsibleName('João')).toBe(false);
  });

  it('returns false for null', () => {
    expect(Sample.validateResponsibleName(null)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(Sample.validateResponsibleName('')).toBe(false);
  });

  it('returns true for two single-letter words (word-count check only)', () => {
    expect(Sample.validateResponsibleName('J S')).toBe(true);
  });
});

describe('Sample.validate', () => {
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

  it('returns no errors for valid data', () => {
    const result = Sample.validate(validData);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns error when participantId is missing', () => {
    const { participantId: _, ...data } = validData;
    const result = Sample.validate(data);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('participantId'))).toBe(true);
  });

  it('returns error when specimenId is missing', () => {
    const { specimenId: _, ...data } = validData;
    const result = Sample.validate(data);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('specimenId'))).toBe(true);
  });
});
