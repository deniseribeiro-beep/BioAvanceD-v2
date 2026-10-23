# 2026-10-23: a WorkflowRun records why it failed and which failed run it resumes

Requirement RF027 AC6 ("Registrar falha, retomada e derivação"). Issue #1322.

## The question

A WorkflowRun could say `runStatus: 'failed'`, but not why it failed, and no run could say that it resumes a failed one. The seed is already recorded (`randomSeed`, `2026-10-23-workflow-run-provenance-companions.md` item 2), derivation is read through the file-overlap lineage (`2026-10-23-workflow-run-lineage.md` item 1), and the executor stays BaseRecord's `createdBy` (#669). The dictionary gives WorkflowRun no failure field and no resume field, and only the client knows that one run resumes another, so the link cannot be derived from the data. Where do the failure reason and the resume link live, and how is the link checked? This takes up the "Resume and derivation records (RF027 AC6)" item that both earlier WorkflowRun docs left open.

## Decided

`[inference]`, from the specification and the repo's patterns, by the coordinator for #1322, on 2026-10-23. The patterns: the repo reuses a field before it invents one (`createdBy` serves as the executor, and the lineage is derived from file overlap); and when a requirement needs a field that no dictionary field covers, the repo adds a non-dictionary field and says so (`promotionClaimedAt` and `dataQualityAssessmentId`, `2026-10-23-reference-release-coverage-manifest.md`). No existing field can carry either fact, so both are new non-dictionary fields.

1. **`WorkflowRun.js` gains two optional non-dictionary fields.**
   - `failureReason`: when present and not null, a string that is not blank after trimming (`failureReason deve ser uma string não vazia`), allowed only when `runStatus` is `failed` or `cancelled` (`failureReason só é permitido quando runStatus é failed ou cancelled`). It stays optional: it is not a dictionary field, stored failed rows have none, and PUT validates the merged row.
   - `resumesWorkflowRunId`: when present and not null, a string that is not blank after trimming (`resumesWorkflowRunId deve ser uma string não vazia`).
   - `create` stores each as sent when it is a non-empty string, else `null`, so `create({})` does not throw. Both become PUT-allowlisted, since the workflow-runs allowlist is the keys of `create({})`.
2. **`services/workflowRun.service.js`'s `validateWorkflowRunReferences` is the workflow-runs mount's `validateReferences`.** It acts only when the payload has an own `resumesWorkflowRunId` key; without one it reads nothing.
   - **On update** (the payload has no `workflowRunId`, which POST always sets), naming `resumesWorkflowRunId`, even as `null`, is refused with 422: `resumesWorkflowRunId é registrado na criação da execução e não pode ser editado`. This fails closed: the update cannot see the stored run's `workflowId`, and clearing the link would erase the record.
   - **On create** a `null` value is not checked. A value is refused with 422 when it is not a non-empty string (a guard behind the model), when it names the run itself (`uma execução não retoma a si mesma`), when the named run is not `failed` or `cancelled` (`resumesWorkflowRunId deve referenciar uma execução failed ou cancelled`), or when its `workflowId` or `workflowVersion` differs from the payload's (`uma retomada mantém workflowId e workflowVersion da execução retomada`). A run that is not stored is a 404 (`resumesWorkflowRunId <id> não encontrado`). Every 422 carries `details: [message]`.
   - A changed version is a new derivation, read through the lineage, not a resume. Several runs may resume the same failed run, and a resume of a resume is allowed, as long as each target is `failed` or `cancelled`.

## Not decided here

- **A resume read or lineage edge**: the lineage walk does not follow `resumesWorkflowRunId`.
- **The ingestion path**: `canonical.v1.workflow` keeps `additionalProperties: false`, so an ingested run cannot carry either field.
- **The FHIR Provenance export of a resume.**
- **A required `failureReason`.**
- **A server-stamped executor on the master-data POST**: it takes `createdBy` from the body today; ingestion stamps it from the actor.
