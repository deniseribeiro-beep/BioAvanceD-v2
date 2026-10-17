# 2026-10-16: user accounts keep createdAt and updatedAt as local extensions

Dictionary: UserAccount, P1X-0182..0208, and BaseRecord, ELM-0006 `createdAt` and ELM-0008 `updatedAt` (Dicionário de Dados v2.0.0). Issue #1330.

## Question

UserAccount's 27 rows repeat neither `createdAt` nor `updatedAt`. BaseRecord defines both (dateTime, 1..1, Core). The user document carries both, and the conformance guard recorded them as `TODO(#1330)` extras. `2026-10-11-user-account-names.md` left them open under "Not decided here".

## Decided

1. **Both stay on the user document, under BaseRecord's names.** `models/User.js`'s `create()` stamps both. The user writes in `auth.service.js` and `user-security.service.js` stamp `updatedAt`.
2. **The conformance guard records both as deliberate local extensions,** not as drift to fix.

Why:

- **Dropping `createdAt` breaks the password expiry.** `password.service.js` anchors the expiry on `passwordChangedAt`, falls back to `lastPasswordChange`, and then to `createdAt`. Without `createdAt`, an account with neither of the first two cannot be dated, so its password never expires.
- **The guard already treats a record timestamp this way.** It records Session's `updatedAt`, which has no Session row either, as a deliberate local extension (its KNOWN_DRIFT entry).

Made by the 2026-10-16 coordinator sitting on #1330, settling the open item of its 2026-10-11 comment; the owner may reverse it.

## Not decided here

- Whether the dictionary should give UserAccount its own timestamp rows. That question is the owner's.
