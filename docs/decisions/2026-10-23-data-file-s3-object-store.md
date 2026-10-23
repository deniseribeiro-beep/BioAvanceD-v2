# 2026-10-23: an S3-compatible adapter sits behind the DataFile object-store interface

Requirements RF007 AC2, RNF016 C4. Issue #1321.

## The question

`2026-10-23-data-file-object-storage.md` put every DataFile binary through one store interface, `putObject({ area, ownerKey, body })` and `getObject(uri)`, whose only adapter is the filesystem under `STORAGE_BASE`, and left "the S3-compatible adapter" to the next slice. RNF016 C4 says "Object Storage contém binários; MongoDB contém seus metadados". How does an S3-compatible service (MinIO in this stack) hold the same objects under the same contract, and what does a row record when it does?

## Decided

By the coordinator for #1321, on 2026-10-23:

1. **The same interface and the same key rule:** `createS3ObjectStore({ endpoint, bucket, region, accessKeyId, secretAccessKey, timeoutMs, fetchImpl, now })` returns exactly `{ putObject, getObject }`, with no delete and no overwrite (`api/backend/src/infrastructure/objectStorage/s3ObjectStore.js`). It validates the area, maps the owner through `ownerSegment` and refuses a non-Buffer body exactly as the filesystem store does, sharing that store's exported helpers, so `OBJECT_KEY_INVALID` is thrown before any request. An endpoint that is not an `http:` or `https:` URL, a bucket outside `[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]`, or an empty key is refused when the store is created.
2. **Path-style addressing always:** the object `objstore://<area>/<owner>/sha256/<hex>` lives at `<endpoint>/<bucket>/<area>/<owner>/sha256/<hex>`, the form MinIO serves without virtual-host DNS.
3. **Write-once by `If-None-Match: *`, verify on exists:** a PUT carries `If-None-Match: *` and is signed with AWS Signature Version 4 (`awsSigV4.js`), its payload hash the key's own hex. A 412 or 409 (the object exists) is followed by a GET of that object: it is reused when its bytes hash to the key, and is otherwise a refusal (`OBJECT_CONFLICT`). The existing object is never put again. Any other status, a failed request or the timeout is `OBJECT_STORE_UNAVAILABLE`, naming the status and never the secret or the authorization header. There is no retry.
4. **`version` stays `sha256:<hex>` and `path` is `null`:** a put through either adapter returns the same `uri` and `version` for the same bytes. There is no local file, so `path` is `null`.
5. **A missing object is `ENOENT`:** `getObject` throws an error with `code: 'ENOENT'` on a 404, the code `readStoredBytes` in `fileAccess.controller.js` already maps to a 404. Bytes that do not hash to their key are `OBJECT_CONFLICT`, and `getObject` returns a `Buffer`.

`[inference]` `version` is the content address rather than the service's own version id, so a row's `storageUri` and `storageObjectVersion` do not depend on the adapter that wrote it: a content address is immutable, and the key-rotation rewrite and any migration between adapters read the same key. This revises the inference in `2026-10-23-data-file-object-storage.md` that an S3-compatible adapter would return its own version id in that field.

`[inference]` No SDK: the adapter signs its own requests and sends them with Node's global `fetch`, as `rfc3161-adapter.service.js` and `audit-witness.service.js` call their HTTP services without one.

`[inference]` A server that ignores `If-None-Match` could only rewrite an object with identical bytes, since the key is the bytes' hash; a conflicting body names another key.

## Not decided here

- **The driver selector** between the filesystem and S3 adapters, and **the S3 config keys in `env.js`.**
- **`SampleFile.validate`'s required `storagePath`,** which an S3 row (`path: null`) cannot satisfy.
- **The download existence checks** that test `fs.existsSync(storagePath)`.
- **The MinIO compose service** and its end-to-end proof.
- **Re-encrypting stored binaries after a key rotation.**
