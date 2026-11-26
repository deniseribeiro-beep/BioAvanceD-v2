import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useSecurity } from './useSecurity';
import type { SecurityConfig, ProfilePermissions } from './useSecurity';
import { securityService } from '../services/api';

vi.mock('../services/api', () => ({
  securityService: {
    getConfig: vi.fn(),
    getPermissions: vi.fn(),
    updateConfig: vi.fn(),
    exportLogs: vi.fn(),
  },
}));

const getConfig = vi.mocked(securityService.getConfig);
const getPermissions = vi.mocked(securityService.getPermissions);
const updateConfig = vi.mocked(securityService.updateConfig);
const exportLogs = vi.mocked(securityService.exportLogs);

const CFG_A = { session: { timeoutMinutes: 30 } } as unknown as SecurityConfig;
const CFG_B = { session: { timeoutMinutes: 45 } } as unknown as SecurityConfig;
const PERMS_A: ProfilePermissions = {
  roles: [{ roleCode: 'ADMIN', displayName: 'Admin', hierarchyLevel: 1, permissionCodes: ['P1'] }],
  permissions: [{ permissionCode: 'P1', displayName: 'P one', resourceType: 'sample', allowedActions: ['read'] }],
};
const PERMS_B: ProfilePermissions = { roles: [], permissions: [] };

