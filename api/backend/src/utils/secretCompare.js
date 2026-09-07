const crypto = require('crypto');

// #1067: the one place either machine-credential gate compares a
// caller-supplied secret to the configured one.
//
// Both utils/machineIngestGate.js and utils/testSupportGate.js used a plain
// `!==`, which short-circuits at the first differing byte, so the comparison
// time varies with how many leading bytes match. #1067 filed the pair as a
// single decision rather than hardening one and creating a divergence nothing
// records; direction 1 -- one shared helper, so neither gate owns the
// comparison and neither can drift -- is the one taken.
//
// Why hash both sides instead of comparing buffers directly. The obvious
// `crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))` THROWS on unequal
// lengths, so it needs a length guard -- and that guard leaks the secret's
// length, which is most of what an attacker wants from a hand-typed secret.
// Hashing first makes both operands a constant 32 bytes, so there is no length
// branch and no early return.
//
// This is deliberately NOT the shape of services/mqtt-signature.service.js:30,
// which does guard on length before timingSafeEqual. That is correct there and
// wrong here: it compares two sha256 HEX DIGESTS, which are fixed-length by
// construction, so its length check can only ever leak a malformed input. The
// two secrets this file compares are hand-typed -- neither is minted by
// scripts/generate-env-docker-secrets.sh, and both ship blank in every tracked
// template -- which is exactly the case where a byte-at-a-time oracle stops
// being theoretical.
//
// The unset-secret branch stays an early return, and that is intentional. It
// reproduces the fail-closed property #675 established and #1054 carried over
// ("an unset secret must never be treated as no auth required"), and the timing
// it exposes reveals only whether the deployment configured machine ingest at
// all -- a stack-wide constant, not per-attempt secret material, and already
// observable from the route 403ing on every request regardless of header.
function constantTimeSecretEquals(provided, expected) {
  const expectedValue = String(expected == null ? '' : expected);
  if (!expectedValue) return false;

  const providedValue = String(provided == null ? '' : provided);
  const digest = (value) => crypto.createHash('sha256').update(value, 'utf8').digest();

  return crypto.timingSafeEqual(digest(providedValue), digest(expectedValue));
}

module.exports = { constantTimeSecretEquals };
