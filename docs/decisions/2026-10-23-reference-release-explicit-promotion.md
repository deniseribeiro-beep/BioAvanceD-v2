# 2026-10-23: an approved reference release is promoted explicitly, rolled back through a route, and each change writes an AuditEvent

Requirements RF028 AC8, AC9 and RNF032 C8, C9; dictionary V2E-0490, V2E-0491. Issue #1319.

## The question

RF028 AC8 asks to "Promover release explicitamente", AC9 to "Manter rollback para release anterior"; RNF032 C8 to "Ativar release explicitamente e manter rollback" and C9 to "Gerar AuditEvent". `runImport` (`api/backend/src/reference-data/reference-imports/pipeline.js`) promoted an approved full run itself, the moment it was approved; `rollbackRelease` had no route; neither wrote an AuditEvent; and the release model carried neither V2E-0490 `promotionApprovedBy` (Reference(Actor), 0..1, "Obrigatório quando active") nor V2E-0491 `rollbackTargetId` (Reference(ReferenceDatasetRelease), 0..1, "Release anterior para rollback"). Who promotes a release, when, how is a rollback asked for, and what records each?

## Decided

By the coordinator for #1319, on 2026-10-23:

1. **An approved full run promotes nothing.** Its release becomes `approved`, unless it is already `active`, which it stays. The write is made before the run's final update, so a crash between the two leaves a `running` run, whose resume registers a fresh release; the stale `approved` release has no completed run and is never promoted. The run's `recordsInserted`, `recordsUpdated` and `recordsSkipped` stay 0. A rejected run is unchanged, and a resumed run still reuses only a `downloaded`, `staged` or `active` release.
2. **`promoteRelease` in `api/backend/src/services/referenceRelease.service.js` promotes an `approved` release.** It requires a non-empty `approvedBy`, an `approved` release and a `completed` full run of that release whose `validationSummary.approved` is true; otherwise it writes nothing and returns `approver_required`, `release_not_found`, `release_not_approved` or `approved_run_not_found`. Before its first record write it claims the release, setting `promotionClaimedAt` on a release still `approved` whose claim is absent or older than ten minutes; a call that cannot claim writes nothing and returns `promotion_in_progress`, or `release_not_approved` once the release has left `approved`. It writes the concepts and relations staged by that run, each with its outbox event in one transaction as before, and only then sets the release `active` with `previousReleaseId` and `promotionApprovedBy`, clearing the claim, conditional on its still being `approved`, and supersedes the dataset's previous active release. A crash before the status write leaves the release `approved` with its claim, and a retry once the claim is stale skips the records already written. The run gets the record counts and the promotion's ORPHAN_RELATION issues.
3. **`rollbackRelease` moves to the same service,** with its checks, return shape and rollback run unchanged. The rolled-back release also gets `rollbackTargetId`, the id of the release reactivated.
4. **Each promotion and each rollback writes one AuditEvent** through `auditLogger.log`: action `PROMOTE` or `ROLLBACK`, resourceType `ReferenceDatasetRelease`, severity `critical`, module "Dados de referência", source `api` for a request and `system` otherwise. A refused promotion or rollback writes none.
5. **`ReferenceDatasetReleaseModel`** creates `promotionApprovedBy`, `rollbackTargetId` and `promotionClaimedAt` as null, requires `promotionApprovedBy` on an `active` release and requires `rollbackTargetId`, when present, to be a string.
6. **The 16 `import-<dataset>-reference-dataset.js` scripts promote the release of their own approved, completed full run** after the import, and print `promoted`, `promotionReason`, and as `recordsInserted` the promotion's count when it promoted, else the run's. A refused promotion is not an error: a re-run of an already active release returns `release_not_approved`.
7. **`POST /api/reference-releases/:id/promote` and `POST /api/reference-releases/datasets/:datasetCode/rollback`** call the service with the caller's `userID` as `approvedBy` or `initiatedBy`. A promotion or rollback answers 200; `release_not_found` and `no_active_release` 404; `approver_required` 403; `release_not_approved`, `promotion_in_progress`, `approved_run_not_found`, `no_previous_release` and `previous_release_not_found` 409; no database 503; a throw 500. A rollback without a `userID` answers 403. The audit middleware maps the `reference-releases` prefix to `ReferenceDatasetRelease`, and the routes are pinned in `api/backend/tests/rbac-pins/referenceRelease.pins.js`.

`[inference]` An approved run ends at `approved`, read off the order of `RELEASE_STATUSES` in `api/backend/src/models/ReferenceDatasetRelease.js` (`staged`, `approved`, `active`).

`[inference]` The bootstrap scripts promote with `approvedBy: 'system:reference-data-bootstrap'`, because RF028's primary actor is "Administrador / Sistema" and `runImport` already names that system actor in `initiatedBy`.

`[inference]` `rollbackTargetId` is written on the rolled-back release at rollback, naming the release reactivated, as `previousReleaseId` is written at the moment of the change (`2026-10-22-reference-release-registered-before-load.md`).

`[inference]` The routes take `requireRole(4)`, as `api/backend/src/routes/retentionPolicy.js` gates the Administrador's policy routes, and RF028's actor is the Administrador.

`[inference]` A reactivated release keeps its original `promotionApprovedBy`; the rollback actor is on the rollback run and its AuditEvent.

## Not decided here

Later slices of #1319:

- **The coverage manifest and the DataQualityAssessment of a release** (RF028 AC6, AC7; dictionary V2E-0489).
- **The essential-reference loader** `api/backend/scripts/load-essential-references.js`, whose manifest carries no license or retrieval URI.
