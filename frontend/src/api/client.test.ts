import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InternalAxiosRequestConfig } from 'axios';
import type { ApiToastEventDetail } from './client';

// The shared apiClient: where it points (decided once at import), the headers
// its request interceptor adds, and the toast its response interceptor raises
// for each failure. Requests go to a stub adapter, so none leaves the test.

type Adapter = (config: InternalAxiosRequestConfig) => Promise<unknown>;

function ok(config: InternalAxiosRequestConfig, data: unknown = {}) {
  return { data, status: 200, statusText: 'OK', headers: {}, config, request: {} };
}

function httpError(config: InternalAxiosRequestConfig, status: number, data: unknown = {}) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    config,
    response: { status, data, headers: {}, config, statusText: '' },
  });
}

async function loadClient(adapter?: Adapter) {
  vi.resetModules();
  const mod = await import('./client');
  if (adapter) mod.apiClient.defaults.adapter = adapter as never;
  return mod;
}

let toasts: ApiToastEventDetail[] = [];
function onToast(event: Event) {
  toasts.push((event as CustomEvent<ApiToastEventDetail>).detail);
}

// The first import transforms client.ts and axios; done here, under the hook
// timeout, so no case pays for it inside its own.
beforeAll(async () => {
  await import('./client');
});

beforeEach(() => {
  localStorage.clear();
  toasts = [];
  window.addEventListener('bioavanced:toast', onToast);
});

afterEach(() => {
  window.removeEventListener('bioavanced:toast', onToast);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('apiClient base URL', () => {
  it('uses VITE_API_BASE_URL as given when it already ends in /api', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://lims.example.org/api');
    expect((await loadClient()).apiClient.defaults.baseURL).toBe('https://lims.example.org/api');
  });

  it('appends /api to a VITE_API_BASE_URL that lacks it, dropping one trailing slash', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://lims.example.org/');
    expect((await loadClient()).apiClient.defaults.baseURL).toBe('https://lims.example.org/api');
  });

  describe('with no VITE_API_BASE_URL, on localhost', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_API_BASE_URL', '');
    });

    it('defaults to port 3000', async () => {
      expect((await loadClient()).apiClient.defaults.baseURL).toBe('http://localhost:3000/api');
    });

    it('uses a saved numeric api_port', async () => {
      localStorage.setItem('api_port', '3004');
      expect((await loadClient()).apiClient.defaults.baseURL).toBe('http://localhost:3004/api');
    });

    it('ignores a non-numeric api_port', async () => {
      localStorage.setItem('api_port', '30a4');
      expect((await loadClient()).apiClient.defaults.baseURL).toBe('http://localhost:3000/api');
    });
  });
});

describe('apiClient request interceptor', () => {
  it('sends the saved token as a Bearer header, the UI language and a request id', async () => {
    localStorage.setItem('token', 'tok-123');
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => ok(config, { id: 1 }));
    await loadClient(adapter);
    const { setLanguage } = await import('../i18n');
    setLanguage('es-ES');
    const { apiClient } = await import('./client');

    const res = await apiClient.get('/samples');

    expect(res.data).toEqual({ id: 1 });
    const sent = adapter.mock.calls[0][0];
    expect(sent.headers.Authorization).toBe('Bearer tok-123');
    expect(sent.headers['Accept-Language']).toBe('es-ES');
    expect(String(sent.headers['X-Request-Id'])).toMatch(/^[A-Za-z0-9._-]{8,128}$/);
  });

  it('sends no Authorization header without a saved token', async () => {
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => ok(config));
    const { apiClient } = await loadClient(adapter);

    await apiClient.get('/health');

    expect(adapter.mock.calls[0][0].headers.Authorization).toBeUndefined();
  });

  it('RNF001 C4 (#1469) times a call and posts its timing to the frontend-timings route', async () => {
    localStorage.setItem('token', 'tok-123');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => ok(config));
    const { apiClient } = await loadClient(adapter);
    const { flushTimings } = await import('./timingReporter');

    await apiClient.get('/patients/123/consent');
    await flushTimings();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${apiClient.defaults.baseURL}/monitoring/frontend-timings`);
    expect(JSON.parse(String(init.body)).timings).toEqual([{ name: 'GET /api/patients/:id/consent', ms: expect.any(Number) }]);
  });
});

describe('apiClient response interceptor', () => {
  async function failWith(error: (config: InternalAxiosRequestConfig) => unknown, extra: Record<string, unknown> = {}) {
    const { apiClient } = await loadClient(async (config) => {
      throw error(config);
    });
    return apiClient.get('/samples', extra).catch((e: unknown) => e);
  }

  it('rejects without a toast when the request asks to suppress it', async () => {
    const err = await failWith((c) => httpError(c, 500), { suppressErrorToast: true });
    expect((err as { response: { status: number } }).response.status).toBe(500);
    expect(toasts).toEqual([]);
  });

  it('raises the access-denied toast on 403', async () => {
    const err = await failWith((c) => httpError(c, 403, { message: 'ignored' }));
    expect((err as { response: { status: number } }).response.status).toBe(403);
    expect(toasts).toEqual([
      { message: 'Acesso Negado: Você não tem permissão para esta ação', type: 'error', duration: 4500 },
    ]);
  });

  it('raises the server-failure toast on a 5xx', async () => {
    await failWith((c) => httpError(c, 503, { message: 'ignored' }));
    expect(toasts).toEqual([
      { message: 'Falha no servidor. Tente novamente em instantes.', type: 'error', duration: 4500 },
    ]);
  });

  it('raises the connection toast when no response came back', async () => {
    const err = await failWith((c) => Object.assign(new Error('Network Error'), { config: c }));
    expect((err as Error).message).toBe('Network Error');
    expect(toasts).toEqual([
      { message: 'Não foi possível conectar ao backend.', type: 'error', duration: 4500 },
    ]);
  });

  it("warns with the response's message on another 4xx", async () => {
    await failWith((c) => httpError(c, 422, { message: 'Campo obrigatório', error: 'other' }));
    expect(toasts).toEqual([{ message: 'Campo obrigatório', type: 'warning', duration: 4000 }]);
  });

  it("warns with the response's error field when it has no message", async () => {
    await failWith((c) => httpError(c, 409, { error: 'Duplicado' }));
    expect(toasts).toEqual([{ message: 'Duplicado', type: 'warning', duration: 4000 }]);
  });

  it("warns with the request error's own message when the body says nothing", async () => {
    await failWith((c) => httpError(c, 404, ''));
    expect(toasts).toEqual([
      { message: 'Request failed with status code 404', type: 'warning', duration: 4000 },
    ]);
  });

  it('raises no toast for a rejected status below 400', async () => {
    const err = await failWith((c) => httpError(c, 304));
    expect((err as { response: { status: number } }).response.status).toBe(304);
    expect(toasts).toEqual([]);
  });
});

describe('notifyApiToast', () => {
  it('dispatches the given toast on the shared event', async () => {
    const { notifyApiToast, API_TOAST_EVENT } = await loadClient();
    expect(API_TOAST_EVENT).toBe('bioavanced:toast');

    notifyApiToast({ message: 'Salvo', type: 'success' });

    expect(toasts).toEqual([{ message: 'Salvo', type: 'success' }]);
  });
});
