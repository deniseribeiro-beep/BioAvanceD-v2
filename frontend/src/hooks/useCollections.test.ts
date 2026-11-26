import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useCollections } from './useCollections';
import { collectionsService } from '../services/api';
import { clearClientSession } from '../utils/sessionCleanup';
import type { Collection } from '../types/models';

vi.mock('../services/api', () => ({
  collectionsService: {
    getAll: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

const getAll = vi.mocked(collectionsService.getAll);
const create = vi.mocked(collectionsService.create);
const update = vi.mocked(collectionsService.update);
const remove = vi.mocked(collectionsService.delete);

const A: Collection = { collectionId: 'c1', collectionName: 'Alpha' };
const B: Collection = { collectionId: 'c2', collectionName: 'Beta' };

function res(data: unknown) {
  return { data, status: 200 } as any;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((r, j) => {
    resolve = r;
    reject = j;
  });
  return { promise, resolve, reject };
}

async function mountLoaded(items: Collection[] = [A]) {
  getAll.mockResolvedValueOnce(res({ success: true, data: items }));
  const hook = renderHook(() => useCollections());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

describe('useCollections', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('loading on mount', () => {
    it('starts loading, calls getAll once, then settles with the collections', async () => {
      const d = deferred<any>();
      getAll.mockReturnValueOnce(d.promise);
      const { result } = renderHook(() => useCollections());
      expect(result.current.loading).toBe(true);
      expect(result.current.collections).toEqual([]);
      expect(result.current.error).toBeNull();
      expect(getAll).toHaveBeenCalledTimes(1);
      await act(async () => {
        d.resolve(res({ success: true, data: [A, B] }));
      });
      expect(result.current.collections).toEqual([A, B]);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it.each([
      ['an envelope with a data array', { success: true, data: [A] }, [A]],
      ['a bare array body', [A], [A]],
      ['an items array', { items: [A] }, [A]],
    ])('reads %s', async (_label, body, expected) => {
      getAll.mockResolvedValueOnce(res(body));
      const { result } = renderHook(() => useCollections());
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.collections).toEqual(expected);
    });

    it('replaces the loaded collections with [] for a body with no array', async () => {
      const { result } = await mountLoaded();
      expect(result.current.collections).toEqual([A]);
      getAll.mockResolvedValueOnce(res({ success: true, data: { total: 0 } }));
      await act(async () => {
        await result.current.loadCollections();
      });
      expect(result.current.collections).toEqual([]);
      expect(result.current.error).toBeNull();
    });
  });

  describe('load errors', () => {
    it.each([
      ['an Error message', new Error('down'), 'down'],
      ['an error without a message', {}, 'Erro ao carregar coleções'],
    ])('maps %s and clears the loaded collections', async (_label, err, message) => {
      const { result } = await mountLoaded();
      expect(result.current.collections).toEqual([A]);
      getAll.mockRejectedValueOnce(err);
      await act(async () => {
        await result.current.loadCollections();
      });
      expect(result.current.error).toBe(message);
      expect(result.current.collections).toEqual([]);
      expect(result.current.loading).toBe(false);
    });

    it('sets loading at the start of a reload and clears the error once it succeeds', async () => {
      getAll.mockRejectedValueOnce(new Error('first'));
      const { result } = renderHook(() => useCollections());
      await waitFor(() => expect(result.current.error).toBe('first'));
      const d = deferred<any>();
      getAll.mockReturnValueOnce(d.promise);
      let p!: Promise<void>;
      act(() => {
        p = result.current.loadCollections();
      });
      expect(result.current.loading).toBe(true);
      await act(async () => {
        d.resolve(res({ success: true, data: [B] }));
        await p;
      });
      expect(result.current.error).toBeNull();
      expect(result.current.collections).toEqual([B]);
      expect(result.current.loading).toBe(false);
    });
  });

  describe('stale responses (#901)', () => {
    it('drops an older load that resolves after a newer one', async () => {
      const first = deferred<any>();
      const second = deferred<any>();
      getAll.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      const { result } = renderHook(() => useCollections());
      let p!: Promise<void>;
      act(() => {
        p = result.current.loadCollections();
      });
      await act(async () => {
        second.resolve(res({ success: true, data: [B] }));
        await p;
      });
      expect(result.current.collections).toEqual([B]);
      expect(result.current.loading).toBe(false);
      await act(async () => {
        first.resolve(res({ success: true, data: [A] }));
      });
      expect(result.current.collections).toEqual([B]);
    });

    it('drops an older load that rejects after a newer one, and keeps loading while the newer one is pending', async () => {
      const first = deferred<any>();
      const second = deferred<any>();
      getAll.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      const { result } = renderHook(() => useCollections());
      let p!: Promise<void>;
      act(() => {
        p = result.current.loadCollections();
      });
      await act(async () => {
        first.reject(new Error('stale'));
      });
      expect(result.current.error).toBeNull();
      expect(result.current.loading).toBe(true);
      await act(async () => {
        second.resolve(res({ success: true, data: [B] }));
        await p;
      });
      expect(result.current.collections).toEqual([B]);
      expect(result.current.loading).toBe(false);
    });
  });

  for (const { name, service, call, args, fallback } of [
    {
      name: 'createCollection',
      service: create,
      call: (h: ReturnType<typeof useCollections>) => h.createCollection({ collectionName: 'New' }),
      args: [{ collectionName: 'New' }],
      fallback: 'Erro ao criar coleção',
    },
    {
      name: 'updateCollection',
      service: update,
      call: (h: ReturnType<typeof useCollections>) => h.updateCollection('c1', { collectionName: 'New' }),
      args: ['c1', { collectionName: 'New' }],
      fallback: 'Erro ao atualizar coleção',
    },
  ]) describe(name, () => {
    it('passes its arguments, reloads, and returns the envelope data', async () => {
      const { result } = await mountLoaded();
      service.mockResolvedValueOnce(res({ success: true, data: B }));
      getAll.mockResolvedValueOnce(res({ success: true, data: [A, B] }));
      let out: unknown;
      await act(async () => {
        out = await call(result.current);
      });
      expect(service).toHaveBeenCalledWith(...args);
      expect(getAll).toHaveBeenCalledTimes(2);
      expect(out).toEqual(B);
      expect(result.current.collections).toEqual([A, B]);
    });

    it('returns the body itself when it has no data field', async () => {
      const { result } = await mountLoaded();
      service.mockResolvedValueOnce(res(B));
      getAll.mockResolvedValueOnce(res({ success: true, data: [A] }));
      let out: unknown;
      await act(async () => {
        out = await call(result.current);
      });
      expect(out).toEqual(B);
    });

    it.each([
      ['response data.message', { response: { data: { message: 'M', error: 'E' } }, message: 'x' }, 'M'],
      ['response data.error', { response: { data: { error: 'E' } }, message: 'x' }, 'E'],
      ['the error message', { message: 'plain' }, 'plain'],
      ['nothing', {}, fallback],
    ])(`${name} rethrows %s without reloading`, async (_label, err, message) => {
      const { result } = await mountLoaded();
      service.mockRejectedValueOnce(err);
      await act(async () => {
        await expect(call(result.current)).rejects.toMatchObject({ message });
      });
      expect(getAll).toHaveBeenCalledTimes(1);
    });
  });

  describe('deleteCollection', () => {
    it('deletes by id, reloads, and resolves undefined', async () => {
      const { result } = await mountLoaded([A, B]);
      remove.mockResolvedValueOnce(res({ success: true }));
      getAll.mockResolvedValueOnce(res({ success: true, data: [B] }));
      let out: unknown = 'unset';
      await act(async () => {
        out = await result.current.deleteCollection('c1');
      });
      expect(remove).toHaveBeenCalledWith('c1');
      expect(getAll).toHaveBeenCalledTimes(2);
      expect(out).toBeUndefined();
      expect(result.current.collections).toEqual([B]);
    });

    it.each([
      ['response data.message', { response: { data: { message: 'M', error: 'E' } }, message: 'x' }, 'M'],
      ['response data.error', { response: { data: { error: 'E' } }, message: 'x' }, 'E'],
      ['the error message', { message: 'plain' }, 'plain'],
      ['nothing', {}, 'Erro ao remover coleção'],
    ])('deleteCollection rethrows %s without reloading', async (_label, err, message) => {
      const { result } = await mountLoaded();
      remove.mockRejectedValueOnce(err);
      await act(async () => {
        await expect(result.current.deleteCollection('c1')).rejects.toMatchObject({ message });
      });
      expect(getAll).toHaveBeenCalledTimes(1);
    });
  });

  describe('client logout', () => {
    it('clears collections and ends a pending load', async () => {
      const { result } = await mountLoaded();
      getAll.mockReturnValueOnce(deferred<any>().promise);
      act(() => {
        void result.current.loadCollections();
      });
      expect(result.current.loading).toBe(true);
      act(() => {
        clearClientSession();
      });
      expect(result.current.collections).toEqual([]);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('clears the load error', async () => {
      getAll.mockRejectedValueOnce(new Error('down'));
      const { result } = renderHook(() => useCollections());
      await waitFor(() => expect(result.current.error).toBe('down'));
      act(() => {
        clearClientSession();
      });
      expect(result.current.error).toBeNull();
    });

    it('stops listening once unmounted', async () => {
      const addSpy = vi.spyOn(window, 'addEventListener');
      const removeSpy = vi.spyOn(window, 'removeEventListener');
      const { unmount } = await mountLoaded();
      const added = addSpy.mock.calls.filter(([type]) => type === 'auth:logout');
      expect(added).toHaveLength(1);
      const listener = added[0][1];
      expect(removeSpy).not.toHaveBeenCalledWith('auth:logout', listener);
      unmount();
      expect(removeSpy).toHaveBeenCalledWith('auth:logout', listener);
      addSpy.mockRestore();
      removeSpy.mockRestore();
    });
  });
});
