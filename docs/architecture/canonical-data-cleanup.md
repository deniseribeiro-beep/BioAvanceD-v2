# Canonical data cleanup

This branch prepares the BioAvanceD data layer for a new aggregate matrix.

## Non-negotiable rules

1. One canonical representation per concept.
2. No legacy field aliases or collection aliases.
3. No duplicate operational FHIR collections; FHIR is an interoperability boundary.
4. Clinical observations, quality assessments, consent, custody, storage and specimen state have independent responsibilities.
5. The MongoDB outbox and the canonical Neo4j projection are preserved.
6. No executable seed or automatic population is introduced.
7. The databases are treated as empty; no compatibility migration is required.

## Preserve

- `graph_projection_outbox`
- `graphProjection.service.js`
- `neo4jOutbox.service.js`
- `neo4jCanonicalProjection.service.js`
- canonical graph nodes and relations for donor, consent, specimen lineage, quality and telemetry incidents

## Remove before the aggregate redesign

- duplicated FHIR persistence collections (`patients_fhir`, `samples_fhir`, `consents_fhir`)
- unused duplicate models (`ClinicalRecord`, generic `Observation`)
- collection aliases and field aliases
- legacy quality fields and compatibility namespaces
- disease-specific fields embedded in participant and specimen documents
- clinical and pharmacological payloads embedded in the specimen document
- duplicated location representations
- duplicated status fields that mix lifecycle, availability, quarantine, consent and processing
- frontend payload adapters that emit more than one name for the same field

## Execution order

1. Freeze canonical names and block aliases.
2. Remove duplicate persistence representations.
3. Separate mixed responsibilities.
4. Replace frontend forms and API payloads with one canonical contract.
5. Run CI and inspect all broken dependencies.
6. Build the new aggregate matrix from the cleaned repository and the consolidated data dictionary.

This document is a destructive-refactor contract. Removed compatibility structures must not be reintroduced.
