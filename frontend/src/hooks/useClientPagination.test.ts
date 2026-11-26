import { describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { LIST_PAGE_SIZE, useClientPagination } from './useClientPagination';

describe('useClientPagination', () => {
  it('uses LIST_PAGE_SIZE of 10 and pages a long list', () => {
    const items = Array.from({ length: 25 }, (_, index) => index + 1);
    const { result } = renderHook(() => useClientPagination(items));

    expect(LIST_PAGE_SIZE).toBe(10);
    expect(result.current.totalPages).toBe(3);
    expect(result.current.pagedItems).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(result.current.pageStart).toBe(1);
    expect(result.current.pageEnd).toBe(10);

    act(() => result.current.setCurrentPage(2));
    expect(result.current.pagedItems).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(result.current.pageStart).toBe(11);
    expect(result.current.pageEnd).toBe(20);

    act(() => result.current.setCurrentPage(3));
    expect(result.current.pagedItems).toEqual([21, 22, 23, 24, 25]);
    expect(result.current.pageEnd).toBe(25);
  });

  it('clamps an out-of-range page back into bounds', () => {
    const { result } = renderHook(() => useClientPagination(['a', 'b']));
    act(() => result.current.setCurrentPage(99));
    expect(result.current.currentPage).toBe(1);
    expect(result.current.pagedItems).toEqual(['a', 'b']);
  });
});
