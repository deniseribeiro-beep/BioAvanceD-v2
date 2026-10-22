# 2026-10-22: a full reference import preserves its source asset in object storage, content-addressed by its checksum

Requirements RF028 AC2 and RNF032 C2. Issue #1319.

## The question

RF028 AC2 asks to "Adquirir somente fontes aprovadas e preservar o asset no Object Storage quando aplicável", and RNF032 C2 to "Preservar asset/checksum no Object Storage quando aplicável". `runImport` (`api/backend/src/reference-data/reference-imports/pipeline.js`) checksummed the source file and parsed it in place; no copy of the source bytes was kept anywhere. When is the asset preserved, where, under which name, and what happens when it cannot be?

## Decided

By the coordinator for #1319, on 2026-10-22:

1. **A full run preserves its asset after its release is registered and before the run is created or resumed,** so before its first staging write. The order is: integrity check, registration validation, release registered, asset preserved, run created or resumed, staging. The idempotent short-circuit is unchanged.
2. **The object is content-addressed.** It is stored at `<STORAGE_BASE>/reference-releases/<datasetCode>/sha256/<sourceChecksum>` and named `objstore://reference-releases/<datasetCode>/sha256/<sourceChecksum>`, both pure functions of the release's own `datasetCode` and `sourceChecksum` (`api/backend/src/reference-data/reference-imports/preserveAsset.js`). A `datasetCode` outside `[A-Za-z0-9_-]` or a checksum that is not 64 lowercase hex digits is refused before the disk is touched.
3. **An existing object is reused only when it is a regular file whose SHA-256 equals the checksum.** A directory, a symlink or other bytes at the path is a refusal; the stored object is never overwritten or deleted.
4. **A new object is written through a temp copy** that is hashed again (a source changed after the integrity check is a refusal) and hard-linked to the final path, which fails rather than overwrites if the object appeared meanwhile. No temp file is left on any path.
5. **A preservation failure ends the run `failed` before anything is staged, and the release keeps its status.** A `running` run is set to `failed`, else a failed run is created, carrying the release id; one fatal `ASSET_PRESERVATION_FAILED` issue on `ReferenceDatasetRelease` carries the release id, the reason and `rawValue: { assetUri, checksum }`. The call never throws. The release is not set to `rejected`, as an earlier draft of this decision had it: a preservation failure is environmental (unwritable or full storage), the content was never judged, and a `rejected` release is history that a retry could not reuse.
8. **A run failed only on preserving its asset is retried, not returned as idempotent.** The evidence is the run's own fatal issues, read in the idempotent short-circuit: a `failed` run whose fatal issues are all `ASSET_PRESERVATION_FAILED` is retried; a failed run with any other fatal issue, or with none, short-circuits as before. The retry sets that same run doc back to `running`, so no second run carries the idempotency key (nothing indexes `idempotencyKey` on `referenceImportRuns`), and it reuses the release through the run's `referenceDatasetReleaseId` under the resume rules of `2026-10-22-reference-release-registered-before-load.md`. No field is added to the run.
6. **A full run parses the preserved copy,** so the staged records come from the bytes whose hash was verified. A dry run parses the source file.
7. **`runImport` returns `assetUri`:** the object's URI on a full run, null on a dry run, a checksum mismatch, an invalid registration or a preservation failure.

`[inference]` The object is stored as plaintext. A reference release is published, licensed external data, not the scientific files or consent evidence that RNF029/#566 classify encrypted at rest, and `assertFileEncryptionConfigured` would fail every import on a keyless deployment.

`[inference]` A dry run and a checksum mismatch preserve nothing. A dry run loads nothing, and the F2 integrity gate's action on a checksum or size mismatch is "Rejeitar asset" (`docs/extracted-v2.0.0/plano.md`).

`[inference]` No new field is written on the release, the run or an issue. The dictionary gives ReferenceDatasetRelease no asset field, and V2E-0263 `ReferenceCoverageManifest.assets` (array<uri>, 1..*, Core) is where the URI is recorded, in the AC6 slice.

`[inference]` "quando aplicável" is read as every source with a file artifact, which today is all 16 sources.

`[inference]` "Adquirir somente fontes aprovadas" is read as met by the fixed source registry in `api/backend/src/reference-data/reference-imports/sources/`: only a registered source can be imported. It is unchanged here.

## Not decided here

Later slices of #1319:

- **The coverage manifest and the DataQualityAssessment of a release** (RF028 AC6, AC7).
- **Explicit promotion, a rollback route and the AuditEvent of each** (RF028 AC8, AC9): decided in `2026-10-23-reference-release-explicit-promotion.md`.
- **Dictionary V2E-0489..0491.**
- **The essential-reference loader** `api/backend/scripts/load-essential-references.js`.
- **Serving or deleting a stored asset.**
