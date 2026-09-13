import { describe, it, expect } from 'vitest';

const { constantTimeSecretEquals } = require('../../src/utils/secretCompare');

// #1067: the shared constant-time comparison both machine-credential gates
// call. These cases pin the two properties the gates depend on -- fail-closed
// on an unset secret, and no length branch -- rather than re-testing either
// gate's HTTP behaviour, which its own file already covers.
describe('secretCompare.constantTimeSecretEquals (#1067)', () => {
  it('is true only for an exact match', () => {
    expect(constantTimeSecretEquals('machine-secret-1', 'machine-secret-1')).toBe(true);
  });

  it('is false for a same-length mismatch', () => {
    expect(constantTimeSecretEquals('machine-secret-2', 'machine-secret-1')).toBe(false);
  });

  // The load-bearing case for the hash-first design. A naive
  // timingSafeEqual(Buffer.from(a), Buffer.from(b)) THROWS on unequal lengths,
  // so a helper that compared raw buffers would need a length guard -- and that
  // guard is the length oracle this helper exists to avoid. If this assertion
  // ever has to be relaxed to a rejects/throws, the design regressed.
  it('is false -- not a throw -- for a different-length mismatch, in both directions', () => {
    expect(constantTimeSecretEquals('short', 'a-much-longer-configured-secret')).toBe(false);
    expect(constantTimeSecretEquals('a-much-longer-provided-value', 'short')).toBe(false);
  });

  it('is false for an empty provided value against a real secret', () => {
    expect(constantTimeSecretEquals('', 'machine-secret-1')).toBe(false);
  });

  // Fail-closed: #675's rule, carried over by #1054. An unset secret must never
  // be treated as "no auth required", so nothing matches it -- including the
  // empty string and the absent header that would otherwise compare equal to it.
  it('is false when the configured secret is unset, whatever is provided', () => {
    for (const expected of [undefined, null, '']) {
      expect(constantTimeSecretEquals('anything', expected)).toBe(false);
      expect(constantTimeSecretEquals('', expected)).toBe(false);
      expect(constantTimeSecretEquals(undefined, expected)).toBe(false);
    }
  });

  it('is false when no value was provided at all', () => {
    expect(constantTimeSecretEquals(undefined, 'machine-secret-1')).toBe(false);
    expect(constantTimeSecretEquals(null, 'machine-secret-1')).toBe(false);
  });

  it('does not throw on a hostile oversized provided value', () => {
    expect(() => constantTimeSecretEquals('x'.repeat(100000), 'machine-secret-1')).not.toThrow();
    expect(constantTimeSecretEquals('x'.repeat(100000), 'machine-secret-1')).toBe(false);
  });
});
