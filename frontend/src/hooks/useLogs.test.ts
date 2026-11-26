import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useLogs } from './useLogs';
import { logService } from '../services/api';
import { clearClientSession } from '../utils/sessionCleanup';

vi.mock('../services/api', () => ({
  logService: {
    getLogs: vi.fn(),
    queryLogs: vi.fn(),
  },
}));

const getLogs = vi.mocked(logService.getLogs);
const queryLogs = vi.mocked(logService.queryLogs);

const A = { id: 'a1', action: 'login' };
const B = { id: 'b2', action: 'logout' };

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

async function mountLoaded(payload: unknown = { success: true, data: { logs: [A] } }) {
  getLogs.mockResolvedValueOnce(ok(payload));
  const hook = renderHook(() => useLogs());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

describe('useLogs', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  describe('loading on mount', () => {
    it('starts loading, calls getLogs once with no filters, then settles with the logs', async () => {
      const d = deferred<any>();
      getLogs.mockReturnValueOnce(d.promise);
      const { result } = renderHook(() => useLogs());
      expect(result.current.loading).toBe(true);
      expect(result.current.error).toBeNull();
      expect(result.current.logs).toEqual([]);
      expect(getLogs).toHaveBeenCalledTimes(1);
      expect(getLogs).toHaveBeenCalledWith(undefined);
      await act(async () => {
        d.resolve(ok({ success: true, data: { logs: [A, B], total: 2 } }));
      });
      expect(result.current.logs).toEqual([A, B]);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it.each([
      ['success with data.logs', { success: true, data: { logs: [A] } }, [A]],
      ['success with a data array', { success: true, data: [A] }, [A]],
      ['top-level logs array', { logs: [A] }, [A]],
      ['bare array', [A], [A]],
      ['data array without success', { data: [A] }, [A]],
      ['success:false with data.logs', { success: false, data: { logs: [A] } }, []],
      ['success with data.logs not an array', { success: true, data: { logs: 'x' } }, []],
      ['success with an empty data object', { success: true, data: {} }, []],
      ['null', null, []],
    ])('reads %s', async (_label, payload, expected) => {
      const { result } = await mountLoaded(payload);
      expect(result.current.logs).toEqual(expected);
      expect(result.current.error).toBeNull();
    });
  });

  describe('load errors', () => {
    it.each([
      ['a 503', { response: { status: 503, data: { error: 'ignored' } } }, 'Banco de dados não disponível. Verifique a conexão com o MongoDB.'],
      ['response data.error', { response: { status: 500, data: { error: 'E-data', message: 'ignored' } } }, 'E-data'],
      ['response data.message', { response: { status: 500, data: { message: 'M-data' } } }, 'M-data'],
      ['a status with statusText', { response: { status: 404, statusText: 'Not Found' } }, 'Erro ao carregar logs (404: Not Found)'],
      ['a status without statusText', { response: { status: 500 } }, 'Erro ao carregar logs (500)'],
      ['a plain Error', new Error('boom'), 'boom'],
      ['an empty object', {}, 'Erro ao carregar logs'],
      ['null', null, 'Erro ao carregar logs'],
    ])('maps %s and clears the loaded logs', async (_label, err, message) => {
      const { result } = await mountLoaded();
      expect(result.current.logs).toEqual([A]);
      getLogs.mockRejectedValueOnce(err);
      await act(async () => {
        await result.current.loadLogs();
      });
      expect(result.current.error).toBe(message);
      expect(result.current.logs).toEqual([]);
      expect(result.current.loading).toBe(false);
      expect(consoleError).toHaveBeenCalledWith('Erro ao carregar logs:', err);
    });

    it('resets error and sets loading at the start of a reload, passing the filters through', async () => {
      getLogs.mockRejectedValueOnce(new Error('first'));
      const { result } = renderHook(() => useLogs());
      await waitFor(() => expect(result.current.error).toBe('first'));
      expect(result.current.loading).toBe(false);

      const d = deferred<any>();
      getLogs.mockReturnValueOnce(d.promise);
      let p!: Promise<void>;
      act(() => {
        p = result.current.loadLogs({ module: 'samples' });
      });
      expect(getLogs).toHaveBeenLastCalledWith({ module: 'samples' });
      expect(result.current.loading).toBe(true);
      expect(result.current.error).toBeNull();
      await act(async () => {
        d.resolve(ok({ logs: [B] }));
        await p;
      });
      expect(result.current.logs).toEqual([B]);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });

  describe('stale responses', () => {
    it('discards an older load that resolves after a newer one started, and keeps loading', async () => {
      const { result } = await mountLoaded();
      const first = deferred<any>();
      const second = deferred<any>();
      getLogs.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      let p1!: Promise<void>;
      let p2!: Promise<void>;
      act(() => {
        p1 = result.current.loadLogs({ page: 1 });
        p2 = result.current.loadLogs({ page: 2 });
      });
      await act(async () => {
        first.resolve(ok({ logs: [B] }));
        await p1;
      });
      expect(result.current.logs).toEqual([A]);
      expect(result.current.loading).toBe(true);
      await act(async () => {
        second.resolve(ok({ logs: [A, B] }));
        await p2;
      });
      expect(result.current.logs).toEqual([A, B]);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('discards an older load that rejects after a newer one started', async () => {
      const { result } = await mountLoaded();
      const first = deferred<any>();
      const second = deferred<any>();
      getLogs.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      let p1!: Promise<void>;
      let p2!: Promise<void>;
      act(() => {
        p1 = result.current.loadLogs();
        p2 = result.current.loadLogs();
      });
      await act(async () => {
        first.reject(new Error('stale'));
        await p1;
      });
      expect(result.current.error).toBeNull();
      expect(result.current.logs).toEqual([A]);
      expect(result.current.loading).toBe(true);
      await act(async () => {
        second.resolve(ok({ logs: [B] }));
        await p2;
      });
      expect(result.current.logs).toEqual([B]);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it.each([
      ['resolves', (d: ReturnType<typeof deferred<any>>) => d.resolve(ok({ logs: [A, B] }))],
      ['rejects', (d: ReturnType<typeof deferred<any>>) => d.reject(new Error('stale'))],
    ])('ends loading when a load made stale by a query %s', async (_label, settle) => {
      const { result } = await mountLoaded();
      const load = deferred<any>();
      getLogs.mockReturnValueOnce(load.promise);
      queryLogs.mockResolvedValueOnce(ok({ logs: [B] }));
      let lp!: Promise<void>;
      act(() => {
        lp = result.current.loadLogs();
      });
      expect(result.current.loading).toBe(true);
      await act(async () => {
        await result.current.queryLogs({});
      });
      expect(result.current.logs).toEqual([B]);
      await act(async () => {
        settle(load);
        await lp;
      });
      expect(result.current.logs).toEqual([B]);
      expect(result.current.error).toBeNull();
      expect(result.current.loading).toBe(false);
    });
  });

  describe('queryLogs', () => {
    it('posts the filters, stores and returns the logs', async () => {
      const { result } = await mountLoaded();
      queryLogs.mockResolvedValueOnce(ok({ success: true, data: { logs: [B] } }));
      let returned: unknown;
      await act(async () => {
        returned = await result.current.queryLogs({ severity: 'critical' });
      });
      expect(queryLogs).toHaveBeenCalledWith({ severity: 'critical' });
      expect(returned).toEqual([B]);
      expect(result.current.logs).toEqual([B]);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it.each([
      ['a status', { response: { status: 500 } }, 'Erro ao consultar logs (500)'],
      ['an empty object', {}, 'Erro ao consultar logs'],
      ['response data.error', { response: { data: { error: 'denied' } } }, 'denied'],
    ])('clears logs and throws the mapped message for %s, leaving error state alone', async (_label, err, message) => {
      const { result } = await mountLoaded();
      queryLogs.mockRejectedValueOnce(err);
      let thrown: unknown;
      await act(async () => {
        await result.current.queryLogs({}).catch((e) => {
          thrown = e;
        });
      });
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toBe(message);
      expect(result.current.logs).toEqual([]);
      expect(result.current.error).toBeNull();
      expect(consoleError).toHaveBeenCalledWith('Erro ao consultar logs:', err);
    });

    it('returns but does not store a query result made stale by a newer load', async () => {
      const { result } = await mountLoaded();
      const q = deferred<any>();
      queryLogs.mockReturnValueOnce(q.promise);
      getLogs.mockResolvedValueOnce(ok({ logs: [A, B] }));
      let qp!: Promise<unknown>;
      await act(async () => {
        qp = result.current.queryLogs({});
        await result.current.loadLogs();
      });
      expect(result.current.logs).toEqual([A, B]);
      let returned: unknown;
      await act(async () => {
        q.resolve(ok({ logs: [B] }));
        returned = await qp;
      });
      expect(returned).toEqual([B]);
      expect(result.current.logs).toEqual([A, B]);
    });

    it('does not clear logs when a query made stale by a newer load rejects, and still throws', async () => {
      const { result } = await mountLoaded();
      const q = deferred<any>();
      queryLogs.mockReturnValueOnce(q.promise);
      getLogs.mockResolvedValueOnce(ok({ logs: [A, B] }));
      let qp!: Promise<unknown>;
      await act(async () => {
        qp = result.current.queryLogs({});
        await result.current.loadLogs();
      });
      let thrown: unknown;
      await act(async () => {
        q.reject(new Error('late'));
        await qp.catch((e) => {
          thrown = e;
        });
      });
      expect((thrown as Error).message).toBe('late');
      expect(result.current.logs).toEqual([A, B]);
    });
  });

  describe('client logout', () => {
    it('clears logs and ends a pending load', async () => {
      const { result } = await mountLoaded();
      getLogs.mockReturnValueOnce(deferred<any>().promise);
      act(() => {
        void result.current.loadLogs();
      });
      expect(result.current.loading).toBe(true);
      expect(result.current.logs).toEqual([A]);
      act(() => {
        clearClientSession();
      });
      expect(result.current.logs).toEqual([]);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('clears the load error', async () => {
      getLogs.mockRejectedValueOnce(new Error('down'));
      const { result } = renderHook(() => useLogs());
      await waitFor(() => expect(result.current.error).toBe('down'));
      act(() => {
        clearClientSession();
      });
      expect(result.current.error).toBeNull();
      expect(result.current.logs).toEqual([]);
      expect(result.current.loading).toBe(false);
    });

    it('stops listening once unmounted', async () => {
      const remove = vi.spyOn(window, 'removeEventListener');
      const { unmount } = await mountLoaded();
      unmount();
      expect(remove).toHaveBeenCalledWith('auth:logout', expect.any(Function));
      remove.mockRestore();
    });
  });
});
