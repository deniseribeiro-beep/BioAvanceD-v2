# 2026-10-24: the key-rotation rewrite re-encrypts DataFile binaries held in the object store

Requirements RNF020 AC3 and AC5, RF007 AC2, RNF016 C4. Issues #1321 and #1103.

## The question

`2026-10-08-encryption-key-rotation-rewrite.md` item 5 left file binaries counted, not rewritten, until their move to object storage. That move is done (`2026-10-23-data-file-object-storage.md`, `2026-10-23-data-file-s3-object-store.md`), but `npm run encryption:rewrite` still re-encrypted fields only: every sample, assay or dataset file and every retained DataFileVersion stayed under the key it was uploaded with, so `fileRowsUnderOtherKey` kept `safeToEmptyPreviousSlot` false for good on any stack that stored a file before a rotation. How does the rewrite re-encrypt those binaries under the active key, through either object-store driver, without losing or overwriting one?

## Decided

By the coordinator for #1321, on 2026-10-24:

1. **The rewrite covers the DataFile collections and their version rows:** `sample_files`, `assayFiles` and `datasetFiles` (the `FILE_ACCESS_COLLECTIONS` keys, URI field `storageUri`), then `dataFileVersions` (URI field `objectUri`), in that order (`api/backend/src/services/fileBinaryRewrite.service.js`, called by `rewriteEncryptedFields` after the field loop). A collection the database does not hold is not touched. The worklist is every row with an `encryptionKeyId` other than the active one, or with `--all` every row with one; a logically deleted row is included, since its binary is kept evidence.
2. **A row is rewritten only on positive evidence, and every other row is counted and left untouched:**
   1. its URI names a store object (`objstore://<area>/<owner>/sha256/<hex>`, with segments `getObject` accepts), and a DataFile row also carries a non-empty `storageObjectVersion`; otherwise it is `notInObjectStore`;
   2. the store is resolved on the first such row, through `getFileObjectStore()`, so either driver serves; an error building it (`OBJECT_STORE_MISCONFIGURED`) aborts the run, with the store's own masked message and nothing added;
   3. `getObject` returns its bytes; a missing object is `objectMissing`, bytes that do not hash to their key are `unreadable`, and any other error (an S3 outage) aborts the run;
   4. a registered key opens them; an unknown key or a bad tag is `unreadable`;
   5. the plaintext's SHA-256 equals the row's `checksum`, a 64-character lowercase hex; a mismatch or a missing checksum is `unreadable`;
   6. a dry run counts the row as one it would rewrite, and puts and writes nothing;
   7. `--apply` encrypts the plaintext under the active key and puts the ciphertext under the old URI's area and owner segment;
   8. the row is updated guarded on its `_id`, its `encryptionIv` and its URI as read, setting the new URI, the four `encryption*` fields and, for a DataFile row, `storageObjectVersion` and `storagePath` (`null` on S3). Nothing else is set: not `checksum`, which names the plaintext, and not `updatedAt`. A row the guard no longer matches is `changedMeanwhile`, not overwritten.
3. **Rows sharing an object stay on one new object.** A per-run memo, keyed by the old URI and the old `encryptionIv`, reuses the first such row's new object and envelope, so a DataFile row and its latest version row, which hold the same object under the same envelope, name the same new URI. The memo feeds only the update, never its guard.
4. **A put can name an already-mapped owner segment.** `putObject({ area, owner, body })` takes the segment of a stored URI as is, through `resolveOwnerSegment` shared by both stores: it must pass the test `getObject` applies, it is never mapped again (an `x-<hex>` segment would be hashed a second time), and naming both `owner` and `ownerKey` is refused (`OBJECT_KEY_INVALID`). A put with `ownerKey` is unchanged.
5. **The verdict is unchanged:** `safeToEmptyPreviousSlot` is still the dry run's count of rows under another key, so a row left for any reason above keeps it false. `npm run encryption:rewrite` exits 1 when any file summary counts an `unreadable` or `objectMissing` row.

`[inference]` A download token issued before the rewrite is refused as `superseded`, since it names the row's old `storageUri` (`fileAccess.controller.js`, the `superseded` refusal). Its 60-second TTL bounds this to a fresh token request.

`[inference]` The memo that keeps a DataFile row and its latest version row on one new object lasts a single run. An `--apply` run that aborts between the two leaves them on separate new objects. Both decrypt under the active key, and no code compares the two URIs, so the cost is one duplicate object.

`[inference]` The old ciphertext object is kept: the stores have no delete. Once the previous slot is emptied it is an orphan no key opens, which is the write-once rule of `2026-10-23-data-file-object-storage.md`.

## Not decided here

- **Legacy disk rows** (no `objstore://` URI or no `storageObjectVersion`): they are counted `notInObjectStore` and keep the verdict false until they are migrated into the store.
- **Backup files**, still only counted.
- **`import_batches.sourceFile`,** whose envelope fields are nested, so the top-level `encryptionKeyId` counter does not see them.
- **The HL7 audit hash** of ciphertext bytes, which changes once a binary is re-encrypted.
