# 2026-10-11: sessions use their dictionary names

Dictionary: Session, P1X-0251..0267 (Dicionário de Dados v2.0.0). Requirement: RNF021, "Ciclo de vida seguro de sessões e tokens", Requisitos v4.0.0. Issue #1330 (its Session line).

## Decided

1. **`sessions` documents are written under the canonical names:** `sessionId`, `userAccountId`, `accessTokenHash`, `lastActivityAt`, `sessionStartedAt` and `inactivityTimeoutMs` (`models/Session.js`). A new document carries none of the old names (`sessionID`, `userID`, `tokenHash`, `lastActivity`, `createdAt`, `inactiveTimeout`).
2. **Readers fall back to the old names** for a document written before them. `models/Session.js` holds one accessor per renamed field (canonical first, then legacy) and the filters that match either name with an `$or`: by id, by owner and by access-token hash. Every reader and query in `session.service.js`, `user-security.service.js` and the refresh, logout and session-revocation routes goes through them, so a session opened before the change still authenticates, refreshes, expires, lists and revokes.
3. **A rewrite moves a document to the canonical names in place.** The activity write (`updateActivity`) sets `lastActivityAt` and the four identity fields (`sessionId`, `userAccountId`, `sessionStartedAt`, `inactivityTimeoutMs`) and `$unset`s their old names. Token rotation does the same and also moves `tokenHash` to `accessTokenHash`, so after its next refresh a session carries no old name. This follows the RecoveryCodeSet rename (`2026-10-07-recovery-code-set-names.md`): writers use the canonical name, and readers fall back.
4. **The API keeps its response keys.** `GET /api/auth/sessions` still returns `id`, `lastAccess` and `createdAt`; the audit list still returns `createdAt` and `lastActivity` and still takes `sortBy=createdAt|lastActivity|revokedAt`; keepalive still returns `data.lastActivity`; the internal sign-in bundle and the refresh token's claim keep `sessionID`. Only the stored names they are read from changed, so the frontend is unchanged.

## Chosen where the sources leave a gap

- **The activity write does not move `tokenHash`.** It may run on a cached copy of the session, and another process may have rotated the token since. The identity fields never change after a session starts, so any copy carries the right values; the token hash does change. Rotation computes the new hash itself, so it is where `tokenHash` is renamed.
- **No value is invented.** A document that never had `inactiveTimeout` does not gain a null `inactivityTimeoutMs`. Such a session keeps the behaviour it had: no per-session inactivity limit on the request path, and the maintenance sweep's 30-minute default.
- **Ordering across the change.** A sort on the start or on the last activity uses the canonical name, then the legacy one, as two keys. A document carries one of the two, and a legacy-only document sorts as missing on the first key, so it falls below every canonical one. For last activity this order is exact: any activity since the change wrote `lastActivityAt`, so a legacy-only document's last activity predates every canonical one. For the start it is exact except for sessions that were open at the change and were rewritten afterwards: they keep their pre-change start in `sessionStartedAt` and sort among the canonical documents, above legacy-only documents that started after them. The window is bounded by the longest session (`maxSessionDurationHours`, at most 24 hours). The date-range filter is exact, since it matches `sessionStartedAt` or `createdAt`.

## Indexes

None of the `sessions` indexes is unique or TTL. Expiry is the `isActive`/`expiresAt`/inactivity check on each request and the maintenance sweep, so no index has to keep legacy documents expiring.

MongoDB serves an `$or` from indexes only when every branch has one. So each index on a renamed field gained a canonical twin, and the legacy index stays for the documents written before the change (`utils/sessionIndexes.js`): `accessTokenHash`, `sessionId`, `userAccountId + isActive`, `userAccountId + sessionStartedAt`, `revocationReason + sessionStartedAt`, and `sessionStartedAt + createdAt`, which serves the audit list's default two-key order as written. The planner measurements of #1005 were made on the legacy names and were not repeated for the twins.

## Not decided here

- **`updatedAt`.** Every session write sets it (#974), and Session has no dictionary row for it, so the conformance guard still records it as an extra under #1330. Whether to stop writing it, as RecoveryCodeSet did, or to keep it as a deliberate local extension is open: a reader outside this repo may use it.
- **Removing the legacy fallback and the legacy indexes.** Both can go once no stored document carries an old name. Nothing converts a revoked or expired session, so this needs a one-off migration or a retention decision on old session rows.
