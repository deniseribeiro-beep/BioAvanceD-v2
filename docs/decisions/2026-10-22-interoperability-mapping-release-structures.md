# 2026-10-22: InteroperabilityMappingRelease and FHIRProfileRegistry are modelled as Phase 1 structures

Requirement RF011 AC2/AC6, RNF024 C6, RULE-035. Dictionary V2E-0244..0260 and V2E-0710..0729 (InteroperabilityMappingRelease V2E-0244..0252 and V2E-0710..0729, FHIRProfileRegistry V2E-0253..0260). Issue #1322.

## The question

RF011 AC2 asks for an InteroperabilityMappingRelease with its canonical release, FHIR version, guide and version, jurisdiction, profiles, resources, namespaces, terminologies, mapping URI and hash, conformance report, coverage, round-trip losses, approval, vigência and supersession, and AC6 for the unmapped fields and round-trip limitations it records. Nothing in `api/backend/src` modelled it or its FHIRProfileRegistry. The requisitos prepare structures in Phase 1 and populate mappings and profiles in Phase 2 (`docs/extracted-v2.0.0/requisitos.md` lines 52-56). What does the backend build now, and which values does it accept?

## Decided

`[inference]`, from the specification and the repo's pattern, by the coordinator for #1322, on 2026-10-22:

1. **Plain models, catalog-conformant, with no collection or flow.** Each entity is a model under `api/backend/src/models/` with a pure `fieldsOf`, a `validate` and a `create`, registered in `canonical-catalog-conformance.arch.test.js` with zero drift. The pattern is the repo's plain-model template (`TelemetryIngestionEvent.js`, `DatasetSnapshot.js`). AC2's MongoDB persistence, its `collections.js` and `env.js` keys, and the FHIR validator come in later slices.
2. **Not "inactive".** Unlike `2026-10-22-inactive-analytical-preparation-structures.md`, no architecture guard forbids a flow from using these models: that guard came from RF029 AC8's use restriction, and RF011 has none.
3. **The status set is the repo's release lifecycle**, `draft|candidate|approved|active|superseded|retired`, as `ConfigurationRelease.js` and `CanonicalModelRelease.js` use it. The V2E-0717 cell reads `draft` and the example `approved`. FHIRProfileRegistry's `status` shares the set.
4. **RULE-035's approval fields hold at approved, active and superseded.** V2E-0727/0728 (`approvedAt`, `effectivePeriod`) are "Obrigatório quando status=approved"; an active or superseded release followed that approval, so it carries them too, as `ConfigurationRelease.js` carries its approval fields past activation. RULE-035's other consequences are 1..1 or 1..* Core fields and hold at every status.
5. **`standard` is `FHIR R4` only.** The V2E-0245 cell and example both read `FHIR R4`, and the entity's FHIR-specific Core fields (`fhirVersion`, `profileRegistryIds`) fit no other standard. A later export slice that reuses the entity for another standard extends the set.
6. **`fhirVersion` is `4.0.1|R4`.** RF011 AC1 says FHIR 4.0.1, V2E-0711's example is `4.0.1` and V2E-0255's is `R4`, the same release. FHIRProfileRegistry imports the set rather than copying it.
7. **`resourceTypes` is the nine resources RF011 AC4 names**: Patient, Specimen, Consent, Observation, DiagnosticReport, Provenance, AuditEvent, DocumentReference and ResearchStudy.
8. **A set `profile` requires an IG.** V2E-0712 makes `implementationGuideCanonical` mandatory "para perfil institucional, nacional ou internacional"; a set `profile` is read as one, and V2E-0713 then requires `implementationGuideVersion`. RULE-035's "IG versions" are read through these two conditions, not as an unconditional requirement: a base-FHIR release with no profile carries no IG.
9. **A `jurisdiction` CodeableConcept is stored as the Coding shape** `{ systemUri, code, version, display }`, as `2026-10-22-inactive-analytical-preparation-structures.md` item 4 decided. A Period (`effectivePeriod`) is half-open `[start, end)`, with a null end meaning open-ended.
10. **`coverageRatio` is measured coverage** (RULE-035), so it must equal `coverageNumerator / coverageDenominator` within 1e-9, and a zero denominator requires a zero ratio. The numerator may not exceed the denominator.
11. **`checksum` and `mappingDefinitionHash` are SHA-256**, written `sha256:<hex>` or as a bare 64-hex digest, as `DatasetSnapshot.js` reads its checksum.

## Not decided here

- **The FHIR validator** of RF011 AC1 and the resource mappings of AC4/AC5.
- **The MongoDB collection** AC2 persists the release in, and its indexes.
- **Which actor approves a release**, and the homologation gate RULE-035 blocks.
- **MIABIS, Network and Biobank exports**, and whether they reuse this entity with another `standard`.
