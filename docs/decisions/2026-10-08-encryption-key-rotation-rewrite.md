# 2026-10-08: one inventory of encrypted fields, and a checked step to retire the previous key

Requirements: RNF020 AC3 and AC5 (encryption at rest; secrets rotatable without a code change), RNF007, Requisitos v4.0.0; dictionary ParticipantIdentity `encryptionKeyVersion` P1X-0362. Issue #1103.

## Decided

1. **`api/backend/src/utils/encryptedFieldRegistry.js` is the one inventory of fields written with `encryptValue`.** Each entry names the collection, the writing module and its ciphertext fields. `participantIdentity.service` and `patient.service` read their field maps from it. `tests/architecture/encrypted-field-registry.arch.test.js` fails when a module calls `encryptValue` without an entry.
2. **`npm run encryption:rewrite` is step 4 of a rotation.** With `--apply` it re-encrypts every listed field under the active key and re-derives the participant blind indexes. Run without flags, it writes nothing and reports `safeToEmptyPreviousSlot`. The previous slot is emptied only when that is `true`.
3. **The worklist is the envelope's own `keyId`; no marker field is added to the other collections.** Every envelope `encryptValue` writes carries `keyId`, and MongoDB queries a nested field, so `{ '<field>.keyId': { $ne: <active> } }` selects exactly the documents a rotation left behind. The issue proposed stamping `encryptionKeyVersion` at every write site. That would add four fields the dictionary does not define, for a question the stored envelope already answers. `participantIdentities` keeps `encryptionKeyVersion`, which the dictionary defines, and the rewrite updates it.
4. **A document no registered key opens is counted `unreadable` and left alone,** and it keeps the verdict false. Each update is guarded on the `iv` of the envelopes it read, so a write that lands in between is counted, not overwritten.
5. **File binaries are counted, not rewritten.** `fileCrypto.js` uses the same key and records it on the file's metadata row as `encryptionKeyId`. The dry run counts such rows under another key in every collection, so the verdict cannot say "safe" while any remain. Re-encrypting the binaries belongs with their move to object storage (#1321).
