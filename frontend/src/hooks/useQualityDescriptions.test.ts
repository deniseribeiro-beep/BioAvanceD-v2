import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useQualityDescriptions } from './useQualityDescriptions';
import { qualityDescriptionService } from '../services/api';
import { clearClientSession } from '../utils/sessionCleanup';

vi.mock('../services/api', () => ({
  qualityDescriptionService: {
    getAll: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

const getAll = vi.mocked(qualityDescriptionService.getAll);
const create = vi.mocked(qualityDescriptionService.create);
const update = vi.mocked(qualityDescriptionService.update);
const remove = vi.mocked(qualityDescriptionService.delete);

// An axios-shaped response: status marks it as a transport envelope, so the
// adapters read the body under data.
function ok(body: unknown) {
  return { data: body, status: 200 } as any;
}

const RAW_A = { qualityID: 7, description: 'Boa' };
const RAW_B = { qualityID: 8, description: 'Hemolisada' };
const A = { ...RAW_A, id: '7', code: '7', name: 'Boa', label: 'Boa', active: true, is_active: true };
const B = { ...RAW_B, id: '8', code: '8', name: 'Hemolisada', label: 'Hemolisada', active: true, is_active: true };

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function mountLoaded(items: unknown[] = [RAW_A]) {
  getAll.mockResolvedValueOnce(ok({ success: true, data: items }));
  const hook = renderHook(() => useQualityDescriptions());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

describe('useQualityDescriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loading on mount', () => {
    it('starts loading, calls getAll once, then settles with the items keyed by qualityID', async () => {
      const d = deferred<any>();
      getAll.mockReturnValueOnce(d.promise);
      const { result } = renderHook(() => useQualityDescriptions());
      expect(result.current.loading).toBe(true);
      expect(result.current.qualities).toEqual([]);
      expect(result.current.error).toBeNull();
      expect(getAll).toHaveBeenCalledTimes(1);
      await act(async () => {
        d.resolve(ok({ success: true, data: [RAW_A, RAW_B] }));
      });
      expect(result.current.qualities).toEqual([A, B]);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it.each([
      ['a bare array body', [RAW_A], [A]],
      ['an items body', { items: [RAW_A] }, [A]],
      ['a body with no array', { success: true, data: {} }, []],
      ['a null body', null, []],
    ])('reads %s', async (_label, body, expected) => {
      getAll.mockResolvedValueOnce(ok(body));
      const { result } = renderHook(() => useQualityDescriptions());
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.qualities).toEqual(expected);
    });
  });

  describe('load errors', () => {
    it.each([
      ['an Error', new Error('boom'), 'boom'],
      ['an error without a message', {}, 'Erro ao carregar qualidades'],
    ])('maps %s and clears the loaded items', async (_label, err, message) => {
      const { result } = await mountLoaded();
      expect(result.current.qualities).toEqual([A]);
      getAll.mockRejectedValueOnce(err);
      await act(async () => {
        await result.current.loadQualities();
      });
      expect(result.current.error).toBe(message);
      expect(result.current.qualities).toEqual([]);
      expect(result.current.loading).toBe(false);
    });

    it('clears a previous error once a reload succeeds', async () => {
      getAll.mockRejectedValueOnce(new Error('down'));
      const { result } = renderHook(() => useQualityDescriptions());
      await waitFor(() => expect(result.current.error).toBe('down'));
      getAll.mockResolvedValueOnce(ok({ success: true, data: [RAW_B] }));
      await act(async () => {
        await result.current.loadQualities();
      });
      expect(result.current.error).toBeNull();
      expect(result.current.qualities).toEqual([B]);
    });
  });

  describe('stale responses (#901)', () => {
    it('discards a response that resolves after a newer load, and keeps loading until the newer one settles', async () => {
      const { result } = await mountLoaded();
      const older = deferred<any>();
      const newer = deferred<any>();
      getAll.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
      act(() => {
        void result.current.loadQualities();
        void result.current.loadQualities();
      });
      await act(async () => {
        older.resolve(ok({ success: true, data: [RAW_B] }));
      });
      expect(result.current.qualities).toEqual([A]);
      expect(result.current.loading).toBe(true);
      await act(async () => {
        newer.resolve(ok({ success: true, data: [RAW_A, RAW_B] }));
      });
      expect(result.current.qualities).toEqual([A, B]);
      expect(result.current.loading).toBe(false);
    });

    it('discards an error that arrives after a newer load', async () => {
      const { result } = await mountLoaded();
      const older = deferred<any>();
      const newer = deferred<any>();
      getAll.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
      act(() => {
        void result.current.loadQualities();
        void result.current.loadQualities();
      });
      await act(async () => {
        older.reject(new Error('stale'));
      });
      expect(result.current.error).toBeNull();
      expect(result.current.qualities).toEqual([A]);
      expect(result.current.loading).toBe(true);
      await act(async () => {
        newer.resolve(ok({ success: true, data: [RAW_B] }));
      });
      expect(result.current.qualities).toEqual([B]);
      expect(result.current.loading).toBe(false);
    });
  });

  describe('createQuality', () => {
    it('creates, reloads, and returns the created entity over the submitted data', async () => {
      const { result } = await mountLoaded();
      create.mockResolvedValueOnce(ok({ success: true, data: { qualityID: 9, description: 'Lipêmica' } }));
      getAll.mockResolvedValueOnce(ok({ success: true, data: [RAW_A, RAW_B] }));
      let created: unknown;
      await act(async () => {
        created = await result.current.createQuality({ description: 'Lipemica', sampleID: 's1' } as any);
      });
      expect(create).toHaveBeenCalledWith({ description: 'Lipemica', sampleID: 's1' });
      expect(created).toEqual({ description: 'Lipêmica', sampleID: 's1', qualityID: 9 });
      expect(getAll).toHaveBeenCalledTimes(2);
      expect(result.current.qualities).toEqual([A, B]);
    });

    it.each([
      ['an Error', new Error('dup'), 'dup'],
      ['an error without a message', {}, 'Erro ao criar qualidade'],
    ])('rethrows %s and does not reload', async (_label, err, message) => {
      const { result } = await mountLoaded();
      create.mockRejectedValueOnce(err);
      await act(async () => {
        await expect(result.current.createQuality({ description: 'x' } as any)).rejects.toThrow(message);
      });
      expect(getAll).toHaveBeenCalledTimes(1);
      expect(result.current.qualities).toEqual([A]);
    });
  });

  describe('updateQuality', () => {
    it('updates by id, reloads, and returns the updated entity over the submitted data', async () => {
      const { result } = await mountLoaded();
      update.mockResolvedValueOnce(ok({ success: true, data: { qualityID: 7, description: 'Ótima' } }));
      getAll.mockResolvedValueOnce(ok({ success: true, data: [RAW_B] }));
      let updated: unknown;
      await act(async () => {
        updated = await result.current.updateQuality('7', { description: 'Otima', notes: 'n' } as any);
      });
      expect(update).toHaveBeenCalledWith('7', { description: 'Otima', notes: 'n' });
      expect(updated).toEqual({ description: 'Ótima', notes: 'n', qualityID: 7 });
      expect(getAll).toHaveBeenCalledTimes(2);
      expect(result.current.qualities).toEqual([B]);
    });

    it.each([
      ['an Error', new Error('nope'), 'nope'],
      ['an error without a message', {}, 'Erro ao atualizar qualidade'],
    ])('rethrows %s and does not reload', async (_label, err, message) => {
      const { result } = await mountLoaded();
      update.mockRejectedValueOnce(err);
      await act(async () => {
        await expect(result.current.updateQuality('7', {} as any)).rejects.toThrow(message);
      });
      expect(getAll).toHaveBeenCalledTimes(1);
    });
  });

  describe('deleteQuality', () => {
    it('deletes by id and reloads', async () => {
      const { result } = await mountLoaded([RAW_A, RAW_B]);
      remove.mockResolvedValueOnce(ok({ success: true }));
      getAll.mockResolvedValueOnce(ok({ success: true, data: [RAW_B] }));
      await act(async () => {
        await expect(result.current.deleteQuality('7')).resolves.toBeUndefined();
      });
      expect(remove).toHaveBeenCalledWith('7');
      expect(getAll).toHaveBeenCalledTimes(2);
      expect(result.current.qualities).toEqual([B]);
    });

    it.each([
      ['an Error', new Error('in use'), 'in use'],
      ['an error without a message', {}, 'Erro ao deletar qualidade'],
    ])('rethrows %s and does not reload', async (_label, err, message) => {
      const { result } = await mountLoaded();
      remove.mockRejectedValueOnce(err);
      await act(async () => {
        await expect(result.current.deleteQuality('7')).rejects.toThrow(message);
      });
      expect(getAll).toHaveBeenCalledTimes(1);
      expect(result.current.qualities).toEqual([A]);
    });
  });

  describe('client logout', () => {
    it('clears the items and ends a pending load', async () => {
      const { result } = await mountLoaded();
      getAll.mockReturnValueOnce(deferred<any>().promise);
      act(() => {
        void result.current.loadQualities();
      });
      expect(result.current.loading).toBe(true);
      act(() => {
        clearClientSession();
      });
      expect(result.current.qualities).toEqual([]);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('clears the load error', async () => {
      getAll.mockRejectedValueOnce(new Error('down'));
      const { result } = renderHook(() => useQualityDescriptions());
      await waitFor(() => expect(result.current.error).toBe('down'));
      act(() => {
        clearClientSession();
      });
      expect(result.current.error).toBeNull();
    });

    it('stops listening once unmounted', async () => {
      const removeListener = vi.spyOn(window, 'removeEventListener');
      const { unmount } = await mountLoaded();
      unmount();
      expect(removeListener).toHaveBeenCalledWith('auth:logout', expect.any(Function));
    });
  });
});
