# 2026-10-16: a one-off migration moves users and sessions off their legacy names

Dictionary: UserAccount, P1X-0182..0208, and Session, P1X-0251..0267 (Dicionário de Dados v2.0.0). Issue #1330. Follows `2026-10-11-user-account-names.md` and `2026-10-11-session-names.md`, whose "Not decided here" each leave this move to a one-off migration.

## Decided

1. **`npm run migrate:auth-canonical-names` (`src/scripts/migrateAuthCanonicalNames.js`) moves every `users` and `sessions` document that still carries a legacy name** to the canonical names. Live writes already move a document they rewrite; this covers the ones no write reaches: a dormant user, a revoked or expired session. `--dry-run` counts and writes nothing.
2. **A user follows `storedValueOf`'s null rule.** Only an absent canonical name falls back, so a legacy value is moved only where the canonical name is absent (`UserModel.canonicalMoveOf`), and a canonical `null` stays `null`. A legacy name beside a canonical one that is present, `null` included, is never read, and the migration removes it.
3. **A session follows its accessors' null rule.** They use `??`, so a canonical name that is `null` or absent falls back. A legacy value is moved where the canonical name is `null` or absent (`SessionModel.canonicalMoveOf`): `sessionId: null` beside `sessionID: 'x'` becomes `sessionId: 'x'`. A legacy name beside a canonical value that is set is only removed.
4. **Each move is one guarded `updateOne`.** Its filter requires each moved field to be still absent (a user) or null or absent (a session) under its canonical name, and present under its legacy one. Every live writer sets the canonical name and `$unset`s the legacy one, so a document written since the migration read it fails the filter and the whole move is skipped. It is counted as `raced` and left for the next run, which reads it afresh; it is not retried within the run.
5. **The summary is the evidence.** It reports, per collection, the documents `scanned`, `moved` and `raced`, and `remaining`: a count, after the pass, of the documents still carrying any legacy name. A second run on a quiet database finds nothing and reports `remaining` 0.
6. **The read fallbacks are removed (#1386).** The accessors of `UserModel` and `SessionModel` read the canonical name only; the session `$or` filters (`idFilter`, `ownerFilter`, `accessTokenHashFilter`, `notAccessTokenHash`), `accountStatusFilter`'s legacy branch, the legacy sorts and `$ifNull`s in `session.service.js` and the legacy-keyed indexes in `utils/sessionIndexes.js` are gone. The condition below held: there is no deployed database (Dennis, 2026-10-21), and on the only database, the Docker test stack, this migration reported `remaining` 0 for both `users` and `sessions` on 2026-10-21. The migration script stays, for a database restored from older data, and writes still `$unset` the legacy names. Items 2 and 3 now describe only what the migration moves; no reader falls back.

## Not decided here

- **`recovery_codes` legacy sets** (`2026-10-07-recovery-code-set-names.md`) are not covered by this migration.
- **The older `lastPasswordChange` name** on `users` (now `passwordChangedAt`, #1251) is not in `UserModel.RENAMED`, so this migration does not move it; `password.service.js` still reads it as a fallback.
