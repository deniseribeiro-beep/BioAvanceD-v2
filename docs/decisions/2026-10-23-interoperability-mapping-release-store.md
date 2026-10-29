# 2026-10-23: InteroperabilityMappingRelease and FHIRProfileRegistry rows are stored, entered by an administrator, and the FHIR import validation reads the stored profiles

Requirement RF011 AC2, RNF024 C1, RULE-035. Dictionary InteroperabilityMappingRelease V2E-0244..0252 and V2E-0710..0729, FHIRProfileRegistry V2E-0253..0260. Issue #1322.

## The question

RF011 AC2 asks for InteroperabilityMappingRelease and its FHIRProfileRegistry to be persisted and populated. Both were plain models (`docs/decisions/2026-10-22-interoperability-mapping-release-structures.md`) with no collection, no route and no writer. The FHIR validator refuses any declared `meta.profile` that no eligible FHIRProfileRegistry row names (`docs/decisions/2026-10-23-fhir-validator-version-profile-identifier-system.md`), but the only profile list it read was the frozen, empty module `api/backend/src/resources/fhir/conformance-registry.js`, so every declared profile was refused for good. Where are release and profile rows stored, who enters them, what must they reference, and how does the import validation read the profiles?

## Decided

`[inference]`, read off the repo's consistent choice for each Phase 1 registry that needs rows: the Network/Biobank pattern (`docs/decisions/2026-10-23-network-biobank-structures.md`) and then IdentifierNamespaceRegistry (`docs/decisions/2026-10-23-identifier-namespace-registry-store.md`), each a plain model, the master-data router, roles 3 and 4, a reference validator and no seed. By the coordinator for #1322, on 2026-10-23:

1. **Two mounts on the master-data router.** Releases live in the `interoperabilityMappingReleases` collection, entered at `/api/interoperability-mapping-releases`; profiles live in `fhirProfileRegistries`, entered at `/api/fhir-profiles`. Both are written by roles 3 and 4, the factory's gate, and each model's `validate` answers the POST's 422 and validates the merged row on PUT. Both models refuse `create({})`, so each PUT allowlist is hand-enumerated in `master-data.routes.js`.
2. **References are checked for existence only.** `api/backend/src/services/interoperabilityMappingRelease.service.js` answers 404 `<field> <value> não encontrado` when a release names an `identifierNamespaceRegistryIds` entry that is not a stored IdentifierNamespaceRegistry row, or a `supersedesReleaseId` that is not a stored release, and when a profile names a `mappingReleaseId` that is not a stored release. RULE-035's "approved namespaces" is read as a stored namespace row, since entry is activation there (namespace decision 2). A key the payload does not carry, as on a PUT that leaves it out, is not checked. A `mappingReleaseId` or namespace id that is not a non-empty string is skipped, since the model requires non-empty strings there and has already refused it. The release model does not type-check `supersedesReleaseId`, so the reference check itself refuses a carried value that is not `null` and not a non-empty string (a number, an array, an object, a blank or empty string) with 422, before reading the store; `null` means no release is superseded.
3. **Immutable fields.** A release's `mappingVersion` is immutable on PUT (422) and is left out of its allowlist: a new mapping version is a new row naming the old one in `supersedesReleaseId`. A profile's `canonicalUrl` and `profileVersion` are immutable and left out likewise: that pair is the key the validator matches `meta.profile` on (`url|version`, or a bare url).
4. **The loader reads the stored profiles, each part failing closed on its own.** `loadConformanceRegistry` (`api/backend/src/services/identifierNamespaceRegistry.service.js`) appends the stored FHIRProfileRegistry rows to the base profiles, as it appends the stored namespace rows to the base namespaces. A read that throws or answers a non-array keeps the base rows for that part only, logs a warning, and leaves the other part as read; without a db, or with both reads failed, the base answers alone. It filters nothing: the validator keeps a profile row only while `FHIRProfileRegistry.validate` accepts it and its status is `approved` or `active`.
5. **No seed.** Phase 1 allows no fictitious operational data (`docs/extracted-v2.0.0/requisitos.md` line 54), so no release or profile row is added to `src/`. "Populating" means an administrator can now enter real rows.

## Not decided here

- **Resolution of `profileRegistryIds`**: a profile names its release, so the release is entered first and its profile ids cannot resolve when it is. Nor are `canonicalModelReleaseId` and `terminologyReleaseIds` resolved.
- **Whether a profile counts only while its release is approved or active.** Today the profile's own status decides.
- **RULE-035's homologation actor and gate**: which role approves a release, and what blocks it.
- **Immutability after approval**: an approved or active release's other fields can still be edited on PUT.
- **MongoDB unique indexes** on either id, on `mappingVersion`, or on `canonicalUrl` with `profileVersion`.
- **The frontend** screen that enters releases and profiles.
