/**
 * RNF015 C1 (#1323): every axios call carries an X-Request-Id, so a user's
 * action can be tied to its backend log lines. The backend keeps a value that
 * matches ^[A-Za-z0-9._-]{8,128}$ and echoes it back.
 */
import { AxiosHeaders } from 'axios';

export const REQUEST_ID_HEADER = 'X-Request-Id';

// randomUUID exists only in secure contexts; the app is also served over
// plain http on a LAN hostname, where getRandomValues still exists.
export function newRequestId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function withRequestId<T extends { headers?: unknown }>(config: T): T {
  const headers = config.headers;
  if (headers instanceof AxiosHeaders) {
    if (!headers.has(REQUEST_ID_HEADER)) {
      headers.set(REQUEST_ID_HEADER, newRequestId());
    }
    return config;
  }
  const plain = (headers && typeof headers === 'object' ? headers : {}) as Record<string, unknown>;
  const wanted = REQUEST_ID_HEADER.toLowerCase();
  if (!Object.keys(plain).some((key) => key.toLowerCase() === wanted)) {
    plain[REQUEST_ID_HEADER] = newRequestId();
  }
  (config as { headers?: unknown }).headers = plain;
  return config;
}

// Raw fetch calls carry the id too (#1323): a caller's own X-Request-Id, in
// any letter case, is kept; a Request input keeps its own headers.
export function fetchWithRequestId(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const fromRequest = typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined;
  const headers = new Headers(init.headers ?? fromRequest);
  if (!headers.has(REQUEST_ID_HEADER)) {
    headers.set(REQUEST_ID_HEADER, newRequestId());
  }
  return globalThis.fetch(input, { ...init, headers });
}
