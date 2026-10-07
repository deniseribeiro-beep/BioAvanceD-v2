const crypto = require('crypto');

/**
 * #1049: the consent-link credential is stored only as a hash.
 *
 * `consentToken` is the sole credential for the deliberately-unauthenticated
 * POST /api/e-consent/consent-tokens/{validate,accept}, and it used to sit in
 * plaintext on the Patient document, so anyone with database access, a backup
 * or a dump held every pending participant's credential. Patients now carry
 * `consentTokenHash` instead; the plaintext exists only in memory between
 * mint and the link that is emailed.
 *
 * A plain SHA-256 is enough here, with no salt and no slow KDF: the token is
 * 32 random bytes (NotificationService#generateConsentToken), so there is no
 * dictionary to precompute and no guessable space to brute-force. A slow hash
 * protects low-entropy secrets such as passwords, which this is not.
 */
function hashConsentToken(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

/**
 * Constant-time comparison of a presented token against a stored hash. The
 * old check was a plain `!==` on an unauthenticated endpoint. Both sides are
 * hashed to the same fixed length first, so `timingSafeEqual` never sees
 * buffers of different sizes and the comparison does not leak the length.
 */
function consentTokenMatches(storedHash, presentedToken) {
  if (typeof storedHash !== 'string' || storedHash.length === 0) return false;
  if (presentedToken === undefined || presentedToken === null || presentedToken === '') return false;

  const expected = Buffer.from(storedHash, 'utf8');
  const actual = Buffer.from(hashConsentToken(presentedToken), 'utf8');
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

module.exports = { hashConsentToken, consentTokenMatches };
