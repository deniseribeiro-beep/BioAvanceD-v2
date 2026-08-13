# Reference Data Seeding

MongoDB remains the operational source of truth. Neo4j remains an outbox-fed projection. FHIR stays a serialization and interoperability boundary.
The backend architecture and contract checks in this repo use Node's native `node:test` runner, not Vitest.

The canonical `api/backend/src/services/fhir.service.js` surface is intentionally reduced to:

- `toFhirPatient`
- `toFhirSpecimen`
- `toFhirConsent`
- `resultToFHIR`
- `temperatureToFHIR`
- `validateFHIRResource`

## Strategy

Reference data is split into two phases:

1. Essential seed, small and deterministic.
2. Large imports, deferred until the data model for the UI surfaces is finalized.

## Essential seed

The essential manifest currently includes only:

- `RCS-GOV`
- `MIABIS` minimal
- `SPREC` minimal
- roles or permissions only when operational tests need them

The essential seed is manual, idempotent, and never runs automatically at startup.

### Available commands

- `npm --prefix api/backend run seed:essential:list`
- `npm --prefix api/backend run seed:essential:dry-run`
- `npm --prefix api/backend run seed:essential`
- `npm --prefix api/backend run seed:validate:essential`
- `npm --prefix api/backend run test:architecture` runs architecture/contract checks with `node --test`

## Large imports

The large import scaffold (`scripts/reference-imports/import-large-reference-dataset.js`) is intentionally non-operational — it only validates arguments and prints a plan.

Deferred datasets (no operational importer yet):

- ORPHA
- CID / ICD
- OMIM
- MONDO
- HGNC
- LOINC
- UCUM
- medications / DCB / ATC
- disease-phenotype relations

### RF028 first importer: HPO

HPO is the first Fase 2 source with an operational importer (#367), per
`docs-7-27-2026/3-Plano_Integrado_Foundation_Data_Pipeline.md` §7.4's
recommended Fase 2 order. It lives in
`src/reference-data/reference-imports/` (separate module from the essential
seed) and is invoked by `scripts/reference-imports/import-hpo-reference-dataset.js`
(`npm run reference:import:hpo` / `reference:import:hpo:dry-run`), wired into
`compose.dev.yml` as the `reference-data-bootstrap` one-shot service (runs
after `foundation-bootstrap` completes).

It writes to five new collections — `referenceDatasetReleases`,
`referenceImportRuns`, `referenceImportIssues`, `terminologyConcepts`,
`terminologyRelations` — modeled in `src/models/` per
`dict-02_DICIONARIO.md`'s ReferenceDatasetRelease/ReferenceImportRun/
ReferenceImportIssue/TerminologyConcept/TerminologyRelation rows.

This first slice imports a small bundled fixture
(`reference-imports/fixtures/hpo-sample.jsonl`), not a live HPO release
download — dict-01_FONTES.md's SRC_HPO row lists the license as "verify at
ingestion time" rather than a fixed value, and this repo keeps import
scripts free of live network calls (`reference-import-boundary.arch.test.js`).
Live download, real license verification, checkpoint/resume, quarantine
recovery, rollback, and Neo4j outbox projection are follow-up scope,
together with the remaining 15 Fase 2 sources.

## Runtime guarantees

- No seed is called from `app.js`, `server.js`, `worker.js`, or Compose.
- The application database stays empty on startup.
- Seed validation runs structurally without requiring a database.
- The essential seed uses stable upserts and never deletes data.

## Relation to the consolidated dictionary

The consolidated dictionary still describes the current vocabulary surface, but it does not imply that all large reference datasets are modeled or imported yet. This PR only establishes the infrastructure for the essential seed and the later import scaffolds.
