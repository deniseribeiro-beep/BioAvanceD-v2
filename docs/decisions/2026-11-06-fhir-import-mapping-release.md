# 2026-11-06: A FHIR import records the mapping releases its declared profiles name

Requirement RF011 AC5, RNF024 AC2; dictionary FHIRProfileRegistry.mappingReleaseId (V2E-0259), InteroperabilityMappingRelease.mappingVersion (V2E-0247). Issue #1479.

## The question

RF011 AC5 and RNF024 AC2 ask that a FHIR import keep the mapping version it was read with. Staging validates no profile against the Bundle, and the mapping code (`api/backend/src/resources/fhir/import-mappings.js`) is fixed, so nothing in the import itself names a release. Which release is an import read with, and what does it record when none can be named?

## Decided

`[inference]`, from the repo's pattern, by the coordinator for #1479, on 2026-11-06. Every decision below is an inference, not a citation. Pattern: the FHIR validator already ties a declared `meta.profile` to an eligible FHIRProfileRegistry row (`url|version` or a bare url, status approved or active), and that row's `mappingReleaseId` ("Mapping vinculado") names the release; a reference nothing backs is recorded as empty, never guessed (the MIABIS export's `mappingReleaseId: null`, `2026-10-23-miabis-export.md` item 3).

1. **The chain is meta.profile, eligible profile row, mappingReleaseId, stored release.** For every `meta.profile` entry of a resource, every FHIRProfileRegistry row the validator's own matching accepts (`buildConformanceSets`, then `profileRegistered`) names its `mappingReleaseId`; that id is looked up in the InteroperabilityMappingRelease store, and its `mappingVersion` is read. A bare-url entry matches every eligible row with that canonical url, and so names each of their releases.
2. **The shape is `{ mappingReleaseId, mappingVersion }`, on the batch and on each staging record, sorted by id.** `stageBundle` stores `mappingReleases` on the batch, resolved over the Bundle's own meta and every resource, and on each staging record, resolved over that record's Patient, Specimen, Consents, Conditions and Observations. It is stored beside `organizationId`, outside the sealed fields.
3. **Empty when nothing resolves; no release is guessed.** No `meta.profile`, a profile no eligible row matches, a draft profile row, a release row that is not stored or has no `mappingVersion`, or a failed release lookup records nothing for it: the list is `[]`.
4. **The commit audit carries it.** `FHIR_IMPORT_RECORD_COMMITTED` names the record's `mappingReleases`, and the committed staging record keeps them.
5. **The profile's own status decides; the release's status is not read**, as `2026-10-23-interoperability-mapping-release-store.md` says.

## Not decided here

- **Whether staging should refuse an unregistered profile.**
- **Whether the committed Sample should carry the release**: no canonical Sample field holds it.
- **A release in force when no profile is declared.**
