import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const collectionResolver = require('../../src/utils/collectionResolver');

const { validateMiabisCompliance } = require('../../src/services/miabisValidator.service');

function makeCompleteSample(overrides = {}) {
  return {
    specimenId: 'SPEC-1',
    participantId: 'patient-1',
    sampleType: 'blood',
    anatomicalSite: 'arm',
    storageTemperature: -20,
    diagnosisCode: 'C50',
    ...overrides,
  };
}

function makeFakeDb() {
  return { collection: vi.fn() };
}

/**
 * #830 follow-up: miabisValidator reads specimens via native getCollection.
 * Specimen findOne is always called; consents only when fields are complete
 * and participantId is present.
 */
function mockCollections({ sampleDoc, consentFindOne } = {}) {
  const specimenFindOne = vi.fn().mockResolvedValue(sampleDoc);
  const consentCollection = consentFindOne
    ? { findOne: consentFindOne }
    : { findOne: vi.fn() };

  return vi.spyOn(collectionResolver, 'getCollection').mockImplementation((_db, key) => {
    if (key === 'Specimen') return { findOne: specimenFindOne };
    if (key === 'consents') return consentCollection;
    throw new Error(`unexpected collection key: ${key}`);
  });
}

describe('validateMiabisCompliance', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns sampleNotFound result and never queries consents when sample is missing', async () => {
    const getCollectionSpy = mockCollections({ sampleDoc: null });

    const result = await validateMiabisCompliance('SPEC-MISSING', makeFakeDb());

    expect(result).toEqual({
      isCompliant: false,
      missingFields: ['sampleNotFound'],
      consentStatus: 'sample_not_found',
      canBeShared: false,
    });
    expect(getCollectionSpy).toHaveBeenCalledWith(expect.anything(), 'Specimen');
    expect(getCollectionSpy).not.toHaveBeenCalledWith(expect.anything(), 'consents');
  });

  it('fast-fails with not_evaluated and preserves field order when only some fields are missing', async () => {
    const sample = makeCompleteSample({ sampleType: undefined, diagnosisCode: undefined });
    const getCollectionSpy = mockCollections({ sampleDoc: sample });

    const result = await validateMiabisCompliance('SPEC-1', makeFakeDb());

    expect(result).toEqual({
      isCompliant: false,
      missingFields: ['sampleType', 'diagnosisCode'],
      consentStatus: 'not_evaluated',
      canBeShared: false,
    });
    expect(getCollectionSpy).not.toHaveBeenCalledWith(expect.anything(), 'consents');
  });

  it('lists all four missing fields in fixed order when all are absent', async () => {
    mockCollections({ sampleDoc: {} });

    const result = await validateMiabisCompliance('SPEC-2', makeFakeDb());

    expect(result.missingFields).toEqual([
      'sampleType',
      'anatomicalSite',
      'storageTemperature',
      'diagnosisCode',
    ]);
    expect(result.consentStatus).toBe('not_evaluated');
  });

  it('is fully compliant when all fields present and an active consent record exists', async () => {
    const findOne = vi.fn().mockResolvedValue({ status: 'ACTIVE' });
    mockCollections({ sampleDoc: makeCompleteSample(), consentFindOne: findOne });

    const result = await validateMiabisCompliance('SPEC-3', makeFakeDb());

    expect(findOne).toHaveBeenCalledWith(
      { participantId: 'patient-1' },
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
    const findOne = vi.fn().mockResolvedValue({ status: 'REVOKED' });
    mockCollections({ sampleDoc: makeCompleteSample(), consentFindOne: findOne });

    const result = await validateMiabisCompliance('SPEC-4', makeFakeDb());

    expect(result).toEqual({
      isCompliant: false,
      missingFields: [],
      consentStatus: 'revoked',
      canBeShared: false,
    });
  });

  it('falls back to unknown status when record.status is falsy', async () => {
    const findOne = vi.fn().mockResolvedValue({ status: null });
    mockCollections({ sampleDoc: makeCompleteSample(), consentFindOne: findOne });

    const result = await validateMiabisCompliance('SPEC-5', makeFakeDb());

    expect(result.consentStatus).toBe('unknown');
    expect(result.canBeShared).toBe(false);
    expect(result.isCompliant).toBe(false);
  });

  it('does not query consents and yields canBeShared false when sample has no participantId', async () => {
    const sample = makeCompleteSample({ participantId: undefined });
    const getCollectionSpy = mockCollections({ sampleDoc: sample });

    const result = await validateMiabisCompliance('SPEC-9', makeFakeDb());

    expect(getCollectionSpy).not.toHaveBeenCalledWith(expect.anything(), 'consents');
    expect(result).toEqual({
      isCompliant: false,
      missingFields: [],
      consentStatus: 'no_consent',
      canBeShared: false,
    });
  });

  it('uses consentStatus no_consent (distinct from sample_not_found) when no consent record exists', async () => {
    const findOne = vi.fn().mockResolvedValue(null);
    mockCollections({ sampleDoc: makeCompleteSample(), consentFindOne: findOne });

    const result = await validateMiabisCompliance('SPEC-6', makeFakeDb());

    expect(result).toEqual({
      isCompliant: false,
      missingFields: [],
      consentStatus: 'no_consent',
      canBeShared: false,
    });
  });

  it('catches errors from getCollection and falls back to consentStatus error without rethrowing', async () => {
    vi.spyOn(collectionResolver, 'getCollection').mockImplementation((_db, key) => {
      if (key === 'Specimen') {
        return { findOne: vi.fn().mockResolvedValue(makeCompleteSample()) };
      }
      throw new Error('mongo down');
    });

    const result = await validateMiabisCompliance('SPEC-7', makeFakeDb());

    expect(result).toEqual({
      isCompliant: false,
      missingFields: [],
      consentStatus: 'error',
      canBeShared: false,
    });
  });

  it('catches errors from findOne and falls back to consentStatus error', async () => {
    const findOne = vi.fn().mockRejectedValue(new Error('query failed'));
    mockCollections({ sampleDoc: makeCompleteSample(), consentFindOne: findOne });

    const result = await validateMiabisCompliance('SPEC-8', makeFakeDb());

    expect(result).toEqual({
      isCompliant: false,
      missingFields: [],
      consentStatus: 'error',
      canBeShared: false,
    });
  });
});
