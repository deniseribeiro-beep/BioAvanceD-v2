const { ObjectId } = require('mongodb');

// RF027 AC4 (#1322): "Preservar lineage fonte→ingestão→transformação→
// snapshot→resultado". No dictionary field names a parent or derived run,
// so lineage is derived, never stored: run P produced an input of run R
// when some file id is in both P.outputFileIds and R.inputFileIds (see
// docs/decisions/2026-10-23-workflow-run-lineage.md). datasetSnapshotId is
// passed through as stored and never looked up.
//
// Both caps are design limits, not measured bounds.
const MAX_LINEAGE_DEPTH = 20;
const MAX_LINEAGE_RUNS = 200;

function runIdOf(run) {
  return String(run.workflowRunId || run._id);
}

function fileIds(list) {
  return Array.isArray(list) ? list.map(String) : [];
}

function toEntry(run, relation, depth) {
  return {
    workflowRunId: runIdOf(run),
    workflowId: run.workflowId ?? null,
    workflowVersion: run.workflowVersion ?? null,
    runStatus: run.runStatus ?? null,
    datasetSnapshotId: run.datasetSnapshotId ?? null,
    inputFileIds: fileIds(run.inputFileIds),
    outputFileIds: fileIds(run.outputFileIds),
    relation,
    depth,
  };
}

/**
 * Walks the runs that produced a run's inputs (upstream) and consumed its
 * outputs (downstream), breadth first, one query per level and direction.
 *
 * @param {import('mongodb').Db} db
 * @param {string} rawId a WorkflowRun's _id or workflowRunId
 * @returns {Promise<null | { workflowRunId: string, runs: object[], edges: object[], truncated: boolean }>}
 */
async function walkWorkflowRunLineage(db, rawId) {
  const id = String(rawId);
  const collection = db.collection('workflowRuns');
  const rootQuery = {
    $or: [
      ...(ObjectId.isValid(id) ? [{ _id: new ObjectId(id) }] : []),
      { workflowRunId: id },
    ],
  };
  const root = await collection.findOne(rootQuery);
  if (!root) return null;

  const runs = [toEntry(root, 'root', 0)];
  const visited = new Set([runs[0].workflowRunId]);
  const edges = [];
  const edgeKeys = new Set();
  let truncated = false;

  const addEdge = (fromWorkflowRunId, toWorkflowRunId, fileId) => {
    if (fromWorkflowRunId === toWorkflowRunId) return;
    const key = `${fromWorkflowRunId}\u0000${toWorkflowRunId}\u0000${fileId}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ fromWorkflowRunId, toWorkflowRunId, fileId });
  };

  // One direction. `ids` reads the frontier ids the query matches on,
  // `query` runs the level's find, and `link` records the edges between a
  // frontier run and a found run.
  const walk = async (relation, ids, query, link) => {
    let frontier = [root];
    for (let depth = 1; frontier.length > 0; depth += 1) {
      const wanted = [...new Set(frontier.flatMap(ids))];
      if (wanted.length === 0) break;
      const found = await query(wanted);
      const next = [];
      for (const run of found) {
        const runId = runIdOf(run);
        if (visited.has(runId)) {
          for (const member of frontier) link(member, run);
          continue;
        }
        if (depth > MAX_LINEAGE_DEPTH || runs.length >= MAX_LINEAGE_RUNS) {
          truncated = true;
          continue;
        }
        visited.add(runId);
        runs.push(toEntry(run, relation, depth));
        next.push(run);
        for (const member of frontier) link(member, run);
      }
      frontier = next;
    }
  };

  await walk(
    'upstream',
    (run) => fileIds(run.inputFileIds),
    (wanted) => collection.find({ outputFileIds: { $in: wanted } }).toArray(),
    (consumer, producer) => {
      const inputs = new Set(fileIds(consumer.inputFileIds));
      for (const fileId of fileIds(producer.outputFileIds)) {
        if (inputs.has(fileId)) addEdge(runIdOf(producer), runIdOf(consumer), fileId);
      }
    }
  );

  await walk(
    'downstream',
    (run) => fileIds(run.outputFileIds),
    (wanted) => collection.find({ inputFileIds: { $in: wanted } }).toArray(),
    (producer, consumer) => {
      const inputs = new Set(fileIds(consumer.inputFileIds));
      for (const fileId of fileIds(producer.outputFileIds)) {
        if (inputs.has(fileId)) addEdge(runIdOf(producer), runIdOf(consumer), fileId);
      }
    }
  );

  return { workflowRunId: runs[0].workflowRunId, runs, edges, truncated };
}

module.exports = { walkWorkflowRunLineage, MAX_LINEAGE_DEPTH, MAX_LINEAGE_RUNS };
