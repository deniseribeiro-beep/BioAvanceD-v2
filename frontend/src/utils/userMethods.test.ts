import { describe, expect, it } from 'vitest';
import { registerSample } from './userMethods';

// #539: registerSample used to default currentStatus off the legacy
// currentStatus field (`sampleData.currentStatus || 'Available'`) instead of
// deriving it from the canonical specimenStatus (dict-02 ELM-0123)
// canonical-data-contract-v1.md requires.
describe('registerSample', () => {
  it('derives currentStatus from specimenStatus rather than a passed-in legacy currentStatus', () => {
    const sample = registerSample({ specimenStatus: 'depleted', currentStatus: 'Available' });
    expect(sample.currentStatus).toBe('TotallyWithdrawn');
  });

  it('defaults to Available when neither specimenStatus nor currentStatus is present', () => {
    const sample = registerSample({});
    expect(sample.currentStatus).toBe('Available');
  });

  it('maps a partial specimenStatus onto PartiallyWithdrawn', () => {
    const sample = registerSample({ specimenStatus: 'partial' });
    expect(sample.currentStatus).toBe('PartiallyWithdrawn');
  });
});
