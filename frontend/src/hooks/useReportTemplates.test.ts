import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useReportTemplates } from '@/hooks/useReportTemplates';
import { reportTemplateService } from '@/services/api';
import { clearClientSession } from '@/utils/sessionCleanup';
import type { ReportTemplate } from '@/types/models';

vi.mock('@/services/api', () => ({
  reportTemplateService: {
    getAll: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

const getAll = vi.mocked(reportTemplateService.getAll);
const create = vi.mocked(reportTemplateService.create);
const update = vi.mocked(reportTemplateService.update);
const remove = vi.mocked(reportTemplateService.delete);

const A: ReportTemplate = { _id: 'a1', code: 'patients', name: 'Patients', handlerKey: 'patient', isSystemDefined: true, templateStatus: 'active' };
const B: ReportTemplate = { _id: 'b2', code: 'custom', name: 'Custom', handlerKey: 'sample', isSystemDefined: false, templateStatus: 'retired' };

// An axios-shaped response: extractResponseItems unwraps it, then finds data.data.
const ok = (data: unknown) => ({ data, status: 200, headers: {}, config: {} }) as any;
const list = (items: ReportTemplate[]) => ok({ success: true, data: items });
const httpError = (data: unknown, message = 'Request failed') => Object.assign(new Error(message), { response: { data } });

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function mountLoaded(items: ReportTemplate[] = [A]) {
  getAll.mockResolvedValueOnce(list(items));
  const hook = renderHook(() => useReportTemplates());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

const ERROR_CASES: [string, unknown, string][] = [
  ['joins response details with "; "', httpError({ details: ['code taken', 'name required'], error: 'ignored' }), 'code taken; name required'],
  ['falls back to response error', httpError({ error: 'Forbidden' }), 'Forbidden'],
  ['falls back to the error message', new Error('Network Error'), 'Network Error'],
];

describe('useReportTemplates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loading on mount', () => {
    it('starts loading, calls getAll once, then settles with the templates', async () => {
      const d = deferred<any>();
      getAll.mockReturnValueOnce(d.promise);
      const { result } = renderHook(() => useReportTemplates());
      expect(result.current.loading).toBe(true);
      expect(result.current.reportTemplates).toEqual([]);
      expect(result.current.error).toBeNull();
      expect(getAll).toHaveBeenCalledTimes(1);
      await act(async () => {
        d.resolve(list([A, B]));
      });
      expect(result.current.reportTemplates).toEqual([A, B]);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it.each([
      ...ERROR_CASES,
      ['falls back to the default message', new Error(''), 'Erro ao carregar modelos de relatório'],
    ])('on a failed load %s and clears the list', async (_label, err, message) => {
      getAll.mockRejectedValueOnce(err);
      const { result } = renderHook(() => useReportTemplates());
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.error).toBe(message);
      expect(result.current.reportTemplates).toEqual([]);
    });

    it('loads again on a reload after the first load settled', async () => {
      const { result } = await mountLoaded([A]);
      const d = deferred<any>();
      getAll.mockReturnValueOnce(d.promise);
      act(() => {
        void result.current.loadReportTemplates();
      });
      expect(result.current.loading).toBe(true);
      await act(async () => {
        d.resolve(list([B]));
      });
      expect(result.current.loading).toBe(false);
      expect(result.current.reportTemplates).toEqual([B]);
    });

    it('a successful reload clears an earlier error', async () => {
      getAll.mockRejectedValueOnce(new Error('down'));
      const { result } = renderHook(() => useReportTemplates());
      await waitFor(() => expect(result.current.error).toBe('down'));
      getAll.mockResolvedValueOnce(list([B]));
      await act(async () => {
        await result.current.loadReportTemplates();
      });
      expect(result.current.error).toBeNull();
      expect(result.current.reportTemplates).toEqual([B]);
    });
  });

  describe('stale responses', () => {
    it('discards an older load that resolves after a newer one, and keeps loading until the newer settles', async () => {
      const first = deferred<any>();
      const second = deferred<any>();
      getAll.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      const { result } = renderHook(() => useReportTemplates());
      act(() => {
        void result.current.loadReportTemplates();
      });
      await act(async () => {
        first.resolve(list([A]));
      });
      expect(result.current.reportTemplates).toEqual([]);
      expect(result.current.loading).toBe(true);
      await act(async () => {
        second.resolve(list([B]));
      });
      expect(result.current.reportTemplates).toEqual([B]);
      expect(result.current.loading).toBe(false);
    });

    it('discards an older load that rejects after a newer one', async () => {
      const first = deferred<any>();
      const second = deferred<any>();
      getAll.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      const { result } = renderHook(() => useReportTemplates());
      act(() => {
        void result.current.loadReportTemplates();
      });
      await act(async () => {
        second.resolve(list([B]));
      });
      await act(async () => {
        first.reject(new Error('stale'));
      });
      expect(result.current.error).toBeNull();
      expect(result.current.reportTemplates).toEqual([B]);
      expect(result.current.loading).toBe(false);
    });
  });

  describe('client logout', () => {
    it('clears the loaded list', async () => {
      const { result } = await mountLoaded([A]);
      expect(result.current.reportTemplates).toEqual([A]);
      act(() => {
        clearClientSession();
      });
      expect(result.current.reportTemplates).toEqual([]);
    });

    it('clears an error left by a failed load', async () => {
      getAll.mockRejectedValueOnce(new Error('down'));
      const { result } = renderHook(() => useReportTemplates());
      await waitFor(() => expect(result.current.error).toBe('down'));
      act(() => {
        clearClientSession();
      });
      expect(result.current.error).toBeNull();
    });

    it('settles loading while a load is pending', async () => {
      const d = deferred<any>();
      getAll.mockReturnValueOnce(d.promise);
      const { result } = renderHook(() => useReportTemplates());
      expect(result.current.loading).toBe(true);
      act(() => {
        clearClientSession();
      });
      expect(result.current.loading).toBe(false);
    });
  });

  describe('createReportTemplate', () => {
    it('posts the data, reloads, and returns the unwrapped created template', async () => {
      const { result } = await mountLoaded();
      create.mockResolvedValueOnce(ok({ success: true, data: B }));
      getAll.mockResolvedValueOnce(list([A, B]));
      let created: unknown;
      await act(async () => {
        created = await result.current.createReportTemplate({ code: 'custom', name: 'Custom' });
      });
      expect(create).toHaveBeenCalledWith({ code: 'custom', name: 'Custom' });
      expect(getAll).toHaveBeenCalledTimes(2);
      expect(created).toEqual(B);
      expect(result.current.reportTemplates).toEqual([A, B]);
    });

    it('returns the response body itself when it has no data field', async () => {
      const { result } = await mountLoaded();
      create.mockResolvedValueOnce(ok(B));
      getAll.mockResolvedValueOnce(list([A, B]));
      let created: unknown;
      await act(async () => {
        created = await result.current.createReportTemplate({ code: 'custom' });
      });
      expect(created).toEqual(B);
    });

    it.each([
      ...ERROR_CASES,
      ['falls back to the default message', new Error(''), 'Erro ao criar modelo de relatório'],
    ])('rejects and does not reload when the post fails: %s', async (_label, err, message) => {
      const { result } = await mountLoaded();
      create.mockRejectedValueOnce(err);
      await expect(result.current.createReportTemplate({ code: 'x' })).rejects.toThrow(new Error(message));
      expect(getAll).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateReportTemplate', () => {
    it('puts the data under the id, reloads, and returns the unwrapped template', async () => {
      const { result } = await mountLoaded([B]);
      const renamed = { ...B, name: 'Renamed' };
      update.mockResolvedValueOnce(ok({ success: true, data: renamed }));
      getAll.mockResolvedValueOnce(list([renamed]));
      let updated: unknown;
      await act(async () => {
        updated = await result.current.updateReportTemplate('b2', { name: 'Renamed' });
      });
      expect(update).toHaveBeenCalledWith('b2', { name: 'Renamed' });
      expect(getAll).toHaveBeenCalledTimes(2);
      expect(updated).toEqual(renamed);
      expect(result.current.reportTemplates).toEqual([renamed]);
    });

    it('returns the response body itself when it has no data field', async () => {
      const { result } = await mountLoaded([B]);
      update.mockResolvedValueOnce(ok(B));
      getAll.mockResolvedValueOnce(list([B]));
      let updated: unknown;
      await act(async () => {
        updated = await result.current.updateReportTemplate('b2', { name: 'Custom' });
      });
      expect(updated).toEqual(B);
    });

    it.each([
      ...ERROR_CASES,
      ['falls back to the default message', new Error(''), 'Erro ao atualizar modelo de relatório'],
    ])('rejects and does not reload when the put fails: %s', async (_label, err, message) => {
      const { result } = await mountLoaded([B]);
      update.mockRejectedValueOnce(err);
      await expect(result.current.updateReportTemplate('b2', { name: 'x' })).rejects.toThrow(new Error(message));
      expect(getAll).toHaveBeenCalledTimes(1);
    });
  });

  describe('deleteReportTemplate', () => {
    it('deletes by id and reloads', async () => {
      const { result } = await mountLoaded([A, B]);
      remove.mockResolvedValueOnce(ok({ success: true }));
      getAll.mockResolvedValueOnce(list([A]));
      await act(async () => {
        await result.current.deleteReportTemplate('b2');
      });
      expect(remove).toHaveBeenCalledWith('b2');
      expect(getAll).toHaveBeenCalledTimes(2);
      expect(result.current.reportTemplates).toEqual([A]);
    });

    it.each([
      ...ERROR_CASES,
      ['falls back to the default message', new Error(''), 'Erro ao remover modelo de relatório'],
    ])('rejects and does not reload when the delete fails: %s', async (_label, err, message) => {
      const { result } = await mountLoaded([A, B]);
      remove.mockRejectedValueOnce(err);
      await expect(result.current.deleteReportTemplate('b2')).rejects.toThrow(new Error(message));
      expect(getAll).toHaveBeenCalledTimes(1);
    });
  });
});
