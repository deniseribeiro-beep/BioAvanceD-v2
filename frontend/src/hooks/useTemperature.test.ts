import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTemperature } from './useTemperature';
import { temperatureService } from '../services/api';
import { clearClientSession } from '../utils/sessionCleanup';

vi.mock('../services/api', () => ({
  temperatureService: {
    getAll: vi.fn(),
    viewControl: vi.fn(),
  },
}));

const getAll = vi.mocked(temperatureService.getAll);
const viewControlApi = vi.mocked(temperatureService.viewControl);

const DISABLED_MESSAGE =
  'Leitura de temperatura desativada temporariamente - não há sensores cadastrados';

type HookResult = ReturnType<typeof useTemperature>;

function mountRecording() {
  const renders: HookResult[] = [];
  const hook = renderHook(() => {
    const value = useTemperature();
    renders.push(value);
    return value;
  });
  return { ...hook, renders };
}

describe('useTemperature (reading disabled: TEMPERATURE_READING_DISABLED is true)', () => {
  let consoleInfo: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleInfo.mockRestore();
    vi.restoreAllMocks();
  });

  describe('mount', () => {
    it('renders first with loading true, then the mount effect settles it to false with no request', () => {
      const { result, renders } = mountRecording();
      expect(renders[0].loading).toBe(true);
      expect(renders[0].temperatures).toEqual([]);
      expect(renders[0].error).toBeNull();
      expect(result.current.loading).toBe(false);
      expect(result.current.temperatures).toEqual([]);
      expect(result.current.error).toBeNull();
      expect(getAll).not.toHaveBeenCalled();
      expect(viewControlApi).not.toHaveBeenCalled();
    });

    it('returns the five members of its contract', () => {
      const { result } = mountRecording();
      expect(Object.keys(result.current).sort()).toEqual(
        ['error', 'loadTemperatures', 'loading', 'temperatures', 'viewControl'],
      );
      expect(typeof result.current.loadTemperatures).toBe('function');
      expect(typeof result.current.viewControl).toBe('function');
    });
  });

  describe('loadTemperatures', () => {
    it('resolves to undefined, keeps the reset state and never calls getAll, on every call', async () => {
      const { result } = mountRecording();
      let first: unknown = 'unset';
      let second: unknown = 'unset';
      await act(async () => {
        first = await result.current.loadTemperatures();
        second = await result.current.loadTemperatures();
      });
      expect(first).toBeUndefined();
      expect(second).toBeUndefined();
      expect(result.current.loading).toBe(false);
      expect(result.current.temperatures).toEqual([]);
      expect(result.current.error).toBeNull();
      expect(getAll).not.toHaveBeenCalled();
    });
  });

  describe('viewControl', () => {
    it.each([
      ['no arguments', [] as [string?, string?]],
      ['a sensor and a policy', ['sensor-1', 'policy-9'] as [string?, string?]],
    ])('with %s returns [] and logs the disabled notice, never calling the service', async (_label, args) => {
      const { result } = mountRecording();
      let out: unknown;
      await act(async () => {
        out = await result.current.viewControl(...args);
      });
      expect(out).toEqual([]);
      expect(viewControlApi).not.toHaveBeenCalled();
      expect(consoleInfo).toHaveBeenCalledTimes(1);
      expect(consoleInfo).toHaveBeenCalledWith(DISABLED_MESSAGE);
    });
  });

  describe('logout', () => {
    it('subscribes to the logout event on mount and unsubscribes the same listener on unmount', () => {
      const add = vi.spyOn(window, 'addEventListener');
      const remove = vi.spyOn(window, 'removeEventListener');
      const { unmount } = mountRecording();
      const added = add.mock.calls.filter(([type]) => type === 'auth:logout');
      expect(added).toHaveLength(1);
      expect(remove.mock.calls.filter(([type]) => type === 'auth:logout')).toHaveLength(0);
      unmount();
      const removed = remove.mock.calls.filter(([type]) => type === 'auth:logout');
      expect(removed).toHaveLength(1);
      expect(removed[0][1]).toBe(added[0][1]);
    });

    it('leaves the hook reset (no data, no error, not loading) after a client logout', () => {
      const { result } = mountRecording();
      act(() => {
        clearClientSession();
      });
      expect(result.current.temperatures).toEqual([]);
      expect(result.current.error).toBeNull();
      expect(result.current.loading).toBe(false);
      expect(getAll).not.toHaveBeenCalled();
    });
  });
});
