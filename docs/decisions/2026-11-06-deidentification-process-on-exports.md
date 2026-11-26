# 2026-11-06: RNF007 AC6 writes no DeidentificationProcess until an export's input is a DatasetSnapshot

Requirement RNF007 AC6, RNF030 C5. Dictionary V2E-0338..0345 (DeidentificationProcess). Relationships REL-0083..0085. Issue #1461.

## The question

RNF007 AC6 asks the backend to "Registrar DeidentificationProcess para datasets exportados quando aplicável". The backend has several exports, and DeidentificationProcess is one of the seven analytical-preparation entities that `2026-10-22-inactive-analytical-preparation-structures.md` keeps modelled but written by no flow. Which of today's exports is a dataset export, and what would a record on it reference?

## Decided

`[inference]`, from the specification and the repo's pattern, by the coordinator for #1461, on 2026-11-06:

1. **No current export is a dataset export, so AC6 does not yet apply.** What each export carries:

   | Export | What it carries |
   |----|----|
   | `GET /api/reports/:type/export`, `/api/reports/:type/export/pdf` | The rows of one report, built per request and streamed, never stored. |
   | `GET /api/biobanks/miabis/export` | Biobank and Collection catalog metadata, no participant data. |
   | `GET /api/samples/:specimenId/files/:fileID/export/hl7`, `/fhir`, `/cda`, and `GET /api/export/fhir/samples/:specimenId/files/:fileID` | One sample file as an interoperability message (the last as a FHIR DocumentReference). |
   | `GET /api/export/fhir/workflow-runs/:workflowRunId` (and `/lineage`), `/studies/:studyId`, `/audit-events/:eventId` | One WorkflowRun as Provenance or a lineage Bundle, one Study as ResearchStudy, one audit event as AuditEvent. |
   | `GET /api/logs/export/csv`, `/api/logs/export/xlsx`, `GET /api/security/logs/export` | Audit records. |
   | `GET /api/datasets/:datasetId/files/:fileID/download` | A file a user uploaded to a Dataset (ELM-0416..0423), returned as stored, not built from participant records. A Dataset is not a DatasetSnapshot. |

   None exports a frozen DatasetSnapshot, which is what `inputSnapshotId` (V2E-0344, 1..1) names as the process's input.
2. **A record cannot be written conformantly today.** `inputSnapshotId` must reference an existing DatasetSnapshot (REL-0084), and DatasetSnapshot is itself inactive under the 2026-10-22 record, whose gate is not decided there. `outputFileIds` (V2E-0345, 1..*) must reference existing DataFile rows (REL-0085), and the report and MIABIS exports store no file. A record with a placeholder snapshot or file id would break REL-0084 and REL-0085. The pattern is the 2026-10-22 record, which keeps all seven analytical-preparation entities, DeidentificationProcess among them, unwritten until the flow that activates them brings its gate; every DeidentificationProcess and DatasetSnapshot dictionary row places population in Phase 3 (`docs/extracted-v2.0.0/requisitos.md` line 56).
3. **"quando aplicável" is read as: when an export's input is a DatasetSnapshot.** The pattern is `2026-10-22-reference-release-asset-preserved.md`, which reads the same phrase as the set of cases the referenced entity exists for.
4. **The flow that first exports a DatasetSnapshot writes the DeidentificationProcess in the same change.** It removes `DeidentificationProcess` and `DatasetSnapshot` from `INACTIVE` in `api/backend/tests/architecture/inactive-analytical-structures.arch.test.js` and brings the real-backend e2e proof of AC6. Until then that architecture test is the check that nothing writes one: it fails the day a backend file requires the model or names `deidentificationProcesses`.

## Not decided here

- **The authorized-scientific-use gate**, as in the 2026-10-22 record.
- **Which entity `riskAssessmentId` references**: V2E-0341 types it as a bare `Reference`.
- **The field-transformation vocabulary** beyond the dictionary's example `{"field":"participantId","method":"pseudonymize"}`.
