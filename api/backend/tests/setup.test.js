const { beforeEach, afterEach, vi } = require('vitest');

// Export vi to globalThis so factories can access it
globalThis.vi = vi;

const ORIGINAL_ENV = { ...process.env };

process.env.CONSENT_SECRET = process.env.CONSENT_SECRET || 'test-consent-secret';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';
process.env.NODE_ENV = 'test';

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.env.CONSENT_SECRET = process.env.CONSENT_SECRET || 'test-consent-secret';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';
  process.env.NODE_ENV = 'test';
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});
