# 2026-10-30: backup runs stay out of the DataFile object store

Requirements RNF010 C1, RNF016 C4, RF007 AC2. Issue #1419.

## The question

The DataFile binaries now go through one object-store interface (`2026-10-23-data-file-object-storage.md`, `2026-10-23-data-file-s3-object-store.md`), and the rows written before it are migrated into it (`2026-10-30-data-file-legacy-disk-rows-migration.md`). A backup run is also a set of encrypted files: `performBackup` in `api/backend/src/services/backup.service.js` writes one folder per run under `BACKUP_DIR`, and `uploadBackupRunOffsite` in `backup-offsite.service.js` copies it to an S3-compatible bucket. #1419 asks that backup files be rewritten into the object store, or that a decision record why they stay out. Do they move?

## Decided

By the coordinator for #1419, on 2026-10-30:

1. **Backup runs stay out of the DataFile object store.** The local copy stays in its run folder under `BACKUP_DIR` (`getBackupBaseDir`), and the off-site copy stays in its own bucket under the `BACKUP_OFFSITE_S3_*` settings (`backup-offsite.service.js`), at the key `backups/<folder>/<path>`. Neither goes through `putObject` or `getObject`.
2. **A backup run is not a DataFile.** RNF016 C4 says "Object Storage contém binários; MongoDB contém seus metadados": a binary of the data model, held in the store, with its metadata row in MongoDB (a `sample_files`, `assayFiles` or `datasetFiles` row with `storageUri` and `storageObjectVersion`). A run folder holds a copy of the databases themselves: the `mongodump` tree or the JSON-fallback collection files (`writeJsonBackup`), and the Neo4j and InfluxDB exports. It is described by its own `manifest.json`, with `checksum` and the `encryptedFiles` envelopes, and by its `backupHistory` row (`recordBackupHistory`, called by `runBackup`), not by a DataFile row.
3. **The run's layout does not map onto the store interface.** `putObject` writes one body, once, under `<area>/<owner>/sha256/<hex>`, a key derived from the bytes' hash, and the store has no list and no delete. A run is read and removed by folder and by relative path:
   1. `cleanupOldBackups` lists `BACKUP_DIR` and removes each run folder older than the retention days, which the store's no-delete rule forbids;
   2. `restoreBackup` takes a folder path (the restore route joins `getBackupBaseDir()` with the folder name), reads `manifest.json` by name, and `prepareDecryptedRestoreCopy` copies the folder and decrypts each file at the relative path its `encryptedFiles` entry names; a content-addressed key keeps no relative path to find a file by.

`[inference]` RNF010 C1's 3-2-1 asks for "pelo menos três cópias, em duas tecnologias ou mídias, com uma cópia fora do ambiente principal". The DataFile store holds the primary binaries, so a backup of the databases written into it would sit in the primary data's failure domain, and losing that store would lose both. The off-site path already gives backups a store of their own, separate from the DataFile store: the two were built as separate stores, the DataFile store for #1321 and the off-site bucket for #1325.

## Not decided here

- **Re-encrypting backup files after a key rotation:** `npm run encryption:rewrite` still only counts them (`api/backend/src/scripts/rewriteEncryptedFields.js`), as `2026-10-24-data-file-key-rotation-rewrite.md` left them.
- **Backing up the file binaries themselves,** the "File binaries" row of `docs/operations/backup-restore-runbook.md` section 10.
- **Off-site retention,** which the code leaves to the bucket's lifecycle rule.
