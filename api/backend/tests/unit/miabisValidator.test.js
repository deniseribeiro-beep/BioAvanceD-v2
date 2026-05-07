import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/infrastructure/database/neo4j/connection', () => ({
  connectNeo4j: vi.fn(async () => ({
    session: () => ({
      run: vi.fn(async () => ({
        records: [{ toObject: () => ({ status: 'valid', isPublic: true }) }],
      })),
      close: vi.fn(async () => undefined),
    }),
  })),
}));

const Sample = require('../../src/models/Sample');
const { validateMiabisCompliance } = require('../../src/services/miabisValidator.service');

describe('MIABIS Validator', () => {
  it('should return isCompliant false if diagnosisCode is missing', async () => {
    const originalFindById = Sample.findById;

    Sample.findById = vi.fn(() => ({
      lean: () => Promise.resolve({
        sampleType: 'Blood',
        anatomicalSite: 'Arm',
        storageTemperature: '-80',
      }),
    }));

    try {
      const result = await validateMiabisCompliance('507f1f77bcf86cd799439011');
      expect(result.isCompliant).toBe(false);
      expect(result.missingFields).toContain('diagnosisCode');
    } finally {
      Sample.findById = originalFindById;
    }
  });
});
