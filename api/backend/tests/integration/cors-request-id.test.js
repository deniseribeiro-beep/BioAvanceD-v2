/**
 * RNF015 C1 (#1323): the frontend calls the API cross-origin and sends an
 * X-Request-Id on every axios call. A call with Authorization is preflighted,
 * so the CORS options must allow that header, or the browser refuses every
 * call; and they must expose it, so the browser may read the echoed id.
 */
import { describe, it, expect, afterEach } from 'vitest';
const request = require('supertest');

const appPath = require.resolve('../../app');
const envPath = require.resolve('../../src/config/env');
require('../../app');

const ORIGIN = 'http://localhost:5173';

function loadApp() {
  delete require.cache[appPath];
  delete require.cache[envPath];
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';
  return require('../../app');
}

function headerList(value) {
  return String(value || '')
    .split(',')
    .map((name) => name.trim().toLowerCase());
}

afterEach(() => {
  delete require.cache[appPath];
  delete require.cache[envPath];
});

describe('CORS for X-Request-Id (RNF015 C1)', () => {
  it('#1323 a preflight asking for x-request-id is allowed it', async () => {
    const res = await request(loadApp())
      .options('/api/health')
      .set('Origin', ORIGIN)
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization,x-request-id');

    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(headerList(res.headers['access-control-allow-headers'])).toContain('x-request-id');
  });

  it('#1323 a cross-origin response exposes X-Request-Id', async () => {
    const res = await request(loadApp()).get('/api/health').set('Origin', ORIGIN);

    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(headerList(res.headers['access-control-expose-headers'])).toContain('x-request-id');
    expect(res.headers['x-request-id']).toBeTruthy();
  });
});
