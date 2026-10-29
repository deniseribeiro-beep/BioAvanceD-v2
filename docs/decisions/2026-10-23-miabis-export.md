# 2026-10-23: Biobank and Collection are exported by the MIABIS mapping, with their national extensions and a round-trip loss report

Requirement RF020 AC5-AC8. Dictionary MAP-V2-010 and MAP-V2-011. Issue #1322.

## The question

RF020 AC5 asks the system to export Biobank and Collection by the approved MIABIS mapping, AC6 to preserve the regime, CAAE, approval, custody and other national extensions in the canonical model, AC7 to record a round-trip loss report, and AC8 to claim no full conformance without an independent assessment. Network and Biobank are now stored (`docs/decisions/2026-10-23-network-biobank-structures.md`), but no route emitted a MIABIS record, and MAP-V2-010/011 are `partial` and `prepared Phase 1`. Where is the export, which element names does it use, what does it do without an approved mapping release, and how are the extensions and the loss carried?

## Decided

`[inference]`, from the specification and the repo's pattern, by the coordinator for #1322, on 2026-10-23:

1. **A read-only export at `GET /api/biobanks/miabis/export`, for roles 3 and 4.** RF020's primary actor is the Coordenador, and roles 3 and 4 are the Biobank write gate (`createMasterDataRouter`). The route reads every stored biobank and collection and writes nothing; the global audit middleware records the call as a Biobank `EXPORT`. It is mounted before `/api/biobanks`, as the governance routes are before `/api/collections`, and has no organization scope, as neither of those mounts has one.
2. **Element names follow the dictionary where it spells them.** The P1X Biobank and Collection rows are MIABIS's attributes in camelCase and keep their names, so a stored P1X MIABIS attribute is not reported as loss; `sexCategories` (P1X-0048) is exported as `sex`. The other elements (`id`, `name`, `description`, `juristicPerson`, `country`, `materialTypes`, `dataCategories`, `diseases`, `inclusionCriteria`, `exclusionCriteria`, `useAndAccessConditions`, `storageTemperatures`, `sex`, `numberOfSubjects`, `publications`) are names chosen here for the ELM fields: the repo holds no MIABIS primary source. The two tables in `api/backend/src/services/miabisExport.service.js` are the one place a later approved mapping changes.
3. **No approved MIABIS mapping release is stored.** `InteroperabilityMappingRelease` admits only FHIR R4, and MAP-V2-010/011 read `prepared Phase 1`. So the export names the MAP rows and their status, sets `mappingReleaseId: null`, and claims no conformance (`conformanceClaimed: false`, RF020 AC8). It does not refuse to export.
4. **National extensions travel beside the MIABIS record, never inside it.** `governanceRegime`, `governanceContextId` (V2E-0428) and the whole embedded `governanceContext` (CAAE, ethics approval, custodian) go in `nationalExtensions`, as MAP-V2-011's limitation reads ("governanceRegime, CAAE and approval are preserved internally"). The canonical store is only read, so the extensions also stay canonical (MAP-V2-010's "Brazilian governance extensions remain canonical"). A Biobank has no extension field. Approvals and custodianship assignments stored in their own collections are not joined in this slice.
5. **The round-trip loss report is computed, not stored.** Each non-empty canonical field of a record that is neither mapped, an extension nor a system field (`_id`, `createdAt`, `updatedAt`) is listed as `{ entity, id, field }`. Empty means absent, `null`, a blank string or an empty list. This reconciles both Biobank capability pairs: the P1X code[] pair (P1X-0040/0042) is exported, and the ELM-0037/0038 CodeableConcept pair is reported as dropped, as are `biobankStatus`, `collectionStatus` and `sampleCount`.
6. **Collections are exported unattached to a biobank.** The dictionary has no Collection-to-Biobank link, so the record set is every biobank and every collection, and no collection claims a biobank.

## Not decided here

- **Network export.**
- **A stored InteroperabilityMappingRelease for MIABIS** and its approval.
- **Persisting the loss report** (`roundTripLossReportUri`).
- **A Collection-to-Biobank link.**
- **Joining approvals and custodianship** stored outside the collection document.
- **Import**, the return leg of the round trip.
- **The frontend** screen that triggers the export.
- **Any conformity or certification claim** (RF020 AC8).
