# 2026-10-23: WorkflowRun, AuditEvent, DataFile and Study export to FHIR R4 as pure transforms that force no equivalence

Requirement RF011 AC4, RF011 AC6, RF011 AC7, RNF024; mappings MAP-V2-006..009. Issue #1322.

## The question

RF011 AC4 asks the export to "Mapear Patient, Specimen, Consent, Observation, DiagnosticReport, Provenance, AuditEvent, DocumentReference e ResearchStudy quando aplicável". `api/backend/src/services/fhir.service.js` mapped only the first five. MAP-V2-006..009 name the scope of the other four (AuditEvent "actor, target, outcome and time", DataFile "URI, MIME, checksum and context", WorkflowRun "agents, entities and derivation", Study "identifier, status, title and protocol") and a round-trip limitation each. What does each canonical field become, and what is left out?

## Decided

`[inference]`, from the specification and the repo's pattern, by the coordinator for #1322, on 2026-10-23. The pattern is the import side's "paths, never values; limitations as declared prose; no forced equivalence" (`2026-10-23-fhir-round-trip-loss-record.md`), read together with each MAP-V2 row's scope.

Shared to all four: each is a pure transform in `fhir.service.js` (no lookup, no I/O, RF011 AC7), and a `null` input throws. A canonical value that is absent, empty or outside a closed table is left out, never replaced by a guessed code, and an empty list is left out, never `[]`. No coding `system` is invented: a canonical code goes out as `{ code }` or `{ text }`. A canonical entity that is not a FHIR resource type is referenced as `{ identifier: { value }, display: <entity type> }`, never as `reference: 'Type/id'`; only a DataFile id is written `DocumentReference/<id>`, since this slice maps DataFile to DocumentReference. What each mapping does not carry is stated in `EXPORT_ROUND_TRIP_LIMITATIONS`, a frozen table of short Portuguese sentences keyed by resource type: static prose, so nothing per record and nothing to cap.

1. **`toFhirProvenance` (MAP-V2-008).** `outputFileIds` become `target`, `inputFileIds` become `entity` with role `source`, `startedAt`/`completedAt` become `occurredPeriod` (no `end` while the run has not completed), `createdAt` is `recorded`. `createdBy`, the executor (#669), is the one agent, typed `author` in the HL7 provenance-participant-type code system, which is R4's binding for `Provenance.agent.type`, not an invented one. The workflow identity and version (a PlanDefinition, not exported), the computational environment fields and `runStatus` (a Task.status, not a Provenance element) are not carried.
2. **`toFhirAuditEvent` (MAP-V2-006).** It reads the stored shape `audit-v2.service.js#createEvent` writes. The outcome table is closed: `success` is `0` and nothing else maps. A `failure`, `attempted` or `resolved` result leaves `outcome` out and goes in `outcomeDesc` as written, because the R4 codes 4, 8 and 12 each assert a severity the canonical result does not carry. The agent is the actor's pseudonym only, never a user id. The hash chain, the sequence, the digests, the policy and model release and the correlation id stay canonical.
3. **`toFhirDocumentReference` (MAP-V2-007).** The id is `fileId` or the Mongo `_id`. `storageUri`, `mimeType` (else `fileFormat`) and `fileSize` form the attachment; `storagePath` is never exported, as the model keeps it from the frontend. The SHA-256 hex checksum is not put in `Attachment.hash`, which R4 defines as a base64 SHA-1: it is a limitation, not a mapping. A file with `deletedAt` set has no `status`, since a logical delete is neither `superseded` nor `entered-in-error`; otherwise it is `current`. `context.related` lists `specimenId`, then each `linkedEntityRefs` item, once each.
4. **`toFhirResearchStudy` (MAP-V2-009).** `studyStatus` is kept only when it is an R4 ResearchStudy status code, as ELM-0058's vocabulary is "FHIR ResearchStudy status"; any other value is left out. Each `ethicsApprovalId` is a `relatedArtifact` of type `documentation`. `studyAcronym` and `studyDesign` are not exported: the dictionary names `ResearchStudy.acronym` and `.studyDesign`, which exist in R5, not R4. The other Study fields beyond `create`'s four (ELM-0053..0067) are read as optional.

## Not decided here

- **An HTTP export route or Bundle assembly** for these resources.
- **Populating InteroperabilityMappingRelease** (Phase 2): no mapping release is stored or seeded.
- **The import of these four types**: they stay `unattached` in the staging loss report.
- **A FHIR schema for them in the validator.**
