# 2026-10-23: WorkflowRun lineage is derived from shared file ids, never stored

Requirement RF027 AC4 ("Preservar lineage fonte→ingestão→transformação→snapshot→resultado"). Issue #1322.

## The question

A WorkflowRun records `inputFileIds`, `outputFileIds` and an unresolved `datasetSnapshotId`, but nothing walked from a run to the runs that produced its inputs or consumed its outputs, so no lineage could be read. The dictionary gives WorkflowRun no parent-run or derived-run field. Where does the link between two runs come from, and how far is it walked?

## Decided

`[inference]`, from the specification and the repo's pattern, by the coordinator for #1322, on 2026-10-23. The pattern: the repo reuses existing fields before it invents vocabulary (`WorkflowRun.js`'s header reuses BaseRecord's `createdBy` for the executor rather than adding an executor field, #669), and the dictionary has no WorkflowRun parent or derived-run field to reuse.

1. **Lineage is derived from file overlap, never stored.** Run P produced an input of run R when some file id is in both `P.outputFileIds` and `R.inputFileIds`. No field is added to WorkflowRun and nothing is written: `services/workflowRunLineage.js` computes the chain on each read.
2. **One read, `GET /api/workflow-runs/:workflowRunId/lineage`.** It needs a session and no role, like the file-link GET. It answers `{ workflowRunId, runs, edges, truncated }`: each run once, with its `relation` (`root`, `upstream` or `downstream`) and its `depth` from the root, and one edge `{ fromWorkflowRunId, toWorkflowRunId, fileId }` per shared file. A run reached both ways keeps the relation it was first reached by, and the upstream walk runs first.
3. **The walk is breadth first, one query per level and direction, and bounded.** A visited set ends a cycle. `MAX_LINEAGE_DEPTH = 20` levels per direction and `MAX_LINEAGE_RUNS = 200` runs are design limits, not measured bounds; reaching either sets `truncated: true`.
4. **Every run status is walked.** A `failed` or `cancelled` run still produced or consumed what it lists, so its status is reported, not filtered.
5. **`datasetSnapshotId` is passed through as stored and never looked up**, as `2026-10-23-workflow-run-provenance-companions.md` item 3 keeps it while DatasetSnapshot is written by no flow.

## Not decided here

- **Resume and derivation records** (RF027 AC6).
- **Resolving `datasetSnapshotId`**: it waits on DatasetSnapshot's activation.
- **The source→ingestion segment** before the first run: the walk starts and ends at WorkflowRuns.
- **A frontend view** of the lineage.
- **An e2e case against real Mongo**: the walk is checked against filter-evaluating fakes only.
