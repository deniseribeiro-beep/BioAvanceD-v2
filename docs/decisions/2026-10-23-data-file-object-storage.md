# 2026-10-23: a DataFile binary is written once to a content-addressed object through one store interface

Requirements RF007 AC2 and AC3, RNF016 C4. Issue #1321.

## The question

RF007 AC2 asks to "Calcular checksum e armazenar o binário exclusivamente no Object Storage", AC3 to "Registrar URI, versão do objeto, tamanho, criptografia, owner, retenção, acesso e vínculos canônicos no MongoDB", and RNF016 C4 says "Object Storage contém binários; MongoDB contém seus metadados". A sample, assay or dataset file was written in place by multer, its ciphertext written over that same staging file, and its `objstore://<area>/<owner>/files/<name>` URI was only a label: no object-store client existed and `storageObjectVersion` (V2E-0472, string, 1..1, Core) was never written. Where does the binary go, under which name, and what is its version?

## Decided

By the coordinator for #1321, on 2026-10-23:

1. **One store interface with two methods and no delete or overwrite:** `putObject({ area, ownerKey, body })` returns `{ uri, version, path }`, and `getObject(uri)` returns the stored bytes (`api/backend/src/infrastructure/objectStorage/`). Today's adapter is `createFilesystemObjectStore({ root })`, and `getFileObjectStore()` memoizes one rooted at `STORAGE_BASE`.
2. **The object is content-addressed by the SHA-256 of the stored bytes,** the ciphertext: key `<area>/<owner>/sha256/<hex>`, URI `objstore://<key>`, path `<STORAGE_BASE>/<area>/<owner>/sha256/<hex>`, version `sha256:<hex>`. An `area` outside `[A-Za-z0-9._-]{1,128}` or equal to `.` or `..`, an empty or non-string owner id, or a body that is not a Buffer, is refused (`OBJECT_KEY_INVALID`) before the disk is touched.
   **The owner segment is mapped from the parent id inside the store (`ownerSegment`), for every caller:** an id matching `[A-Za-z0-9_-]{1,128}` that does not start with `x-` is its own segment, and any other id is `x-<sha256 of the id>`. Assay and dataset ids are client-supplied and may hold a space, an accent, a dot or a slash, so a parent id is treated as data, never as a path: no id can traverse out of its area, and no id outside the pattern is refused. The row keeps the raw parent id.
3. **A new object is written to a temp file and hard-linked to its key path,** which fails rather than overwrites if the object exists. An existing object is reused only when it is a regular file whose SHA-256 equals the key; anything else is a refusal (`OBJECT_CONFLICT`) and the stored object is left as it is. No temp file is left on any path. `getObject` reads only `objstore://<area>/<ownerKey>/sha256/<64 hex>` and refuses bytes that no longer hash to their key.
4. **The four write sites put the ciphertext through the store:** the upload and replace of `sample-file.controller.js` (area `samples`, owner the sample `_id`) and of `createLinkedFileController.js` (area the entity's `storageSubdir`, owner the parent id). The record's `storageUri` is the object's URI, its `storagePath` the object's path, and a new `storageObjectVersion` is written beside them; the upload and replace responses return `storageObjectVersion` beside `uri`.
5. **The plaintext staging file multer wrote is removed after the put,** and a failed removal is logged, never thrown. When a replace's staging path is the previous record's `storagePath`, that file is evidence: it is overwritten with the ciphertext and a warning logged, never unlinked.
6. **The previous object of a replace is never touched,** and `recordReplacement` versions the new URI as before.
7. **`SampleFile.create` writes `storageObjectVersion`, and `validate` refuses one that is present but not a non-empty string.** It is not required, since rows written before this decision lack it.

`[inference]` The filesystem adapter is the object store for now because the stack runs no object-storage service: no compose file runs MinIO or any S3-compatible service. This follows the repo's own choice in `2026-10-22-reference-release-asset-preserved.md`, where `<STORAGE_BASE>/reference-releases/<datasetCode>/sha256/<checksum>` is the object store for a reference asset.

`[inference]` `storageObjectVersion` is `sha256:<hex of the stored ciphertext>`, an immutable content address: the same key never names other bytes. An S3-compatible adapter will return its own version id in that field.

`[inference]` An object written before a later validation or database failure is kept as an orphan, since the store deletes nothing. A retry of the same bytes reuses it only when it encrypts to the same ciphertext, which a fresh IV makes unlikely, so orphans can accumulate until a retention sweep exists.

## Not decided here

- **The S3-compatible adapter and its compose service,** the next slice of #1321, and the driver switch between adapters.
- **Moving downloads onto `getObject`:** they keep reading `storagePath`, which now points at the object.
- **Consent evidence** (`consentEvidence.service.js`) **and reference assets** on the store interface.
- **Re-encrypting stored binaries after a key rotation.**
- **Migrating rows written before this decision** to content-addressed objects and a `storageObjectVersion`.
