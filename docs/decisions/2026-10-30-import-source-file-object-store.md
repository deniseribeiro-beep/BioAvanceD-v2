# 2026-10-30: a quarantined import's retained source file goes into the DataFile object store

Requirements RF007 AC2, RNF016 C4, RNF011 AC4, RNF029 AC5. Issue #1419.

## The question

`retainSourceFileForBatch` kept a quarantined LGPD import's source file (#792, #806), as ciphertext of civil identifiers (#807), at `<uploads>/quarantine/<batchId><ext>` on local disk, and recorded only that path in `import_batches.sourceFile`. Every other stored binary goes through the object store and follows `OBJECT_STORE_DRIVER` (`2026-10-23-data-file-object-store-driver.md`). Where does this file go?

## Decided

By the coordinator for #1419, on 2026-10-30:

1. **The file is put through `getFileObjectStore().putObject`**, area `import-sources`, owner the batch id, so its key is `import-sources/<batchId>/sha256/<hex>`: write-once, content-addressed, and holding no part of the client's `originalname`, which stays metadata only.
2. **The staging file is removed by the service only after the put succeeds.** A put that throws reaches the function's existing catch: logged, `null` returned. The function stays best-effort and never throws.
3. **A `null` retention removes the staging file.** Both callers in `import-lgpd.controller.js` (rows quarantined, and the FAILED batch of a header-level throw) call `cleanupFile(file.path)` when retention returns `null`, whether the put failed or no key was configured: the staging copy is plaintext civil identifiers, so nothing is left in `uploads/temp/`. The quarantined rows, or the FAILED batch, still record the rejection, and the batch outcome is unchanged.
4. **`sourceFile` records** `storageUri`, `storageObjectVersion` and `storedPath`, the last a path under the filesystem store and `null` on S3, beside the existing `originalName`, `size`, `retainedAt`, `encrypted` and envelope fields. `storedPath` is kept for batches retained before this change and for the UI, which reads a batch as retained when either `storageUri` or `storedPath` is set.
5. **Encryption is unchanged:** with a key the ciphertext is stored; under the `ALLOW_UNENCRYPTED_FILE_STORAGE=true` opt-out the plaintext is stored, as the DataFile upload does (`encryption ? ciphertext : plaintext`); with neither nothing is stored and `null` is returned.

`[inference]` RNF016 C4 and RF007 AC2 put every stored binary behind the object store; the retained import file is one, and keeping it on local disk would leave it outside `OBJECT_STORE_DRIVER`. This is the repo's consistent choice since #1321.

## Not decided here

- **Batches retained before this change:** their files stay in `quarantine/`, with no migration.
- **How long the file is retained** (#793).
- **Key rotation of its nested envelope.**
