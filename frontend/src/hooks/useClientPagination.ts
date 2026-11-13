import { useMemo, useState } from 'react';

/** Shared page size for list tables (inventory, quarantine, access, backup). */
export const LIST_PAGE_SIZE = 10;

export function useClientPagination<T>(items: T[], pageSize: number = LIST_PAGE_SIZE) {
  const [currentPage, setCurrentPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize) || 1);
  const safePage = Math.min(Math.max(1, currentPage), totalPages);

  const pagedItems = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, pageSize, safePage]);

  const pageStart = items.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const pageEnd = Math.min(safePage * pageSize, items.length);

  return {
    currentPage: safePage,
    setCurrentPage,
    totalPages,
    pagedItems,
    pageStart,
    pageEnd,
    total: items.length,
    pageSize,
  };
}
