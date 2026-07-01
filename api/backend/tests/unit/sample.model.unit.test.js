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
    expect(Sample.validateLifecycleStatus('DESTROYED')).toBe(false);
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

describe('Sample.mapLifecycleToLegacy', () => {
  it('maps AVAILABLE to Available', () => {
    expect(Sample.mapLifecycleToLegacy('AVAILABLE')).toBe('Available');
  });

  it('maps PARTIAL to PartiallyWithdrawn', () => {
    expect(Sample.mapLifecycleToLegacy('PARTIAL')).toBe('PartiallyWithdrawn');
  });

  it('maps DEPLETED to TotallyWithdrawn', () => {
    expect(Sample.mapLifecycleToLegacy('DEPLETED')).toBe('TotallyWithdrawn');
  });

  it('maps UNAVAILABLE to Unusable', () => {
    expect(Sample.mapLifecycleToLegacy('UNAVAILABLE')).toBe('Unusable');
  });

  it('defaults to Available for unknown status', () => {
    expect(Sample.mapLifecycleToLegacy('UNKNOWN')).toBe('Available');
    expect(Sample.mapLifecycleToLegacy(null)).toBe('Available');
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

describe('Sample.validateSampleStatus', () => {
  it('returns true for valid legacy statuses', () => {
    ['Available', 'PartiallyWithdrawn', 'TotallyWithdrawn', 'Withdrawn', 'Expired', 'Destroyed', 'Unusable'].forEach(s => {
      expect(Sample.validateSampleStatus(s)).toBe(true);
    });
  });

  it('returns false for unknown status', () => {
    expect(Sample.validateSampleStatus('Active')).toBe(false);
    expect(Sample.validateSampleStatus(null)).toBe(false);
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

  it('returns false for name shorter than 5 chars', () => {
    expect(Sample.validateResponsibleName('J S')).toBe(false);
  });
});

describe('Sample.validate', () => {
  const { SAMPLE_ORIGIN_IDS, EXTRACTION_PROTOCOL_IDS } = require('../../src/config/constants/specimen.constants');
  const validData = {
    patientID: '12345678',
    sampleType: 'PLASMA',
    sampleOrigin: SAMPLE_ORIGIN_IDS[0],
    extractionProtocol: EXTRACTION_PROTOCOL_IDS[0],
    quantity: 10,
    unit: 'mL',
    quality: 'GOOD',
    linkedProject: 'PROJ-001',
    registerDate: new Date().toISOString(),
  };

  it('returns no errors for valid data', () => {
    const result = Sample.validate(validData);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns error when patientID is missing', () => {
    const { patientID: _, ...data } = validData;
    const result = Sample.validate(data);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('patientID'))).toBe(true);
  });

  it('returns error when patientID is not 8 digits', () => {
    const result = Sample.validate({ ...validData, patientID: '1234' });
    expect(result.isValid).toBe(false);
  });
});
