# 2026-10-30: the test stack stores DataFile binaries in an S3-compatible service, and the RF007 upload case proves it

Requirements RF007 AC2, RF007 AC3, RNF016 C4. Issue #1419.

## The question

`2026-10-23-data-file-s3-object-store.md` and `2026-10-23-data-file-object-store-driver.md` built the S3-compatible adapter and the `OBJECT_STORE_DRIVER` selector, and both left "the MinIO compose service and its end-to-end proof" to a later slice. `compose.test.yml` ran no S3-compatible service, so the adapter had never run in the Docker e2e gate. Which service does the test stack run, how does its bucket come to exist, which containers use it, and what proves an upload landed there?

## Decided

By the coordinator for #1419, on 2026-10-30:

1. **`s3-test` is the store:** a MinIO server, `pgsty/minio:RELEASE.2026-08-04T00-00-00Z`, running `server /data` on the named volume `s3-test-data`, with a root user and password that are test values only. Its healthcheck is `curl -fsS http://127.0.0.1:9000/minio/health/live`. Its port is published on the host loopback as `127.0.0.1:${S3_HOST_PORT:-9000}:9000`, per `2026-10-23-compose-ports-loopback.md`, and `S3_HOST_PORT` moves it as the other published ports move (#1156).
2. **The image:** pulls of `minio/minio` and `quay.io/minio/minio` were refused as `unauthorized` on 2026-10-30 (#1419), so the stack uses `pgsty/minio`, a maintained MinIO build on docker.io that carries `curl` for the healthcheck. It is pinned to an exact release, as every third-party image in the repo is (a7ef6570).
3. **The bucket is made by a one-shot that signs with the backend's own signer:** `s3-bucket-init-test` runs `tests/e2e/docker/s3-bucket-init.cjs` on `node:22.23.4-alpine`, with `api/backend/src/infrastructure/objectStorage` mounted read-only at `/s3`. It sends a path-style CreateBucket `PUT <endpoint>/<bucket>` signed with `awsSigV4.js`, and exits 0 on a 200 or on a 409 whose body holds `<Code>BucketAlreadyOwnedByYou</Code>` (a bucket this stack made before, since the volume survives a down/up). Any other answer, including 409 `BucketAlreadyExists` and 403, or an unset `OBJECT_STORE_S3_*` key, exits 1 naming the status. No S3 client image is pulled. It waits on `s3-test` being healthy, and `backend-app-test` waits on it with `service_completed_successfully`, so a failed init fails the stack's `up`. It is not named `*bootstrap*`, because `scripts/e2e-gate.sh` waits on containers by that name.
4. **The driver is on the shared anchor:** `x-object-store-env` holds `OBJECT_STORE_DRIVER: s3` and the five `OBJECT_STORE_S3_*` keys (endpoint `http://s3-test:9000`, bucket `bioavanced-test-files`, region `us-east-1`), and `x-test-env` merges it first. Every container built from `x-test-env`, the API and `worker-test` included, therefore reads and writes the one store. The init one-shot takes the same anchor, so the bucket it makes is the one the backend uses.
5. **The e2e proof:** the RF007 case "uploads a scientific file, recording checksum/URI/encryption..." in `tests/e2e/scientific-data-access.spec.ts` asserts that `storageObjectVersion` is `sha256:<hex>`, that `uri` is `objstore://samples/<owner>/sha256/<that hex>`, and that the `sample_files` row (read through `readSampleFileStorage` in `tests/e2e/helpers/seedParticipant.ts`) holds that `storageUri` and `storageObjectVersion` with `storagePath: null`. The case's existing download round trip then reads the binary back through the store-only path (`/api/file-access`).

`[inference]` `storagePath: null` is what tells the S3 store from the filesystem store: the filesystem store returns a path string, the S3 store `path: null`, and the upload stores it as given. The URI and version alone cannot tell them apart, since both adapters return the same content address for the same bytes.

`[inference]` A server that ignores `If-None-Match` does not break the adapter: `2026-10-23-data-file-s3-object-store.md` records that it could only rewrite identical bytes, and the adapter accepts a 200 or a 412/409. Only a non-200, non-412/409 answer to a PUT carrying the header (for example 501) would break uploads.

`[inference]` `backend-unit-runner` also merges `x-test-env`, and CI runs it with `run --no-deps`, so without `s3-test`. Its architecture tests, seed and dictionary validation and compliance evidence call no object store, so the driver on the anchor reaches no store there.

## Not decided here

- **`.env.docker.example` and the dev, prod and lab compose files**, which keep the filesystem store.
- **The off-site backup bucket.**
