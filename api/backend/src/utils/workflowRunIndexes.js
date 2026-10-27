/**
 * #1405 (ELM-0326): the index of WorkflowRun, one run per `workflowRunId`,
 * a helper taking the collection, like `utils/biomarkerAssociationIndexes.js`.
 * It neither latches nor catches: the Foundation job builds it before the
 * APIs start.
 */
function canIndex(collection) {
  return Boolean(collection) && typeof collection.createIndex === 'function';
}

async function ensureWorkflowRunIndexes(collection) {
  if (!canIndex(collection)) return;
  await collection.createIndex({ workflowRunId: 1 }, { unique: true, name: 'uniq_workflowRunId' });
}

module.exports = { ensureWorkflowRunIndexes };
