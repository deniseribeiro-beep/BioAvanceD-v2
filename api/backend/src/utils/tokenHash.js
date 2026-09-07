const crypto = require('crypto');

/**
 * #1078: the one sha256 token-hashing primitive, extracted from
 * session.service.js so the password-reset writers can share it rather than
 * grow a third copy.
 *
 * It was already duplicated twice before this file existed: session.service's
 * own module-scope copy, and a hand-copied re-implementation in
 * tests/unit/user-security.service.db.unit.test.js -- the second being
 * standing evidence that the last person who needed it could not import it,
 * because session.service exports an instance and never attached this.
 *
 * dict-02 sanctions the algorithm explicitly: P1X-0207's Formato column reads
 * "SHA-256/bcrypt conforme uso". sha256 is right for a token -- it is a
 * high-entropy value, not a password, so there is nothing for a slow KDF to
 * defend against and Session.tokenHash already made that call (P1X-0253).
 *
 * The `String(token || '')` coercion is load-bearing and fail-closed: a null,
 * undefined or empty input hashes to the digest of the empty string rather
 * than throwing, so a caller comparing against a stored digest gets a
 * mismatch instead of an exception. auth.controller.js:447-449 documents that
 * property at the session call site.
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

module.exports = { hashToken };
