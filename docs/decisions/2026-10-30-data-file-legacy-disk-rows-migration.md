# 2026-10-30: legacy DataFile rows whose binary is on local disk are migrated into the object store

Requirements RF007 AC2, RNF016 C4, RNF020 AC3. Issues #1419 and #1321.

## The question

`2026-10-24-data-file-key-rotation-rewrite.md` left the legacy disk rows under "Not decided here": a DataFile row written before the object store has no `storageObjectVersion`, a label `storageUri` such as `objstore://samples/<id>/files/<name>`, and its ciphertext at `storagePath` on local disk. The rewrite counts it `notInObjectStore`, so it keeps `safeToEmptyPreviousSlot` false for good. How is such a binary moved into the store, through either driver, without losing, overwriting or misattributing one?

## Decided

By the coordinator for #1419, on 2026-10-30:

1. **A separate, dry-run-first migration moves them:** `npm run files:migrate-legacy` (`api/backend/src/scripts/migrateLegacyFileBinaries.js`, calling `api/backend/src/services/legacyFileMigration.service.js`) counts and writes nothing; `-- --apply` writes. It covers `sample_files` (area `samples`, owner field `sampleID`), `assayFiles` (`assays`, `assayId`) and `datasetFiles` (`datasets`, `datasetId`), the area and owner each upload puts under today. A collection the database does not hold is not touched. The worklist is every row whose `storageObjectVersion` is null or absent; a logically deleted row is included, since its binary is kept evidence.
2. **A row is migrated only on positive evidence; the first step that fails counts the row and leaves it untouched:**
   1. `storagePath` is a non-empty string whose real path lies inside the real path of a storage root (`STORAGE_BASE` or `UPLOADS_BASE`), and is a regular file, not a symlink; otherwise it is `outsideRoots`, or `fileMissing` when it does not exist;
   2. the owner field is a non-empty string or a number; otherwise `noOwner`;
   3. the row carries a non-empty `encryptionKeyId`, `encryptionIv` and `encryptionTag`; otherwise `notEncrypted`;
   4. a registered key opens the bytes and the plaintext's SHA-256 equals the row's `checksum`, a 64-character lowercase hex; otherwise `unreadable`;
   5. a dry run counts the row as one it would migrate, and puts and writes nothing;
   6. `--apply` puts the bytes unchanged under the row's area and owner (`ownerKey`), so the envelope on the row stays valid; re-keying is the rewrite's job. An `OBJECT_CONFLICT` from the store is `unreadable`; any other store error aborts the run;
   7. the row's version rows are moved (item 3), and then the row is updated guarded on its `_id`, `storagePath`, `storageUri` and `encryptionIv` as read and on `storageObjectVersion` still null, setting only `storageUri`, `storageObjectVersion` and `storagePath` (`null` on S3). A row the guard no longer matches is `changedMeanwhile`, not overwritten.
3. **A version row moves with its file row, and before it:** each `dataFileVersions` row whose `fileId` is the file row's `_id`, whose `objectUri` is the old `storageUri` and whose `encryptionIv` is the row's, gets the new URI, guarded on its `_id`, `objectUri` and `encryptionIv` (`versionsMigrated`). The file row is updated last, so a run that stops in between leaves it a candidate, and a rerun puts the same content-addressed object again and finishes it. A version row the guard no longer matches leaves the file row unmoved, counted `changedMeanwhile`.
4. **The verdict:** the script prints the per-collection summaries as JSON and exits 1 when any counts a `fileMissing` or `unreadable` row. A migrated row then reaches `npm run encryption:rewrite`.

`[inference]` A plaintext legacy row is left, counted `notEncrypted`. Since #938 the upload stores plaintext only under the `ALLOW_UNENCRYPTED_FILE_STORAGE` opt-out, and the migration moves bytes, never encrypts them: encrypting would change the binary the row's evidence names.

`[inference]` The disk file is kept, never removed or changed: the stores delete nothing, and the migrated row no longer names it, so it is an orphan only an operator removes.

`[inference]` A version row is moved only alongside its file row. Since the file row is updated last, no run leaves a version row on the label URI while its file row is no longer a candidate. A legacy version row whose envelope differs from its file row's (an older binary) keeps its label URI, since no step here reads its bytes.

## Not decided here

- **Deleting the migrated disk files.**
- **Plaintext legacy rows**, still counted `notEncrypted`.
- **Legacy version rows** that do not share their file row's binary.
