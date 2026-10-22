# 2026-10-22: a reference import registers its ReferenceDatasetRelease before the load, and that release ends `active` or `rejected`

Requirement RF028 AC1. Issue #1319.

## The question

RF028 AC1 asks to register origin, version, license, URI, checksum, format, parserVersion and mappingVersion before the load ("antes da carga"). `runImport` (`api/backend/src/reference-data/reference-imports/pipeline.js`) wrote the ReferenceDatasetRelease only inside `promote()`, after staging: every run staged with `referenceDatasetReleaseId: null`, and a run that was not approved left no release at all. When is the release registered, which runs register one, which status does it move through, and what links to it?

## Decided

By the coordinator for #1319, on 2026-10-22:

1. **A full run registers its release after the integrity check and before its first staging write.** It reuses the release its resumed `running` run already names, else the dataset's `active` release when that one holds the same `systemUri`, `datasetVersion` and checksum, else it inserts a new release in status `downloaded`. A fresh run is created carrying the release id; a resumed run whose stored id is null or names no release gets the resolved id.
2. **The registration is validated on every run, a dry run included,** with `ReferenceDatasetReleaseModel.validate`. If it fails, no release is written, nothing is staged, and the run ends `failed` with one fatal `RELEASE_REGISTRATION_INVALID` issue whose message joins the validation errors; a `running` run is set to `failed` rather than a second run being created.
3. **After staging, a release not `active` becomes `staged`.**
4. **Promotion activates the registered release** instead of creating one. A release already `active` is left as it is; otherwise the dataset's other `active` release becomes its `previousReleaseId` and is superseded, never deleted.
5. **A full run that is not approved sets its release to `rejected`,** and never touches an `active` one.
6. **The release id is on the run, on every issue and on the returned `releaseId` for every full run,** approved or not, and on each promoted concept and relation. A dry run keeps null on the run and `unresolved` on its issues.
7. **A resumed run keeps its registered release only while that release is `downloaded`, `staged` or `active`.** A release since `superseded`, `rolled_back` or `rejected` is history: the resume never reactivates it or rewrites its `previousReleaseId`. The run registers a new release, whose `previousReleaseId` is the dataset's current active release at promotion, and the run's `referenceDatasetReleaseId` is set to it.

`[inference]` A dry run registers no release: it loads nothing, so AC1's "antes da carga" has nothing to precede.

`[inference]` A checksum mismatch registers no release: integrity is the acquire gate, and its run and fatal `CHECKSUM_MISMATCH` issue already record it.

`[inference]` The status path is `downloaded` → `staged` → `active` | `rejected`, read off the order of `RELEASE_STATUSES` in `api/backend/src/models/ReferenceDatasetRelease.js`.

`[inference]` `previousReleaseId` is set at promotion, not at registration, since the dataset's active release can change between the two.

The idempotent short-circuit, the checksum branch and `rollbackRelease` are unchanged.

## Not decided here

Later slices of #1319:

- **Asset preservation in object storage** (RF028 AC2).
- **The coverage manifest and the DataQualityAssessment of a release** (RF028 AC6, AC7).
- **Explicit promotion, a rollback route and the AuditEvent of each** (RF028 AC8, AC9).
- **Dictionary V2E-0489..0491.**
- **The essential-reference loader** `api/backend/scripts/load-essential-references.js`, whose manifest carries no license or retrieval URI.
