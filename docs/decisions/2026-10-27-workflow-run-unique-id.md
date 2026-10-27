# 2026-10-27: one WorkflowRun per workflowRunId, held by a unique index

Dictionary ELM-0326. Issue #1405.

## The question

`WorkflowRun.create()` keeps a client-supplied `workflowRunId` (`data.workflowRunId || randomUUID()`), and nothing held `workflowRuns.workflowRunId` unique, so a POST naming an existing `workflowRunId` inserted a second run with that id. Every lookup resolves a run by that id: the lineage walk's root (`services/workflowRunLineage.js`), the `resumesWorkflowRunId` check on create (`services/workflowRun.service.js`, #1322), and the FHIR single-run and lineage exports (`fhir-export.routes.js`). What holds `workflowRunId` unique, and what does a duplicate POST answer?

## Decided

`[inference]`, from the #1402 precedent (`2026-10-24-biomarker-association-unique-index.md`: a master-data id held unique by an index the Foundation job builds, a duplicate POST answering 409), by the coordinator for #1405, on 2026-10-27:

1. **One run per `workflowRunId`, held by a MongoDB unique index.** `api/backend/src/utils/workflowRunIndexes.js` builds `{ workflowRunId: 1 }` unique as `uniq_workflowRunId`, and the Foundation job builds it before the APIs start (`INDEX_TARGETS` in `src/foundation/indexes.js`). The index, not a pre-insert read, is what holds under concurrent posts.
2. **A duplicate POST answers 409.** `/api/workflow-runs` is a master-data mount, whose POST answers a driver error with code 11000 as `409 Registro duplicado` (#1402). The PUT cannot write `workflowRunId`, which is excluded from its updatable fields. Ingestion is unaffected: it always generates the WorkflowRun id with `randomUUID()`, never from the payload.

So the lineage, resume and FHIR lookups by `workflowRunId` each resolve at most one run.

## Not decided here

- **Deduplicating runs already stored**: a stack already holding a duplicate `workflowRunId` fails this build, which the Foundation job reports as `ok: false`; no migration is decided.
- **A string that is both one run's `_id` hex and another run's `workflowRunId`**: the lineage and FHIR lookups match either field (an `$or` in `services/workflowRunLineage.js` and `fhir-export.routes.js`), and this index does not tell those two runs apart.
