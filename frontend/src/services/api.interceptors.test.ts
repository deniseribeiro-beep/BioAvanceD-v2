import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios';

// #1337: the shared client's request and response interceptors, driven through
// a stub adapter so no request leaves the test. Each case imports a fresh copy
// of the module, since it keeps the redirect latch and the pending refresh in
// module state.
const clearClientSession = vi.fn();
const fetchWithRequestId = vi.fn();

vi.mock('../utils/sessionCleanup', () => ({
  clearClientSession: (...args: unknown[]) => clearClientSession(...args),
}));

vi.mock('../api/requestId', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/requestId')>();
  return { ...actual, fetchWithRequestId: (...args: unknown[]) => fetchWithRequestId(...args) };
});

type Adapter = (config: InternalAxiosRequestConfig) => Promise<unknown>;

function ok(config: InternalAxiosRequestConfig, data: unknown = {}) {
  return { data, status: 200, statusText: 'OK', headers: {}, config, request: {} };
}

function httpError(config: InternalAxiosRequestConfig, status: number) {
  const error = Object.assign(new Error(`Request failed with status code ${status}`), {
    config,
    response: { status, data: {}, headers: {}, config, statusText: '' },
  });
  return error;
}

async function loadApi(adapter: Adapter): Promise<AxiosInstance> {
  vi.resetModules();
  const mod = await import('./api');
  mod.default.defaults.adapter = adapter as any;
  return mod.default;
}

// The first import transforms api.ts and axios; done here, under the hook
// timeout, so no case pays for it inside its own.
beforeAll(async () => {
  await import('./api');
});

