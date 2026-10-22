# 2026-10-23: The FHIR validator checks the declared version, the declared profile and every identifier.system

Requirement RF011 AC1, RNF024 C1, RULE-036. Dictionary FHIRProfileRegistry V2E-0253..0260, IdentifierNamespaceRegistry V2E-0691..0699. Issue #1322.

## The question

RF011 AC1 asks the import to "Validar FHIR 4.0.1, estrutura, perfil, identifier systems e campos obrigatórios", and RNF024 C1 to "Validar versão, estrutura, perfil e identifier systems". `api/backend/src/services/fhir-validator.service.js` checked each resource against a JSON schema only, so a Patient declaring `fhirVersion: '5.0.0'`, an unknown `meta.profile` and `identifier: [{ system: 'cpf' }]` was accepted, alone and inside a Bundle. Against what does the validator check version, profile and identifier systems, when the requisitos populate profiles and mappings only in Phase 2 (`docs/extracted-v2.0.0/requisitos.md` lines 50-57)?

## Decided

`[inference]`, from the specification and the repo's pattern, by the coordinator for #1322, on 2026-10-23:

1. **The registry is a module the validator reads, empty in Phase 1.** `api/backend/src/resources/fhir/conformance-registry.js` holds the FHIRProfileRegistry rows, the IdentifierNamespaceRegistry rows and RULE-036's approved external hosts, and a caller may inject others. RF011's "F2 perfis e mappings" and the phase table put profile and mapping population in Phase 2, and Phase 1 holds no fictitious data, so no row is invented: in Phase 1 every declared profile and every identifier system is refused (fail closed).
2. **A row counts only when its model accepts it.** A profile row counts when `FHIRProfileRegistry.validate` accepts it and its status is `approved` or `active`. A namespace counts when `IdentifierNamespaceRegistry.create` accepts it (RULE-036: HTTPS, under bioadvanced.dev or an approved external host) and the current time is inside its `[start, end)` vigência. Any other row is ignored, never a crash.
3. **The version read is an own `fhirVersion` element, else R4.** FHIR R4 carries no version on Patient, Specimen, Observation, Organization or Bundle: the validator reads an own `fhirVersion` element when present (the one R4 carries on its conformance resources) and holds it to `4.0.1|R4`, the set `InteroperabilityMappingRelease.js` exports; with none, the resource is read as R4, the release the loaded schemas encode. A declared profile carries its version through its registry row, whose `fhirVersion` the model already holds to that set. The upload's MIME `fhirVersion` parameter is not read: multer passes the part type without parameters.
4. **A declared profile must match an eligible row.** `meta.profile` must be an array of non-empty strings; `url|version` matches a row's `canonicalUrl` and `profileVersion`, a bare url its `canonicalUrl`.
5. **An Identifier with no `system` is accepted** (Identifier.system is 0..1 in R4); one with a `system` must equal a counted namespace's `systemUri` exactly. Every Identifier is checked, under a key `identifier` or ending in `Identifier`, single or in an array, at any depth, the Bundle's own included; a Bundle's entries are each checked once, as resources.

## Not decided here

- **The staging path** (`fhir-import-staging.service.js` `stageBundle`), which does not call this validator and whose fixtures use non-URI systems (`cpf`, `rg`, `urn:oid:cpf`).
- **A profile row's `identifierSystems`** restricting the systems a profiled resource may use, and a namespace's `targetTypes` against the resource type.
- **Profiles of `contained` resources.**
- **The persisted (MongoDB) registries** and their population (Phase 2).
