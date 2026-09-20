import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const MODULE_PATH = require.resolve('../../src/config/env');

const originalEnv = { ...process.env };

function loadEnv(overrides = {}, deletes = []) {
  process.env = { ...originalEnv, ...overrides };
  for (const key of deletes) delete process.env[key];
  delete require.cache[MODULE_PATH];
  return require(MODULE_PATH);
}

afterEach(() => {
  process.env = { ...originalEnv };
  delete require.cache[MODULE_PATH];
});

describe('config/env item 8 residual branches', () => {
  it('falls back to development and accepts TEST_ENVIRONMENT=1', () => {
    const env = loadEnv(
      { TEST_ENVIRONMENT: '1' },
      ['NODE_ENV']
    );

    expect(env.NODE_ENV).toBe('development');
    expect(env.TEST_ENVIRONMENT).toBe(true);
  });

  it('uses documented graph-outbox defaults when explicit overrides are absent', () => {
    const env = loadEnv({}, [
      'GRAPH_OUTBOX_BATCH_SIZE',
      'GRAPH_OUTBOX_MAX_ATTEMPTS',
      'GRAPH_OUTBOX_LEASE_MS',
      'GRAPH_OUTBOX_RETRY_BACKOFF_MS',
    ]);

    expect(env.GRAPH_OUTBOX_BATCH_SIZE).toBe(100);
    expect(env.GRAPH_OUTBOX_MAX_ATTEMPTS).toBe(8);
    expect(env.GRAPH_OUTBOX_LEASE_MS).toBe(5 * 60 * 1000);
    expect(env.GRAPH_OUTBOX_RETRY_BACKOFF_MS).toBe(1000);
  });

  it('parses explicit graph-outbox numeric overrides', () => {
    const env = loadEnv({
      GRAPH_OUTBOX_BATCH_SIZE: '25',
      GRAPH_OUTBOX_MAX_ATTEMPTS: '4',
      GRAPH_OUTBOX_LEASE_MS: '45000',
      GRAPH_OUTBOX_RETRY_BACKOFF_MS: '750',
    });

    expect(env.GRAPH_OUTBOX_BATCH_SIZE).toBe(25);
    expect(env.GRAPH_OUTBOX_MAX_ATTEMPTS).toBe(4);
    expect(env.GRAPH_OUTBOX_LEASE_MS).toBe(45000);
    expect(env.GRAPH_OUTBOX_RETRY_BACKOFF_MS).toBe(750);
  });
});
