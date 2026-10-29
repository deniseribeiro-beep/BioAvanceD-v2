# 2026-10-17: ParticipantIdentity's stored ciphertext names, and which of its missing elements are built

Dictionary: ParticipantIdentity P1X-0348..0364 (Dicionário de Dados v2.0.0). Requirements: RF005, RNF007, RNF020. Issue #1386 (the remainder of #1330). Follows `2026-10-08-encryption-key-rotation-rewrite.md`.

## Question

The conformance guard leaves two questions open for ParticipantIdentity. First, under which names is the ciphertext of the seven plain-typed fields stored? The dictionary types `patientName`, `birthDate`, `email`, `phone`, `representativeName`, `representativeEmail` and `representativePhone` as string or date, and names only P1X-0354 and P1X-0359 as ciphertext, yet the service stores all nine identity fields enciphered under `<field>Encrypted`. Second, which of the six elements the model never emits are built: P1X-0348, P1X-0355, P1X-0356, P1X-0361, P1X-0363 and P1X-0364? P1X-0362 is also missing from the model, though the service already stores it.

## Decided

No decision below is new policy: each is the repo's own inference from a choice it has already made, cited where it was made.

1. **Each enciphered field is stored as `<dictionary name>Ciphertext`, and the plain names stay the decrypted names.** The nine moves:

   | Today | New |
   |---|---|
   | `patientNameEncrypted` | `patientNameCiphertext` |
   | `birthDateEncrypted` | `birthDateCiphertext` |
   | `identityDocumentEncrypted` | `identityDocumentCiphertext` (P1X-0354) |
   | `emailEncrypted` | `emailCiphertext` |
   | `phoneEncrypted` | `phoneCiphertext` |
   | `representativeNameEncrypted` | `representativeNameCiphertext` |
   | `representativeEmailEncrypted` | `representativeEmailCiphertext` |
   | `representativeIdentityDocumentEncrypted` | `representativeIdentityDocumentCiphertext` (P1X-0359) |
   | `representativePhoneEncrypted` | `representativePhoneCiphertext` |

   `patientName`, `birthDate`, `email`, `phone`, `representativeName`, `representativeEmail` and `representativePhone` remain the names readers receive from `decryptIdentity` (`services/participantIdentity.service.js:242-267`). Those are the values the dictionary types as string and date.

   Why:
   - Every element the dictionary stores enciphered carries the suffix `Ciphertext`: P1X-0197 `mfaSecretCiphertext`, P1X-0354, P1X-0355 and P1X-0359. No element anywhere in the dictionary ends in `Encrypted`: `grep -c -E "\| [A-Za-z]+Encrypted \|" docs/extracted-v2.0.0/dict-DICIONARIO.md` gives 0.
   - The repo already followed that suffix once: #1072 renamed the users' `mfaSecret` to `mfaSecretCiphertext` (commit 4fe66bee).
   - One suffix keeps a single rule across the document. Renaming only the two fields the dictionary names would leave two suffixes side by side in one record.
   - The move is safe for the data. `utils/fieldEncryption.js` binds no field name into the envelope (it sets no AAD), so an envelope stored under a new name still decrypts. The rotation worklist (`2026-10-08-encryption-key-rotation-rewrite.md`, item 3) reads `<field>.keyId` under whatever names the registry lists.

   How a later change carries out the move:
   - Writes use the new names and remove the old ones.
   - A reader falls back to an old name only where the new name is absent, so a new name holding `null` stays `null` (the rule of `2026-10-11-user-account-names.md`, item 2).
   - `npm run encryption:rewrite` covers both names until no document carries an old one. Otherwise its verdict could report a key slot safe to empty while envelopes under the old name still use that key.
   - A one-off migration moves the rest, as `2026-10-16-auth-legacy-name-migration.md` did.
2. **P1X-0348 `participantIdentityId` (uuid, 1..1 Core): built, as a uuid generated when the record is inserted.**
   - This is the repo's pattern for an entity's own id: `models/Access.js:85` and `models/AccessRequest.js:67` (`data.<x>Id || crypto.randomUUID()`).
   - UserAccount went the other way (`2026-10-17-user-account-absent-elements.md`, item 1), because references to users by `_id` already existed. No reference to an identity record exists. Every reader finds the record by `participantId` (`services/participantIdentity.service.js:313-317`), so a uuid gives the record its first id and does not compete with an existing one.
   - Existing records get their id from the migration.
3. **P1X-0361 `identityStatus` (code, 1..1 Core): built.**
   - The value set is `active|inactive|merged|restricted` (`dict-ENUMS.md` ENUM-0177..0180).
   - The default is `active`. The dictionary has no default column; `active` is the row's example value, and it is the only status any record can hold today.
   - Every existing and new record is `active`. No flow changes the status yet.
