# 2026-10-11: user accounts use their dictionary names

Dictionary: UserAccount, P1X-0182..0208 (Dicionário de Dados v2.0.0). Requirements: RF001 "Segurança e autenticação", RF003 "Gestão de usuários" and RNF020 "Proteção criptográfica e gestão de segredos", Requisitos v4.0.0. Issue #1330 (its UserAccount line).

## Decided

1. **`users` documents are written under the canonical names:** `displayName` (was `name`), `passwordHash` (`password`), `accountStatus` (`status`), `mfaSetupAt` (`mfaActivationDate`), `lastLoginAt` (`lastLogin`), `passwordHistoryHashes` (`passwordHistory`), `forcePasswordReset` (`forceReset`) and `passwordResetExpiresAt` (`passwordResetExpires`). `models/User.js` holds the map (`RENAMED`). A new document, from registration or from the first-admin bootstrap, carries none of the old names. `fieldsOf` also declares `passwordResetTokenHash` and `passwordResetExpiresAt`, which the reset request writes, as null on a new document.
2. **Readers fall back to the old names** for a document written before them. `models/User.js` holds one accessor per renamed field (canonical first, then legacy; only an absent canonical name falls back, so a canonical null stays null) and `accountStatusFilter`, which matches a status under `accountStatus`, or under `status` on a document that has no `accountStatus`. Every reader goes through them: sign-in and the two first-login endpoints, the MFA enrolment, the token reset, both password-change routes, the administrator's set-password, the refresh route, the authenticate middleware's status check, the incident and IoT alert recipient queries, and the import worker's actor name.
3. **Every write uses the canonical names and removes the legacy ones.** `UserModel.storedUpdateOf` builds each update: a field it sets is written under its canonical name, and its legacy name is `$unset` in the same update.
4. **A document is moved to the canonical names whole** after a sign-in, an MFA activation, a password change and a token reset (`UserModel.canonicalMoveOf`, applied by `moveToCanonicalNames` in `auth.service.js`). The move takes its values from the copy the request read, so it is conditional: its filter requires each moved field to be still absent under its canonical name and present under its legacy one. Every writer stores the canonical name and removes the legacy one, so a field written since the read fails the filter and the whole move is skipped. An account an administrator blocked meanwhile stays blocked; the move is retried by the next such write.
5. **The API keeps its keys.** Request bodies still use `name`, `status`, `password`, and the user routes rename them on the way in (`storedNamesOf`, `storedUpdateOf`). Responses still carry `name`, `status`, `mfaActivationDate`, `lastLogin`, `forceReset` and `passwordResetExpires`: `UserModel.stripSecrets`, the boundary every user response already passes, first puts the document under those names (`apiViewOf`). The sign-in bundle, the access token's `name` claim and `GET /api/auth/verify` keep `name`. The frontend is unchanged.
6. **No response returns either hash name or either history name.** `stripSecrets` removes `password`, `passwordHash`, `passwordHistory` and `passwordHistoryHashes`, with `passwordResetTokenHash` and both MFA secret names. Registration's response now goes through it too; before, it spread the stored document and blanked `password` only, so it carried `passwordHistory` (always empty at creation) and a null `mfaSecretCiphertext`. Those two keys are gone from that response.

## Unchanged

Hashing (bcrypt, the same cost at each site), the password policy, the reuse depth, the lockout, MFA, the reset token's hashing and single use, and every status rule. A legacy document's history is read under its old name, so a password in it is still refused after the change.

## Indexes

The only indexes on `users` are the unique ones on `email` and `username` (`scripts/createFirstAdmin.js`), RF003 AC1's uniqueness of e-mail and username. Neither field is renamed, so both still cover legacy and canonical documents alike, and uniqueness holds across the two. No index exists on a renamed field, so none needed a canonical twin; the status filter of the alert recipient queries runs after an `_id` `$in` and is not index-served.

## Chosen where the sources leave a gap

- **Status values are not translated.** `accountStatus` keeps the values `status` held (`active`, `inactive`, `blocked`, `suspended`); the move carries the stored value as it is, and readers normalize it as before.
- **Audit payloads keep the names they had.** `fieldsCleared` and `fieldsSet` in the MFA reset and set-password audit rows still name `mfaActivationDate`, `lastLogin`, `password`, `passwordHistory` and `forceReset`. They describe the operation to a reader of the trail, which is API-facing.

## Not decided here

- **`createdAt` and `updatedAt`.** UserAccount has no row for either; the conformance guard still records them under #1330. `passwordChangedAt`'s expiry falls back to `createdAt`, so dropping it needs its own decision.
- **Removing the legacy fallback.** It can go once no stored document carries an old name. A user who never signs in, changes or resets a password again keeps the old names, so this needs a one-off migration.
