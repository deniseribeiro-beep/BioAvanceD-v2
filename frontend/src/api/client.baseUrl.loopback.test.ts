/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url": "http://127.0.0.1:5173/"}
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Opened on the loopback address, apiClient still calls the API as localhost.
async function baseUrl(): Promise<string | undefined> {
  vi.resetModules();
  const mod = await import('./client');
  return mod.apiClient.defaults.baseURL;
}

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

describe('apiClient base URL on 127.0.0.1', () => {
  it('calls the API on localhost at port 3000', async () => {
    expect(window.location.host).toBe('127.0.0.1:5173');
    expect(await baseUrl()).toBe('http://localhost:3000/api');
  });

  it('keeps a saved api_port', async () => {
    localStorage.setItem('api_port', '3002');
    expect(await baseUrl()).toBe('http://localhost:3002/api');
  });
});
