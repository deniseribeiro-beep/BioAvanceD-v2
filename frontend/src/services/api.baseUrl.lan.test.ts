/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url": "http://lab.biobank.lan:8080/"}
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// #1337: opened from another machine on the network, the client keeps the
// page's protocol and host and swaps in the API port, never the page's own.
async function baseUrl(): Promise<string | undefined> {
  vi.resetModules();
  const mod = await import('./api');
  return mod.default.defaults.baseURL;
}

// The first import transforms api.ts and axios; done here, under the hook
// timeout, so no case pays for it inside its own.
beforeAll(async () => {
  await import('./api');
});

beforeEach(() => {
  localStorage.clear();
  vi.stubEnv('VITE_API_BASE_URL', '');
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('API base URL on a LAN hostname', () => {
  it('keeps the page host and uses port 3000', async () => {
    expect(window.location.host).toBe('lab.biobank.lan:8080');
    expect(await baseUrl()).toBe('http://lab.biobank.lan:3000/api');
  });

  it('uses a saved api_port on that host', async () => {
    localStorage.setItem('api_port', '3002');
    expect(await baseUrl()).toBe('http://lab.biobank.lan:3002/api');
  });

  it('ignores a saved api_port equal to the page port and resets it to 3000', async () => {
    localStorage.setItem('api_port', '8080');
    expect(await baseUrl()).toBe('http://lab.biobank.lan:3000/api');
    expect(localStorage.getItem('api_port')).toBe('3000');
  });
});
