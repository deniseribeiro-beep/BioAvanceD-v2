# 2026-10-23: Network and Biobank are modelled and entered by an administrator

Requirement RF020 AC1. Dictionary ELM-0032..0038, P1X-0001..0012 and P1X-0036..0043 (Biobank ELM-0032..0038 and P1X-0036..0043, Network P1X-0001..0012), mapping MAP-V2-010. Issue #1322.

## The question

RF020 AC1 asks the system to register Organization, Network, Biobank and Collection, and AC5 to export Biobank and Collection by the approved MIABIS mapping. `api/backend/src/models/` had Organization and Collection but no Network or Biobank, and no route stored either. The export needs these two entities first. How are they modelled and entered, and which values do they accept?

## Decided

`[inference]`, from the specification and the repo's pattern, by the coordinator for #1322, on 2026-10-23:

1. **Plain catalog-conformant models, stored through the master-data router.** Each entity is a model under `api/backend/src/models/` with a pure `fieldsOf`, a `validate` and a `create`, registered in `canonical-catalog-conformance.arch.test.js` with zero drift, as `FHIRProfileRegistry.js` and `InteroperabilityMappingRelease.js` are. They are stored through `createMasterDataRouter` at `/api/biobanks` and `/api/networks`, like `Collection` and `Dataset`, and written by roles 3 and 4, the factory's gate (RF020's primary actor is the Coordenador). `create` never throws, as `Collection.js`'s does not: validation is the router's. No seed: Phase 1 allows no fictitious operational data (`docs/extracted-v2.0.0/requisitos.md` lines 51-58); a real row is entered by an administrator.
2. **Both Biobank capability pairs are stored as given.** ELM-0037/0038 (`infrastructureCapabilities`, `bioprocessingCapabilities`, CodeableConcept[]) and P1X-0040/0042 (`infrastructuralCapabilities`, `bioprocessingAnalyticalCapabilities`, code[]) are all catalog rows of Biobank, so all four are emitted and none is merged into another. Reconciling them is the export mapping's job.
3. **Status and type fields are open codes.** `biobankStatus`, `networkStatus` and `networkType` name a vocabulary (`BioAvanceD biobank-status`, an example `active`), but `dict-ENUMS.md` has no set for them, and `Collection.collectionStatus` is likewise unchecked. A required one must be a non-empty string; no set is checked.
4. **`contactInformation` (MIABIS Contact) is a non-empty object.** It is required (1..1) and must be an object with at least one filled value. Its MIABIS field set is fixed by the export mapping, not here.
5. **`legalEntityId` and `juristicPerson` resolve to an Organization**, by `organizationId`, on create and on an update that sends them, with a 404 when none exists. This is the existence-only check `assayReferenceValidator.js` makes. `networkMembers` is not resolved: a member may be a Biobank or a Network.
6. **No organization scoping** on these mounts, as `/api/collections` has none.

Also read off the dictionary: a country code is ISO 3166-1 alpha-2 and upper-cased on create, as `Organization.js` checks its own; a Network's `countryCodes` is 1..*; a `url` is checked to be a URI when given; a code[] or Reference[] list holds only non-empty strings, and a CodeableConcept[] list is only checked to be a list, as `Collection.js` checks its own.

## Not decided here

- **The MIABIS export** of Biobank and Collection and its round-trip loss report (RF020 AC5-AC7).
- **A Collection-to-Biobank link**: the dictionary links them through a ResearchResource (P1X-0142..0151), stored since 2026-11-10 (`2026-11-10-research-resource-structures.md`).
- **A MongoDB unique index** on `biobankId` or `networkId`.
- **The Neo4j projection** of these entities.
- **The frontend** screens that enter them.
- **Any conformity or certification claim** (RF020 AC8).
