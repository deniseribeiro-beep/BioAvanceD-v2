import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/api', () => ({
  organizationService: { getAll: vi.fn() },
}));

import { organizationService } from '../services/api';
import { fetchAllOrganizations, ORGANIZATION_PAGE_SIZE } from './useOrganizations';

// #1280: the route returns one sorted page of at most 500 rows, and the hook
// used to keep only the first page (of 100, the default).

const getAll = organizationService.getAll as unknown as ReturnType<typeof vi.fn>;

const orgs = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => ({ organizationId: `org-${from + i}`, officialName: `Org ${from + i}` }));

const page = (items: unknown[]) => ({ data: { success: true, data: items } });

describe('fetchAllOrganizations (#1280)', () => {
  beforeEach(() => {
    getAll.mockReset();
  });

  it('reads pages until one comes back short, and returns every row', async () => {
    getAll
      .mockResolvedValueOnce(page(orgs(0, ORGANIZATION_PAGE_SIZE)))
      .mockResolvedValueOnce(page(orgs(ORGANIZATION_PAGE_SIZE, 3)));

    const all = await fetchAllOrganizations();

    expect(all).toHaveLength(ORGANIZATION_PAGE_SIZE + 3);
    expect(getAll.mock.calls).toEqual([
      [{ limit: ORGANIZATION_PAGE_SIZE, skip: 0 }],
      [{ limit: ORGANIZATION_PAGE_SIZE, skip: ORGANIZATION_PAGE_SIZE }],
    ]);
  });

  it('makes one call when the first page is short', async () => {
    getAll.mockResolvedValueOnce(page(orgs(0, 2)));

    expect(await fetchAllOrganizations()).toHaveLength(2);
    expect(getAll).toHaveBeenCalledTimes(1);
  });

  it('stops when a server ignoring the offset repeats the same full page', async () => {
    getAll.mockResolvedValue(page(orgs(0, ORGANIZATION_PAGE_SIZE)));

    const all = await fetchAllOrganizations();

    expect(all).toHaveLength(ORGANIZATION_PAGE_SIZE);
    expect(getAll).toHaveBeenCalledTimes(2);
  });
});
