import { describe, it, expect } from 'vitest';
const { ObjectId } = require('mongodb');
const { walkWorkflowRunLineage, MAX_LINEAGE_DEPTH } = require('../../../src/services/workflowRunLineage');

// RF027 AC4 (#1322). The fake really evaluates the filters the service
// sends: a mock that returned its fixture whatever the filter would pass
// with the upstream and downstream queries swapped.
function matchesIn(doc, filter) {
  return Object.entries(filter).every(([field, condition]) => {
    const values = Array.isArray(doc[field]) ? doc[field] : [];
    return values.some((value) => condition.$in.includes(value));
  });
}

function matchesLookup(doc, filter) {
  return filter.$or.some((clause) => (
    ('_id' in clause && String(doc._id) === String(clause._id))
    || ('workflowRunId' in clause && doc.workflowRunId === clause.workflowRunId)
  ));
}

function makeDb(docs) {
  const workflowRuns = {
    findOne: async (filter) => docs.find((doc) => matchesLookup(doc, filter)) || null,
    find: (filter) => ({ toArray: async () => docs.filter((doc) => matchesIn(doc, filter)) }),
  };
  return { collection: (name) => (name === 'workflowRuns' ? workflowRuns : undefined) };
}

function run(workflowRunId, inputFileIds, outputFileIds, extra = {}) {
  return {
    _id: new ObjectId(),
    workflowRunId,
    workflowId: 'wf-1',
    workflowVersion: '1.0.0',
    runStatus: 'completed',
    inputFileIds,
    outputFileIds,
    ...extra,
  };
}

const chain = () => [
  run('A', [], ['f1']),
  run('B', ['f1'], ['f2']),
  run('C', ['f2'], []),
];

const byId = (result, id) => result.runs.find((entry) => entry.workflowRunId === id);

describe('walkWorkflowRunLineage (RF027 AC4, #1322)', () => {
  it('walks a chain A→B→C from B: A upstream and C downstream at depth 1, one edge per file', async () => {
    const result = await walkWorkflowRunLineage(makeDb(chain()), 'B');

    expect(result.workflowRunId).toBe('B');
    expect(byId(result, 'B')).toMatchObject({ relation: 'root', depth: 0 });
    expect(byId(result, 'A')).toMatchObject({ relation: 'upstream', depth: 1 });
    expect(byId(result, 'C')).toMatchObject({ relation: 'downstream', depth: 1 });
    expect(result.runs).toHaveLength(3);
    expect(result.edges).toEqual([
      { fromWorkflowRunId: 'A', toWorkflowRunId: 'B', fileId: 'f1' },
      { fromWorkflowRunId: 'B', toWorkflowRunId: 'C', fileId: 'f2' },
    ]);
    expect(result.truncated).toBe(false);
  });

  it('walks the chain from C: A is upstream at depth 2', async () => {
    const result = await walkWorkflowRunLineage(makeDb(chain()), 'C');

    expect(byId(result, 'B')).toMatchObject({ relation: 'upstream', depth: 1 });
    expect(byId(result, 'A')).toMatchObject({ relation: 'upstream', depth: 2 });
    expect(result.edges).toHaveLength(2);
  });

  it('finds the root by its _id as well as its workflowRunId', async () => {
    const docs = chain();
    const result = await walkWorkflowRunLineage(makeDb(docs), String(docs[1]._id));

    expect(result.workflowRunId).toBe('B');
    expect(result.runs).toHaveLength(3);
  });

  it('terminates on a cycle A↔B and lists each run once', async () => {
    const docs = [run('A', ['f2'], ['f1']), run('B', ['f1'], ['f2'])];
    const result = await walkWorkflowRunLineage(makeDb(docs), 'A');

    expect(result.runs.map((entry) => entry.workflowRunId).sort()).toEqual(['A', 'B']);
    expect(byId(result, 'B')).toMatchObject({ relation: 'upstream', depth: 1 });
    expect(result.edges).toEqual(expect.arrayContaining([
      { fromWorkflowRunId: 'B', toWorkflowRunId: 'A', fileId: 'f2' },
      { fromWorkflowRunId: 'A', toWorkflowRunId: 'B', fileId: 'f1' },
    ]));
    expect(result.edges).toHaveLength(2);
    expect(result.truncated).toBe(false);
  });

  it('returns only the root for a run with no files', async () => {
    const result = await walkWorkflowRunLineage(makeDb([run('solo', [], [])]), 'solo');

    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]).toMatchObject({ workflowRunId: 'solo', relation: 'root', depth: 0 });
    expect(result.edges).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it('sets truncated when a chain is longer than MAX_LINEAGE_DEPTH', async () => {
    const length = MAX_LINEAGE_DEPTH + 3;
    const docs = Array.from({ length }, (_, index) => run(
      `R${index}`,
      index === 0 ? [] : [`f${index - 1}`],
      [`f${index}`]
    ));
    const result = await walkWorkflowRunLineage(makeDb(docs), `R${length - 1}`);

    expect(result.truncated).toBe(true);
    expect(Math.max(...result.runs.map((entry) => entry.depth))).toBe(MAX_LINEAGE_DEPTH);
    expect(result.runs).toHaveLength(MAX_LINEAGE_DEPTH + 1);
  });

  it('returns null for an unknown id', async () => {
    expect(await walkWorkflowRunLineage(makeDb(chain()), 'nope')).toBeNull();
  });

  it('passes datasetSnapshotId through and walks a failed run', async () => {
    const docs = [
      run('A', [], ['f1'], { runStatus: 'failed', datasetSnapshotId: 'snap-1' }),
      run('B', ['f1'], []),
    ];
    const result = await walkWorkflowRunLineage(makeDb(docs), 'B');

    expect(byId(result, 'A')).toMatchObject({ relation: 'upstream', runStatus: 'failed', datasetSnapshotId: 'snap-1' });
    expect(byId(result, 'B').datasetSnapshotId).toBeNull();
  });
});
