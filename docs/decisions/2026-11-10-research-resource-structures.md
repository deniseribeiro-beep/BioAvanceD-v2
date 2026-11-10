# 2026-11-10: ResearchResource and its Collection and Biobank links are stored, entered by an administrator

Requirement RNF008 AC3. Dictionary P1X-0013..0035 (ResearchResource), P1X-0142..0146 (ResearchResourceCollection) and P1X-0147..0151 (ResearchResourceBiobank). Issue #1496.

## The question

RNF008 AC3 asks an AccessPolicy to scope by biobank. Nothing stored which biobank a collection belongs to. In the v2.0.0 dictionary the only path is Collection <- ResearchResourceCollection -> ResearchResource <- ResearchResourceBiobank -> Biobank, and none of these three entities was stored. How are they modelled and entered, and when does a link count?

## Decided

`[inference]`, from the specification and the repo's pattern, by the coordinator for #1496, on 2026-11-10:

1. **Plain catalog-conformant models, stored through the master-data router.** `ResearchResource.js`, `ResearchResourceCollection.js` and `ResearchResourceBiobank.js` under `api/backend/src/models/` each have a pure `fieldsOf`, a `validate` and a `create` that never throws, and are registered in `canonical-catalog-conformance.arch.test.js` with zero drift, as `Biobank.js` and `Network.js` are (see `2026-10-23-network-biobank-structures.md`). They are stored through `createMasterDataRouter` at `/api/research-resources`, `/api/research-resource-collections` and `/api/research-resource-biobanks`, written by roles 3 and 4, the factory's gate. The two link entities share one helper, `researchResourceAssociation.js`.
2. **Required fields follow the dictionary's 1..1 and 1..* Core rows.** A ResearchResource needs a `name`, a non-empty `contactInformation` list whose every contact has a filled value, a non-empty `sexCategories` list of codes and a non-empty `sampleTypes` list. A `url` is checked to be a URI when given, a code[] list holds only non-empty strings, a CodeableConcept[], Disease[] or Identifier[] list is only checked to be a list, `ageLow` and `ageHigh` are finite numbers and `totalNumberOfSubjects` a non-negative integer. A link needs its `researchResourceId` and its `collectionId` or `biobankId`; `associationRole` is an open code.
3. **Each link's references are existence-checked**: `researchResourceId` in `researchResources`, `collectionId` in `collections` and `biobankId` in `biobanks`, on create and on an update that sends them, with a 404 when none exists, as `institutionalReferenceValidator.js` checks a Biobank's `legalEntityId`.
4. **`effectivePeriod` (a Period) is stored as `{ start, end }`**, as AccessPolicy and CollectionGovernanceApproval store theirs. When given it must be an object, each bound a valid date, and `end` after `start`.
5. **A link counts only while in force**, over the half-open interval `[start, end)` that `AccessPolicy.js` uses: a link with no period is in force, one whose start is later than now or whose end is at or before now is not. `associationInForce` in `researchResourceAssociation.js` is the one place this is decided.
6. **No seed and no organization scope.** Phase 1 allows no fictitious operational data, so a real row is entered by an administrator; these mounts have no scope field, as `/api/biobanks` has none.

## Not decided here

- **How an AccessPolicy reads the biobank fact** from these links (RNF008 AC3's scoping itself).
- **What happens to the links** when a ResearchResource, Collection or Biobank is deleted.
- **A MongoDB unique index** on `researchResourceId` or `associationId`.
- **The MIABIS export and the Neo4j projection** of these entities. The three mounts are documented in `docs/api/openapi.json` and listed in its `x-covered-mounts` (RNF006 C2).
- **The frontend** screens that enter them.
