import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { usePatients } from './usePatients';
import { patientService } from '../services/api';
import { onDashboardDataChanged } from '../utils/dashboardRefresh';
import { clearClientSession } from '../utils/sessionCleanup';

vi.mock('../services/api', () => ({
  patientService: {
    getAll: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

const getAll = vi.mocked(patientService.getAll);

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

async function mountLoaded() {
  const hook = renderHook(() => usePatients());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

describe('usePatients', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  describe('loading on mount', () => {
    it('reads the listar() envelope data.patients and settles loading', async () => {
      getAll.mockResolvedValue(
        ok({ success: true, data: { patients: [{ participantId: '12345678' }], total: 1, limit: 10, skip: 0 } }),
      );
      const { result } = renderHook(() => usePatients());
      expect(result.current.loading).toBe(true);
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.patients).toEqual([{ participantId: '12345678' }]);
      expect(result.current.error).toBeNull();
      expect(getAll).toHaveBeenCalledTimes(1);
    });

    it('fills participantId from id, and with an empty string when neither is present', async () => {
      getAll.mockResolvedValue(ok({ data: [{ id: 'A1' }, { participantId: 'P2', id: 'ignored' }, { name: 'x' }] }));
      const { result } = await mountLoaded();
      expect(result.current.patients).toEqual([
        { id: 'A1', participantId: 'A1' },
        { participantId: 'P2', id: 'ignored' },
        { name: 'x', participantId: '' },
      ]);
    });

    it.each([
      ['data.patients empty', { data: { patients: [] } }],
      ['top-level patients empty', { patients: [] }],
      ['bare empty array', []],
      ['data empty array', { data: [] }],
      ['an object with no list and no id', { success: true }],
      ['null', null],
    ])('yields no patients for %s', async (_label, payload) => {
      getAll.mockResolvedValue(ok(payload));
      const { result } = await mountLoaded();
      expect(result.current.patients).toEqual([]);
      expect(result.current.error).toBeNull();
    });

    it.each([
      ['participantId', { participantId: 'P9', success: true }, 'P9'],
      ['id', { id: 'X7' }, 'X7'],
    ])('wraps a single patient object keyed by %s', async (_label, payload, expected) => {
      getAll.mockResolvedValue(ok(payload));
      const { result } = await mountLoaded();
      expect(result.current.patients).toHaveLength(1);
      expect(result.current.patients[0].participantId).toBe(expected);
    });
  });

  describe('load errors', () => {
    it.each([
      ['response.data.error', { response: { data: { error: 'E1', message: 'M1' } }, message: 'raw' }, 'E1'],
      ['response.data.message', { response: { data: { message: 'M1' } }, message: 'raw' }, 'M1'],
      ['error.message', { message: 'raw' }, 'raw'],
      ['the fallback', {}, 'Erro ao carregar pacientes'],
    ])('reports %s and clears the list', async (_label, err, expected) => {
      getAll.mockRejectedValue(err);
      const { result } = await mountLoaded();
      expect(result.current.error).toBe(expected);
      expect(result.current.patients).toEqual([]);
      expect(consoleError).toHaveBeenCalled();
    });

    it('clears a list loaded before when a reload fails', async () => {
      getAll.mockResolvedValueOnce(ok({ data: { patients: [{ participantId: 'P1' }] } }));
      const { result } = await mountLoaded();
      expect(result.current.patients).toHaveLength(1);
      getAll.mockRejectedValueOnce(new Error('boom'));
      await act(async () => {
        await result.current.loadPatients();
      });
      expect(result.current.patients).toEqual([]);
      expect(result.current.error).toBe('boom');
    });

    it('a reload after a failure sets loading, then clears the error on success', async () => {
      getAll.mockRejectedValueOnce(new Error('boom'));
      const { result } = await mountLoaded();
      expect(result.current.error).toBe('boom');
      const reload = deferred<any>();
      getAll.mockReturnValueOnce(reload.promise);
      let pending!: Promise<void>;
      act(() => {
        pending = result.current.loadPatients();
      });
      expect(result.current.loading).toBe(true);
      await act(async () => {
        reload.resolve(ok({ data: { patients: [{ participantId: 'P1' }] } }));
        await pending;
      });
      expect(result.current.error).toBeNull();
      expect(result.current.loading).toBe(false);
      expect(result.current.patients).toEqual([{ participantId: 'P1' }]);
    });

    it('stays silent on the no-token abort', async () => {
      getAll.mockRejectedValue({ code: 'NO_TOKEN_PROTECTED_REQUEST', message: 'no token' });
      const { result } = await mountLoaded();
      expect(result.current.error).toBeNull();
      expect(result.current.patients).toEqual([]);
      expect(consoleError).not.toHaveBeenCalled();
    });
  });

  describe('stale responses (#901)', () => {
    it('discards a slower earlier success once a newer load has resolved', async () => {
      const first = deferred<any>();
      getAll.mockReturnValueOnce(first.promise);
      getAll.mockResolvedValueOnce(ok({ data: { patients: [{ participantId: 'NEW' }] } }));
      const { result } = renderHook(() => usePatients());
      await act(async () => {
        await result.current.loadPatients();
      });
      expect(result.current.patients).toEqual([{ participantId: 'NEW' }]);
      await act(async () => {
        first.resolve(ok({ data: { patients: [{ participantId: 'OLD' }] } }));
        await first.promise;
      });
      expect(result.current.patients).toEqual([{ participantId: 'NEW' }]);
      expect(result.current.loading).toBe(false);
    });

    it('discards a slower earlier failure once a newer load has resolved', async () => {
      const first = deferred<any>();
      getAll.mockReturnValueOnce(first.promise);
      getAll.mockResolvedValueOnce(ok({ data: { patients: [{ participantId: 'NEW' }] } }));
      const { result } = renderHook(() => usePatients());
      await act(async () => {
        await result.current.loadPatients();
      });
      await act(async () => {
        first.reject(new Error('late'));
        await first.promise.catch(() => undefined);
      });
      expect(result.current.error).toBeNull();
      expect(result.current.patients).toEqual([{ participantId: 'NEW' }]);
      expect(consoleError).not.toHaveBeenCalled();
    });

    it('keeps loading while a newer load is in flight when an older one settles', async () => {
      const first = deferred<any>();
      const second = deferred<any>();
      getAll.mockReturnValueOnce(first.promise);
      getAll.mockReturnValueOnce(second.promise);
      const { result } = renderHook(() => usePatients());
      let pending!: Promise<void>;
      act(() => {
        pending = result.current.loadPatients();
      });
      await act(async () => {
        first.resolve(ok({ data: { patients: [{ participantId: 'OLD' }] } }));
        await first.promise;
      });
      expect(result.current.loading).toBe(true);
      expect(result.current.patients).toEqual([]);
      await act(async () => {
        second.resolve(ok({ data: { patients: [{ participantId: 'NEW' }] } }));
        await pending;
      });
      expect(result.current.loading).toBe(false);
      expect(result.current.patients).toEqual([{ participantId: 'NEW' }]);
    });
  });

  it('clears patients, error and loading on client logout', async () => {
    getAll.mockResolvedValue(ok({ data: { patients: [{ participantId: 'P1' }] } }));
    const { result } = await mountLoaded();
    expect(result.current.patients).toHaveLength(1);
    act(() => {
      clearClientSession();
    });
    expect(result.current.patients).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('clears the load error on client logout', async () => {
    getAll.mockRejectedValue(new Error('boom'));
    const { result } = await mountLoaded();
    expect(result.current.error).toBe('boom');
    act(() => {
      clearClientSession();
    });
    expect(result.current.error).toBeNull();
  });

  it('ends a pending load on client logout', async () => {
    getAll.mockReturnValueOnce(deferred<any>().promise);
    const { result } = renderHook(() => usePatients());
    expect(result.current.loading).toBe(true);
    act(() => {
      clearClientSession();
    });
    expect(result.current.loading).toBe(false);
  });

  describe.each([
    {
      name: 'createPatient',
      service: 'create' as const,
      call: (h: ReturnType<typeof usePatients>) => h.createPatient({ participantId: 'N1' }),
      args: [{ participantId: 'N1' }],
      fallback: 'Erro ao criar paciente',
      returnsData: true,
    },
    {
      name: 'updatePatient',
      service: 'update' as const,
      call: (h: ReturnType<typeof usePatients>) => h.updatePatient('12345678', { participantId: '12345678' }),
      args: ['12345678', { participantId: '12345678' }],
      fallback: 'Erro ao atualizar paciente',
      returnsData: true,
    },
    {
      name: 'deletePatient',
      service: 'delete' as const,
      call: (h: ReturnType<typeof usePatients>) => h.deletePatient(42),
      args: [42],
      fallback: 'Erro ao deletar paciente',
      returnsData: false,
    },
  ])('$name', ({ service, call, args, fallback, returnsData }) => {
    const mutate = () => vi.mocked(patientService[service]) as unknown as ReturnType<typeof vi.fn>;

    it('calls the service, reloads the list and notifies the dashboard', async () => {
      getAll.mockResolvedValueOnce(ok({ data: { patients: [{ participantId: 'P1' }] } }));
      const { result } = await mountLoaded();
      mutate().mockResolvedValue(ok({ participantId: 'RET' }));
      getAll.mockResolvedValueOnce(ok({ data: { patients: [{ participantId: 'P1' }, { participantId: 'P2' }] } }));
      const dashboard = vi.fn();
      const off = onDashboardDataChanged(dashboard);
      let returned: unknown;
      await act(async () => {
        returned = await call(result.current);
      });
      off();
      expect(mutate()).toHaveBeenCalledWith(...args);
      expect(getAll).toHaveBeenCalledTimes(2);
      expect(result.current.patients).toHaveLength(2);
      expect(dashboard).toHaveBeenCalledTimes(1);
      expect(returned).toEqual(returnsData ? { participantId: 'RET' } : undefined);
    });

    it('rethrows an API error that carries a response unchanged', async () => {
      getAll.mockResolvedValue(ok({ data: { patients: [] } }));
      const { result } = await mountLoaded();
      const apiError = { response: { status: 400, data: { error: 'invalid' } } };
      mutate().mockRejectedValue(apiError);
      await expect(call(result.current)).rejects.toBe(apiError);
      expect(getAll).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['its message', { message: 'network down' }, 'network down'],
      ['the fallback', {}, fallback],
    ])('wraps an error with no response in an Error with %s', async (_label, err, expected) => {
      getAll.mockResolvedValue(ok({ data: { patients: [] } }));
      const { result } = await mountLoaded();
      mutate().mockRejectedValue(err);
      await expect(call(result.current)).rejects.toThrow(new Error(expected));
    });
  });
});
