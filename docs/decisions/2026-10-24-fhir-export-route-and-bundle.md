# 2026-10-24: Provenance, AuditEvent, DocumentReference and ResearchStudy are exported one record at a time under /api/export/fhir, as a collection Bundle in an envelope that claims no release

Requirement RF011 AC4, RF011 AC5, RF011 AC6, RF011 AC7; mappings MAP-V2-006..009. Issue #1322.

## The question

`2026-10-23-fhir-export-provenance-auditevent-documentreference-researchstudy.md` added the four transforms to `api/backend/src/services/fhir.service.js` and left "an HTTP export route or Bundle assembly" open: nothing called them. Which routes answer them, behind which gates, and what does a response carry?

## Decided

`[inference]`, from the specification and the repo's pattern, by the coordinator for #1322, on 2026-10-24.

1. **The routes.** Each answers one stored record, read only (RF011 AC7):
   - `GET /api/export/fhir/workflow-runs/:workflowRunId`: a `workflowRuns` row by `_id` or `workflowRunId`, as `toFhirProvenance`.
   - `GET /api/export/fhir/studies/:studyId`: a `studies` row by `_id` or `studyId`, as `toFhirResearchStudy`.
   - `GET /api/export/fhir/audit-events/:eventId`: an `audit_events` row by `eventId`, else the `audit_events_archive` one, as `toFhirAuditEvent`.
   - `GET /api/export/fhir/samples/:specimenId/files/:fileID`: a `sample_files` row, as `toFhirDocumentReference`.

   An unknown id is a 404. The first three are `fhir-export.routes.js`; the sample-file one is its own file, `fhir-document-reference-export.routes.js`, because it is organization-scoped and the other three are not.
2. **The gates.** `[inference]`: each copies the gate the repo already uses for that record's existing read or export. The WorkflowRun and Study exports take `requireRole(3, 4)`, as the MIABIS export does (`miabis-export.routes.js`). The audit event export takes `requirePermission('viewReports')`, which every read in `audit.routes.js` uses. The sample-file export takes the same chain and checks as `GET /api/samples/:specimenId/files/:fileID/export/fhir`, in the same order: `requireOrganizationScope`, `requireDataExportAllowed` (the LGPD export switch), `enforceCommercialConsent` on the URL's specimen, then the file (absent, logically deleted or a non-ObjectId id is a 404), the sample, the file-to-sample link (400) and the sample's organization (403). It has no role or permission gate, as that export has none.
3. **The prefix.** `[inference]`: `/api/export/fhir` is chosen so the global audit middleware records each call as entity `Export`, action `EXPORT`, through its existing `export` entry, with no new entity-map entry.
4. **The envelope.** `buildFhirExport(resourceType, resources, { generatedAt })` in `fhir.service.js`, pure like the transforms: `standard` `HL7 FHIR`, `fhirVersion` `4.0.1`, the resource type's MAP-V2 row as `mapping` (`EXPORT_MAPPINGS`, each `partial`, `prepared Phase 1`), `mappingReleaseId: null` and `conformanceClaimed: false`, `generatedAt`, the type's own `EXPORT_ROUND_TRIP_LIMITATIONS` as `roundTripLimitations`, and the `bundle`. No approved InteroperabilityMappingRelease is stored, so no release is named and no conformance is claimed (RF011 AC5/AC6), as in the MIABIS export. An unmapped type, an inherited key, an empty list or a resource of another type throws.
5. **The Bundle.** `toFhirExportBundle` builds a `collection` Bundle: `timestamp` is `generatedAt`, each entry is `{ resource }`. No `fullUrl`, which is 0..1 in R4 and needs a base URL none is governed for, and no Bundle `id`.

## Not decided here

- **The import of these four types**: they stay `unattached` in the staging loss report.
- **Populating InteroperabilityMappingRelease** (Phase 2), so a response could name a release.
- **A multi-resource Bundle**, such as a WorkflowRun with its files' DocumentReferences.
- **A FHIR schema for the four in the validator.**
