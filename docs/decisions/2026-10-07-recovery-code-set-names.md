# 2026-10-07: recovery code sets use their dictionary names, and each generation is a new set

Dictionary: RecoveryCodeSet, P1X-0268..0275 (Dicionário de Dados v2.0.0). Requirement: RNF020 AC3, "Tokens de recuperação e códigos sensíveis são armazenados por hash", Requisitos v4.0.0. Issue #1330 (its RecoveryCodeSet line).

## Decided

1. **`recovery_codes` documents are written under the canonical names:** `recoveryCodeSetId`, `userAccountId`, `codeHashes`, `remainingCount`, `usedCodeHashes`, `generatedAt`, `regeneratedAt` and `invalidatedAt` (`models/RecoveryCodeSet.js`).
2. **Readers fall back to the pre-dictionary names** (`userID`, `remaining`) for a document written before them. A regeneration `$unset`s all six old names (`userID`, `codes`, `remaining`, `usedCodes`, `createdAt`, `updatedAt`), so the document converts in place. This follows the earlier `lastPasswordChange` to `passwordChangedAt` rename: writers use the canonical name, and readers fall back.

## Chosen where the sources leave a gap

- **Each generation is a new set, with a new `recoveryCodeSetId`.** P1X-0274 `regeneratedAt` "invalida o conjunto anterior", so a regenerated set is a different set from the one it invalidates. It is stored in place of the old one, so a user still holds one document. `generatedAt` is the current set's generation time (P1X-0273), and `regeneratedAt` equals it when the set replaced an earlier one.
- **`updatedAt` is not written.** RecoveryCodeSet has no row for it, and no reader used it.

## Not decided here

- Redeeming a code at sign-in, which is what moves a hash into `usedCodeHashes`, is not built (#1331).
- `invalidatedAt` (P1X-0275) has no writer. Nothing invalidates a set except a regeneration, which replaces it.
