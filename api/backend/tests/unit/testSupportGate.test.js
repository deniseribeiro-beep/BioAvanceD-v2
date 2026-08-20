import { describe, it, expect, afterEach } from 'vitest';

const { testSupportRoutesEnabled, requireTestSupportSecret } = require('../../src/utils/testSupportGate');

describe('testSupportGate.testSupportRoutesEnabled (#675)', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalFlag = process.env.ENABLE_TEST_SUPPORT_ROUTES;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.ENABLE_TEST_SUPPORT_ROUTES = originalFlag;
  });

  it('returns true when NODE_ENV is not production and the flag is explicitly "true"', () => {
    process.env.NODE_ENV = 'test';
    process.env.ENABLE_TEST_SUPPORT_ROUTES = 'true';
    expect(testSupportRoutesEnabled()).toBe(true);
  });

  it('returns false when NODE_ENV is production, even with the flag set', () => {
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_TEST_SUPPORT_ROUTES = 'true';
    expect(testSupportRoutesEnabled()).toBe(false);
  });

  it('returns false when the flag is unset, even outside production', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.ENABLE_TEST_SUPPORT_ROUTES;
    expect(testSupportRoutesEnabled()).toBe(false);
  });

  it('returns false when the flag is any value other than the literal string "true"', () => {
    process.env.NODE_ENV = 'test';
    process.env.ENABLE_TEST_SUPPORT_ROUTES = 'yes';
    expect(testSupportRoutesEnabled()).toBe(false);
  });

  it('returns false when both conditions fail', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ENABLE_TEST_SUPPORT_ROUTES;
    expect(testSupportRoutesEnabled()).toBe(false);
  });
});

describe('testSupportGate.requireTestSupportSecret (#675)', () => {
  const originalSecret = process.env.TEST_SUPPORT_SECRET;

  afterEach(() => {
    process.env.TEST_SUPPORT_SECRET = originalSecret;
  });

  function createRes() {
    const res = {};
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
    res.json = (body) => {
      res.body = body;
      return res;
    };
    return res;
  }

  it('calls next() when the provided header matches the configured secret', () => {
    process.env.TEST_SUPPORT_SECRET = 'real-secret';
    const req = { get: () => 'real-secret' };
    const res = createRes();
    let nextCalled = false;

    requireTestSupportSecret(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBeUndefined();
  });

  it('403s when the header is missing', () => {
    process.env.TEST_SUPPORT_SECRET = 'real-secret';
    const req = { get: () => undefined };
    const res = createRes();

    requireTestSupportSecret(req, res, () => {
      throw new Error('next() should not be called');
    });

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ success: false, error: 'Não autorizado' });
  });

  it('403s when the header does not match the configured secret', () => {
    process.env.TEST_SUPPORT_SECRET = 'real-secret';
    const req = { get: () => 'wrong-secret' };
    const res = createRes();

    requireTestSupportSecret(req, res, () => {
      throw new Error('next() should not be called');
    });

    expect(res.statusCode).toBe(403);
  });

  it('fails closed (403) when TEST_SUPPORT_SECRET is unset, even with a header sent', () => {
    delete process.env.TEST_SUPPORT_SECRET;
    const req = { get: () => 'anything' };
    const res = createRes();

    requireTestSupportSecret(req, res, () => {
      throw new Error('next() should not be called');
    });

    expect(res.statusCode).toBe(403);
  });
});
