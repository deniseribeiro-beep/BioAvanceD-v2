import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useEquipment } from './useEquipment';
import { equipmentService } from '../services/api';
import { clearClientSession } from '../utils/sessionCleanup';

vi.mock('../services/api', () => ({
  equipmentService: {
    getAll: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

const getAll = vi.mocked(equipmentService.getAll);
const create = vi.mocked(equipmentService.create);
const update = vi.mocked(equipmentService.update);
const remove = vi.mocked(equipmentService.delete);

// E1 carries a Mongo _id; E2 has only its numeric equipmentID.
const E1 = { _id: 'e1', equipmentID: 1, equipmentDescription: 'Freezer A' };
const E2 = { equipmentID: 2, equipmentDescription: 'Centrifuge B' };
// What normalizeMasterDataItem(item, ['equipmentID']) adds to each row.
const N1 = { ...E1, id: '1', code: '1', active: true, is_active: true };
const N2 = { ...E2, id: '2', code: '2', active: true, is_active: true };

// An axios-shaped response, so unwrapApiPayload takes `data` off it.
function ok(data: unknown) {
  return { data, status: 200 } as any;
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

async function mountLoaded(payload: unknown = { success: true, data: [E1, E2] }) {
  getAll.mockResolvedValueOnce(ok(payload));
  const hook = renderHook(() => useEquipment());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

const apiErrors = (verb: string) => [
  ['the response message', { response: { data: { message: 'msg', error: 'err' } }, message: 'plain' }, 'msg'],
  ['the response error', { response: { data: { error: 'err' } }, message: 'plain' }, 'err'],
  ['the error message', new Error('plain'), 'plain'],
  ['the default', {}, `Erro ao ${verb} equipamento`],
] as const;

describe('useEquipment', () => {
  let dashboardEvents: number;
  const onDashboard = () => {
    dashboardEvents += 1;
  };

  beforeEach(() => {
    // resetAllMocks, not clearAllMocks: it also drops a once-value a case left unconsumed.
    vi.resetAllMocks();
    dashboardEvents = 0;
    window.addEventListener('dashboard:data-changed', onDashboard);
  });

  afterEach(() => {
    window.removeEventListener('dashboard:data-changed', onDashboard);
  });

  describe('loading on mount', () => {
    it('starts loading, calls getAll once, then settles with the normalized equipment', async () => {
      const d = deferred<any>();
      getAll.mockReturnValueOnce(d.promise);
      const { result } = renderHook(() => useEquipment());
      expect(result.current.loading).toBe(true);
      expect(result.current.equipment).toEqual([]);
      expect(result.current.error).toBeNull();
      expect(getAll).toHaveBeenCalledTimes(1);
      await act(async () => {
        d.resolve(ok({ success: true, data: [E1, E2] }));
      });
      expect(result.current.equipment).toEqual([N1, N2]);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it.each([
      ['an envelope', { success: true, data: [E2] }, [N2]],
      ['a bare array', [E2], [N2]],
      ['an envelope without an array', { success: true, data: {} }, []],
      ['null', null, []],
    ])('reads %s', async (_label, payload, expected) => {
      const { result } = await mountLoaded(payload);
      expect(result.current.equipment).toEqual(expected);
      expect(result.current.error).toBeNull();
    });
  });

  describe('load errors', () => {
    it.each([
      ['an Error message', new Error('boom'), 'boom'],
      ['an error without a message', {}, 'Erro ao carregar equipamentos'],
    ])('maps %s and clears the loaded equipment', async (_label, err, message) => {
      const { result } = await mountLoaded();
      expect(result.current.equipment).toEqual([N1, N2]);
      getAll.mockRejectedValueOnce(err);
      await act(async () => {
        await result.current.loadEquipment();
      });
      expect(result.current.error).toBe(message);
      expect(result.current.equipment).toEqual([]);
      expect(result.current.loading).toBe(false);
    });

    it('clears a previous error on a successful reload', async () => {
      getAll.mockRejectedValueOnce(new Error('first'));
      const { result } = renderHook(() => useEquipment());
      await waitFor(() => expect(result.current.error).toBe('first'));
      getAll.mockResolvedValueOnce(ok({ success: true, data: [E2] }));
      await act(async () => {
        await result.current.loadEquipment();
      });
      expect(result.current.error).toBeNull();
      expect(result.current.equipment).toEqual([N2]);
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
        p1 = result.current.loadEquipment();
        p2 = result.current.loadEquipment();
      });
      await act(async () => {
        second.resolve(ok({ success: true, data: [E2] }));
        await p2;
      });
      expect(result.current.equipment).toEqual([N2]);
      expect(result.current.loading).toBe(false);
      await act(async () => {
        first.resolve(ok({ success: true, data: [E1] }));
        await p1;
      });
      expect(result.current.equipment).toEqual([N2]);
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
        p1 = result.current.loadEquipment();
        p2 = result.current.loadEquipment();
      });
      await act(async () => {
        first.reject(new Error('stale'));
        await p1;
      });
      expect(result.current.error).toBeNull();
      expect(result.current.equipment).toEqual([N1, N2]);
      expect(result.current.loading).toBe(true);
      await act(async () => {
        second.resolve(ok({ success: true, data: [E2] }));
        await p2;
      });
      expect(result.current.equipment).toEqual([N2]);
      expect(result.current.loading).toBe(false);
    });
  });

  describe('logout', () => {
    it('clears equipment, error and loading on a client logout', async () => {
      const { result } = await mountLoaded();
      expect(result.current.equipment).toEqual([N1, N2]);
      act(() => {
        clearClientSession();
      });
      expect(result.current.equipment).toEqual([]);
      expect(result.current.error).toBeNull();
      expect(result.current.loading).toBe(false);
    });

    it('resets an error and a pending load on a client logout', async () => {
      getAll.mockRejectedValueOnce(new Error('first'));
      const { result } = renderHook(() => useEquipment());
      await waitFor(() => expect(result.current.error).toBe('first'));
      const pending = deferred<any>();
      getAll.mockReturnValueOnce(pending.promise);
      act(() => {
        void result.current.loadEquipment();
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

  describe('createEquipment', () => {
    it.each([
      ['an envelope', { success: true, data: { _id: 'e3', equipmentID: 3 } }],
      ['a bare entity', { _id: 'e3', equipmentID: 3 }],
    ])('merges the entity from %s over the request, appends it without a reload and notifies once', async (_label, body) => {
      const { result } = await mountLoaded();
      create.mockResolvedValueOnce(ok(body));
      let created: unknown;
      await act(async () => {
        created = await result.current.createEquipment({ equipmentDescription: 'Shaker C' });
      });
      const expected = { equipmentDescription: 'Shaker C', _id: 'e3', equipmentID: 3 };
      expect(create).toHaveBeenCalledWith({ equipmentDescription: 'Shaker C' });
      expect(created).toEqual(expected);
      expect(result.current.equipment).toEqual([N1, N2, expected]);
      expect(getAll).toHaveBeenCalledTimes(1);
      expect(dashboardEvents).toBe(1);
    });

    it('falls back to the request data when the response body is empty', async () => {
      const { result } = await mountLoaded();
      create.mockResolvedValueOnce(ok(null));
      let created: unknown;
      await act(async () => {
        created = await result.current.createEquipment({ equipmentDescription: 'Shaker C' });
      });
      expect(created).toEqual({ equipmentDescription: 'Shaker C' });
      expect(result.current.equipment).toEqual([N1, N2, { equipmentDescription: 'Shaker C' }]);
      expect(getAll).toHaveBeenCalledTimes(1);
      expect(dashboardEvents).toBe(1);
    });

    it.each(apiErrors('criar'))('rethrows %s without changing the list or notifying', async (_label, err, message) => {
      const { result } = await mountLoaded();
      create.mockRejectedValueOnce(err);
      await expect(result.current.createEquipment({ equipmentDescription: 'x' })).rejects.toThrow(message);
      expect(result.current.equipment).toEqual([N1, N2]);
      expect(getAll).toHaveBeenCalledTimes(1);
      expect(dashboardEvents).toBe(0);
    });
  });

  describe('updateEquipment', () => {
    it('replaces the row whose _id matches, keeps the others and notifies once', async () => {
      const { result } = await mountLoaded();
      update.mockResolvedValueOnce(ok({ success: true, data: { _id: 'e1', equipmentID: 1, status: 'Active' } }));
      let updated: unknown;
      await act(async () => {
        updated = await result.current.updateEquipment('e1', { status: 'Active' });
      });
      const expected = { status: 'Active', _id: 'e1', equipmentID: 1 };
      expect(update).toHaveBeenCalledWith('e1', { status: 'Active' });
      expect(updated).toEqual(expected);
      expect(result.current.equipment).toEqual([expected, N2]);
      expect(getAll).toHaveBeenCalledTimes(1);
      expect(dashboardEvents).toBe(1);
    });

    it('matches a row without an _id by its numeric equipmentID', async () => {
      const { result } = await mountLoaded();
      update.mockResolvedValueOnce(ok({ equipmentID: 2, status: 'Maintenance' }));
      await act(async () => {
        await result.current.updateEquipment(2, { status: 'Maintenance' });
      });
      expect(result.current.equipment).toEqual([N1, { status: 'Maintenance', equipmentID: 2 }]);
    });

    it('leaves the list unchanged when no row has the id', async () => {
      const { result } = await mountLoaded();
      update.mockResolvedValueOnce(ok({ _id: 'e9' }));
      await act(async () => {
        await result.current.updateEquipment('e9', { status: 'Active' });
      });
      expect(result.current.equipment).toEqual([N1, N2]);
      expect(dashboardEvents).toBe(1);
    });

    it.each(apiErrors('atualizar'))('rethrows %s without changing the list or notifying', async (_label, err, message) => {
      const { result } = await mountLoaded();
      update.mockRejectedValueOnce(err);
      await expect(result.current.updateEquipment('e1', { status: 'Active' })).rejects.toThrow(message);
      expect(result.current.equipment).toEqual([N1, N2]);
      expect(getAll).toHaveBeenCalledTimes(1);
      expect(dashboardEvents).toBe(0);
    });
  });

  describe('deleteEquipment', () => {
    it.each([
      ['its _id', 'e1' as string | number, [N2]],
      ['its numeric equipmentID', 2 as string | number, [N1]],
    ])('drops the row by %s before the reload settles, then takes the reload and notifies once', async (_label, id, interim) => {
      const { result } = await mountLoaded();
      remove.mockResolvedValueOnce(ok({ success: true }));
      const reload = deferred<any>();
      getAll.mockReturnValueOnce(reload.promise);
      let p!: Promise<void>;
      await act(async () => {
        p = result.current.deleteEquipment(id);
      });
      expect(remove).toHaveBeenCalledWith(id);
      expect(result.current.equipment).toEqual(interim);
      expect(result.current.loading).toBe(true);
      expect(dashboardEvents).toBe(0);
      let out: unknown = 'unset';
      await act(async () => {
        reload.resolve(ok({ success: true, data: [E2] }));
        out = await p;
      });
      expect(out).toBeUndefined();
      expect(getAll).toHaveBeenCalledTimes(2);
      expect(result.current.equipment).toEqual([N2]);
      expect(result.current.loading).toBe(false);
      expect(dashboardEvents).toBe(1);
    });

    it('still resolves and notifies when the reload after a delete fails', async () => {
      const { result } = await mountLoaded();
      remove.mockResolvedValueOnce(ok({ success: true }));
      getAll.mockRejectedValueOnce(new Error('reload down'));
      await act(async () => {
        await result.current.deleteEquipment('e1');
      });
      expect(result.current.error).toBe('reload down');
      expect(result.current.equipment).toEqual([]);
      expect(dashboardEvents).toBe(1);
    });

    it.each(apiErrors('deletar'))('rethrows %s without changing the list or notifying', async (_label, err, message) => {
      const { result } = await mountLoaded();
      remove.mockRejectedValueOnce(err);
      await expect(result.current.deleteEquipment('e1')).rejects.toThrow(message);
      expect(result.current.equipment).toEqual([N1, N2]);
      expect(getAll).toHaveBeenCalledTimes(1);
      expect(dashboardEvents).toBe(0);
    });
  });
});
