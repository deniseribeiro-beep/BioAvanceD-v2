# 2026-10-17: an import batch's tenancy key is its organizationId, and an unstamped batch only global scope reads

Issue #1385, following #1376 and #1384.

## Question

`import_batches` holds the batches of four import paths, told apart by `type`. Which field scopes each kind to an organization, and who reads a batch that carries none?

Three kinds are read back through `import.routes.js`:

- the **staging batch** of `POST /api/import/batch` (a `StagingImport`), read by `GET /batch/:jobId` and `GET /status/:jobId`;
- the **FHIR batch** (`type: 'FHIR_BUNDLE'`) of `POST /fhir/stage`, read and acted on by the six `/fhir/batches/:id...` routes;
- the **async quarantine batch** (`type: 'ASYNC_BATCH_IMPORT'`) that `quarantineRejectedRows` writes for the rows a staging batch rejects, read by `GET /batch/quarantine/:id`.

Until #1385 the FHIR and quarantine batches stored no organization, so their routes answered any caller holding `uploadFiles`.

## Decided

1. **The key is a scalar `organizationId`** (a string, or `null`): the value `resolveCallerCreateOrganization` returns for the uploader (#1376).
   - The staging batch carries it in `rawData.organizationId` (#1376, read since #1384).
   - The FHIR batch carries it on the batch document and on each staged record. `POST /fhir/stage` resolves it from the caller's scope, and the FHIR commit gives a new sample the batch's `organizationId`. An existing sample's organization is not moved.
   - The quarantine batch carries it on the batch document and on each quarantined row. The worker copies it from the staging batch's `rawData.organizationId`.
   - The LGPD batches keep their `organizationIds` array (#800). These two kinds use the scalar of #1376, because one upload resolves to exactly one organization.
2. **Reads follow the rule of #800.** A caller with organization scope reaches only a batch stamped with one of its organizations. An unstamped batch, made before this change or by a global caller who named no organization, is reached only by global scope. No scope passed means an internal caller, which is unfiltered. `isRecordInOrganizationScope` gives exactly this. A batch outside the caller's scope is refused 403, after the existing 404 for a missing batch or one of another type.
3. **The creator gets no carve-out.** Being the batch's `createdBy` grants no read the scope rule does not already give.
4. **The public consent-token routes stay unscoped.** The signed token is their authority, so `validateImportConsentToken` resolves the batch with no scope.

Why:

- **The repo already applies this rule twice.** `import-lgpd.service.js` scopes the LGPD quarantine this way (#800), and `getBatchImportStatus` scopes the staging batch this way (#1384). Neither has a creator carve-out.
- **No backfill is needed.** A legacy batch is still visible to global scope, and every new batch is stamped.

Made by the 2026-10-17 coordinator sitting on #1385, by inference from #800 and #1384; the owner may reverse it.
