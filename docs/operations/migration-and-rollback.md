# Migration and rollback: the three phases, their gates, and v1.3.0 to v2.0.0

Answers RNF006 C3 ("Referenciar o modelo canônico v2.0.0 e registrar changelog e migração."), its migration part, and RNF006 C4 ("Documentar as três fases, gates, releases de referência, ingestão e rollback."). Written 2026-11-13. It describes what the code does at this commit, nothing more; everything RNF006 C3 and C4 ask for that the code does not do is listed under [Gaps](#6-gaps), never as a procedure. Tracking issue: #1472.

Sources: `docs/extracted-v2.0.0/plano.md` (sections 3-6, 8-10), `docs/extracted-v2.0.0/persistencia-poliglota.md` (sections 12 and 14), `docs/extracted-v2.0.0/requisitos.md` (RNF006), `api/backend/package.json`, `package.json`, `compose.prod.yml`, `api/backend/Dockerfile.prod`, `api/backend/server.js`, `api/backend/src/config/env.js`, `api/backend/scripts/seed-essential-reference-data.js`, `api/backend/scripts/load-essential-references.js`, `api/backend/scripts/reference-imports/import-hpo-reference-dataset.js` (and its fifteen siblings), `api/backend/scripts/reference-imports/import-large-reference-dataset.js`, `api/backend/scripts/neo4j-canonical-rebuild.js`, `api/backend/scripts/graph-projection-reconcile.js`, `api/backend/src/foundation/readiness.js`, `api/backend/src/foundation/indexes.js`, `api/backend/src/foundation/essential-references.js`, `api/backend/src/foundation/rcs-readiness.js`, `api/backend/src/governance/registry.js`, `api/backend/src/models/CanonicalModelRelease.js`, `api/backend/src/models/ConfigurationRelease.js`, `api/backend/src/models/ReferenceDatasetRelease.js`, `api/backend/src/services/configurationRelease.service.js`, `api/backend/src/services/security.service.js`, `api/backend/src/services/referenceRelease.service.js`, `api/backend/src/interface/routes/security.routes.js`, `api/backend/src/interface/routes/referenceRelease.routes.js`, `api/backend/src/interface/routes/ingestion.routes.js`, `api/backend/src/ingestion/ingestionGateway.js`, `api/backend/src/ingestion/productionIngestion.js`, `api/backend/src/ingestion/ingestionTargets.js`, `api/backend/src/ingestion/quarantine.js`, `api/backend/src/reference-data/reference-imports/resolveSourceAsset.js`, `api/backend/src/utils/sampleBarcodeWindow.js`, every script under `api/backend/src/scripts/` that a `migrate:*`, `encryption:rewrite` or `files:migrate-legacy` script runs, and `docs/decisions/2026-10-29-production-reference-data.md`.

Related: [changelog-v2.0.0.md](changelog-v2.0.0.md) (the model release, the catalog the code loads, and what changed), [install-runbook.md](install-runbook.md), [configuration-runbook.md](configuration-runbook.md), [outbox-runbook.md](outbox-runbook.md), [backup-restore-runbook.md](backup-restore-runbook.md), [troubleshooting-runbook.md](troubleshooting-runbook.md).

## 1. How the scripts are run

Every `npm run` below is a script of `api/backend/package.json`, run from `api/backend` against the database its environment names (`MONGO_URI`, read through `api/backend/src/database/mongo.js`). In the production stack the backend image holds the whole of `api/backend` and Node with npm (`api/backend/Dockerfile.prod`), so the same script runs in the `backend` service, the way `npm run compose:prod:seed-admin` (root `package.json`) runs `createFirstAdmin.js` there:

```sh
docker compose --env-file .env.production -f compose.prod.yml exec backend npm run migrate:specimen-status-v2 -- --dry-run
```

Flags follow `--`. A script reads only the flags this document names for it; it ignores any other.

## 2. Phase 1: Foundation

### 2.1 What the plan requires

`plano.md` §4, steps F1.0 to F1.11: preflight, a dry-run with zero mutation, registration of the CanonicalModelRelease, invariant catalog and configuration releases, schemas (1644 elements, 146 entities, the 929 historical ids present), storage and indexes, outbox and audit, telemetry, physical topology, domain gates, reference mechanisms, interoperability, analytics readiness, verify, and a ReadinessReport that promotes only on `status=ready`. §3: dry-run before apply, verify after apply, a tested and traceable rollback. §8: each run is a FoundationDataRun with `executionMode` `validate`, `dry_run`, `apply`, `repair` or `rollback`. `persistencia-poliglota.md` §12: no real operational data in Phase 1, and the gate is every P0, the invariants, version parity and the zero-operational-data post-condition.

### 2.2 What the code does

- **The job**: `api/backend/scripts/seed-essential-reference-data.js`. `compose.prod.yml` runs it as the one-shot service `foundation` (`restart: "no"`, after `mongodb` is healthy). `backend`, `worker` and `neo4j-projection-worker` depend on it with `service_completed_successfully`.
- **One apply run** (no flag) records a FoundationDataRun (collection `foundationDataRuns`) and does, in order: the dry-run checks; the `entities` step (the v2.0.0 catalog from `api/backend/src/reference-data/canonical-dictionary/v2.js`); the configuration seeds `governance-registry` (the CanonicalModelRelease and GovernanceInvariantCatalog, `registerGovernance` in `api/backend/src/governance/registry.js`), `rbac-catalog` and `report-templates`; the `indexes` step (`buildFoundationIndexes` in `api/backend/src/foundation/indexes.js`); verify; then a ReadinessReport (collection `readinessReports`). Each completed step records a checkpoint with the `_id`s it inserted.
- **The gates** the run evaluates, each P0: `version` (the release id and the dictionary checksum against the previous completed run), `schemas` (the catalog's completeness, 929 historical ids included), `governance-registry` (a registered release or catalog whose checksum no longer matches is a conflict), `configuration` (every active ConfigurationRelease has a passed validation run), `reference-mechanisms` (every essential-reference loader loads and every planned doc carries its unique keys, `api/backend/src/foundation/essential-references.js`), `rcs` (`rcsReadinessGate` in `api/backend/src/foundation/rcs-readiness.js`), `storage-constraints` and the other index gates, `zero-operational-data` (the counts of `patients`, `participantIdentities`, `consents`, `samples`, `sampleMovements`, `encounters`, `rcsAssessments` and `accessRequests` do not grow during apply) and `zero-reference-data` (the essential set's reference collections do not grow). The plan's other §9 gates are written to the report as `not_evaluated` (`DEFERRED_P0_GATES` in `api/backend/src/foundation/readiness.js`); see [Gaps](#6-gaps).
- **Deferred preparations**: the apply run writes the `quarantine`, `outbox` and `audit` preparations into its steps with status `deferred`, each with the phase that brings it (`DEFERRED_PREPARATIONS` in `api/backend/scripts/seed-essential-reference-data.js`); the job builds none of them. It has no step of its own for the plan's telemetry (F1.5a), physical topology (F1.5b), interoperability (F1.8) or analytics-readiness (F1.9) preparations either: its `indexes` step builds, among the others, the indexes of the physical chain (`ensureContainerIndexes`, `ensureSpecimenContainerAssignmentIndexes`, `ensureContainerPositionAssignmentIndexes`, `ensureRackLocationAssignmentIndexes`), of StorageLocation, LabelIdentifier and ScanEvent, and of TelemetryExposureSummary (`ensureTelemetryExposureSummaryIndexes`), as `INDEX_TARGETS` in `api/backend/src/foundation/indexes.js`), and of F1.6's domain gates it evaluates only `rcs`. See [Gaps](#6-gaps).
- **Where the gate holds**: the job exits 0 only on a `ready` report (2 on a blocked one), which holds the dependent services back. The API then re-checks: with `FOUNDATION_READINESS_REQUIRED` set (`compose.prod.yml` sets it on `backend`), `api/backend/server.js` calls `assertReadiness`, which refuses to start unless the newest ReadinessReport for `NODE_ENV` is `ready` and names `CANONICAL_MODEL_RELEASE_ID` (`release-2.0.0`).
- The run records `migrationPlanId` as `MIGRATION_PLAN_ID` (`migration-1.3.0-to-2.0.0`) and a `reportUri` naming the run document by id and content checksum (`urn:bioavanced:foundation-data-run:...`).

### 2.3 The steps, as scripts

```sh
npm run seed:essential:list
npm run seed:essential:dry-run
npm run seed:essential
npm run seed:essential -- --verify
```

- `seed:essential:list`: prints the essential manifest; touches no database.
- `seed:essential:dry-run` (`--dry-run`): a `dry_run` FoundationDataRun; plans and validates, mutates nothing else; exit 0 when the dry-run passed.
- `seed:essential` (no flag): the apply run of section 2.2.
- `--verify`: a `validate` run; re-evaluates the gates against the newest completed apply and writes a new ReadinessReport. With no completed apply on record the report carries the blocker `no_completed_apply`.
- `--only=<key>`: restricts the run to one essential manifest entry.

In production the `foundation` service runs the apply form at every `docker compose ... up`; the dry-run and verify forms run in the `backend` service as in section 1.

### 2.4 Rollback

```sh
npm run seed:essential -- --rollback
```

`--rollback` writes a `rollback` FoundationDataRun naming, in `validationSummary.rollbackTargetRunId`, the newest passed apply that no rollback has named yet, and deletes the `_id`s that apply's checkpoints recorded. Runs are append-only: the apply run is not edited. Indexes stay. The ReadinessReport written after it is blocked (`rolled_back:<run id>`), so the API does not start on it until the next apply. A CanonicalModelRelease that is registered is never rewritten (`api/backend/src/models/CanonicalModelRelease.js`, `createActive` sets `supersedesId` to null); there is no route or script that supersedes or rolls it back.

## 3. Phase 2: Reference data

### 3.1 What the plan requires

`plano.md` §5, steps 1-9: register a ReferenceDatasetRelease (origin, licence, version, checksum, format, parser, mapping); acquire approved assets only; load into isolated staging and check integrity; normalize; record a ReferenceImportIssue and quarantine per line or field; generate a ReferenceCoverageManifest; run a DataQualityAssessment; approve and promote, publishing the outbox and projecting into Neo4j; reconcile and test the rollback to the previous release. Gate F2: integrity, licence, parser and mapping, coverage, quality, projection.

### 3.2 What the code does

- **The essential set** (MIABIS minimal, SPREC minimal, RCS-GOV 1.0): `api/backend/scripts/load-essential-references.js`, the one-shot service `essential-references` of `compose.prod.yml`, which depends on `foundation` completing; `backend` depends on it. It runs only when the newest ReadinessReport for the environment is `ready` (else it loads nothing and exits 1, blocked `no_readiness_report` or `foundation_<status>`). Per entry it writes a ReferenceImportRun linked to that Foundation run; a full run registers the ReferenceDatasetRelease before the load, upserts with `$setOnInsert` (a re-run inserts nothing), writes the coverage manifest and quality assessment, sets the release approved or rejected, and promotes an approved one through `promoteRelease` (`api/backend/src/services/referenceRelease.service.js`). After `rcs-gov-1.0` is active it writes the RCSRulePackage of the running rules when it validates. Exit 1 when a run failed or a completed entry's release is not `active`. Rule: [essential-reference releases](../decisions/2026-10-23-essential-reference-releases.md).
- **The full packs**: sixteen importers under `api/backend/scripts/reference-imports/` (`import-<source>-reference-dataset.js`, for HPO, MONDO, ORPHA, ICD-11, ICD-10, OMIM, HGNC, LOINC, UCUM, DCB, ATC, DUO, UBERON, NCBITaxon, CL and EDAM). A full run promotes its own release through `promoteRelease` only when the run completed and its validation approved it; a refused promotion does not fail the script. The source asset is the bundled fixture by default; with `REFERENCE_IMPORT_PROFILE` set to `full-lab` it is a dump placed by the operator under `REFERENCE_FULL_ASSET_DIR` (`resolveSourceAsset.js`); no importer downloads. In production these are not compose services: they are operator-run against a live stack, or arrive inside a restore (`docs/decisions/2026-10-29-production-reference-data.md`). `import-large-reference-dataset.js` (`reference:import:plan`) is a non-operational placeholder.
- **Promotion and its gate**: `promoteRelease` refuses a release without a passing coverage manifest and quality assessment ([coverage manifest](../decisions/2026-10-23-reference-release-coverage-manifest.md)) and inserts each new TerminologyConcept with its outbox event in one transaction where the deployment supports one (`appendTerminologyConceptEvent`), which the Neo4j projection worker then projects. It writes an AuditEvent ([explicit promotion](../decisions/2026-10-23-reference-release-explicit-promotion.md)). An administrator can promote through `POST /api/reference-releases/:id/promote` (`referenceRelease.routes.js`, role level 4).

### 3.3 The steps, as scripts

```sh
npm run seed:essential:list
npm run reference:load:essential:dry-run
npm run reference:load:essential
npm run reference:import:hpo:dry-run
npm run reference:import:hpo
```

- `reference:load:essential:dry-run` (`--dry-run`): loads and checks each entry and writes only its ReferenceImportRun; registers no release. `reference:load:essential` accepts `--only=<key>` as well.
- Each `reference:import:<source>:dry-run` passes `--dry-run`; its full form loads and promotes as in section 3.2. The sixteen pairs are named the same way (`reference:import:mondo`, `reference:import:ucum`, and so on).

### 3.4 Rollback

There is no npm script for a reference rollback; it is the route `POST /api/reference-releases/datasets/:datasetCode/rollback` (role level 4), calling `rollbackRelease`. It moves one step: the dataset's `active` release becomes `rolled_back` with `rollbackTargetId` naming the release before it, and that one, named by the active release's `previousReleaseId`, becomes `active` again. It deletes nothing: both releases stay in `referenceDatasetReleases`, the TerminologyConcept and TerminologyRelation documents are untouched, a `rollback` ReferenceImportRun is written and an AuditEvent records it. It refuses with `no_active_release`, `no_previous_release` or `previous_release_not_found`. Before promotion, a failed or rejected release is simply never promoted; it stays `rejected` with its run and issues.

## 4. Phase 3: Operational and scientific data

### 4.1 What the plan requires

`plano.md` §6, steps 10-23: receive a canonical payload with source system, source record id, release, configuration and correlation; validate schema, types, cardinalities, active references, units and missingness; separate identity before projection or export; evaluate collection governance, consent, purpose and AccessPolicy; persist each kind in its authoritative store (MongoDB, InfluxDB, object storage); the outbox in the aggregate's transaction; audit; RCS under its full contract; quality assessment. `persistencia-poliglota.md` §12: the gate is consent and purpose, provenance, active references, quality, security and audit.

### 4.2 What the code does

- **No phase job**: Phase 3 is the running API. Its readiness gate is Phase 1's (`assertReadiness`, section 2.2); there is no FoundationDataRun or ReadinessReport for Phase 3.
- **Ingestion**: `POST /api/ingestion/records` (`api/backend/src/interface/routes/ingestion.routes.js`, role levels 3 and 4). The gateway (`api/backend/src/ingestion/ingestionGateway.js`) composes idempotency, the provenance envelope, the canonical-contract and reference-existence checks and the active-code check, and quarantines on any violation instead of correcting or dropping. `api/backend/src/ingestion/productionIngestion.js` persists an accepted record into its store with its `INGESTION_RECORD_PERSISTED` outbox event in the same transaction where the deployment runs one, and every outcome carries the `canonicalModelReleaseId` and the `configurationReleaseId`. The entity types it persists are those of `api/backend/src/ingestion/ingestionTargets.js`: Dataset, WorkflowRun, OmicsQualification, Assay, OmicsRun, Specimen, Participant and Consent. TelemetryReading, DataFile and DataFileVersion are refused 422 `INGESTION_STORE_UNSUPPORTED`, naming their store and route. The route audits every outcome.
- **Quarantine**: `api/backend/src/ingestion/quarantine.js` writes an IngestionQuarantineRecord (collection `ingestionQuarantineRecords`, `COLL_INGESTION_QUARANTINE_RECORDS`) with `resolutionStatus` `open`. `resolveQuarantineRecord` moves it once to a terminal status with who, when and why, and never overwrites a resolution; no route calls it (see [Gaps](#6-gaps)).
- **Other live paths**: registration, consent, telemetry and file routes write operational data directly; their rules are the decisions listed in [changelog-v2.0.0.md](changelog-v2.0.0.md).

### 4.3 The migration from v1.3.0 data, as scripts

A deployment holding data written under v1.3.0 is brought to v2.0.0 by one-off scripts, each its own npm script. The code names no order among them and records no run of them beyond what each prints. One order is stated in a header: `files:migrate-legacy` moves the disk binaries into the object store, after which `encryption:rewrite` can re-encrypt them (`migrateLegacyFileBinaries.js`), so the two come last. Each script with `--dry-run` counts and writes nothing; without it, it writes.

```sh
npm run migrate:auth-canonical-names -- --dry-run
npm run migrate:auth-canonical-names
npm run migrate:participant-identity-ids -- --dry-run
npm run migrate:participant-identity-ids
npm run migrate:participant-identity-ciphertext-names -- --dry-run
npm run migrate:participant-identity-ciphertext-names
npm run migrate:participant-record-numbers -- --dry-run
npm run migrate:participant-record-numbers
npm run migrate:participant-birth-dates -- --dry-run
npm run migrate:participant-birth-dates
npm run migrate:sample-organization -- --dry-run
npm run migrate:sample-organization
npm run migrate:specimen-role -- --dry-run
npm run migrate:specimen-role
npm run migrate:specimen-status-v2 -- --dry-run
npm run migrate:specimen-status-v2
npm run migrate:sample-barcode-labels -- --dry-run
npm run migrate:sample-barcode-labels
npm run migrate:facilities-rooms-to-locations -- --dry-run
npm run migrate:facilities-rooms-to-locations
npm run migrate:storage-assignments-to-chain -- --dry-run
npm run migrate:storage-assignments-to-chain
npm run migrate:sensor-metadata-to-datastreams -- --dry-run
npm run migrate:sensor-metadata-to-datastreams
npm run files:migrate-legacy
npm run files:migrate-legacy -- --apply
npm run encryption:rewrite
npm run encryption:rewrite -- --apply
```

| npm script | What it does (its file's header) | Flags |
|---|---|---|
| `migrate:auth-canonical-names` | `users` and `sessions` documents still carrying a legacy name move to their dictionary names (`migrateAuthCanonicalNames.js`). | `--dry-run` |
| `migrate:participant-identity-ids` | Sets a missing `participantIdentityId` and `identityStatus` (`migrateParticipantIdentityIds.js`). | `--dry-run` |
| `migrate:participant-identity-ciphertext-names` | Moves `<field>Encrypted` to `<field>Ciphertext` (`migrateParticipantIdentityCiphertextNames.js`). | `--dry-run` |
| `migrate:participant-record-numbers` | Moves a plaintext `patients.recordNumber` onto the identity as ciphertext and hash (`migrateParticipantRecordNumbers.js`). | `--dry-run` |
| `migrate:participant-birth-dates` | Rewrites a midnight birth date to 12:00 UTC and recomputes its blind index (`migrateParticipantBirthDates.js`). | `--dry-run` |
| `migrate:sample-organization` | Sets `Sample.organizationId` from `collectionSite` (`migrateSampleOrganization.js`). | `--dry-run` |
| `migrate:specimen-role` | Gives a stored sample its `specimenRole` (`migrateSpecimenRole.js`). | `--dry-run` |
| `migrate:specimen-status-v2` | v1.3.0 `specimenStatus` to the v2 set, `quantityStatus` derived, `destroyed`/`disposed` closed only with an executed DispositionAction, the original kept in `legacySpecimenStatus` (`migrateSpecimenStatusV2.js`). | `--dry-run` |
| `migrate:sample-barcode-labels` | Issues each stored `Sample.barcode` as a LabelIdentifier; the sample document is not modified (`migrateSampleBarcodeLabels.js`). | `--dry-run` |
| `migrate:facilities-rooms-to-locations` | Mirrors each Facility and Room as a StorageLocation; facilities and rooms are only read (`migrateFacilitiesRoomsToLocations.js`). | `--dry-run`, `--organization-id <id>` |
| `migrate:storage-assignments-to-chain` | Historical StorageAssignment rows become the physical chain; `storageAssignments` is only read (`migrateStorageAssignmentsToChain.js`). | `--dry-run` |
| `migrate:sensor-metadata-to-datastreams` | Each SensorMetadata binding becomes a temperature TelemetryDatastream; its sources are only read (`migrateSensorMetadataToDatastreams.js`). | `--dry-run`, `--sampling-policy-id <id>` |
| `files:migrate-legacy` | Moves the binaries of legacy disk DataFile rows into the object store; the disk file is never removed (`migrateLegacyFileBinaries.js`). | dry run by default; `--apply` writes |
| `encryption:rewrite` | Re-encrypts every registered encrypted field under the active `ENCRYPTION_KEY` (`rewriteEncryptedFields.js`). | dry run by default; `--apply` writes; `--all` selects every envelope, not only those under another key |

Older one-off scripts take no flag and write on every run: `migrate:rcs`, `migrate:location-storage`, `migrate:user-role-assignments`, `migrate:clinical-unit-organizations`, `migrate:role-assignment-scopes`, `migrate:user-anon-ids`, `migrate:user-organizations`, `migrate:participant-identities`, `migrate:result-specimen-ids`, `migrate:sealed-snapshot-pins`, `migrate:security-config-keys`, `migrate:consent-token-hash` and `migrate:drop-legacy-locations`. The headers of `migrate:role-assignment-scopes` and `migrate:consent-token-hash` state that a second run changes nothing; `migrate:drop-legacy-locations` drops the legacy `locations` collection.

After the data scripts, the graph is rebuilt from MongoDB and checked:

```sh
npm run neo4j:canonical:rebuild
npm run neo4j:projection:reconcile
npm run neo4j:projection:reconcile -- --repair
```

`neo4j:canonical:rebuild` (`api/backend/scripts/neo4j-canonical-rebuild.js`) appends the canonical outbox events of every stored participant, consent and sample and projects them; `neo4j:projection:reconcile` reports stopped or missing projections and, with `--repair`, requeues their dead letters or appends their events again (`api/backend/scripts/graph-projection-reconcile.js`). The [outbox-runbook.md](outbox-runbook.md) covers both.

### 4.4 Rollback

- **Live writes**: none of the ingestion or registration paths has a rollback; a quarantined ingestion record is kept, not deleted.
- **Data migrations**: no migration script has a rollback mode. What each preserves instead is in its header: `migrate:specimen-status-v2` keeps the v1.3.0 value in `legacySpecimenStatus`; `migrate:sample-barcode-labels` leaves `Sample.barcode` in place; `migrate:storage-assignments-to-chain`, `migrate:facilities-rooms-to-locations` and `migrate:sensor-metadata-to-datastreams` only read their sources; `files:migrate-legacy` never removes the disk file. A return to the state before a migration is a restore of a backup taken before it ([backup-restore-runbook.md](backup-restore-runbook.md)).
- **Configuration**: a configuration change is a new ConfigurationRelease superseding the active one (`supersedesId`). A rollback is `POST /api/security/config/rollback` with a `configurationReleaseId` (`security.routes.js`, `rollbackConfig` in `security.service.js`): a new release carrying the earlier release's settings, whose `rollbackTargetId` names it, through the same validation and audit as any change, with a ConfigurationChangeEvent of `changeType` `rolled_back` (`api/backend/src/services/configurationRelease.service.js`). The old release is never reactivated or rewritten. The [configuration-runbook.md](configuration-runbook.md) covers it.
- **Graph**: Neo4j is rebuilt from MongoDB through the outbox (section 4.3).
- **Files**: a replace writes DataFileVersion rows and keeps the previous binary ([data-file versions](../decisions/2026-10-22-data-file-versions.md)).

## 5. persistencia-poliglota.md section 14, step by step

| Step (§14) | Where the code does it |
|---|---|
| 1. Freeze and verify the checksums of v1.3.0 and of the final v2.0.0 | `registerGovernance` registers the CanonicalModelRelease with the sha256 of each artifact of `docs/RELEASE_MANIFEST.json` and of the generated catalog, and reports a conflict when a registered checksum moves (`governance-registry` gate); the `version` gate compares the dictionary checksum with the previous completed run. The v1.3.0 catalog is checked only by id (step 2); no v1.3.0 checksum is frozen. |
| 2. Dry-run with an inventory of the 929 historical ids | `npm run seed:essential:dry-run`; the `schemas` gate checks that every v1.3.0 element id of `catalog.1.3.0.json` is in `catalog.2.0.0.json` (`v2.js`). |
| 3. Keep maintained fields; complete the companions of altered entities | The per-entity scripts of section 4.3 (`migrate:auth-canonical-names`, `migrate:participant-identity-*`, `migrate:participant-record-numbers`, `migrate:sample-organization`, `migrate:specimen-role`, and the older ones). No script covers every altered entity; see [Gaps](#6-gaps). |
| 4. `specimenStatus`: partial/depleted to `quantityStatus`; destroyed needs a DispositionAction | `npm run migrate:specimen-status-v2`. A specimen with no executed disposition becomes `unavailable` and is listed as needing disposition evidence. |
| 5. Consent booleans to ConsentPermission, keeping the source values | No script. See [Gaps](#6-gaps). |
| 6. `barcodeValue` to LabelIdentifier, and block new writes to the legacy field | `npm run migrate:sample-barcode-labels`; once `SAMPLE_BARCODE_WINDOW_CLOSED` is set, an insert drops `barcode` and an update naming it is refused (`api/backend/src/utils/sampleBarcodeWindow.js`). |
| 7. Collection governance contexts, and no activation without compatibility | No migration script. See [Gaps](#6-gaps). |
| 8. Outbox events only from the canonical source; rebuild Neo4j and reconcile | `npm run neo4j:canonical:rebuild`, `npm run neo4j:projection:reconcile` (section 4.3). |
| 9. Verify, ReadinessReport, promote only without P0 blockers | `npm run seed:essential -- --verify`; `assertReadiness` at API start. Seven P0 gates are `not_evaluated` (section 2.2). |
| 10. Keep the rollback to the previous release without reusing ids or overwriting evidence | Foundation `--rollback` (section 2.4), reference `rollbackRelease` (section 3.4), configuration rollback (section 4.4); the data scripts keep their sources (section 4.4). |

## 6. Gaps

| Criterion | What the code does today | Gap |
|---|---|---|
| RNF006 C3, migration (`persistencia-poliglota.md` §14 step 5) | Consents are kept as decision events and revocations; a consent written before that history has no rows and is read as accepted ([consent history](../decisions/2026-10-08-consent-history.md), item 9). | Not implemented: a script that normalizes the v1.3.0 Consent booleans into ConsentPermission. |
| RNF006 C3, migration (§14 step 7) | A collection's governance context, approvals and conversion event are written by the live API ([collection governance](../decisions/2026-10-08-collection-governance.md)). | Not implemented: a migration script that adds governance contexts to collections stored under v1.3.0. |
| RNF006 C3, migration (§14 steps 1 and 3) | The v1.3.0 catalog is checked by element id; the data scripts each cover one entity or field. | Not implemented: a frozen v1.3.0 checksum, and one migration plan run that orders the data scripts, records which ran, and covers every altered entity; `MIGRATION_PLAN_ID` is only a name the FoundationDataRun carries. |
| RNF006 C4, rollback of a data migration | The data scripts keep their source values (section 4.4). | Not implemented: a rollback mode for any `migrate:*`, `files:migrate-legacy` or `encryption:rewrite` script; the way back is a restore. |
| RNF006 C4, gates (`plano.md` §9) | The Foundation job evaluates version, schemas, governance, configuration, reference mechanisms, `rcs`, indexes and zero data. | Not implemented: the `biobank-biorepository`, `consent`, `specimen`, `identification`, `persistence`, `fhir` and `ai-ready` gates, reported `not_evaluated` (`DEFERRED_P0_GATES`). |
| RNF006 C4, Foundation preparations (`plano.md` §4) | The apply run records `quarantine`, `outbox` and `audit` as steps with status `deferred` (`DEFERRED_PREPARATIONS` in `api/backend/scripts/seed-essential-reference-data.js`); its `indexes` step builds the indexes `INDEX_TARGETS` names. | Not implemented: the Foundation preparation of quarantine, outbox and audit (F1.5, F1.7's quarantine); and a Foundation step of its own for telemetry (F1.5a), physical topology and the ex ante protocol registry (F1.5b), interoperability mapping releases, profiles and namespaces (F1.8) and analytics readiness (F1.9), beyond the indexes the `indexes` step builds. |
| RNF006 C4, Foundation modes (`plano.md` §8) | `apply`, `dry_run`, `validate` and `rollback`. | Not implemented: the `repair` mode; and a report in object storage (the `reportUri` names the run document in MongoDB). |
| RNF006 C4, CanonicalModelRelease rollback (`plano.md` §10) | A registered release is never rewritten; `supersedesId` is always null. | Not implemented: superseding or rolling back a CanonicalModelRelease. |
| RNF006 C4, reference rollback | `POST /api/reference-releases/datasets/:datasetCode/rollback`, one step back. | Not implemented: an npm script or compose service for it, and a rollback test run against production data. |
| RNF006 C4, ingestion quarantine | `resolveQuarantineRecord` exists in `api/backend/src/ingestion/quarantine.js`. | Not implemented: a route or script that resolves a quarantined ingestion record, and any re-submission of one. |
| RNF006 C4, Phase 3 gate | Phase 3 runs behind the Phase 1 ReadinessReport only. | Not implemented: a Phase 3 run record or readiness report of its own. |
