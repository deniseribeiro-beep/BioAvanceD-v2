// RF027 AC6 (#1322): a WorkflowRun names the failed or cancelled run it
// resumes in resumesWorkflowRunId, a non-dictionary field. It is checked on
// create only. A payload without the key (a PUT that does not send it) is not
// checked and reads nothing. An update (no workflowRunId, which POST always
// sets) that names the key, even as null, is refused: it cannot see the
// stored run's workflowId, and clearing the link would erase the record.
// See docs/decisions/2026-10-23-workflow-run-failure-and-resume.md.
const WORKFLOW_RUN_COLLECTION = 'workflowRuns';
const RESUMABLE_STATUSES = ['failed', 'cancelled'];

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';

function createUnprocessableError(message) {
  const error = new Error(message);
  error.statusCode = 422;
  error.details = [message];
  return error;
}

async function validateWorkflowRunReferences(db, payload = {}) {
  if (!Object.prototype.hasOwnProperty.call(payload, 'resumesWorkflowRunId')) return;
  if (!Object.prototype.hasOwnProperty.call(payload, 'workflowRunId')) {
    throw createUnprocessableError('resumesWorkflowRunId é registrado na criação da execução e não pode ser editado');
  }
  const value = payload.resumesWorkflowRunId;
  if (value === null) return;
  // The model has already refused this; kept as a guard.
  if (!isNonEmptyString(value)) {
    throw createUnprocessableError('resumesWorkflowRunId deve ser uma string não vazia');
  }
  if (payload.workflowRunId === value) {
    throw createUnprocessableError('uma execução não retoma a si mesma');
  }
  const resumed = await db.collection(WORKFLOW_RUN_COLLECTION).findOne({ workflowRunId: value });
  if (!resumed) {
    const error = new Error(`resumesWorkflowRunId ${value} não encontrado`);
    error.statusCode = 404;
    throw error;
  }
  if (!RESUMABLE_STATUSES.includes(resumed.runStatus)) {
    throw createUnprocessableError('resumesWorkflowRunId deve referenciar uma execução failed ou cancelled');
  }
  // A changed version is a new derivation, read through the lineage, not a resume.
  if (resumed.workflowId !== payload.workflowId || resumed.workflowVersion !== payload.workflowVersion) {
    throw createUnprocessableError('uma retomada mantém workflowId e workflowVersion da execução retomada');
  }
}

module.exports = {
  WORKFLOW_RUN_COLLECTION,
  validateWorkflowRunReferences,
};