function envelope(data: unknown) {
  return { data: { success: true, data } } as any;
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

async function mountLoaded() {
  getConfig.mockResolvedValueOnce(envelope(CFG_A));
  getPermissions.mockResolvedValueOnce(envelope(PERMS_A));
  const hook = renderHook(() => useSecurity());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  await waitFor(() => expect(hook.result.current.permissions).toEqual(PERMS_A));
  return hook;
}

describe('useSecurity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loading on mount', () => {
    it('starts loading, fetches config and permissions once each, then stores both', async () => {
      const c = deferred<any>();
      const p = deferred<any>();
      getConfig.mockReturnValueOnce(c.promise);
      getPermissions.mockReturnValueOnce(p.promise);
      const { result } = renderHook(() => useSecurity());
      expect(result.current.loading).toBe(true);
      expect(result.current.saving).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.config).toBeNull();
      expect(result.current.permissions).toBeNull();
      expect(getConfig).toHaveBeenCalledTimes(1);
      expect(getConfig).toHaveBeenCalledWith();
      expect(getPermissions).toHaveBeenCalledTimes(1);
      expect(getPermissions).toHaveBeenCalledWith();
      await act(async () => {
        p.resolve(envelope(PERMS_A));
      });
      expect(result.current.permissions).toEqual(PERMS_A);
      expect(result.current.loading).toBe(true);
      await act(async () => {
        c.resolve(envelope(CFG_A));
      });
      expect(result.current.config).toEqual(CFG_A);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it.each([
      ['a response without data', {}],
      ['an envelope without data.data', { data: { success: true } }],
      ['a null response', null],
      ['a non-object response', 'text'],
    ])('stores null config and permissions for %s', async (_label, response) => {
      getConfig.mockResolvedValueOnce(response as any);
      getPermissions.mockResolvedValueOnce(response as any);
      const { result } = renderHook(() => useSecurity());
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.config).toBeNull();
      expect(result.current.permissions).toBeNull();
      expect(result.current.error).toBeNull();
    });
  });

  describe('load errors', () => {
    it.each([
      ['the response message first', { message: 'm', response: { data: { message: 'server says no' } } }, 'server says no'],
      ['the error message without a response message', { message: 'm', response: { data: {} } }, 'm'],
      ['an Error instance', new Error('network down'), 'network down'],
      ['the fallback for an object with no message', {}, 'Erro ao carregar configurações'],
      ['the fallback for a non-object rejection', 'boom', 'Erro ao carregar configurações'],
    ])('sets a config load error from %s and stops loading', async (_label, rejection, message) => {
      getConfig.mockRejectedValueOnce(rejection);
      getPermissions.mockResolvedValueOnce(envelope(PERMS_A));
      const { result } = renderHook(() => useSecurity());
      await waitFor(() => expect(result.current.loading).toBe(false));
      await waitFor(() => expect(result.current.permissions).toEqual(PERMS_A));
      expect(result.current.error).toBe(message);
      expect(result.current.config).toBeNull();
    });

    it('sets the permissions fallback error and leaves loading to the config load', async () => {
      const c = deferred<any>();
      getConfig.mockReturnValueOnce(c.promise);
      getPermissions.mockRejectedValueOnce({});
      const { result } = renderHook(() => useSecurity());
      await waitFor(() => expect(result.current.error).toBe('Erro ao carregar permissões'));
      expect(result.current.permissions).toBeNull();
      expect(result.current.loading).toBe(true);
      await act(async () => {
        c.resolve(envelope(CFG_A));
      });
      expect(result.current.loading).toBe(false);
      expect(result.current.config).toEqual(CFG_A);
      expect(result.current.error).toBe('Erro ao carregar permissões');
    });

    it('resets error and sets loading at the start of a config reload', async () => {
      getConfig.mockRejectedValueOnce(new Error('first'));
      getPermissions.mockResolvedValueOnce(envelope(PERMS_A));
      const { result } = renderHook(() => useSecurity());
      await waitFor(() => expect(result.current.error).toBe('first'));
      expect(result.current.loading).toBe(false);
      const c = deferred<any>();
      getConfig.mockReturnValueOnce(c.promise);
      let pending!: Promise<void>;
      act(() => {
        pending = result.current.loadConfig();
      });
      expect(result.current.loading).toBe(true);
      expect(result.current.error).toBeNull();
      await act(async () => {
        c.resolve(envelope(CFG_B));
        await pending;
      });
      expect(result.current.config).toEqual(CFG_B);
      expect(result.current.loading).toBe(false);
      expect(getConfig).toHaveBeenCalledTimes(2);
    });

    it('resets the shared error at the start of a permissions reload', async () => {
      getConfig.mockRejectedValueOnce(new Error('config failed'));
      getPermissions.mockResolvedValueOnce(envelope(PERMS_A));
      const { result } = renderHook(() => useSecurity());
      await waitFor(() => expect(result.current.error).toBe('config failed'));
      const p = deferred<any>();
      getPermissions.mockReturnValueOnce(p.promise);
      let pending!: Promise<void>;
      act(() => {
        pending = result.current.loadPermissions();
      });
      expect(result.current.error).toBeNull();
      expect(result.current.loading).toBe(false);
      await act(async () => {
        p.resolve(envelope(PERMS_B));
        await pending;
      });
      expect(result.current.permissions).toEqual(PERMS_B);
      expect(getPermissions).toHaveBeenCalledTimes(2);
    });
  });

  describe('stale responses', () => {
    it('discards an older config load that resolves after a newer one started, and keeps loading', async () => {
      const { result } = await mountLoaded();
      const older = deferred<any>();
      const newer = deferred<any>();
      getConfig.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
      let p1!: Promise<void>;
      let p2!: Promise<void>;
      act(() => {
        p1 = result.current.loadConfig();
      });
      act(() => {
        p2 = result.current.loadConfig();
      });
      await act(async () => {
        older.resolve(envelope(CFG_B));
        await p1;
      });
      expect(result.current.config).toEqual(CFG_A);
      expect(result.current.loading).toBe(true);
      await act(async () => {
        newer.resolve(envelope(CFG_B));
        await p2;
      });
      expect(result.current.config).toEqual(CFG_B);
      expect(result.current.loading).toBe(false);
    });

    it('discards an older config load that rejects after a newer one started', async () => {
      const { result } = await mountLoaded();
      const older = deferred<any>();
      const newer = deferred<any>();
      getConfig.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
      let p1!: Promise<void>;
      let p2!: Promise<void>;
      act(() => {
        p1 = result.current.loadConfig();
      });
      act(() => {
        p2 = result.current.loadConfig();
      });
      await act(async () => {
        older.reject(new Error('stale failure'));
        await p1;
      });
      expect(result.current.error).toBeNull();
      expect(result.current.loading).toBe(true);
      await act(async () => {
        newer.resolve(envelope(CFG_B));
        await p2;
      });
      expect(result.current.error).toBeNull();
      expect(result.current.config).toEqual(CFG_B);
      expect(result.current.loading).toBe(false);
    });

    it('discards an older permissions load, resolved or rejected, after a newer one started', async () => {
      const { result } = await mountLoaded();
      const older = deferred<any>();
      const failing = deferred<any>();
      const newer = deferred<any>();
      getPermissions
        .mockReturnValueOnce(older.promise)
        .mockReturnValueOnce(failing.promise)
        .mockReturnValueOnce(newer.promise);
      let p1!: Promise<void>;
      let p2!: Promise<void>;
      let p3!: Promise<void>;
      act(() => {
        p1 = result.current.loadPermissions();
      });
      act(() => {
        p2 = result.current.loadPermissions();
      });
      act(() => {
        p3 = result.current.loadPermissions();
      });
      await act(async () => {
        older.resolve(envelope(PERMS_B));
        failing.reject(new Error('stale failure'));
        await p1;
        await p2;
      });
      expect(result.current.permissions).toEqual(PERMS_A);
      expect(result.current.error).toBeNull();
      await act(async () => {
        newer.resolve(envelope(PERMS_B));
        await p3;
      });
      expect(result.current.permissions).toEqual(PERMS_B);
    });

    it('discards a config load made stale by a later save', async () => {
      const { result } = await mountLoaded();
      const load = deferred<any>();
      getConfig.mockReturnValueOnce(load.promise);
      updateConfig.mockResolvedValueOnce(envelope(CFG_B));
      let pending!: Promise<void>;
      act(() => {
        pending = result.current.loadConfig();
      });
      await act(async () => {
        await result.current.updateConfig({});
      });
      expect(result.current.config).toEqual(CFG_B);
      await act(async () => {
        load.resolve(envelope(CFG_A));
        await pending;
      });
      expect(result.current.config).toEqual(CFG_B);
    });

    it.each([
      ['resolves', (d: ReturnType<typeof deferred<any>>) => d.resolve(envelope(CFG_A))],
      ['rejects', (d: ReturnType<typeof deferred<any>>) => d.reject(new Error('stale failure'))],
    ])('ends loading when a config load made stale by a save %s', async (_label, settle) => {
      const { result } = await mountLoaded();
      const load = deferred<any>();
      getConfig.mockReturnValueOnce(load.promise);
      updateConfig.mockResolvedValueOnce(envelope(CFG_B));
      let pending!: Promise<void>;
      act(() => {
        pending = result.current.loadConfig();
      });
      expect(result.current.loading).toBe(true);
      await act(async () => {
        await result.current.updateConfig({});
      });
      await act(async () => {
        settle(load);
        await pending;
      });
      expect(result.current.config).toEqual(CFG_B);
      expect(result.current.error).toBeNull();
      expect(result.current.loading).toBe(false);
    });
  });

  describe('updateConfig', () => {
    it('sends the updates, flags saving, stores and returns the response body', async () => {
      const { result } = await mountLoaded();
      const d = deferred<any>();
      updateConfig.mockReturnValueOnce(d.promise);
      const updates = { session: { timeoutMinutes: 45 } } as Partial<SecurityConfig>;
      let pending!: Promise<unknown>;
      act(() => {
        pending = result.current.updateConfig(updates);
      });
      expect(updateConfig).toHaveBeenCalledWith(updates);
      expect(result.current.saving).toBe(true);
      expect(result.current.error).toBeNull();
      let returned: unknown;
      await act(async () => {
        d.resolve(envelope(CFG_B));
        returned = await pending;
      });
      expect(returned).toEqual({ success: true, data: CFG_B });
      expect(result.current.config).toEqual(CFG_B);
      expect(result.current.saving).toBe(false);
      expect(result.current.loading).toBe(false);
    });

    it('clears an earlier error when a save starts', async () => {
      getConfig.mockRejectedValueOnce(new Error('load failed'));
      getPermissions.mockResolvedValueOnce(envelope(PERMS_A));
      const { result } = renderHook(() => useSecurity());
      await waitFor(() => expect(result.current.error).toBe('load failed'));
      updateConfig.mockResolvedValueOnce(envelope(CFG_B));
      await act(async () => {
        await result.current.updateConfig({});
      });
      expect(result.current.error).toBeNull();
      expect(result.current.config).toEqual(CFG_B);
    });

    it.each([
      ['the response message', { message: 'Request failed with status code 400', response: { data: { message: 'invalid timeout' } } }, 'invalid timeout'],
      ['the fallback', 'boom', 'Erro ao salvar configurações'],
    ])('sets error from %s, throws it and clears saving on failure', async (_label, rejection, message) => {
      const { result } = await mountLoaded();
      updateConfig.mockRejectedValueOnce(rejection);
      let thrown: unknown;
      await act(async () => {
        try {
          await result.current.updateConfig({});
        } catch (err) {
          thrown = err;
        }
      });
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toBe(message);
      expect(result.current.error).toBe(message);
      expect(result.current.saving).toBe(false);
      expect(result.current.config).toEqual(CFG_A);
    });

    it('returns but does not store a save made stale by a newer load', async () => {
      const { result } = await mountLoaded();
      const save = deferred<any>();
      updateConfig.mockReturnValueOnce(save.promise);
      getConfig.mockResolvedValueOnce(envelope(CFG_A));
      let pending!: Promise<unknown>;
      act(() => {
        pending = result.current.updateConfig({});
      });
      await act(async () => {
        await result.current.loadConfig();
      });
      let returned: unknown;
      await act(async () => {
        save.resolve(envelope(CFG_B));
        returned = await pending;
      });
      expect(returned).toEqual({ success: true, data: CFG_B });
      expect(result.current.config).toEqual(CFG_A);
      expect(result.current.saving).toBe(false);
    });

    it('still throws but sets no error for a save made stale by a newer load', async () => {
      const { result } = await mountLoaded();
      const save = deferred<any>();
      updateConfig.mockReturnValueOnce(save.promise);
      getConfig.mockResolvedValueOnce(envelope(CFG_A));
      let pending!: Promise<unknown>;
      act(() => {
        pending = result.current.updateConfig({});
      });
      await act(async () => {
        await result.current.loadConfig();
      });
      let thrown: unknown;
      await act(async () => {
        save.reject(new Error('stale save'));
        try {
          await pending;
        } catch (err) {
          thrown = err;
        }
      });
      expect((thrown as Error).message).toBe('stale save');
      expect(result.current.error).toBeNull();
      expect(result.current.saving).toBe(false);
    });
  });

  describe('exportLogs', () => {
    it('passes filters and csv by default and returns the whole response', async () => {
      const { result } = await mountLoaded();
      const response = { data: 'a,b\n1,2' };
      exportLogs.mockResolvedValueOnce(response as any);
      let returned: unknown;
      await act(async () => {
        returned = await result.current.exportLogs({ action: 'login' });
      });
      expect(exportLogs).toHaveBeenCalledWith({ action: 'login' }, 'csv');
      expect(returned).toBe(response);
      expect(result.current.error).toBeNull();
    });

    it('passes the json format through and clears an earlier error', async () => {
      getConfig.mockRejectedValueOnce(new Error('load failed'));
      getPermissions.mockResolvedValueOnce(envelope(PERMS_A));
      const { result } = renderHook(() => useSecurity());
      await waitFor(() => expect(result.current.error).toBe('load failed'));
      exportLogs.mockResolvedValueOnce({ data: [] } as any);
      await act(async () => {
        await result.current.exportLogs(undefined, 'json');
      });
      expect(exportLogs).toHaveBeenCalledWith(undefined, 'json');
      expect(result.current.error).toBeNull();
    });

    it.each([
      ['the error message', new Error('export failed'), 'export failed'],
      ['the fallback', 'boom', 'Erro ao exportar logs'],
    ])('sets error from %s and throws it on failure', async (_label, rejection, message) => {
      const { result } = await mountLoaded();
      exportLogs.mockRejectedValueOnce(rejection);
      let thrown: unknown;
      await act(async () => {
        try {
          await result.current.exportLogs();
        } catch (err) {
          thrown = err;
        }
      });
      expect(exportLogs).toHaveBeenCalledWith(undefined, 'csv');
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toBe(message);
      expect(result.current.error).toBe(message);
    });
  });
});
