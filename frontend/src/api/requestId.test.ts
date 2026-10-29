import { afterEach, describe, expect, it, vi } from 'vitest';
import { AxiosHeaders } from 'axios';
import { REQUEST_ID_HEADER, fetchWithRequestId, newRequestId, withRequestId } from './requestId';

// The backend keeps a caller's X-Request-Id only when it matches this.
const WELL_FORMED = /^[A-Za-z0-9._-]{8,128}$/;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('newRequestId (RNF015 C1)', () => {
  it('#1323 returns an id the backend keeps, and two calls differ', () => {
    const first = newRequestId();
    const second = newRequestId();
    expect(first).toMatch(WELL_FORMED);
    expect(second).toMatch(WELL_FORMED);
    expect(first).not.toBe(second);
  });

  it('#1323 returns 32 hex characters where randomUUID is missing', () => {
    const realCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', {
      getRandomValues: (array: Uint8Array) => realCrypto.getRandomValues(array),
    });
    const id = newRequestId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(id).toMatch(WELL_FORMED);
  });
});

describe('withRequestId (RNF015 C1)', () => {
  it('#1323 sets the header on a plain headers object', () => {
    const config = withRequestId({ headers: {} as Record<string, unknown> });
    expect(config.headers[REQUEST_ID_HEADER]).toMatch(WELL_FORMED);
  });

  it('#1323 creates headers on a config without them', () => {
    const config = withRequestId({} as { headers?: Record<string, unknown> });
    expect(config.headers?.[REQUEST_ID_HEADER]).toMatch(WELL_FORMED);
  });

  it('#1323 sets the header on an AxiosHeaders instance', () => {
    const headers = new AxiosHeaders();
    withRequestId({ headers });
    expect(headers.get(REQUEST_ID_HEADER)).toEqual(expect.stringMatching(WELL_FORMED));
  });

  it('#1323 keeps a caller id set in another letter case on a plain object', () => {
    const config = withRequestId({ headers: { 'x-request-id': 'caller-0001' } as Record<string, unknown> });
    expect(config.headers).toEqual({ 'x-request-id': 'caller-0001' });
  });

  it('#1323 keeps a caller id set through AxiosHeaders.set', () => {
    const headers = new AxiosHeaders();
    headers.set('X-Request-Id', 'caller-0002');
    withRequestId({ headers });
    expect(headers.get('x-request-id')).toBe('caller-0002');
  });
});

describe('fetchWithRequestId (RNF015 C1)', () => {
  const stubFetch = () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  it('#1323 fetchWithRequestId sends a well-formed id on a call without headers', async () => {
    const fetchMock = stubFetch();
    await fetchWithRequestId('/api/x');
    const sent = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(sent.get(REQUEST_ID_HEADER)).toMatch(WELL_FORMED);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/x');
  });

  it('#1323 fetchWithRequestId keeps a caller id set in another letter case', async () => {
    const fetchMock = stubFetch();
    await fetchWithRequestId('/api/x', { headers: { 'x-request-id': 'caller-0003' } });
    const sent = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(sent.get('X-Request-Id')).toBe('caller-0003');
  });

  it('#1323 fetchWithRequestId keeps the caller headers and body', async () => {
    const fetchMock = stubFetch();
    await fetchWithRequestId('/api/x', { method: 'POST', headers: { Authorization: 'Bearer t' }, body: 'b' });
    const init = fetchMock.mock.calls[0][1];
    const sent = new Headers(init?.headers);
    expect(sent.get('authorization')).toBe('Bearer t');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('b');
    expect(sent.get(REQUEST_ID_HEADER)).toMatch(WELL_FORMED);
  });

  it('#1323 fetchWithRequestId keeps the headers of a Request input', async () => {
    const fetchMock = stubFetch();
    await fetchWithRequestId(new Request('http://localhost/api/x', { headers: { 'X-Custom': 'v' } }));
    const sent = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(sent.get('x-custom')).toBe('v');
    expect(sent.get(REQUEST_ID_HEADER)).toMatch(WELL_FORMED);
  });

  it('#1323 fetchWithRequestId adds no Content-Type to a FormData body', async () => {
    const fetchMock = stubFetch();
    const body = new FormData();
    body.append('a', '1');
    await fetchWithRequestId('/api/x', { method: 'POST', body });
    const init = fetchMock.mock.calls[0][1];
    const sent = new Headers(init?.headers);
    expect(sent.has('content-type')).toBe(false);
    expect(init?.body).toBe(body);
  });
});
