import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// #1337: where the shared client points, decided once at import from
// VITE_API_BASE_URL, else from the page's host and a saved api_port.
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
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('API base URL', () => {
  it('uses VITE_API_BASE_URL as given when it already ends in /api', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://lims.example.org/api');
    expect(await baseUrl()).toBe('https://lims.example.org/api');
  });

  it('appends /api to a VITE_API_BASE_URL that lacks it', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://lims.example.org');
    expect(await baseUrl()).toBe('https://lims.example.org/api');
  });

  describe('with no VITE_API_BASE_URL, on localhost', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_API_BASE_URL', '');
    });

    it('defaults to port 3000', async () => {
      expect(await baseUrl()).toBe('http://localhost:3000/api');
    });

    it('uses a saved numeric api_port', async () => {
      localStorage.setItem('api_port', '3004');
      expect(await baseUrl()).toBe('http://localhost:3004/api');
      expect(localStorage.getItem('api_port')).toBe('3004');
    });

    it('drops a non-numeric api_port and saves 3000 in its place', async () => {
      localStorage.setItem('api_port', 'abc');
      expect(await baseUrl()).toBe('http://localhost:3000/api');
      expect(localStorage.getItem('api_port')).toBe('3000');
    });

    it('ignores a saved api_port equal to the page\'s own port, 3000 here, and leaves it saved', async () => {
      expect(window.location.port).toBe('3000');
      localStorage.setItem('api_port', '3000');
      expect(await baseUrl()).toBe('http://localhost:3000/api');
      expect(localStorage.getItem('api_port')).toBe('3000');
    });
  });
});
