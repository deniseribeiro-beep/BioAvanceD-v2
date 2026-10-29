import { describe, it, expect } from 'vitest';
import { resolveSampleId, type SampleCustodyRow } from './useSampleCustodyReports';

// #1216: a sample names itself by its canonical specimenId. The legacy
// sampleID field this used to read first is prohibited on the wire, so no
// row ever carried it and every row fell through to its Mongo _id.
describe('resolveSampleId', () => {
  it('prefers the canonical specimenId over the Mongo _id', () => {
    const row = { _id: '507f1f77bcf86cd799439011', specimenId: '3116768' } as SampleCustodyRow;
    expect(resolveSampleId(row)).toBe('3116768');
  });

  it('falls back to the _id for a row without a specimenId', () => {
    const row = { _id: '507f1f77bcf86cd799439011' } as SampleCustodyRow;
    expect(resolveSampleId(row)).toBe('507f1f77bcf86cd799439011');
  });
});