4. **P1X-0362 `encryptionKeyVersion` (string, 1..1 Core): already stored. The model now declares it.** `encryptIdentityFields` writes it (`services/participantIdentity.service.js:76-80`), and the rotation rewrite updates it (`scripts/rewriteEncryptedFields.js:118-120`).
5. **P1X-0354 and P1X-0359 are the two dictionary-named moves in item 1.** The model declares both ciphertext names. Its `identityDocument` and `representativeIdentityDocument` keys stay. They are the plaintext input that `encryptIdentityFields` enciphers and then nulls (`services/participantIdentity.service.js:98-118`), and no record stores a value under them once it is enciphered.
6. **P1X-0355 `recordNumberCiphertext` (encrypted string, 0..1 Condicional): built, as its own change, by moving the record number off the Patient document.**
   - Today the number sits in plaintext on the pseudonymous participant record (`models/Patient.js:71` and `:135`).
   - The export already treats it as canonically `recordNumberCiphertext` and leaves it out (`interface/routes/reports.routes.js:1042-1046`).
   - The move follows #575, which took `patientName`, `birthDate` and `identityDocument` off Patient (`models/Patient.js:1-2`) after #565's backfill.
   - Its readers (the patient service, the import paths and the frontend's patient search) make it a change of its own.
   - Built so far: the identity stores `recordNumberCiphertext` and a `recordNumberHash` blind index, under the non-unique index `participant_identities_record_number_hash_idx_v1`. The dictionary row infers no new uniqueness, so uniqueness stays the create-time check. Every writer stops writing the number on Patient and `$unset`s the Patient copy. The readers (the conflict check, the search, the import lookup, batch linkage and the by-barcode read) match the identity only. Their fallback to `patients.recordNumber` is removed (item 9).
   - The search now matches a record number held on the identity exactly, on the normalized number. A blind index cannot serve a substring search; this is #1104's precedent for `patientName`. No arm matches `patients.recordNumber` any more, so no search matches a record number by substring.
   - Patient reads (`getPatient`, `listPatients`, the search results) stop carrying the number, and nothing adds the identity's back. This is an inference from the repo's pattern: the contact (#1166 slice 4) and the representative (#1168) were removed from Patient reads in the same way, and the export already leaves `recordNumberCiphertext` out (`interface/routes/reports.routes.js:1069-1074`). A Patient's own legacy number is not read either (item 9).
7. **P1X-0356 `clinicalUnitId` (Reference(Organization), 0..1 Condicional): absent from the identity record.**
   - The participant's clinical unit is `Patient.clinicalUnitId`, a Reference(Organization) since #352 (`scripts/migrateClinicalUnitOrganizations.js:1-5`).
   - It is the tenancy key every patient route scopes on: `controllers/paciente.controller.js:215` filters on it. The re-identification route checks it at `:457` before the identity is read at `:466`.
   - The identity record is reached only through its participant, after that check.
   - A copy would need a write at every reparent (#1053; `services/PatientIdentityService.js:194-197`), and it could disagree with the key that is actually enforced. This is the reason `primaryRoleId` is not stored on the user (`2026-10-17-user-account-absent-elements.md`, item 5).
8. **P1X-0363 `lastVerifiedAt` (dateTime) and P1X-0364 `verifiedBy` (Reference(Actor)), both 0..1 Condicional: absent, because their condition never holds.**
   - No flow verifies an identity. The re-identification route (`controllers/paciente.controller.js:424`, #560) reads the identity and audits the read, and it verifies nothing.
   - `verifiedBy` is a Reference(Actor), and no Actor entity exists (`2026-10-17-user-account-absent-elements.md`, item 2).
   - Both are built with a verification flow.
9. **The read fallbacks to the old `<field>Encrypted` names and to `patients.recordNumber` are removed.**
   - `decryptIdentity` reads only the `<field>Ciphertext` names. The conflict check, the search, the import lookup, batch linkage and the by-barcode read match a record number on the identity only, and the `patients_record_number_idx_v1` index that served the legacy arms is dropped.
   - Why: the condition this record set holds. No deployed database exists (Dennis, 2026-10-21). On the only database, the Docker test stack, `npm run migrate:participant-identity-ciphertext-names` reported 0 remaining, and `npm run migrate:participant-record-numbers` 0 candidates, 0 conflicts and 0 remaining, on 2026-10-21.
   - The registry's `legacyFields` stay: writers still `$unset` the old names, and `npm run encryption:rewrite` still re-encrypts any envelope under one. The migration scripts stay too, for a database restored from older data; run them on it before it is served.

Paths starting `services/`, `models/`, `controllers/`, `utils/`, `scripts/` or `interface/` are under `api/backend/src/`.

Made by the 2026-10-17 coordinator sitting on #1386, by inference from the repo's existing choices; the owner may reverse any item.

## Not decided here

- **The `patients` collection's own `representativeIdentityDocumentEncrypted`.** It is the registry's `patients` entry (`utils/encryptedFieldRegistry.js:50-56`), and this record does not rename it.
- **The dictionary side.** Whether dict-02 should type the seven fields as ciphertext, or drop `clinicalUnitId` from ParticipantIdentity, is the owner's question.
