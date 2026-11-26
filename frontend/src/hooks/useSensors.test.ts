import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useSensors } from './useSensors';
import { sensorService } from '../services/api';
import { clearClientSession } from '../utils/sessionCleanup';

vi.mock('../services/api', () => ({
  sensorService: {
    getAll: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

const getAll = vi.mocked(sensorService.getAll);
const create = vi.mocked(sensorService.create);
const update = vi.mocked(sensorService.update);
const remove = vi.mocked(sensorService.delete);

const S1 = { _id: 's1', sensorId: 'SEN-1', sensorType: 'freezer' };
const S2 = { _id: 's2', sensorId: 'SEN-2', sensorType: 'fridge' };

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

async function mountLoaded(payload: unknown = { success: true, data: [S1] }) {
  getAll.mockResolvedValueOnce(ok(payload));
  const hook = renderHook(() => useSensors());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

describe('useSensors', () => {
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
    it('starts loading, calls getAll once, then settles with the sensors', async () => {
      const d = deferred<any>();
      getAll.mockReturnValueOnce(d.promise);
      const { result } = renderHook(() => useSensors());
      expect(result.current.loading).toBe(true);
      expect(result.current.sensors).toEqual([]);
      expect(result.current.error).toBeNull();
      expect(getAll).toHaveBeenCalledTimes(1);
      await act(async () => {
        d.resolve(ok({ success: true, data: [S1, S2] }));
      });
      expect(result.current.sensors).toEqual([S1, S2]);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it.each([
      ['an envelope', { success: true, data: [S1] }, [S1]],
      ['a bare array', [S1], [S1]],
      ['an envelope without an array', { success: true, data: {} }, []],
      ['null', null, []],
    ])('reads %s', async (_label, payload, expected) => {
      const { result } = await mountLoaded(payload);
      expect(result.current.sensors).toEqual(expected);
      expect(result.current.error).toBeNull();
    });
  });

  describe('load errors', () => {
    it.each([
      ['an Error message', new Error('boom'), 'boom'],
      ['an error without a message', {}, 'Erro ao carregar sensores'],
    ])('maps %s and clears the loaded sensors', async (_label, err, message) => {
      const { result } = await mountLoaded();
      expect(result.current.sensors).toEqual([S1]);
      getAll.mockRejectedValueOnce(err);
      await act(async () => {
        await result.current.loadSensors();
      });
      expect(result.current.error).toBe(message);
      expect(result.current.sensors).toEqual([]);
      expect(result.current.loading).toBe(false);
    });

    it('clears a previous error on a successful reload', async () => {
      getAll.mockRejectedValueOnce(new Error('first'));
      const { result } = renderHook(() => useSensors());
      await waitFor(() => expect(result.current.error).toBe('first'));
      getAll.mockResolvedValueOnce(ok({ success: true, data: [S2] }));
      await act(async () => {
        await result.current.loadSensors();
      });
      expect(result.current.error).toBeNull();
      expect(result.current.sensors).toEqual([S2]);
    });
  });

  describe('stale responses (#901)', () => {
    it('drops a stale success that resolves after a newer load', async () => {
      const { result } = await mountLoaded();
      const first = deferred<any>();
      const second = deferred<any>();
      getAll.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      let p1!: Promise<void>;
      let p2!: Promise<void>;
      act(() => {
        p1 = result.current.loadSensors();
        p2 = result.current.loadSensors();
      });
      await act(async () => {
        second.resolve(ok({ success: true, data: [S2] }));
        await p2;
      });
      expect(result.current.sensors).toEqual([S2]);
      expect(result.current.loading).toBe(false);
      await act(async () => {
        first.resolve(ok({ success: true, data: [S1] }));
        await p1;
      });
      expect(result.current.sensors).toEqual([S2]);
      expect(result.current.loading).toBe(false);
    });

    it('drops a stale failure and keeps loading until the current load settles', async () => {
      const { result } = await mountLoaded();
      const first = deferred<any>();
      const second = deferred<any>();
      getAll.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      let p1!: Promise<void>;
      let p2!: Promise<void>;
      act(() => {
        p1 = result.current.loadSensors();
        p2 = result.current.loadSensors();
      });
      await act(async () => {
        first.reject(new Error('stale'));
        await p1;
      });
      expect(result.current.error).toBeNull();
      expect(result.current.sensors).toEqual([S1]);
      expect(result.current.loading).toBe(true);
      await act(async () => {
        second.resolve(ok({ success: true, data: [S2] }));
        await p2;
      });
      expect(result.current.sensors).toEqual([S2]);
      expect(result.current.loading).toBe(false);
    });
  });

  describe('logout', () => {
    it('clears sensors, error and loading on a client logout', async () => {
      const { result } = await mountLoaded();
      expect(result.current.sensors).toEqual([S1]);
      act(() => {
        clearClientSession();
      });
      expect(result.current.sensors).toEqual([]);
      expect(result.current.error).toBeNull();
      expect(result.current.loading).toBe(false);
    });

    it('resets an error and a pending load on a client logout', async () => {
      getAll.mockRejectedValueOnce(new Error('first'));
      const { result } = renderHook(() => useSensors());
      await waitFor(() => expect(result.current.error).toBe('first'));
      const pending = deferred<any>();
      getAll.mockReturnValueOnce(pending.promise);
      act(() => {
        void result.current.loadSensors();
      });
      expect(result.current.loading).toBe(true);
      expect(result.current.error).toBe('first');
      act(() => {
        clearClientSession();
      });
      expect(result.current.error).toBeNull();
      expect(result.current.loading).toBe(false);
    });

    it('removes its logout listener on unmount', async () => {
      const add = vi.spyOn(window, 'addEventListener');
      const removeListener = vi.spyOn(window, 'removeEventListener');
      try {
        const { unmount } = await mountLoaded();
        const added = add.mock.calls.filter(([type]) => type === 'auth:logout');
        expect(added).toHaveLength(1);
        unmount();
        expect(removeListener).toHaveBeenCalledWith('auth:logout', added[0][1]);
      } finally {
        add.mockRestore();
        removeListener.mockRestore();
      }
    });
  });

  describe('createSensor', () => {
    it.each([
      ['an envelope', { success: true, data: S2 }],
      ['a bare entity', S2],
    ])('returns the created sensor from %s, reloads and notifies the dashboard', async (_label, body) => {
      const { result } = await mountLoaded();
      create.mockResolvedValueOnce(ok(body));
      getAll.mockResolvedValueOnce(ok({ success: true, data: [S1, S2] }));
      let created: unknown;
      await act(async () => {
        created = await result.current.createSensor({ sensorType: 'freezer' });
      });
      expect(create).toHaveBeenCalledWith({ sensorType: 'freezer' });
      expect(created).toEqual(S2);
      expect(getAll).toHaveBeenCalledTimes(2);
      expect(result.current.sensors).toEqual([S1, S2]);
      expect(dashboardEvents).toBe(1);
    });

    it.each([
      ['an Error message', new Error('dup'), 'dup'],
      ['an error without a message', {}, 'Erro ao criar sensor'],
    ])('rethrows %s without reloading or notifying', async (_label, err, message) => {
      const { result } = await mountLoaded();
      create.mockRejectedValueOnce(err);
      await expect(result.current.createSensor({ sensorType: 'x' })).rejects.toThrow(message);
      expect(getAll).toHaveBeenCalledTimes(1);
      expect(dashboardEvents).toBe(0);
    });
  });

  describe('updateSensor', () => {
    it.each([
      ['an envelope', { success: true, data: S2 }],
      ['a bare entity', S2],
    ])('returns the updated sensor from %s, reloads and notifies the dashboard', async (_label, body) => {
      const { result } = await mountLoaded();
      update.mockResolvedValueOnce(ok(body));
      getAll.mockResolvedValueOnce(ok({ success: true, data: [S2] }));
      let updated: unknown;
      await act(async () => {
        updated = await result.current.updateSensor('s2', { sensorType: 'freezer' });
      });
      expect(update).toHaveBeenCalledWith('s2', { sensorType: 'freezer' });
      expect(updated).toEqual(S2);
      expect(getAll).toHaveBeenCalledTimes(2);
      expect(result.current.sensors).toEqual([S2]);
      expect(dashboardEvents).toBe(1);
    });

    it.each([
      ['an Error message', new Error('gone'), 'gone'],
      ['an error without a message', {}, 'Erro ao atualizar sensor'],
    ])('rethrows %s without reloading or notifying', async (_label, err, message) => {
      const { result } = await mountLoaded();
      update.mockRejectedValueOnce(err);
      await expect(result.current.updateSensor('s1', { sensorType: 'x' })).rejects.toThrow(message);
      expect(getAll).toHaveBeenCalledTimes(1);
      expect(dashboardEvents).toBe(0);
    });
  });

  describe('deleteSensor', () => {
    it('deletes by id, reloads and notifies the dashboard', async () => {
      const { result } = await mountLoaded();
      remove.mockResolvedValueOnce(ok({ success: true }));
      getAll.mockResolvedValueOnce(ok({ success: true, data: [] }));
      let out: unknown = 'unset';
      await act(async () => {
        out = await result.current.deleteSensor('s1');
      });
      expect(remove).toHaveBeenCalledWith('s1');
      expect(out).toBeUndefined();
      expect(getAll).toHaveBeenCalledTimes(2);
      expect(result.current.sensors).toEqual([]);
      expect(dashboardEvents).toBe(1);
    });

    it.each([
      ['an Error message', new Error('locked'), 'locked'],
      ['an error without a message', {}, 'Erro ao deletar sensor'],
    ])('rethrows %s without reloading or notifying', async (_label, err, message) => {
      const { result } = await mountLoaded();
      remove.mockRejectedValueOnce(err);
      await expect(result.current.deleteSensor('s1')).rejects.toThrow(message);
      expect(getAll).toHaveBeenCalledTimes(1);
      expect(dashboardEvents).toBe(0);
    });
  });
});
