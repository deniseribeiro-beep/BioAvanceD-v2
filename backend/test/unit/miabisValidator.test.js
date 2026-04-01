// backend/test/unit/miabisValidator.test.js
const mongoose = require('mongoose');
const { validateMiabisCompliance } = require('../../src/services/miabisValidator.service');

jest.mock('mongoose', () => ({
  model: jest.fn(() => ({
    findById: jest.fn(() => ({ lean: jest.fn() }))
  }))
}));

jest.mock('../../src/infrastructure/database/neo4j', () => ({
  run: jest.fn()
}));

const Sample = mongoose.model('Sample');
const neo4j = require('../../src/infrastructure/database/neo4j');

describe('MIABIS Validator', () => {
  it('should return isCompliant false if diagnosisCode is missing', async () => {
    Sample.findById.mockReturnValueOnce({
      lean: () => Promise.resolve({
        sampleType: 'Blood',
        anatomicalSite: 'Arm',
        storageTemperature: '-80',
        // diagnosisCode missing
      })
    });
    neo4j.run.mockResolvedValueOnce({ records: [{ toObject: () => ({ status: 'valid', isPublic: true }) }] });
    const result = await validateMiabisCompliance('sample123');
    expect(result.isCompliant).toBe(false);
    expect(result.missingFields).toContain('diagnosisCode');
  });
});
