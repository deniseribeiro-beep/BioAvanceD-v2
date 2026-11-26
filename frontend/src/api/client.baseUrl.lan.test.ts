/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url": "http://lab.biobank.lan:8080/"}
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Opened from another machine on the network, apiClient keeps the page's
// protocol and host and swaps in the API port, never the page's own.
async function baseUrl(): Promise<string | undefined> {
  vi.resetModules();
  const mod = await import('./client');
  return mod.apiClient.defaults.baseURL;
}

// The first import transforms client.ts and axios; done here, under the hook
// timeout, so no case pays for it inside its own.
beforeAll(async () => {
  await import('./client');
});

beforeEach(() => {
  localStorage.clear();
  vi.stubEnv('VITE_API_BASE_URL', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('apiClient base URL on a LAN hostname', () => {
  it('keeps the page host and uses port 3000', async () => {
    expect(window.location.host).toBe('lab.biobank.lan:8080');
    expect(await baseUrl()).toBe('http://lab.biobank.lan:3000/api');
  });

  it('uses a saved api_port on that host', async () => {
    localStorage.setItem('api_port', '3002');
    expect(await baseUrl()).toBe('http://lab.biobank.lan:3002/api');
  });

  it('ignores a saved api_port equal to the page port', async () => {
    localStorage.setItem('api_port', '8080');
    expect(await baseUrl()).toBe('http://lab.biobank.lan:3000/api');
  });
});
