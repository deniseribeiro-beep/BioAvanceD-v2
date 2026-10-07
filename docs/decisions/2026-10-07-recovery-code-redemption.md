# 2026-10-07: a recovery code is redeemed at the MFA step of sign-in, once

Dictionary: RecoveryCodeSet, P1X-0270 `codeHashes` ("Hashes dos códigos ainda válidos"), P1X-0271 `remainingCount`, P1X-0272 `usedCodeHashes`, P1X-0275 `invalidatedAt` (Dicionário de Dados v2.0.0). Requirement: RNF020 AC3, codes stored by hash, Requisitos v4.0.0. The redemption flow itself has no RF line; the dictionary's consumption fields and the Security page's own text ("single-use") are its sources. Issue #1331.

## Decided

1. **A recovery code is accepted where a TOTP code is, at the MFA step of `processLogin`.** It is spent by one conditional `updateOne` whose filter matches only while the hash is still in `codeHashes` and the set has no `invalidatedAt`; the update moves the hash to `usedCodeHashes` and decrements `remainingCount` (`RecoveryCodeSetModel.spendOf`). Two sign-ins racing on one code modify the document once, and the loser is refused.
2. **A spent or unknown code is a failed MFA attempt,** counted in `mfaFailedAttempts` and the source-address counter like a wrong TOTP code, so the same lock applies. A sign-in that loses the race on a code it matched is refused and counted in `mfaFailedAttempts`.
3. **Each redemption is audited** (action `MFA`, operation `recovery_code_redeemed`, with the count left).
4. **A set still under the pre-dictionary names converts in the same write that spends its code,** as a regeneration converts one (`2026-10-07-recovery-code-set-names.md`).

## Chosen where the sources leave a gap

- **The login form sends the code in the existing MFA field, and its shape tells it from a TOTP code:** eight characters of the generator's alphabet (no I, O, 0 or 1) against six digits. Case, spaces and hyphens are forgiven, since the code is typed from a saved sheet. A separate request field was the alternative; the shape check needs no change to the login route, the controller or the auth context, and the two shapes cannot collide. `generateRecoveryCode` and `asRecoveryCode` (`auth.service.js`) must change together.
- **The code is spent only by the submission that completes the sign-in.** With a password change due (forced, expired or below the policy floor), the answer asking for a new password issues no session, and the form sends the same code back with the new password (#1252). Spending on the first answer would refuse that second submission, so the spend happens after the new password passes the policy checks and before it is written.
- **Matching compares the code against each unspent hash with bcrypt,** at most ten compares at cost 10, about 0.6 s per attempt. It runs only after the password has matched, so it costs only a caller holding the password, and each miss counts toward the MFA lock.
- **Codes are drawn from `crypto.randomInt`.** They were drawn from `Math.random` before, which was harmless while a code could not sign in.

## Not decided here

- `invalidatedAt` (P1X-0275) still has no writer. A redemption refuses a set carrying it, so a future "invalidate my codes" action needs only to set it.
