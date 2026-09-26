import { describe, expect, it, vi, beforeEach } from 'vitest';

const collectionResolver = require('../../src/utils/collectionResolver');
const { validateMiabisCompliance } = require('../../src/services/miabisValidator.service');

describe('MIABIS Validator', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should return isCompliant false if diagnosisCode is missing', async () => {
    vi.spyOn(collectionResolver, 'getCollection').mockImplementation((_db, key) => {
      if (key === 'Specimen') {
        return {
          findOne: vi.fn().mockResolvedValue({
            sampleType: 'Blood',
            anatomicalSite: 'Arm',
            storageTemperature: '-80',
          }),
        };
      }
      throw new Error(`unexpected key ${key}`);
    });

    const result = await validateMiabisCompliance('SPEC-001', {});
    expect(result.isCompliant).toBe(false);
    expect(result.missingFields).toContain('diagnosisCode');
  });
});
