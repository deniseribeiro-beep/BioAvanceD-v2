import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { flushTimings, installTimingReporter, resetTimingReporterForTests, timingLabel } from './timingReporter';
// The route's own parser, so a posted body is checked against the backend's limits.
import { parseFrontendTimings } from '../../../api/backend/src/infrastructure/metrics/frontendTimings.js';

// RNF001 C4 (#1469): the browser times each API call and posts the timings to
// POST /api/monitoring/frontend-timings, ids replaced in the label.

type Adapter = (config: InternalAxiosRequestConfig) => Promise<unknown>;

const BASE = 'http://localhost:3001/api';

function ok(config: InternalAxiosRequestConfig) {
  return Promise.resolve({ data: {}, status: 200, statusText: 'OK', headers: {}, config, request: {} });
}

function failing(config: InternalAxiosRequestConfig) {
  const error = Object.assign(new Error('Request failed with status code 500'), {
    config,
    response: { status: 500, data: {}, headers: {}, config, statusText: '' },
  });
  return Promise.reject(error);
}

function makeInstance(adapter: Adapter): AxiosInstance {
  const instance = axios.create({ baseURL: BASE });
  instance.defaults.adapter = adapter as any;
  installTimingReporter(instance);
  return instance;
}

const fetchMock = vi.fn();

function postedBodies(): Array<{ timings: Array<{ name: string; ms: number }> }> {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)));
}

beforeEach(() => {
  vi.useFakeTimers();
  resetTimingReporterForTests();
  localStorage.clear();
  localStorage.setItem('token', 'tok-1');
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  resetTimingReporterForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('timingLabel (RNF001 C4)', () => {
  it('replaces a sample code segment with :id', () => {
    expect(timingLabel('get', 'http://localhost:3001/api/samples/BAD-2026-0001')).toBe('GET /api/samples/:id');
  });

  it('drops the query string', () => {
    expect(timingLabel('get', '/api/patients?q=ana')).toBe('GET /api/patients');
  });

  it('keeps a v1 version segment and replaces a numeric id', () => {
    expect(timingLabel('get', '/api/v1/patients/123')).toBe('GET /api/v1/patients/:id');
  });

  it('replaces a segment with an @ with :id', () => {
    expect(timingLabel('post', '/api/users/ana@example.org/reset')).toBe('POST /api/users/:id/reset');
  });
});

describe('installTimingReporter (RNF001 C4)', () => {
  it('times a call through an axios instance and queues its label', async () => {
    const instance = makeInstance(ok);
    await instance.get('/samples/BAD-2026-0001');
    await flushTimings();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [body] = postedBodies();
    expect(body.timings).toHaveLength(1);
    expect(body.timings[0].name).toBe('GET /api/samples/:id');
    expect(body.timings[0].ms).toBeGreaterThanOrEqual(0);
  });

  it('times a rejected call and still rejects', async () => {
    const instance = makeInstance(failing);
    await expect(instance.post('/patients')).rejects.toThrow('status code 500');
    await flushTimings();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(postedBodies()[0].timings).toEqual([{ name: 'POST /api/patients', ms: expect.any(Number) }]);
  });

  it('posts once when 20 timings are queued, and not at 19', async () => {
    const instance = makeInstance(ok);
    for (let i = 0; i < 19; i += 1) {
      await instance.get(`/samples/${i}`);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    await instance.get('/samples/19');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/monitoring/frontend-timings`);
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('Authorization')).toBe('Bearer tok-1');
    const body = JSON.parse(String(init.body));
    expect(body.timings).toHaveLength(20);
    expect(body.timings.every((t: { name: string }) => t.name === 'GET /api/samples/:id')).toBe(true);
  });

  it('posts 3 queued timings after 15 s, and not at 14999 ms', async () => {
    const instance = makeInstance(ok);
    await instance.get('/patients');
    await instance.get('/patients');
    await instance.get('/patients');
    vi.advanceTimersByTime(14999);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(postedBodies()[0].timings).toHaveLength(3);
  });

  it('sends nothing when no token is stored', async () => {
    localStorage.removeItem('token');
    const instance = makeInstance(ok);
    await instance.get('/patients');
    await flushTimings();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('swallows a failing fetch', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    const instance = makeInstance(ok);
    await instance.get('/patients');
    await expect(flushTimings()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('drops a timing over 600000 ms and posts the rest in a body the backend accepts', async () => {
    // Each call moves the clock 10 ms; /samples spans a suspended laptop.
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const instance = makeInstance((config) => {
      clock += config.url === '/samples' ? 700000 : 10;
      return ok(config);
    });
    await instance.get('/patients');
    await instance.get('/samples');
    await instance.get('/storage');
    await flushTimings();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = postedBodies()[0];
    expect(body.timings).toEqual([
      { name: 'GET /api/patients', ms: 10 },
      { name: 'GET /api/storage', ms: 10 },
    ]);
    expect(parseFrontendTimings(body)).toEqual({ ok: true, value: body.timings });
  });

  // The backend's bound is 600000 ms inclusive: a call at it is kept, one past it dropped.
  async function postBoundaryCall(boundaryMs: number) {
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const instance = makeInstance((config) => {
      clock += config.url === '/samples' ? boundaryMs : 10;
      return ok(config);
    });
    await instance.get('/patients');
    await instance.get('/samples');
    await flushTimings();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    return postedBodies()[0];
  }

  it('keeps a timing of exactly 600000 ms in a body the backend accepts', async () => {
    const body = await postBoundaryCall(600000);
    expect(body.timings).toEqual([
      { name: 'GET /api/patients', ms: 10 },
      { name: 'GET /api/samples', ms: 600000 },
    ]);
    expect(parseFrontendTimings(body)).toEqual({ ok: true, value: body.timings });
  });

  it('drops a timing of 600001 ms and posts the rest in a body the backend accepts', async () => {
    const body = await postBoundaryCall(600001);
    expect(body.timings).toEqual([{ name: 'GET /api/patients', ms: 10 }]);
    expect(parseFrontendTimings(body)).toEqual({ ok: true, value: body.timings });
  });
});
