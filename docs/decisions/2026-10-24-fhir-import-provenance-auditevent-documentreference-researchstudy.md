# 2026-10-24: FHIR staging maps Provenance, AuditEvent, DocumentReference and ResearchStudy as pure inverse transforms and records field names and paths only, committing none

Requirement RF011 AC4, RF011 AC6, RF011 AC7; mappings MAP-V2-006..009. Issue #1322.

## The question

RF011 AC4 asks to "Mapear ... Provenance, AuditEvent, DocumentReference e ResearchStudy quando aplicável". The export does (`2026-10-23-fhir-export-provenance-auditevent-documentreference-researchstudy.md`, `2026-10-24-fhir-export-route-and-bundle.md`), and both records left "The import of these four types" open: FHIR Bundle staging (`stageBundle` in `api/backend/src/services/fhir-import-staging.service.js`) mapped none of the four, and each landed in the batch's `roundTripLoss.unattached`. What does importing them mean, what is recorded, and what is committed?

## Decided

`[inference]`, from the specification and the repo's pattern, by the coordinator for #1322, on 2026-10-24. The pattern is the import side's "paths, never values; limitations as declared prose; no forced equivalence" (`2026-10-23-fhir-round-trip-loss-record.md`, decisions 4 and 5), read with RF011 AC4's "quando aplicável" and RF011 AC7 (adapters do not persist).

1. **Pure inverse transforms.** `api/backend/src/resources/fhir/import-mappings.js` holds `fromFhirProvenance`, `fromFhirAuditEvent`, `fromFhirDocumentReference` and `fromFhirResearchStudy`, the exact inverse of the export transforms: no database, no I/O. Each throws for a non-object or another resource type, and otherwise never throws, whatever the element types. Each returns `{ candidate, mappedPaths }`: the canonical fields read (no key for an absent one, no `[]`, no guessed value) and the leaf paths read, in the round-trip loss report's path syntax. A string counts only when non-blank, kept as written. A value outside a closed table is left unmapped: an AuditEvent `outcome` other than `0`, an `outcomeDesc` outside `failure`, `attempted` and `resolved`, a reference other than `DocumentReference/<id>`, a DocumentReference status other than `current`, a ResearchStudy status outside the R4 codes. Only the first `author` agent (Provenance) and the first requestor agent (AuditEvent) map.
2. **Recorded on the batch, as field names and paths.** `stageMappedResources` gives the batch `mappedResources: { mappedResourceCount, mappedResources: [{ resourceIndex, resourceType, mappingId, canonicalEntity, canonicalFields, unmappedCount, unmapped, truncated, limitations }], truncated }`. `canonicalFields` are the candidate's keys, `unmapped` the resource's leaf paths no field carries (the first 50, as on a staged record), and `limitations` the type's `IMPORT_ROUND_TRIP_LIMITATIONS`, frozen Portuguese sentences. The batch document is not sealed at rest (the staged records' `fhir` and `normalized` are, #1191), so it holds no value, id, URI, pseudonym or title.
3. **The list is capped at 50 resources.** `mappedResourceCount` counts every one, `mappedResources` keeps the first 50, `truncated` says whether it was cut: a 20 MB Bundle of AuditEvents must not grow one batch document toward MongoDB's 16 MB limit. A resource past the cap is still mapped.
4. **Mapped, not unattached.** `buildBundleRoundTripLoss` takes the set of mapped resources as a third argument and leaves them out of `unattached`; without it the result is as before.
5. **Nothing is committed, and the candidate is not stored.** `commitBatch` is unchanged and writes no record of these types:
   - **AuditEvent:** the hash chain is canonical, and only the audit service writes it.
   - **DocumentReference:** without its binary, which stays in Object Storage, it is no DataFile.
   - **Provenance:** it carries no `hardwareProfile` or `environmentManifestUri`, which a WorkflowRun requires (1..1 Core, V2E-0477, V2E-0480).
   - **ResearchStudy:** the staging commit creates participants and samples only, and a Study is entered through its own route.

## Not decided here

- **Committing any of the four types.**
- **Storing the canonical candidate.**
- **Staging a Bundle with no Specimen**: it still answers 400.
- **A FHIR schema for the four in the validator.**
- **Populating InteroperabilityMappingRelease** (Phase 2).
