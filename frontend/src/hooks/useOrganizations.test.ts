import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('../services/api', () => ({
  organizationService: { getAll: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
}));

import { organizationService } from '../services/api';
import { clearClientSession } from '../utils/sessionCleanup';
import { fetchAllOrganizations, ORGANIZATION_PAGE_SIZE, useOrganizations } from './useOrganizations';

// #1280: the route returns one sorted page of at most 500 rows, and the hook
// used to keep only the first page (of 100, the default).

const getAll = organizationService.getAll as unknown as ReturnType<typeof vi.fn>;
const create = organizationService.create as unknown as ReturnType<typeof vi.fn>;
const update = organizationService.update as unknown as ReturnType<typeof vi.fn>;
const remove = organizationService.delete as unknown as ReturnType<typeof vi.fn>;

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

  it('keys a row by _id, then id, when it has no organizationId, and drops the repeats', async () => {
    getAll.mockResolvedValueOnce(page([{ _id: 'a' }, { _id: 'a' }, { id: 'b' }, { id: 'b' }]));

    expect(await fetchAllOrganizations()).toEqual([{ _id: 'a' }, { id: 'b' }]);
  });

  it('keeps every row that has no key at all', async () => {
    getAll.mockResolvedValueOnce(page([{ officialName: 'X' }, { officialName: 'Y' }]));

    expect(await fetchAllOrganizations()).toEqual([{ officialName: 'X' }, { officialName: 'Y' }]);
  });
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const A = { organizationId: 'org-a', officialName: 'Alpha' };
const B = { organizationId: 'org-b', officialName: 'Beta' };

async function mountLoaded(items: unknown[] = [A]) {
  getAll.mockResolvedValueOnce(page(items));
  const hook = renderHook(() => useOrganizations());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

// The three rethrow paths read the server's message, then its error code,
// then the thrown message, then the hook's own default.
const failures = (fallback: string) => [
  ['the server message', { response: { data: { message: 'srv msg', error: 'srv err' } }, message: 'net' }, 'srv msg'],
  ['the server error', { response: { data: { error: 'srv err' } }, message: 'net' }, 'srv err'],
  ['the thrown message', new Error('net'), 'net'],
  ['the default', {}, fallback],
] as const;

describe('useOrganizations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAll.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loading on mount', () => {
    it('starts loading, reads the first page, then settles with the rows', async () => {
      const d = deferred<unknown>();
      getAll.mockReturnValueOnce(d.promise);
      const { result } = renderHook(() => useOrganizations());
      expect(result.current.loading).toBe(true);
      expect(result.current.organizations).toEqual([]);
      expect(getAll).toHaveBeenCalledWith({ limit: ORGANIZATION_PAGE_SIZE, skip: 0 });
      await act(async () => {
        d.resolve(page([A, B]));
      });
      expect(result.current.organizations).toEqual([A, B]);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });

  describe('load errors', () => {
    it.each([
      ['an Error', new Error('boom'), 'boom'],
      ['an error without a message', {}, 'Erro ao carregar organizações'],
    ])('maps %s and clears the loaded rows', async (_label, err, message) => {
      const { result } = await mountLoaded();
      expect(result.current.organizations).toEqual([A]);
      getAll.mockRejectedValueOnce(err);
      await act(async () => {
        await result.current.loadOrganizations();
      });
      expect(result.current.error).toBe(message);
      expect(result.current.organizations).toEqual([]);
      expect(result.current.loading).toBe(false);
    });

    it('clears a previous error once a reload succeeds', async () => {
      getAll.mockRejectedValueOnce(new Error('down'));
      const { result } = renderHook(() => useOrganizations());
      await waitFor(() => expect(result.current.error).toBe('down'));
      getAll.mockResolvedValueOnce(page([B]));
      await act(async () => {
        await result.current.loadOrganizations();
      });
      expect(result.current.error).toBeNull();
      expect(result.current.organizations).toEqual([B]);
    });
  });

  describe('stale responses (#901)', () => {
    it('discards rows that resolve after a newer load, and keeps loading until the newer one settles', async () => {
      const { result } = await mountLoaded();
      const older = deferred<unknown>();
      const newer = deferred<unknown>();
      getAll.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
      act(() => {
        void result.current.loadOrganizations();
        void result.current.loadOrganizations();
      });
      await act(async () => {
        older.resolve(page([B]));
      });
      expect(result.current.organizations).toEqual([A]);
      expect(result.current.loading).toBe(true);
      await act(async () => {
        newer.resolve(page([A, B]));
      });
      expect(result.current.organizations).toEqual([A, B]);
      expect(result.current.loading).toBe(false);
    });

    it('discards an error that arrives after a newer load', async () => {
      const { result } = await mountLoaded();
      const older = deferred<unknown>();
      const newer = deferred<unknown>();
      getAll.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
      act(() => {
        void result.current.loadOrganizations();
        void result.current.loadOrganizations();
      });
      await act(async () => {
        older.reject(new Error('stale'));
      });
      expect(result.current.error).toBeNull();
      expect(result.current.organizations).toEqual([A]);
      expect(result.current.loading).toBe(true);
      await act(async () => {
        newer.resolve(page([B]));
      });
      expect(result.current.organizations).toEqual([B]);
      expect(result.current.loading).toBe(false);
    });
  });

  describe('createOrganization', () => {
    it('creates, reloads, and returns the entity under the envelope data', async () => {
      const { result } = await mountLoaded();
      create.mockResolvedValueOnce({ data: { success: true, data: B } });
      getAll.mockResolvedValueOnce(page([A, B]));
      let created: unknown;
      await act(async () => {
        created = await result.current.createOrganization({ officialName: 'Beta' } as any);
      });
      expect(create).toHaveBeenCalledWith({ officialName: 'Beta' });
      expect(created).toEqual(B);
      expect(getAll).toHaveBeenCalledTimes(2);
      expect(result.current.organizations).toEqual([A, B]);
    });

    it('returns a body that has no data field as it is', async () => {
      const { result } = await mountLoaded();
      create.mockResolvedValueOnce({ data: B });
      getAll.mockResolvedValueOnce(page([A, B]));
      let created: unknown;
      await act(async () => {
        created = await result.current.createOrganization({ officialName: 'Beta' } as any);
      });
      expect(created).toEqual(B);
    });

    it.each(failures('Erro ao criar organização'))('rethrows %s and does not reload', async (_label, err, message) => {
      const { result } = await mountLoaded();
      create.mockRejectedValueOnce(err);
      await act(async () => {
        await expect(result.current.createOrganization({} as any)).rejects.toThrow(message);
      });
      expect(getAll).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateOrganization', () => {
    it('updates by id, reloads, and returns the entity under the envelope data', async () => {
      const { result } = await mountLoaded([A]);
      const renamed = { ...A, officialName: 'Alfa' };
      update.mockResolvedValueOnce({ data: { success: true, data: renamed } });
      getAll.mockResolvedValueOnce(page([renamed]));
      let updated: unknown;
      await act(async () => {
        updated = await result.current.updateOrganization('org-a', { officialName: 'Alfa' } as any);
      });
      expect(update).toHaveBeenCalledWith('org-a', { officialName: 'Alfa' });
      expect(updated).toEqual(renamed);
      expect(getAll).toHaveBeenCalledTimes(2);
      expect(result.current.organizations).toEqual([renamed]);
    });

    it.each(failures('Erro ao atualizar organização'))('rethrows %s and does not reload', async (_label, err, message) => {
      const { result } = await mountLoaded();
      update.mockRejectedValueOnce(err);
      await act(async () => {
        await expect(result.current.updateOrganization('org-a', {} as any)).rejects.toThrow(message);
      });
      expect(getAll).toHaveBeenCalledTimes(1);
    });
  });

  describe('deleteOrganization', () => {
    it('deletes by id and reloads', async () => {
      const { result } = await mountLoaded([A, B]);
      remove.mockResolvedValueOnce({ data: { success: true } });
      getAll.mockResolvedValueOnce(page([B]));
      await act(async () => {
        await expect(result.current.deleteOrganization('org-a')).resolves.toBeUndefined();
      });
      expect(remove).toHaveBeenCalledWith('org-a');
      expect(getAll).toHaveBeenCalledTimes(2);
      expect(result.current.organizations).toEqual([B]);
    });

    it.each(failures('Erro ao remover organização'))('rethrows %s and does not reload', async (_label, err, message) => {
      const { result } = await mountLoaded();
      remove.mockRejectedValueOnce(err);
      await act(async () => {
        await expect(result.current.deleteOrganization('org-a')).rejects.toThrow(message);
      });
      expect(getAll).toHaveBeenCalledTimes(1);
    });
  });

  describe('client logout', () => {
    it('clears the rows and ends a pending load', async () => {
      const { result } = await mountLoaded();
      getAll.mockReturnValueOnce(deferred<unknown>().promise);
      act(() => {
        void result.current.loadOrganizations();
      });
      expect(result.current.loading).toBe(true);
      act(() => {
        clearClientSession();
      });
      expect(result.current.organizations).toEqual([]);
      expect(result.current.loading).toBe(false);
    });

    it('clears the load error', async () => {
      getAll.mockRejectedValueOnce(new Error('down'));
      const { result } = renderHook(() => useOrganizations());
      await waitFor(() => expect(result.current.error).toBe('down'));
      act(() => {
        clearClientSession();
      });
      expect(result.current.error).toBeNull();
    });

    it('removes the very listener it added, and only on unmount', async () => {
      const add = vi.spyOn(window, 'addEventListener');
      const removeListener = vi.spyOn(window, 'removeEventListener');
      const { unmount } = await mountLoaded();
      const added = add.mock.calls.filter(([type]) => type === 'auth:logout');
      expect(added).toHaveLength(1);
      const listener = added[0][1];
      expect(removeListener).not.toHaveBeenCalledWith('auth:logout', listener);
      unmount();
      expect(removeListener).toHaveBeenCalledWith('auth:logout', listener);
    });
  });
});
