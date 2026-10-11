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
 * - `{tokenHash:1}`, `{sessionID:1}`, `{refreshTokenHash:1}`: the per-request
 *   and per-refresh lookups in `session.service.js`. 1 document examined each.
 * - `{userID:1, isActive:1}`: `listUserSessions`, `getSessions` and
 *   `invalidateUserSessions`. It beat `{userID:1, lastActivity:-1}` for the
 *   self-service list, so that candidate is not built.
 * - `{createdAt:-1}`: the audit list's default order, its date range, and its
 *   `isRevoked` filter (62 examined per 50 returned, so an `isRevoked`-led
 *   index earns nothing and is not built).
 * - `{userID:1, createdAt:-1}`: the audit list filtered to one user.
 * - `{revocationReason:1, createdAt:-1}`: the audit list filtered by reason.
 *   A rare reason (`risk`) is read exactly (41 examined, 41 returned) where
 *   `{createdAt:-1}` alone walks the whole index to find it.
 *
 * Deliberately unserved: `sortBy=revokedAt` under a reason filter sorts that
 * reason's rows in memory. It stays allowed because the result is correct,
 * and `createdAt` stays the default.
 *
 * `lastActivity` is written on every request, so no index leads with it: each
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

// #1330: documents are written under the dict-02 names (sessionId,
// userAccountId, accessTokenHash, sessionStartedAt), and readers match either
// name with an $or. MongoDB serves an $or from indexes only when every branch
// has one, so each index on a renamed field has a canonical twin and the
// legacy index stays for the documents written before the rename. None of
// these is unique or TTL: expiry is the isActive/expiresAt check and the
// maintenance sweep, not an index.
//
// The default audit order is { sessionStartedAt: -1, createdAt: -1 } (the
// legacy name as the second key), so the canonical start index carries both
// keys and serves that sort as written.
const SESSION_LOOKUP_INDEXES = [
  [{ tokenHash: 1 }, 'sessions_tokenHash_v1'],
  [{ accessTokenHash: 1 }, 'sessions_accessTokenHash_v1'],
  [{ refreshTokenHash: 1 }, 'sessions_refreshTokenHash_v1'],
  [{ sessionID: 1 }, 'sessions_sessionID_v1'],
  [{ sessionId: 1 }, 'sessions_sessionId_v1'],
  [{ userID: 1, isActive: 1 }, 'sessions_userID_isActive_v1'],
  [{ userAccountId: 1, isActive: 1 }, 'sessions_userAccountId_isActive_v1'],
  [{ userID: 1, createdAt: -1 }, 'sessions_userID_createdAt_v1'],
  [{ userAccountId: 1, sessionStartedAt: -1 }, 'sessions_userAccountId_sessionStartedAt_v1'],
  [{ createdAt: -1 }, 'sessions_createdAt_v1'],
  [{ sessionStartedAt: -1, createdAt: -1 }, 'sessions_sessionStartedAt_createdAt_v1'],
  [{ revocationReason: 1, createdAt: -1 }, 'sessions_revocationReason_createdAt_v1'],
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
