import { describe, it, expect } from 'vitest';
const { INGESTION_TARGETS, resolveIngestionTarget } = require('../../../src/ingestion/ingestionTargets');

describe('ingestion/ingestionTargets (RF029, #1318)', () => {
  it('names exactly the Dataset, WorkflowRun and OmicsQualification targets, frozen', () => {
    expect(Object.keys(INGESTION_TARGETS)).toEqual(['Dataset', 'WorkflowRun', 'OmicsQualification']);
    expect(Object.isFrozen(INGESTION_TARGETS)).toBe(true);
    expect(resolveIngestionTarget('Dataset')).toMatchObject({ schemaId: 'canonical.v1.dataset', store: 'mongodb', collection: 'datasets', idField: 'datasetId' });
    expect(resolveIngestionTarget('WorkflowRun')).toMatchObject({ schemaId: 'canonical.v1.workflow', store: 'mongodb', collection: 'workflowRuns', idField: 'workflowRunId' });
    expect(resolveIngestionTarget('OmicsQualification')).toMatchObject({ schemaId: 'canonical.v1.omicsQualification', store: 'mongodb', collection: 'omicsQualifications', idField: 'omicsQualificationId' });
    expect(typeof resolveIngestionTarget('Dataset').model.validate).toBe('function');
  });

  it('names each target\'s missingness fields exactly, frozen (RF029 AC7)', () => {
    expect(INGESTION_TARGETS.Dataset.missingnessFields).toEqual(['doi', 'distributionFiles', 'roCrateManifest']);
    expect(INGESTION_TARGETS.WorkflowRun.missingnessFields).toEqual(['containerImageDigest', 'softwareDependencies', 'parameters', 'inputFileIds', 'outputFileIds', 'completedAt', 'randomSeed', 'datasetSnapshotId']);
    expect(INGESTION_TARGETS.OmicsQualification.missingnessFields).toEqual(['limitations']);
    expect(Object.isFrozen(INGESTION_TARGETS.Dataset.missingnessFields)).toBe(true);
    expect(Object.isFrozen(INGESTION_TARGETS.WorkflowRun.missingnessFields)).toBe(true);
    expect(Object.isFrozen(INGESTION_TARGETS.OmicsQualification.missingnessFields)).toBe(true);
  });

  it.each(['Telemetry', 'dataset', '', undefined, null, '__proto__', 'toString', 'constructor', 'hasOwnProperty'])(
    'resolves %s to null',
    (entityType) => {
      expect(resolveIngestionTarget(entityType)).toBeNull();
    }
  );
});
