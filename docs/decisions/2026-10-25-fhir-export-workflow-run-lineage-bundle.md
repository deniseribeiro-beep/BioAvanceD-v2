# 2026-10-25: a WorkflowRun's lineage is exported as one collection Bundle of Provenance resources under /api/export/fhir/workflow-runs/:workflowRunId/lineage

Requirement RF011 AC4, RF011 AC6, RF027 AC4; mappings MAP-V2-008. Issue #1322.

## The question

`2026-10-24-fhir-export-route-and-bundle.md` exports one record per Bundle and left "a multi-resource Bundle" open. RF027 AC4 asks to preserve lineage, and `GET /api/workflow-runs/:workflowRunId/lineage` already derives it. Which multi-resource Bundle comes first, behind which gate, and what does it carry?

## Decided

`[inference]`, from the specification and the repo's pattern, by the coordinator for #1322, on 2026-10-25.

1. **The route.** `GET /api/export/fhir/workflow-runs/:workflowRunId/lineage` in `fhir-export.routes.js`, read only (RF011 AC7). It answers the run and every run its lineage walk reaches, each as `toFhirProvenance`, root first in the walk's order, in one `collection` Bundle built by `buildFhirExport('Provenance', ...)`. An unknown run is a 404, as is a root deleted between the walk and the read; any other run missing from the read is skipped.
2. **One resource type per envelope.** The Bundle holds only Provenance, so the envelope's `mapping` (MAP-V2-008) and `roundTripLimitations` stay true of every entry, and `buildFhirExport` is unchanged.
3. **The gate.** The route copies the single WorkflowRun export's gate, `requireRole(3, 4)`.
4. **The lineage.** It is the existing derived walk, `walkWorkflowRunLineage` (`docs/decisions/2026-10-23-workflow-run-lineage.md`), with its caps (`MAX_LINEAGE_DEPTH`, `MAX_LINEAGE_RUNS`). The response's `lineage` is `{ workflowRunId, truncated }`; `truncated: true` reports a cut walk, a round-trip loss RF011 AC6 asks to record.
5. **The edges.** No edge list is added: they travel as each Provenance's `entity` and `target` `DocumentReference/<id>` references, a file id shared by one run's `target` and another's `entity`.

## Not decided here

- **A Bundle that mixes types**, such as a run with its files' DocumentReferences. Those file reads are organization-scoped and LGPD-gated, while the run export carries no organization scope (#1403).
- **Committing any of the four imported types** (Provenance, AuditEvent, DocumentReference, ResearchStudy).
- **Populating InteroperabilityMappingRelease** (Phase 2), so a response could name a release.
