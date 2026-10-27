import { afterEach, describe, expect, it, vi } from 'vitest';
import { AxiosHeaders } from 'axios';
import { REQUEST_ID_HEADER, newRequestId, withRequestId } from './requestId';

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
