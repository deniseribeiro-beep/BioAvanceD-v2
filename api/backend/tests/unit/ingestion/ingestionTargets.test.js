import { describe, it, expect } from 'vitest';
const { INGESTION_TARGETS, resolveIngestionTarget } = require('../../../src/ingestion/ingestionTargets');

describe('ingestion/ingestionTargets (RF029, #1318)', () => {
  it('names exactly the Dataset and WorkflowRun targets, frozen', () => {
    expect(Object.keys(INGESTION_TARGETS)).toEqual(['Dataset', 'WorkflowRun']);
    expect(Object.isFrozen(INGESTION_TARGETS)).toBe(true);
    expect(resolveIngestionTarget('Dataset')).toMatchObject({ schemaId: 'canonical.v1.dataset', store: 'mongodb', collection: 'datasets', idField: 'datasetId' });
    expect(resolveIngestionTarget('WorkflowRun')).toMatchObject({ schemaId: 'canonical.v1.workflow', store: 'mongodb', collection: 'workflowRuns', idField: 'workflowRunId' });
    expect(typeof resolveIngestionTarget('Dataset').model.validate).toBe('function');
  });

  it.each(['Telemetry', 'dataset', '', undefined, null, '__proto__', 'toString', 'constructor', 'hasOwnProperty'])(
    'resolves %s to null',
    (entityType) => {
      expect(resolveIngestionTarget(entityType)).toBeNull();
    }
  );
});
