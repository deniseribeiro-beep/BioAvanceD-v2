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

The large import scaffold is intentionally non-operational in this PR. The placeholder script only validates arguments and prints a plan.

Deferred datasets include:

- HPO
- ORPHA
- CID / ICD
- OMIM
- MONDO
- HGNC
- LOINC
- UCUM
- medications / DCB / ATC
- disease-phenotype relations

## Runtime guarantees

- No seed is called from `app.js`, `server.js`, `worker.js`, or Compose.
- The application database stays empty on startup.
- Seed validation runs structurally without requiring a database.
- The essential seed uses stable upserts and never deletes data.

## Relation to the consolidated dictionary

The consolidated dictionary still describes the current vocabulary surface, but it does not imply that all large reference datasets are modeled or imported yet. This PR only establishes the infrastructure for the essential seed and the later import scaffolds.
