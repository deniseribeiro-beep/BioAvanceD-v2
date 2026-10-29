const { buildLookupIndex } = require('./lookupIndex');

/**
 * #1005: the `sessions` lookup indexes. Before this the collection had none
 * at all, so every authenticated request's `verifySession` lookup by
 * `tokenHash` was a collection scan over every session ever written.
 *
 * ## Every index here is a planner decision, not a reading of the queries
 *
 * Measured on mongo:7 with 50000 sessions over 500 users (80% revoked, as a
 * long-lived stack accumulates), candidates built side by side and each query
 * shape's winning plan read from `explain('executionStats')` (#1088's method):
 *
 * - `{accessTokenHash:1}`, `{sessionId:1}`, `{refreshTokenHash:1}`: the
 *   per-request and per-refresh lookups in `session.service.js`. 1 document
 *   examined each.
 * - `{userAccountId:1, isActive:1}`: `listUserSessions`, `getSessions` and
 *   `invalidateUserSessions`. It beat `{userAccountId:1, lastActivityAt:-1}`
 *   for the self-service list, so that candidate is not built.
 * - `{sessionStartedAt:-1}`: the audit list's default order, its date range,
 *   and its `isRevoked` filter (62 examined per 50 returned, so an
 *   `isRevoked`-led index earns nothing and is not built).
 * - `{userAccountId:1, sessionStartedAt:-1}`: the audit list filtered to one
 *   user.
 * - `{revocationReason:1, sessionStartedAt:-1}`: the audit list filtered by
 *   reason. A rare reason (`risk`) is read exactly (41 examined, 41 returned)
 *   where `{sessionStartedAt:-1}` alone walks the whole index to find it.
 *
 * Deliberately unserved: `sortBy=revokedAt` under a reason filter sorts that
 * reason's rows in memory. It stays allowed because the result is correct,
 * and `sessionStartedAt` stays the default.
 *
 * `lastActivityAt` is written on every request, so no index leads with it: each
 * one would add a write to the hottest path for a sort nothing defaults to.
 *
 * ## Ensured at the read path
 *
 * Same posture as `facilityIndexes.js` (#941, #1163): best-effort, un-awaited,
 * one latch per collection, a failure logs and the queries stay correct.
 * `session.service.js` ensures it where it reads.
 */

// Keyed by collection NAME, as in facilityIndexes.js: `db.collection()`
// returns a fresh handle per call, so a latch on the handle never hits.
const sessionsIndexed = new Set();

// #1330, #1386: documents are stored under the dict-02 names (sessionId,
// userAccountId, accessTokenHash, sessionStartedAt) and read under them only,
// so every index is keyed by a canonical name. The legacy-keyed indexes are no
// longer built; one already built on a stack is not dropped here (there is no
// deployed database). None of these is unique or TTL: expiry is the
// isActive/expiresAt check and the maintenance sweep, not an index.
const SESSION_LOOKUP_INDEXES = [
  [{ accessTokenHash: 1 }, 'sessions_accessTokenHash_v1'],
  [{ refreshTokenHash: 1 }, 'sessions_refreshTokenHash_v1'],
  [{ sessionId: 1 }, 'sessions_sessionId_v1'],
  [{ userAccountId: 1, isActive: 1 }, 'sessions_userAccountId_isActive_v1'],
  [{ userAccountId: 1, sessionStartedAt: -1 }, 'sessions_userAccountId_sessionStartedAt_v1'],
  [{ sessionStartedAt: -1 }, 'sessions_sessionStartedAt_v1'],
  [{ revocationReason: 1, sessionStartedAt: -1 }, 'sessions_revocationReason_sessionStartedAt_v1'],
];

async function ensureSessionIndexes(collection) {
  if (!collection || typeof collection.createIndex !== 'function') return;
  const name = collection.collectionName;
  if (sessionsIndexed.has(name)) return;
  sessionsIndexed.add(name);
  for (const [keys, name] of SESSION_LOOKUP_INDEXES) {
    await buildLookupIndex(collection, keys, name, 'SESSIONS');
  }
}

module.exports = { ensureSessionIndexes, SESSION_LOOKUP_INDEXES };
