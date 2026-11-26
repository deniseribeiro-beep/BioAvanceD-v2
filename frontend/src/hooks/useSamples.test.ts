import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useSamples } from './useSamples';
import { samplesApi } from '../services/samples/samplesApi';
import { clearClientSession } from '../utils/sessionCleanup';

vi.mock('../services/samples/samplesApi', () => ({
  samplesApi: {
    getAll: vi.fn(),
    getResults: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));

const getAll = vi.mocked(samplesApi.getAll);
const getResults = vi.mocked(samplesApi.getResults);
const create = vi.mocked(samplesApi.create);
const update = vi.mocked(samplesApi.update);
const remove = vi.mocked(samplesApi.remove);

const A = { id: 1, specimenId: 'S-1' };
const B = { id: 2, specimenId: 'S-2' };
const R = { id: 10, value: 'positive' };

function ok(data: unknown) {
  return { data } as any;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function mountLoaded(payload: unknown = { success: true, data: { samples: [A] } }) {
  getAll.mockResolvedValueOnce(ok(payload));
  const hook = renderHook(() => useSamples());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

const ERRORS: Array<[string, unknown, string]> = [
  ['response data.error', { response: { data: { error: 'E-data', message: 'ignored' } }, message: 'ignored' }, 'E-data'],
  ['response data.message', { response: { data: { message: 'M-data' } }, message: 'ignored' }, 'M-data'],
  ['a plain Error', new Error('boom'), 'boom'],
  ['an empty object', {}, 'FALLBACK'],
  ['null', null, 'FALLBACK'],
];

describe('useSamples', () => {
  let dashboardEvents: number;
  const onDashboard = () => {
    dashboardEvents += 1;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    dashboardEvents = 0;
    window.addEventListener('dashboard:data-changed', onDashboard);
  });

  afterEach(() => {
    window.removeEventListener('dashboard:data-changed', onDashboard);
  });

  describe('loading on mount', () => {
    it('starts loading, calls getAll once, then settles with the samples', async () => {
      const d = deferred<any>();
      getAll.mockReturnValueOnce(d.promise);
      const { result } = renderHook(() => useSamples());
      expect(result.current.loading).toBe(true);
      expect(result.current.samples).toEqual([]);
      expect(result.current.error).toBeNull();
      expect(getAll).toHaveBeenCalledTimes(1);
      await act(async () => {
        d.resolve(ok({ success: true, data: { samples: [A, B] } }));
      });
      expect(result.current.samples).toEqual([A, B]);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it.each([
      ['success with data.samples', { success: true, data: { samples: [A] } }, [A]],
      ['a data array', { data: [A] }, [A]],
      ['top-level samples', { samples: [A] }, [A]],
      ['a bare array', [A], [A]],
      ['samples not an array', { samples: 'x' }, []],
      ['null', null, []],
    ])('reads %s', async (_label, payload, expected) => {
      const { result } = await mountLoaded(payload);
      expect(result.current.samples).toEqual(expected);
      expect(result.current.error).toBeNull();
    });
  });

  describe('load errors', () => {
    it.each(ERRORS)('maps %s and clears the loaded samples', async (_label, err, message) => {
      const { result } = await mountLoaded();
      expect(result.current.samples).toEqual([A]);
      getAll.mockRejectedValueOnce(err);
      await act(async () => {
        await result.current.loadSamples();
      });
      expect(result.current.error).toBe(message === 'FALLBACK' ? 'Erro ao carregar amostras' : message);
      expect(result.current.samples).toEqual([]);
      expect(result.current.loading).toBe(false);
    });

    it('a successful reload clears a previous error', async () => {
      getAll.mockRejectedValueOnce(new Error('first'));
      const { result } = renderHook(() => useSamples());
      await waitFor(() => expect(result.current.error).toBe('first'));
      getAll.mockResolvedValueOnce(ok({ samples: [B] }));
      await act(async () => {
        await result.current.loadSamples();
      });
      expect(result.current.error).toBeNull();
      expect(result.current.samples).toEqual([B]);
    });
  });

  describe('stale responses (#901)', () => {
    it('discards an older success that resolves after a newer call, and keeps loading until the newer one settles', async () => {
      const { result } = await mountLoaded();
      const older = deferred<any>();
      const newer = deferred<any>();
      getAll.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
      let p1!: Promise<void>;
      let p2!: Promise<void>;
      act(() => {
        p1 = result.current.loadSamples();
        p2 = result.current.loadSamples();
      });
      await act(async () => {
        older.resolve(ok({ samples: [B] }));
        await p1;
      });
      expect(result.current.samples).toEqual([A]);
      expect(result.current.loading).toBe(true);
      await act(async () => {
        newer.resolve(ok({ samples: [A, B] }));
        await p2;
      });
      expect(result.current.samples).toEqual([A, B]);
      expect(result.current.loading).toBe(false);
    });

    it('discards an older failure that rejects after a newer call', async () => {
      const { result } = await mountLoaded();
      const older = deferred<any>();
      const newer = deferred<any>();
      getAll.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
      let p1!: Promise<void>;
      let p2!: Promise<void>;
      act(() => {
        p1 = result.current.loadSamples();
        p2 = result.current.loadSamples();
      });
      await act(async () => {
        older.reject(new Error('stale'));
        await p1;
      });
      expect(result.current.error).toBeNull();
      expect(result.current.samples).toEqual([A]);
      expect(result.current.loading).toBe(true);
      await act(async () => {
        newer.resolve(ok({ samples: [B] }));
        await p2;
      });
      expect(result.current.samples).toEqual([B]);
      expect(result.current.loading).toBe(false);
    });
  });

  describe('logout', () => {
    it('clears samples, error and loading on a client logout', async () => {
      const { result } = await mountLoaded();
      expect(result.current.samples).toEqual([A]);
      act(() => {
        clearClientSession();
      });
      expect(result.current.samples).toEqual([]);
      expect(result.current.error).toBeNull();
      expect(result.current.loading).toBe(false);
    });

    it('stops listening after unmount', async () => {
      const removeSpy = vi.spyOn(window, 'removeEventListener');
      const { unmount } = await mountLoaded();
      unmount();
      expect(removeSpy).toHaveBeenCalledWith('auth:logout', expect.any(Function));
      removeSpy.mockRestore();
    });
  });

  describe('getSampleResults', () => {
    it('calls getResults with the id and returns the results array', async () => {
      const { result } = await mountLoaded();
      getResults.mockResolvedValueOnce(ok({ success: true, data: { results: [R] } }));
      let out: unknown;
      await act(async () => {
        out = await result.current.getSampleResults(7);
      });
      expect(getResults).toHaveBeenCalledWith(7);
      expect(out).toEqual([R]);
    });

    it('returns an empty array for a payload with no array', async () => {
      const { result } = await mountLoaded();
      getResults.mockResolvedValueOnce(ok({ success: true, data: {} }));
      await expect(result.current.getSampleResults(7)).resolves.toEqual([]);
    });

    it.each(ERRORS)('throws an Error carrying %s', async (_label, err, message) => {
      const { result } = await mountLoaded();
      getResults.mockRejectedValueOnce(err);
      await expect(result.current.getSampleResults(7)).rejects.toThrow(
        message === 'FALLBACK' ? 'Erro ao buscar resultados' : message,
      );
    });
  });

  describe.each([
    ['createSample', 'Erro ao criar amostra'],
    ['updateSample', 'Erro ao atualizar amostra'],
  ] as const)('%s', (name, fallback) => {
    const mockFor = () => (name === 'createSample' ? create : update);
    const call = (hook: ReturnType<typeof useSamples>) =>
      name === 'createSample' ? hook.createSample({ specimenId: 'S-9' }) : hook.updateSample(5, { specimenId: 'S-9' });

    it('sends the data, reloads the list, notifies the dashboard and returns the unwrapped entity', async () => {
      const { result } = await mountLoaded();
      mockFor().mockResolvedValueOnce(ok({ data: { id: 9 } }));
      getAll.mockResolvedValueOnce(ok({ samples: [A, B] }));
      let out: unknown;
      await act(async () => {
        out = await call(result.current);
      });
      if (name === 'createSample') expect(create).toHaveBeenCalledWith({ specimenId: 'S-9' });
      else expect(update).toHaveBeenCalledWith(5, { specimenId: 'S-9' });
      expect(getAll).toHaveBeenCalledTimes(2);
      expect(result.current.samples).toEqual([A, B]);
      expect(dashboardEvents).toBe(1);
      expect(out).toEqual({ id: 9 });
    });

    it('returns the body itself when it has no data field', async () => {
      const { result } = await mountLoaded();
      mockFor().mockResolvedValueOnce(ok({ id: 9 }));
      getAll.mockResolvedValueOnce(ok({ samples: [A] }));
      let out: unknown;
      await act(async () => {
        out = await call(result.current);
      });
      expect(out).toEqual({ id: 9 });
    });

    it.each(ERRORS)('throws an Error carrying %s, without reloading or notifying', async (_label, err, message) => {
      const { result } = await mountLoaded();
      mockFor().mockRejectedValueOnce(err);
      await expect(call(result.current)).rejects.toThrow(message === 'FALLBACK' ? fallback : message);
      expect(getAll).toHaveBeenCalledTimes(1);
      expect(dashboardEvents).toBe(0);
    });

    it('still resolves and notifies when the reload fails, recording the load error', async () => {
      const { result } = await mountLoaded();
      mockFor().mockResolvedValueOnce(ok({ data: { id: 9 } }));
      getAll.mockRejectedValueOnce(new Error('reload down'));
      await act(async () => {
        await call(result.current);
      });
      expect(result.current.error).toBe('reload down');
      expect(result.current.samples).toEqual([]);
      expect(dashboardEvents).toBe(1);
    });
  });

  describe('deleteSample', () => {
    it('removes by id, reloads the list and notifies the dashboard', async () => {
      const { result } = await mountLoaded({ samples: [A, B] });
      remove.mockResolvedValueOnce(ok(undefined));
      getAll.mockResolvedValueOnce(ok({ samples: [B] }));
      let out: unknown = 'unset';
      await act(async () => {
        out = await result.current.deleteSample('1');
      });
      expect(remove).toHaveBeenCalledWith('1');
      expect(getAll).toHaveBeenCalledTimes(2);
      expect(result.current.samples).toEqual([B]);
      expect(dashboardEvents).toBe(1);
      expect(out).toBeUndefined();
    });

    it.each(ERRORS)('throws an Error carrying %s, without reloading or notifying', async (_label, err, message) => {
      const { result } = await mountLoaded();
      remove.mockRejectedValueOnce(err);
      await expect(result.current.deleteSample(1)).rejects.toThrow(
        message === 'FALLBACK' ? 'Erro ao deletar amostra' : message,
      );
      expect(getAll).toHaveBeenCalledTimes(1);
      expect(dashboardEvents).toBe(0);
    });
  });
});
