# 2026-10-25: FHIR import commits a staged ResearchStudy as a Study, only when absent and only for a Coordenador or Administrador

Requirement RF011 AC4; mapping MAP-V2-009; dictionary ELM-0053..0067 (Study). Issue #1322.

## The question

FHIR Bundle staging maps Provenance, AuditEvent, DocumentReference and ResearchStudy to canonical candidates and commits none (`2026-10-24-fhir-import-provenance-auditevent-documentreference-researchstudy.md`, items 2 and 5). Of the four, only ResearchStudy has a target with a store and a writer: the `studies` collection, `api/backend/src/models/Study.js`, and the `/api/studies` mount. AuditEvent's hash chain is the audit service's alone, a DocumentReference without its binary is no DataFile, and a Provenance lacks the `hardwareProfile` and `environmentManifestUri` a WorkflowRun requires. Can the batch commit create the Study a ResearchStudy names, what must the batch keep until then, and who may create it?

## Decided

`[inference]`, from the repo's pattern, by the coordinator for #1322, on 2026-10-25. Every decision below is an inference, not a citation.

1. **The candidate lives on the batch, and holds only what a Study stores.** `stageMappedResources` (`api/backend/src/resources/fhir/import-mappings.js`) also returns `studyCandidates`: for each ResearchStudy whose candidate passes `StudyModel.validate` (a `studyId`, a `studyTitle` and at least one `documentation` relatedArtifact with a label), `{ resourceIndex, studyId, studyTitle, studyStatus?, ethicsApprovalId }`, at most 50, in resource order. `stageBundle` stores it on the batch as `studyCandidates`, in plaintext. Precedent: these are the four fields `Study.create` keeps, and the `studies` collection stores them in plaintext for any authenticated user to read (`2026-10-25-study-and-workflow-run-organization-scope.md`), so the batch exposes nothing the Study itself does not. No other candidate field, and no value of another type, is stored. A ResearchStudy that fails validation gives no entry; its `mappedResources` entry is as before.
2. **A Study is matched by `studyId` and only inserted when absent.** After the record loop, `commitBatch` runs, for each valid entry, an `updateOne` on `studies` filtered on `studyId` with `$setOnInsert: StudyModel.create(...)` and `upsert: true`. An existing Study is never changed. An insert is audited as `FHIR_IMPORT_STUDY_COMMITTED` with the batch id and studyId. The result carries `studies: { created, existing, notCreatedReason }`. Precedent: the same commit's Patient upsert, idempotent on `participantId`.
3. **A Study is created only for a caller at hierarchy level 3 or 4.** The controller resolves the caller's level (`resolveUserHierarchyLevel`) and passes `canCreateStudy: level === 3 || level === 4`. `commitBatch` creates a Study only when `canCreateStudy` is strictly `true`; any other input (level 2, a null level, an absent option) creates none, reports `notCreatedReason: 'ROLE'` when the batch has candidates, and commits the batch's records as before. Precedent: `POST /api/studies` is `requireRole(3, 4)`, while the commit route needs only `uploadFiles`, which a Tecnico (level 2) holds. A gate accepts only on positive evidence.

This supersedes items 2 and 5 of `2026-10-24-fhir-import-provenance-auditevent-documentreference-researchstudy.md` for ResearchStudy only: the batch now stores its Study candidate, and the commit writes a Study. Those items stand for Provenance, AuditEvent and DocumentReference. `IMPORT_ROUND_TRIP_LIMITATIONS.ResearchStudy` states the new limitations.

## Not decided here

- **Committing Provenance, AuditEvent or DocumentReference.**
- **Updating an existing Study from FHIR.**
- **Staging a Bundle with no Specimen**: it still answers 400, so a Bundle of ResearchStudy alone creates no Study.
