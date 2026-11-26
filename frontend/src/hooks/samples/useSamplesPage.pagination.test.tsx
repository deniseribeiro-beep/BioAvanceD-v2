import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSamplesPage, SAMPLES_PAGE_SIZE } from './useSamplesPage';

const loadSamples = vi.fn();
const deleteSample = vi.fn();

vi.mock('../useSamples', () => ({
  useSamples: () => ({
    samples: Array.from({ length: 11 }, (_, index) => ({
      _id: `oid-${index + 1}`,
      specimenId: `SPC-${index + 1}`,
      barcode: `BR-${index + 1}`,
      sampleType: 'PLASMA',
      participantId: `P-${index + 1}`,
    })),
    loading: false,
    error: null,
    loadSamples,
    deleteSample,
  }),
}));

describe('useSamplesPage pagination', () => {
  beforeEach(() => {
    loadSamples.mockReset();
    deleteSample.mockReset();
  });

  it('pages filtered samples in tens and resets to page 1 on search', () => {
    const { result } = renderHook(() => useSamplesPage());

    expect(SAMPLES_PAGE_SIZE).toBe(10);
    expect(result.current.filteredSamples).toHaveLength(11);
    expect(result.current.pagedSamples).toHaveLength(10);
    expect(result.current.totalPages).toBe(2);
    expect(result.current.currentPage).toBe(1);

    act(() => {
      result.current.setCurrentPage(2);
    });
    expect(result.current.pagedSamples).toHaveLength(1);
    expect(result.current.pagedSamples[0].id).toBe('oid-11');

    act(() => {
      result.current.setSearchInput('SPC-1');
      result.current.submitSearch();
    });
    expect(result.current.currentPage).toBe(1);
  });
});
