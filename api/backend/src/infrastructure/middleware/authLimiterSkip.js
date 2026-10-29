/**
 * #1253: the /api/auth routes the strict brute-force budget (authLimiter,
 * app.js) does not count. That budget exists for routes that verify a secret.
 * GET /password-policy verifies none: it serves the public strength rules, and
 * the login page fetches it on every load, so counting it spent one of a
 * user's ten login attempts per minute on each visit. The global limiter
 * still covers it.
 *
 * `req.path` is relative to the /api/auth mount here.
 */
const EXEMPT = new Set(['GET /password-policy']);

function skipAuthBudget(req) {
  return EXEMPT.has(`${req.method} ${req.path}`);
}

module.exports = { skipAuthBudget };
