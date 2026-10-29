# 2026-10-23: OBJECT_STORE_DRIVER selects the DataFile object store, and a row held only in the S3 store validates, downloads and is HL7-audited

Requirements RF007 AC2, RNF016 C4. Issue #1321.

## The question

`2026-10-23-data-file-s3-object-store.md` added an S3-compatible adapter behind the DataFile object-store interface, but nothing could select it, `SampleFile.validate` refused the rows it writes (`path: null`), the two download handlers answered them 404 on `fs.existsSync(storagePath)`, and the HL7 audit hash read binaries only from disk. How is the adapter chosen, and how does a row with no local path pass those four places?

## Decided

By the coordinator for #1321, on 2026-10-23:

1. **`OBJECT_STORE_DRIVER` selects the store** (`api/backend/src/infrastructure/objectStorage/index.js`). `getFileObjectStore()` reads it on its first call: unset, empty or exactly `filesystem` gives the filesystem store under `STORAGE_BASE`, as before; exactly `s3` gives `createS3ObjectStore` built from `OBJECT_STORE_S3_ENDPOINT`, `OBJECT_STORE_S3_BUCKET`, `OBJECT_STORE_S3_REGION`, `OBJECT_STORE_S3_ACCESS_KEY_ID`, `OBJECT_STORE_S3_SECRET_ACCESS_KEY` and `OBJECT_STORE_S3_TIMEOUT_MS`, all declared raw in `env.js`. Matching is exact and case-sensitive. Any other value throws `OBJECT_STORE_DRIVER_UNKNOWN` with status 503.
2. **A misconfigured S3 store is a 503, naming no credential:** an empty region or timeout is left to the adapter's default (`us-east-1`, 30000 ms); any other timeout must be 1 to 7 digits with no leading zero. A refused timeout or a config the adapter's constructor refuses throws `OBJECT_STORE_MISCONFIGURED` with status 503, carrying the adapter's message, which never names the secret or the access key.
3. **Only a built store is memoized:** a throw leaves the memo empty, so the call after the env is fixed builds the store.
4. **An S3 outage is a 503:** the adapter's `OBJECT_STORE_UNAVAILABLE` error carries status 503, so an upload's catch answers it rather than its default 400.
5. **A store-only row** is one whose `storagePath` is `null` or absent and whose `storageObjectVersion` and `storageUri` are both non-empty strings. `SampleFile.validate` accepts a missing `storagePath` only on such a row; every other `storagePath` must still be a non-empty string, with the same message.
6. **The download pre-checks** in `sample-file.controller.js` and `createLinkedFileController.js` skip `fs.existsSync` for a store-only row and redirect to `/api/file-access`, whose `readStoredBytes` answers a missing object with 404. Every other row, including a filesystem-store row with both a path and a version, keeps the disk check and its 404.
7. **The HL7 audit hash** (`hl7Audit.service.js`) reads a row with a non-empty `storageObjectVersion` through `getObject(storageUri)` and hashes its bytes as UTF-8, the same value the disk read gives for a filesystem-store row. An `ENOENT` takes the existing `fileName|fileSize` fallback; any other failure is logged and the item left out, so the next run retries it rather than recording a metadata hash. A row without a version keeps the disk read.

`[inference]` An unknown driver refuses with 503 rather than falling back to the filesystem. This follows the #938 rule that a missing `ENCRYPTION_KEY` is a refusal, not a downgrade, the same reading `2026-10-23-data-file-malware-scan.md` made for `MALWARE_SCAN_DRIVER`.

`[inference]` The `OBJECT_STORE_*` keys are not added to `.env.docker.example` or its generator, as `MALWARE_SCAN_DRIVER` is not, until the compose slice runs MinIO.

`[inference]` The store-only predicate is written inline in the model and the two controllers rather than imported, so the model does not require infrastructure.

## Not decided here

- **The MinIO compose service** and its end-to-end proof.
- **Re-encrypting stored binaries after a key rotation.**
