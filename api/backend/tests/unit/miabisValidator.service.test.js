import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const Sample = require('../../src/models/Sample');
const collectionResolver = require('../../src/utils/collectionResolver');

const { validateMiabisCompliance } = require('../../src/services/miabisValidator.service');

function makeCompleteSample(overrides = {}) {
  return {
    patientID: 'patient-1',
    sampleType: 'blood',
    anatomicalSite: 'arm',
    storageTemperature: -20,
    diagnosisCode: 'C50',
    ...overrides,
  };
}

function makeFakeDb() {
  return {};
}

describe('validateMiabisCompliance', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns sampleNotFound result and never queries consents when sample is missing', async () => {
    vi.spyOn(Sample, 'findById').mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    });
    const getCollectionSpy = vi.spyOn(collectionResolver, 'getCollection');

    const result = await validateMiabisCompliance('missing-id', makeFakeDb());

    expect(result).toEqual({
      isCompliant: false,
      missingFields: ['sampleNotFound'],
      consentStatus: 'sample_not_found',
      canBeShared: false,
    });
    expect(getCollectionSpy).not.toHaveBeenCalled();
  });

  it('fast-fails with not_evaluated and preserves field order when only some fields are missing', async () => {
    const sample = makeCompleteSample({ sampleType: undefined, diagnosisCode: undefined });
    vi.spyOn(Sample, 'findById').mockReturnValue({
      lean: vi.fn().mockResolvedValue(sample),
    });
    const getCollectionSpy = vi.spyOn(collectionResolver, 'getCollection');

    const result = await validateMiabisCompliance('id-1', makeFakeDb());

    expect(result).toEqual({
      isCompliant: false,
      missingFields: ['sampleType', 'diagnosisCode'],
      consentStatus: 'not_evaluated',
      canBeShared: false,
    });
    expect(getCollectionSpy).not.toHaveBeenCalled();
  });

  it('lists all four missing fields in fixed order when all are absent', async () => {
    vi.spyOn(Sample, 'findById').mockReturnValue({
      lean: vi.fn().mockResolvedValue({}),
    });

    const result = await validateMiabisCompliance('id-2', makeFakeDb());

    expect(result.missingFields).toEqual([
      'sampleType',
      'anatomicalSite',
      'storageTemperature',
      'diagnosisCode',
    ]);
    expect(result.consentStatus).toBe('not_evaluated');
  });

  it('is fully compliant when all fields present and an active consent record exists', async () => {
    vi.spyOn(Sample, 'findById').mockReturnValue({
      lean: vi.fn().mockResolvedValue(makeCompleteSample()),
    });
    const findOne = vi.fn().mockResolvedValue({ status: 'ACTIVE' });
    vi.spyOn(collectionResolver, 'getCollection').mockResolvedValue({ findOne });

    const result = await validateMiabisCompliance('id-3', makeFakeDb());

    expect(findOne).toHaveBeenCalledWith(
      { patientId: 'patient-1' },
      { sort: { signedAt: -1, createdAt: -1 } }
    );
    expect(result).toEqual({
      isCompliant: true,
      missingFields: [],
      consentStatus: 'active',
      canBeShared: true,
    });
  });

  it('is not compliant when consent record exists but status is not active', async () => {
    vi.spyOn(Sample, 'findById').mockReturnValue({
      lean: vi.fn().mockResolvedValue(makeCompleteSample()),
    });
    const findOne = vi.fn().mockResolvedValue({ status: 'REVOKED' });
    vi.spyOn(collectionResolver, 'getCollection').mockResolvedValue({ findOne });

    const result = await validateMiabisCompliance('id-4', makeFakeDb());

    expect(result).toEqual({
      isCompliant: false,
      missingFields: [],
      consentStatus: 'revoked',
      canBeShared: false,
    });
  });

  it('falls back to unknown status when record.status is falsy', async () => {
    vi.spyOn(Sample, 'findById').mockReturnValue({
      lean: vi.fn().mockResolvedValue(makeCompleteSample()),
    });
    const findOne = vi.fn().mockResolvedValue({ status: null });
    vi.spyOn(collectionResolver, 'getCollection').mockResolvedValue({ findOne });

    const result = await validateMiabisCompliance('id-5', makeFakeDb());

    expect(result.consentStatus).toBe('unknown');
    expect(result.canBeShared).toBe(false);
    expect(result.isCompliant).toBe(false);
  });

  it('uses consentStatus no_consent (distinct from sample_not_found) when no consent record exists', async () => {
    vi.spyOn(Sample, 'findById').mockReturnValue({
      lean: vi.fn().mockResolvedValue(makeCompleteSample()),
    });
    const findOne = vi.fn().mockResolvedValue(null);
    vi.spyOn(collectionResolver, 'getCollection').mockResolvedValue({ findOne });

    const result = await validateMiabisCompliance('id-6', makeFakeDb());

    expect(result).toEqual({
      isCompliant: false,
      missingFields: [],
      consentStatus: 'no_consent',
      canBeShared: false,
    });
  });

  it('catches errors from getCollection and falls back to consentStatus error without rethrowing', async () => {
    vi.spyOn(Sample, 'findById').mockReturnValue({
      lean: vi.fn().mockResolvedValue(makeCompleteSample()),
    });
    vi.spyOn(collectionResolver, 'getCollection').mockRejectedValue(new Error('mongo down'));

    const result = await validateMiabisCompliance('id-7', makeFakeDb());

    expect(result).toEqual({
      isCompliant: false,
      missingFields: [],
      consentStatus: 'error',
      canBeShared: false,
    });
  });

  it('catches errors from findOne and falls back to consentStatus error', async () => {
    vi.spyOn(Sample, 'findById').mockReturnValue({
      lean: vi.fn().mockResolvedValue(makeCompleteSample()),
    });
    const findOne = vi.fn().mockRejectedValue(new Error('query failed'));
    vi.spyOn(collectionResolver, 'getCollection').mockResolvedValue({ findOne });

    const result = await validateMiabisCompliance('id-8', makeFakeDb());

    expect(result).toEqual({
      isCompliant: false,
      missingFields: [],
      consentStatus: 'error',
      canBeShared: false,
    });
  });
});
