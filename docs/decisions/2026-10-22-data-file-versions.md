# 2026-10-22: a file replace writes DataFileVersion rows and keeps the previous binary

Requirement RF007 AC4, RF007 AC6, RNF029 C3. Dictionary V2E-0346..0353. Issue #1321.

## The question

RF007 AC4 asks for a DataFileVersion "para substituições, preservando checksum e versão anteriores", and RNF029 C3 to "versionar substituições por DataFileVersion sem sobrescrever evidência". `PUT .../files/:fileID/replace`, in both `api/backend/src/controllers/sample-file.controller.js` and the Assay/Dataset factory `api/backend/src/controllers/createLinkedFileController.js`, overwrote the DataFile row and unlinked the previous binary, so no version existed and the superseded evidence was destroyed. When is a version row written, what does it carry, and what happens to the previous binary?

## Decided

`[inference]`, from the specification and the repo's code, by the coordinator for #1321, on 2026-10-22:

1. **One row per binary version, written at replace time.** An upload is unchanged and writes no row, since AC4 asks for versions "para substituições". The first replace of a file materializes a baseline version 1 for the binary it supersedes, from the DataFile row (`storageUri`, `checksum`, its encryption envelope, `uploadDate`), then writes version 2 for the new binary. Each later replace writes the next version, linked by `previousVersionId` to the latest one. The rows go to the `dataFileVersions` collection (`api/backend/src/services/dataFileVersion.service.js`); every row is validated by `api/backend/src/models/DataFileVersion.js` before its insert, and an invalid row fails the replace with the DataFile row and the previous binary untouched. If the DataFile update fails after the new row is written, the new row is deleted; a baseline row stays, since it describes the still-current binary.
2. **The previous binary is kept, never unlinked** (RNF029 C3). The file replace audit names the `dataFileVersionId` and `versionNumber` it created (RF007 AC6, "criação de versão"), and the response carries `versionNumber`.
3. **The four encryption envelope fields sit beside the eight canonical ones.** A version row stores `encryptionAlgorithm`, `encryptionKeyId`, `encryptionIv` and `encryptionTag` outside `fieldsOf`, so the canonical shape has no drift.
   - 3a. The retained binary is ciphertext. The fields carry the DataFile row's own names, so `decryptFileBuffer` reads a version's envelope as it is, and `countFileRowsUnderOtherKey` (`api/backend/src/scripts/rewriteEncryptedFields.js`) counts a version row by `encryptionKeyId` after a key rotation.
4. **`changeReason` comes from an optional multipart field** `changeReason`, trimmed; an absent, blank or non-string value is recorded as `replacement`. The baseline row's reason is `initial upload`.

## Not decided here

- **Reading or downloading a past version.** No route serves a version row or its binary yet.
- **Logical delete** (RF007 AC6): decided in `docs/decisions/2026-10-22-data-file-logical-delete.md`.
- **Object storage and `storageObjectVersion`** (RF007 AC2, V2E-0472): `objectUri` holds the same `objstore://` URI the DataFile row does.
- **A unique index on `(fileId, versionNumber)`** against two concurrent replaces of the same file, which could both read the same latest version today.