beforeEach(() => {
  localStorage.clear();
  clearClientSession.mockReset();
  fetchWithRequestId.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('request interceptor', () => {
  it('cancels a protected request with no token and ends the session once', async () => {
    const adapter = vi.fn();
    const api = await loadApi(adapter);

    await expect(api.get('/samples')).rejects.toMatchObject({ code: 'NO_TOKEN_PROTECTED_REQUEST' });
    await expect(api.get('/patients')).rejects.toMatchObject({ code: 'NO_TOKEN_PROTECTED_REQUEST' });

    expect(adapter).not.toHaveBeenCalled();
    expect(clearClientSession).toHaveBeenCalledTimes(1);
    expect(clearClientSession).toHaveBeenCalledWith({ redirectToLogin: true });
  });

  it('sends a token-optional route without a token or an Authorization header', async () => {
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => ok(config, { valid: true }));
    const api = await loadApi(adapter);

    const res = await api.post('/e-consent/consent-tokens/validate', { token: 't' });

    expect(res.data).toEqual({ valid: true });
    const sent = adapter.mock.calls[0][0];
    expect(sent.headers.Authorization).toBeUndefined();
    expect(sent.headers['X-Request-Id']).toMatch(/^[A-Za-z0-9._-]{8,128}$/);
    expect(clearClientSession).not.toHaveBeenCalled();
  });

  it('adds the stored token as a Bearer header', async () => {
    localStorage.setItem('token', 'abc');
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => ok(config));
    const api = await loadApi(adapter);

    await api.get('/samples');

    expect(adapter.mock.calls[0][0].headers.Authorization).toBe('Bearer abc');
  });

  it('RNF001 C4 (#1469) times a call and posts its timing to the frontend-timings route', async () => {
    localStorage.setItem('token', 'abc');
    fetchWithRequestId.mockResolvedValue(new Response(null, { status: 204 }));
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => ok(config));
    const api = await loadApi(adapter);
    const { flushTimings } = await import('../api/timingReporter');

    await api.get('/samples/BAD-2026-0001');
    await flushTimings();

    expect(fetchWithRequestId).toHaveBeenCalledTimes(1);
    const [url, init] = fetchWithRequestId.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${api.defaults.baseURL}/monitoring/frontend-timings`);
    expect(JSON.parse(String(init.body)).timings).toEqual([{ name: 'GET /api/samples/:id', ms: expect.any(Number) }]);
  });
});

describe('response interceptor: 401 and the token refresh', () => {
  beforeEach(() => {
    localStorage.setItem('token', 'old');
  });

  it('refreshes once, stores the new token and retries the request with it', async () => {
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      if (config.url === '/auth/refresh') return ok(config, { data: { token: 'new' } });
      if (config.headers.Authorization === 'Bearer new') return ok(config, { rows: 1 });
      throw httpError(config, 401);
    });
    const api = await loadApi(adapter);

    const res = await api.get('/samples');

    expect(res.data).toEqual({ rows: 1 });
    expect(localStorage.getItem('token')).toBe('new');
    expect(adapter.mock.calls.filter(([c]) => c.url === '/auth/refresh')).toHaveLength(1);
    expect(clearClientSession).not.toHaveBeenCalled();
  });

  it('shares one refresh between two requests that fail together', async () => {
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      if (config.url === '/auth/refresh') return ok(config, { data: { token: 'new' } });
      if (config.headers.Authorization === 'Bearer new') return ok(config, config.url);
      throw httpError(config, 401);
    });
    const api = await loadApi(adapter);

    const [a, b] = await Promise.all([api.get('/samples'), api.get('/patients')]);

    expect([a.data, b.data]).toEqual(['/samples', '/patients']);
    expect(adapter.mock.calls.filter(([c]) => c.url === '/auth/refresh')).toHaveLength(1);
  });

  it('ends the session when the refresh answers without a token', async () => {
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      if (config.url === '/auth/refresh') return ok(config, { data: {} });
      throw httpError(config, 401);
    });
    const api = await loadApi(adapter);

    await expect(api.get('/samples')).rejects.toMatchObject({ response: { status: 401 } });
    expect(clearClientSession).toHaveBeenCalledWith({ redirectToLogin: true });
  });

  it('ends the session when the refresh itself fails', async () => {
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      throw httpError(config, 401);
    });
    const api = await loadApi(adapter);

    await expect(api.get('/samples')).rejects.toMatchObject({ config: { url: '/samples' } });
    expect(adapter.mock.calls.map(([c]) => c.url)).toEqual(['/samples', '/auth/refresh']);
    expect(clearClientSession).toHaveBeenCalledTimes(1);
  });

  it('does not refresh a request already retried, and ends the session', async () => {
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      throw httpError(config, 401);
    });
    const api = await loadApi(adapter);

    await expect(api.get('/samples', { _retry: true } as any)).rejects.toMatchObject({ response: { status: 401 } });
    expect(adapter.mock.calls.map(([c]) => c.url)).toEqual(['/samples']);
    expect(clearClientSession).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a token-optional route', '/auth/login', {}],
    ['a request that opts out of the redirect', '/e-consent/consent-templates', { suppressAuthRedirect: true }],
  ])('passes a 401 on %s through without a refresh or a logout', async (_label, url, extra) => {
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      throw httpError(config, 401);
    });
    const api = await loadApi(adapter);

    await expect(api.get(url, extra as any)).rejects.toMatchObject({ response: { status: 401 } });
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(clearClientSession).not.toHaveBeenCalled();
  });

  it('passes a non-401 error through unchanged', async () => {
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      throw httpError(config, 500);
    });
    const api = await loadApi(adapter);

    await expect(api.get('/samples')).rejects.toMatchObject({ response: { status: 500 } });
    expect(clearClientSession).not.toHaveBeenCalled();
  });

  it('passes a cancelled request through unchanged', async () => {
    const axios = (await import('axios')).default;
    const adapter = vi.fn(async () => {
      throw new axios.CanceledError('stop');
    });
    const api = await loadApi(adapter);

    await expect(api.get('/samples')).rejects.toBeInstanceOf(axios.CanceledError);
    expect(clearClientSession).not.toHaveBeenCalled();
  });
});

describe('response interceptor: backend unreachable', () => {
  beforeEach(() => {
    localStorage.setItem('token', 't');
  });

  function networkError(config: InternalAxiosRequestConfig) {
    return Object.assign(new Error('Network Error'), { config });
  }

  it('probes the alternative ports and saves the first that answers', async () => {
    fetchWithRequestId.mockImplementation(async (url: string) => {
      if (url.includes(':3001')) throw new Error('refused');
      return { ok: url.includes(':3003') };
    });
    const api = await loadApi(async (config) => {
      throw networkError(config);
    });

    await expect(api.get('/samples')).rejects.toThrow('Backend encontrado na porta 3003. Recarregue a página para aplicar.');
    expect(fetchWithRequestId.mock.calls.map(([u]) => u)).toEqual([
      'http://localhost:3001/api/health',
      'http://localhost:3002/api/health',
      'http://localhost:3003/api/health',
    ]);
    expect(localStorage.getItem('api_port')).toBe('3003');
  });

  it('reports the backend down when no alternative port answers', async () => {
    fetchWithRequestId.mockResolvedValue({ ok: false });
    const api = await loadApi(async (config) => {
      throw networkError(config);
    });

    await expect(api.get('/samples')).rejects.toThrow(
      'Servidor backend não está disponível. Verifique se está rodando na porta 3000.',
    );
    expect(fetchWithRequestId).toHaveBeenCalledTimes(5);
    expect(localStorage.getItem('api_port')).toBeNull();
  });

  it('does not probe for a health check, nor once a non-default port is saved', async () => {
    const api = await loadApi(async (config) => {
      throw Object.assign(new Error('connect'), { code: 'ECONNREFUSED', config });
    });

    await expect(api.get('/health')).rejects.toThrow('porta 3000');
    localStorage.setItem('api_port', '3002');
    await expect(api.get('/samples')).rejects.toThrow('porta 3002');
    expect(fetchWithRequestId).not.toHaveBeenCalled();
  });
});
