import { describe, it, expect } from 'vitest';
const { SampleModel: Sample } = require('../../src/models/Sample');

describe('Sample.create - collectionSite (ELM-0128 / #1092)', () => {
  const base = {
    specimenId: 'SP-1',
    participantId: '12345678',
    sampleType: 'PLASMA',
    sampleOrigin: 'VENOUS_BLOOD',
    extractionProtocol: 'TUBE_EDTA',
    registeredAt: new Date('2024-01-01'),
    quantity: 10,
    linkedProject: 'ProjectX',
    collectionSite: 'org-uuid-123',
  };

  it('maps collectionSite (Organization reference) onto the created document', () => {
    const result = Sample.create({ ...base, collectionSite: 'org-uuid-123' });
    expect(result.collectionSite).toBe('org-uuid-123');
  });

  it('does not default collectionSite to null when not provided', () => {
    const { collectionSite: _omit, ...withoutSite } = base;
    const result = Sample.create(withoutSite);
    expect(result.collectionSite).toBeUndefined();
  });

  it('validate requires collectionSite', () => {
    const { collectionSite: _omit, ...withoutSite } = base;
    const result = Sample.validate(withoutSite);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('collectionSite é obrigatório'))).toBe(true);
  });

  it('does not emit the retired qrCode alias and preserves the canonical Data Matrix value', () => {
    const result = Sample.create({ ...base, barcode: 'BR-2026-001', qrCode: 'legacy-qr-value' });
    expect(result.barcode).toBe('BR-2026-001');
    expect(result).not.toHaveProperty('qrCode');
  });
});

describe('Sample.validateSpecimenStatus', () => {
  it('returns true for available', () => {
    expect(Sample.validateSpecimenStatus('available')).toBe(true);
  });

  it('returns true for all valid statuses', () => {
    ['available', 'quarantined', 'partial', 'depleted', 'unavailable', 'destroyed', 'disposed'].forEach(s => {
      expect(Sample.validateSpecimenStatus(s)).toBe(true);
    });
  });

  it('returns false for unknown status', () => {
    expect(Sample.validateSpecimenStatus('BOGUS')).toBe(false);
    expect(Sample.validateSpecimenStatus(null)).toBe(false);
    expect(Sample.validateSpecimenStatus('')).toBe(false);
  });
});

// #413: import/FHIR write sites map their legacy lifecycleStatus vocabulary
// onto specimenStatus through this helper instead of constructing the trio.
describe('Sample.mapLegacyLifecycleStatusToSpecimenStatus', () => {
  it('case-folds a directly-mapping legacy value', () => {
    expect(Sample.mapLegacyLifecycleStatusToSpecimenStatus('AVAILABLE')).toBe('available');
    expect(Sample.mapLegacyLifecycleStatusToSpecimenStatus('QUARANTINED')).toBe('quarantined');
    expect(Sample.mapLegacyLifecycleStatusToSpecimenStatus('destroyed')).toBe('destroyed');
  });

  it('folds REGISTERED into available (no dict-02 equivalent)', () => {
    expect(Sample.mapLegacyLifecycleStatusToSpecimenStatus('REGISTERED')).toBe('available');
    expect(Sample.mapLegacyLifecycleStatusToSpecimenStatus('registered')).toBe('available');
  });

  it('defaults to available for blank or unrecognized input', () => {
    expect(Sample.mapLegacyLifecycleStatusToSpecimenStatus('')).toBe('available');
    expect(Sample.mapLegacyLifecycleStatusToSpecimenStatus(null)).toBe('available');
    expect(Sample.mapLegacyLifecycleStatusToSpecimenStatus('Withdrawn')).toBe('available');
  });
});

// #405: computeStatus now computes specimenStatus (case-folded per
// canonical-data-contract-v1.md) instead of the legacy lifecycleStatus —
// same algorithm shape, lowercase value vocabulary.
describe('Sample.computeStatus', () => {
  it('returns depleted when currentVolume <= 0', () => {
    expect(Sample.computeStatus(10, 0, 'available')).toBe('depleted');
    expect(Sample.computeStatus(10, -1, 'available')).toBe('depleted');
  });

  it('returns unavailable when currentStatus is unavailable', () => {
    expect(Sample.computeStatus(10, 5, 'unavailable')).toBe('unavailable');
  });

  it('returns partial when current < initial', () => {
    expect(Sample.computeStatus(10, 5, 'available')).toBe('partial');
  });

  it('returns available when volume is full', () => {
    expect(Sample.computeStatus(10, 10, 'available')).toBe('available');
  });

  it('returns available when initialVolume is 0', () => {
    // init = 0 means condition "init > 0 && curr < init" is false
    expect(Sample.computeStatus(0, 5, 'available')).toBe('available');
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
    collectionSite: 'org-test-1',
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

  it('rejects a non-string physical identifier and accepts an omitted one for server generation', () => {
    const invalid = Sample.validate({ ...validData, barcode: 12345 });
    expect(invalid.isValid).toBe(false);
    expect(invalid.errors).toContain('barcode deve ser uma string canônica para identificação Data Matrix');

    const absent = Sample.validate({ ...validData, barcode: null });
    expect(absent.isValid).toBe(true);
  });
});
