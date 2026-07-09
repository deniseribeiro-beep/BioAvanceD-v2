# Canonical data cleanup

This branch establishes the foundation of the canonical data contract and removes only the pieces that are already proven to be retired.

## Non-negotiable rules

1. One canonical representation per concept.
2. No legacy field aliases or collection aliases in runtime persistence.
3. No duplicate operational FHIR collections; FHIR is an interoperability boundary.
4. MongoDB remains the operational source of truth.
5. Neo4j remains a projection fed by the outbox.
6. No executable seed or automatic population is introduced.
7. The cleanup is incremental and domain-scoped.
8. Reference data seeding is split into a manual essential seed and deferred large imports.

## Preserved Canonical Surface

- `graph_projection_outbox`
- `graphProjection.service.js`
- `neo4jOutbox.service.js`
- `neo4jCanonicalProjection.service.js`
- canonical graph nodes and relations for donor, consent, specimen lineage, quality and telemetry incidents
- `api/backend/src/contracts/canonical/v1/index.js`
- `api/backend/src/resources/fhir/profiles/*.schema.json`
- `docs/architecture/reference-data-seeding.md`

## Removed from runtime

- duplicated FHIR persistence collections such as `patients_fhir`, `samples_fhir` and `consents_fhir`
- legacy FHIR models persisted as operational data
- collection alias subsystem
- `fhir-sync.service` legacy persistence path
- compatibility wrappers that treated FHIR as a primary store

## Removed or downgraded in this PR

- FHIR persistence models were removed from the executable path.
- The intake boundary now rejects aliases with `422 NON_CANONICAL_FIELD`.
- Canonical v1 contract documentation and architecture tests were introduced.

## Still residual

- aliases remain in some active runtime modules and are intentionally deferred
- mixed-domain cleanup across participant, specimen, storage, reports and frontend views remains pending
- some runtime code still carries transitional alias reads for compatibility
- large reference imports are not modeled yet and remain deferred to later scripts

## Known residual legacy surfaces

- `api/backend/src/interface/routes/sample.routes.js`
- `api/backend/src/interface/routes/reports.routes.js`
- `api/backend/src/routes/intakeWizard.js`
- `frontend/src/views/SampleDetailsPage.tsx`
- `frontend/src/components/v2/intake/ClinicalIntakeWizard.jsx`
- services and core modules that still accept transitional aliases

## Deferred cleanup plan

- PR 100 - Canonicalize participant flow
- PR 101 - Canonicalize specimen, custody and storage flow
- PR 102 - Canonicalize frontend intake and active views
- PR 103 - Remove inactive legacy runtime files
- PR 104 - Build aggregate/domain matrix

## PR 100 - Participant flow canonicalization

- Files treated: `api/backend/src/models/Patient.js`, `api/backend/src/services/patient.service.js`, `api/backend/src/services/PatientIdentityService.js`, `api/backend/src/utils/patientAnonymization.js`, `api/backend/src/controllers/paciente.controller.js`, `frontend/src/hooks/usePatients.ts`, `frontend/src/views/PatientsPage.tsx`, `frontend/src/components/UI/PatientSearchInput.tsx`, `frontend/src/services/api.ts`.
- Aliases removed from participant runtime: `patientID`, `patientId`, `pseudoId`, `cpf`, `representativeCpf`.
- Aliases that remain outside this PR: specimen/sample/intake/report legacy surfaces and documentation.
- Routing decision: retain historical route names, but reject non-canonical participant payloads with 422 instead of converting them.
- Tests added: participant architecture gate and negative canonical alias tests.
- Risks: some active non-participant surfaces still carry legacy vocabulary and are intentionally deferred to PR 101-104.

## Execution order

1. Freeze canonical names and block aliases at the intake boundary.
2. Remove duplicate persistence representations already proven retired.
3. Preserve FHIR as pure serialization and interoperability.
4. Keep the canonical Neo4j projection fed by outbox only.
5. Defer deeper domain decomposition to follow-up PRs.

This document is a foundation note, not a declaration of full cleanup completion.
