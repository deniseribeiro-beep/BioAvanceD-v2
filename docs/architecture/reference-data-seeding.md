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

The large import scaffold (`scripts/reference-imports/import-large-reference-dataset.js`) is a separate, still-intentionally-non-operational placeholder — it only validates arguments and prints a plan. It is not where the real Fase 2 work landed; see below.

### RF028: all 16 Fase 2 sources have operational importers

As of #549's close (EDAM, the sixteenth and final source), every Fase 2
source named in `docs-7-27-2026/3-Plano_Integrado_Foundation_Data_Pipeline.md`
§7.4's recommended order has its own operational importer script under
`scripts/reference-imports/`: HPO (#367, the pilot), MONDO (#548), ORPHA,
ICD-10, ICD-11, OMIM, HGNC, LOINC, UCUM, DCB, ATC, DUO, Uberon, NCBI
Taxonomy, Cell Ontology, and EDAM (#549). Each follows the same
`npm run reference:import:<source>` / `reference:import:<source>:dry-run`
pair (e.g. `reference:import:hpo`) and lives in
`src/reference-data/reference-imports/` (separate module from the
essential seed), wired into `compose.dev.yml` as a chained
`reference-data-bootstrap[-<source>]` one-shot service (runs after
`foundation-bootstrap` completes, each source depending on the previous
one in the chain).

Each importer writes to the same five collections — `referenceDatasetReleases`,
`referenceImportRuns`, `referenceImportIssues`, `terminologyConcepts`,
`terminologyRelations` — modeled in `src/models/` per
`dict-02_DICIONARIO.md`'s ReferenceDatasetRelease/ReferenceImportRun/
ReferenceImportIssue/TerminologyConcept/TerminologyRelation rows.

Every source imports from a small bundled fixture under
`reference-imports/fixtures/`, not a live release download — this repo
keeps `src/reference-data/reference-imports/` free of live network calls
(`reference-import-boundary.arch.test.js`). Checkpoint/resume and
quarantine recovery (#551) have landed in `pipeline.js`/`quarantine.js`,
shared by all 16 sources. Rollback and Neo4j outbox projection remain
follow-up scope.

### Live download / license verification (#555/#556/#557)

Live download and real license verification are no longer purely
follow-up scope. `scripts/reference-imports/live-verify/` — deliberately
separate from the fixture-only importers above, per the same
`reference-import-boundary.arch.test.js` boundary — runs a
`workflow_dispatch`-only verify job against each source's real upstream:
`liveVerifySources.js` is now a 16-entry registry (all Fase 2 sources
populated, closing out RF028's live-verify build-loop), and
`verify-live-release.js` supports the different verification shapes those
16 sources actually need (GitHub releases API, a stable direct-download
URL, a redirect-to-latest-version page, a fixed-edition browse page, a
REST info/version endpoint, a GitHub release with no attached assets, or
`not-live-verifiable` for the two sources — OMIM, LOINC — whose upstream
blocks automated requests entirely). See `liveVerifySources.js`'s own
header comment for the per-`kind` rationale and confirmation dates.

## Runtime guarantees

- No seed is called from `app.js`, `server.js`, `worker.js`, or Compose.
- The application database stays empty on startup.
- Seed validation runs structurally without requiring a database.
- The essential seed uses stable upserts and never deletes data.

## Relation to the consolidated dictionary

The consolidated dictionary still describes the current vocabulary surface, but it does not imply that all large reference datasets are modeled or imported yet. This PR only establishes the infrastructure for the essential seed and the later import scaffolds.
