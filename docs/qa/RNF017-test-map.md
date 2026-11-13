# RNF017 test map: criteria 2, 6 and 8

This map lists each item of RNF017 C2 (critical journeys and negative governance cases), C6 (configuration, consent, regimes, states/quantity/destination, labels, PII) and C8 (idempotence, checkpoint, quarantine, outbox, reconciliation, promotion, rollback) of the v2.0.0 release (`docs/extracted-v2.0.0/requisitos.md`, RNF017), with the spec and the test that proves it (#1471).
C7 (RCS matrices) waits on W10 and is not mapped here; C4 (authorized synthetic data only) is the seed-boundary architecture test, `api/backend/tests/architecture/seed-boundary.arch.test.js`.

A row is `proved` only where the named case's own assertions exercise the item against the real backend; a case that stubs the behaviour away does not count. Every test below is a `tests/e2e/*.spec.ts` case run by the e2e gate against the real stack. Each test case is quoted exactly as written in its file, escapes included, so `git grep -F` finds it.

## C2: critical journeys

The release names no list of critical journeys; this map takes each RF's main flow, driven end to end, as one, an inference from the traceability appendix (`docs/mestrado/Apendice_Matriz_Rastreabilidade_Homologacao_v1.0.0.md` §4.1), which gives every RF at least one test case.

| Item | Spec | Test file | Test case | Status |
|---|---|---|---|---|
| RF001 security and authentication | RF001 AC3, AC5 | `tests/e2e/auth-access-security.spec.ts` | `admin logs in through the real login form, reaches the system-management dashboard, and the login is audited` | proved |
| RF002 dashboard and authorization | RF002 AC1 | `tests/e2e/rf002-role-views.spec.ts` | `AC1: the Técnico dashboard shows registration, custody and storage, and no governance or admin card` | proved |
| RF003 user management | RF003 AC1, AC6 | `tests/e2e/auth-access-security.spec.ts` | `admin creates a user (criterion 1 happy path), the creation is audited (criterion 6), and a duplicate email/username is rejected (criterion 1 edge case)` | proved |
| RF004 integrated registration and collection governance | RF004 AC1 | `tests/e2e/intake-wizard.spec.ts` | `a Coordenador assigned to two organizations registers through the wizard, picks the second, and reads the sample and participant back (#1354, #1355)` | proved |
| RF005 participant and clinical data | RF005 AC4, AC5 | `tests/e2e/intake-wizard.spec.ts` | `a real submission through the intake wizard creates Encounter/Condition/PhenotypeObservation/MedicationExposure with terminology coding (#693)` | proved |
| RF006 traceability, quantity and custody | RF006 AC1 | `tests/e2e/specimen-quality-inventory.spec.ts` | `records origin/destination/responsible/purpose/quantity for a withdrawal, and appends to the audit trail (criteria 1, 6)` | proved |
| RF007 scientific files and raw data | RF007 AC2, AC3, AC6 | `tests/e2e/scientific-data-access.spec.ts` | `uploads a scientific file, recording checksum/URI/encryption and auditing it (AC#3/4/5/6/7, RNF029)` | proved |
| RF008 reports | RF008 AC4 | `tests/e2e/scientific-data-access.spec.ts` | `an operator reaches a CSV export through the real UI (/reports → query page → download)` | proved |
| RF009 telemetry and environmental monitoring | RF009 AC1, AC2 | `tests/e2e/interop-monitoring.spec.ts` | `persists a valid reading to InfluxDB, tagged by sensorId (criteria 1, 2, 3-partial)` | proved |
| RF010 consent | RF010 AC2, AC4 | `tests/e2e/consent-token-page.spec.ts` | `a participant with no session can open the emailed link, read the term and accept it` | proved |
| RF011 HL7 FHIR R4 interoperability | RF011 AC1, AC4, AC5 | `tests/e2e/interop-monitoring.spec.ts` | `stages, validates and commits a FHIR Bundle — Patient/Specimen/Consent/Observation mapping and provenance (criteria 1,2,3,5,6)` | proved |
| RF012 audit and cryptographic integrity | RF012 AC1, AC3, AC4 | `tests/e2e/audit-chain-integrity.spec.ts` | `chains audited actions, seals them, verifies an event and detects a rewritten one` | proved |
| RF013 backup and restore | RF013 AC1, AC2, AC3 | `tests/e2e/pipeline-continuity.spec.ts` | `an authorized manual backup records checksum + completion evidence and is listed with its state and result (AC#1, AC#2, AC#3)` | proved |
| RF014 policies and governed configuration | RF014 AC2, AC7 | `tests/e2e/auth-access-security.spec.ts` | `admin updates session/login/password/MFA policy — versioned, validated, and audited as critical (criteria 1,2,3,5,6,7)` | proved |
| RF015 alerts and notifications | RF015 AC1, AC2, AC5, AC6 | `tests/e2e/interop-monitoring.spec.ts` | `a real environmental excursion creates a rule-driven, versioned, event-linked notification within SLA (criteria 1,2,3,6,7)` | proved |
| RF016 physical identification and unified reading | RF016 AC5 | `tests/e2e/specimen-quality-inventory.spec.ts` | `generates Code128, DataMatrix and QR symbology assets tied to the specimen\'s own unique barcode (criteria 1, 2)` | proved |
| RF017 equipment and storage | RF017 AC1, AC2 | `tests/e2e/storage-topology-authoring.spec.ts` | `an API-authored FREEZER -> SHELF -> RACK -> box accepts a sample, and a second FREEZER for the same equipment is refused` | proved |
| RF018 pre-analytical qualification, SPREC and RCS | RF018 AC7, AC8 | `tests/e2e/specimen-quality-inventory.spec.ts` | `a sample registration resolves its governance evidence references, and refuses certification for a missing hash or an unresolvable URI (RNF018 AC5, #1524)` | proved |
| RF019 logical quarantine | RF019 AC2, AC3, AC4 | `tests/e2e/specimen-quality-inventory.spec.ts` | `places a specimen into quarantine with cause and originating event recorded, and blocks withdrawal while quarantined (criteria 1, 5, 6)` | proved |
| RF020 institutional metadata, regimes and MIABIS | RF020 AC5, AC6, AC7 | `tests/e2e/miabis-export.spec.ts` | `exports a stored biobank and collection by the MIABIS mapping, with the national extension and the round-trip loss` | proved |
| RF021 studies, protocols, ethics and custody | RF021 AC1 | `tests/e2e/study-protocol-collection-crud.spec.ts` | `generates studyId and protocolId, requires a protocolVersion and records a revised one` | proved |
| RF022 Foundation Data Pipeline | RF022 AC5, AC9 | `tests/e2e/pipeline-continuity.spec.ts` | `dry-run, apply and verify each leave their checkpoint and a ready report naming the rcs gate (RNF031 AC4, RF022 AC5)` | proved |
| RF023 outbox and Neo4j projection | RF023 AC5 | `tests/e2e/pipeline-continuity.spec.ts` | `a placement projects as a STORED_AT edge with validTime [from,to) and transactionTime, closed by the next placement (RF023 AC5)` | proved |
| RF024 access requests and distribution | RF024 AC1-AC6 | `tests/e2e/access-requests-ui.spec.ts` | `an operator registers, evaluates, approves, distributes and revokes a request through the UI (AC1-AC6)` | proved |
| RF025 assays, reagents and non-conformances | RF025 AC1-AC4 | `tests/e2e/specimen-quality-inventory.spec.ts` | `registers an assay linking specimen, protocol, operator, laboratory, reagent lots, equipment, and controls (criteria 1-4)` | proved |
| RF026 retention, disposition and closure | RF026 AC7 | `tests/e2e/specimen-status-v2.spec.ts` | `an executed destruction closes the specimen with an RF026 AC7 state decision, and no edit reopens it` | proved |
| RF027 workflows and omics data | RF027 AC1-AC5 | `tests/e2e/scientific-data-access.spec.ts` | `registers a workflow run, links an input file, qualifies the assay, and records a genomic reference (AC#1/2/3/4/5/6)` | proved |
| RF028 reference data import | RF028 AC1-AC7 | `tests/e2e/pipeline-continuity.spec.ts` | `an import registers its release before the load, stages, quarantines and checkpoints, keeps its asset and writes its coverage manifest and quality assessment (RF028 AC1-7, RNF032 AC1-7)` | proved |
| RF029 operational and scientific ingestion | RF029 AC4, AC6, AC10 | `tests/e2e/ingestion-records.spec.ts` | `an accepted Dataset is persisted with its outbox event and one INGESTION_ACCEPTED row` | proved |

## C2: negative governance cases

The release lists no negative governance cases either; this set is an inference, one refusal for each governance RF the appendix §4.1 maps.

| Item | Spec | Test file | Test case | Status |
|---|---|---|---|---|
| A revoked or absent consent blocks the sample's use | RF010 AC6, AC7 | `tests/e2e/scientific-data-access.spec.ts` | `a consent revoked for the requested DUO purpose denies the request\'s item and keeps the consent\'s history (RF010 AC7, RNF022 C2)` | proved |
| A role without the permission is refused | RF002 AC5 | `tests/e2e/security-permissions-readonly.spec.ts` | `a route a role row grants is refused once the row drops the permission` | proved |
| A user cannot read or write another organization's records | RF003 AC3; `docs/decisions/2026-10-11-sample-tenancy.md` | `tests/e2e/storage-allocation-tenancy.spec.ts` | `a Tecnico scoped to one organization cannot release, move or read across organizations, and still can within its own` | proved |
| A quarantined sample cannot be released or distributed | RF019 AC3, AC5 | `tests/e2e/scientific-data-access.spec.ts` | `registers a request, evaluates real consent/DUO/study compatibility, and only an approved in-force decision unblocks distribution (AC#1/2/3/4)` | proved |
| An invalid governed configuration is refused | RF014 AC1, AC4 | `tests/e2e/auth-access-security.spec.ts` | `RF014 AC1: the setting catalog covers every configuration key, and its ranges are enforced` | proved |
| A tampered audit chain is detected | RF012 AC6 | `tests/e2e/audit-chain-integrity.spec.ts` | `chains audited actions, seals them, verifies an event and detects a rewritten one` | proved |
| An access request not approved yields no distribution | RF024 AC5, AC6 | `tests/e2e/scientific-data-access.spec.ts` | `blocks access for a rejected decision, and separately for a revoked one (AC#5)` | proved |
| An ingested record failing its governance checks is quarantined, not stored | RF029 AC2, AC3 | `tests/e2e/ingestion-records.spec.ts` | `#1318 RF029 AC2: a Specimen whose participant has no active consent answers 422 INGESTION_QUARANTINED with CONSENT_NOT_ACTIVE and writes no sample` | proved |

## C6: configuration, consent, regimes, states, quantity, destination, labels, PII

| Item | Spec | Test file | Test case | Status |
|---|---|---|---|---|
| Configuration | RF014 AC2, AC4 | `tests/e2e/auth-access-security.spec.ts` | `RF014 AC4: the Security page lists the configuration releases and rolls back to a superseded one` | proved |
| Consent | RF010 AC4, AC5, AC6 | `tests/e2e/tcle-dinamico.spec.ts` | `AC4-AC6: acceptance, scoped revocation, supersession and revocation are appended history the state derives from` | proved |
| Regimes | RF020 AC2, AC4 | `tests/e2e/specimen-quality-inventory.spec.ts` | `converts a collection\'s regime only through a governance event` | proved |
| States | RF006 AC2, AC6 | `tests/e2e/specimen-quality-inventory.spec.ts` | `blocks a withdrawal against a specimen in a blocked lifecycle status, and refuses a v1.3.0 status write (criterion 4)` | proved |
| Quantity | RF006 AC3, AC4 | `tests/e2e/specimen-quality-inventory.spec.ts` | `moves quantityStatus to partial then depleted while specimenStatus stays available, then closes on validated consumption (criteria 2, 3)` | proved |
| Destination | RF006 AC5; RF026 AC1, AC3, AC4 | `tests/e2e/specimen-quality-inventory.spec.ts` | `records a disposition action linked to a real retention policy, with method/date/responsible/affected items preserved (criteria 1, 3, 4)` | proved |
| Labels | RF016 AC8 | `tests/e2e/rnf007-identity-minimization.spec.ts` | `system-generated labels and print jobs carry only opaque codes, never civil identity (RNF007 AC4, RNF022 AC6, RF016 AC8)` | proved |
| PII | RF005 AC3; RF023 AC9 | `tests/e2e/intake-wizard.spec.ts` | `AC#3: no participant identity fields appear in the Neo4j-facing outbox payload` | proved |

## C8: idempotence, checkpoint, quarantine, outbox, reconciliation, promotion, rollback

| Item | Spec | Test file | Test case | Status |
|---|---|---|---|---|
| Idempotence | RF023 AC6; RNF019 C3 | `tests/e2e/pipeline-continuity.spec.ts` | `re-queuing an applied consent event leaves the projected node and the checkpoint unchanged (RF023 AC6, RNF019 C3)` | proved |
| Checkpoint | RF023 AC4 | `tests/e2e/pipeline-continuity.spec.ts` | `a consent's create and revoke apply in aggregateVersion order and leave the projector's checkpoint at the revoke (RF023 AC4, RNF019 C4)` | proved |
| Quarantine | RF029 AC2, AC3 | `tests/e2e/pipeline-continuity.spec.ts` | `a record with no provenance envelope is quarantined, not silently accepted or corrected` | proved |
| Outbox | RF023 AC3 | `tests/e2e/sample-storage-lifecycle.spec.ts` | `a create whose label issue fails rolls back its sample, movement, allocation and outbox events together (RF023 AC3, RNF019 C1)` | proved |
| Reconciliation | RF023 AC6 | `tests/e2e/specimen-lineage.spec.ts` | `a deleted Sample node is reported missing, and the reconciliation\'s repair replays it from the outbox (RF023 AC6, RNF016 C2, RNF019 C6 C7)` | proved |
| Promotion | RF028 AC8 | `tests/e2e/pipeline-continuity.spec.ts` | `promotion and rollback are explicit Administrador calls, publish to the outbox and are audited (RF028 AC5, AC8, AC9, RNF032 AC6, AC8, AC9)` | proved |
| Rollback | RF022 AC9, AC10 | `tests/e2e/pipeline-continuity.spec.ts` | `a rollback undoes the newest apply, blocks promotion and leaves the evidence append-only, and only a new apply promotes again (RF022 AC5 AC10)` | proved |
