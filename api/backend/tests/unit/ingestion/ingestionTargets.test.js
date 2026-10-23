import { describe, it, expect } from 'vitest';
const { INGESTION_TARGETS, resolveIngestionTarget } = require('../../../src/ingestion/ingestionTargets');

describe('ingestion/ingestionTargets (RF029, #1318)', () => {
  it('names exactly the Dataset, WorkflowRun, OmicsQualification, Assay and OmicsRun targets, frozen', () => {
    expect(Object.keys(INGESTION_TARGETS)).toEqual(['Dataset', 'WorkflowRun', 'OmicsQualification', 'Assay', 'OmicsRun']);
    expect(Object.isFrozen(INGESTION_TARGETS)).toBe(true);
    expect(resolveIngestionTarget('Dataset')).toMatchObject({ schemaId: 'canonical.v1.dataset', store: 'mongodb', collection: 'datasets', idField: 'datasetId' });
    expect(resolveIngestionTarget('WorkflowRun')).toMatchObject({ schemaId: 'canonical.v1.workflow', store: 'mongodb', collection: 'workflowRuns', idField: 'workflowRunId' });
    expect(resolveIngestionTarget('OmicsQualification')).toMatchObject({ schemaId: 'canonical.v1.omicsQualification', store: 'mongodb', collection: 'omicsQualifications', idField: 'omicsQualificationId' });
    expect(resolveIngestionTarget('Assay')).toMatchObject({ schemaId: 'canonical.v1.assay', store: 'mongodb', collection: 'assays', idField: 'assayId' });
    expect(resolveIngestionTarget('OmicsRun')).toMatchObject({ schemaId: 'canonical.v1.omicsRun', store: 'mongodb', collection: 'omicsRuns', idField: 'omicsRunId' });
    expect(typeof resolveIngestionTarget('Dataset').model.validate).toBe('function');
  });

  it('names each target\'s missingness fields exactly, frozen (RF029 AC7)', () => {
    expect(INGESTION_TARGETS.Dataset.missingnessFields).toEqual(['doi', 'distributionFiles', 'roCrateManifest']);
    expect(INGESTION_TARGETS.WorkflowRun.missingnessFields).toEqual(['containerImageDigest', 'softwareDependencies', 'parameters', 'inputFileIds', 'outputFileIds', 'completedAt', 'randomSeed', 'datasetSnapshotId']);
    expect(INGESTION_TARGETS.OmicsQualification.missingnessFields).toEqual(['limitations']);
    expect(Object.isFrozen(INGESTION_TARGETS.Dataset.missingnessFields)).toBe(true);
    expect(Object.isFrozen(INGESTION_TARGETS.WorkflowRun.missingnessFields)).toBe(true);
    expect(Object.isFrozen(INGESTION_TARGETS.OmicsQualification.missingnessFields)).toBe(true);
    expect(INGESTION_TARGETS.Assay.missingnessFields).toEqual(['omicsDomain', 'assayBatchId', 'controls', 'reagentLotIds', 'equipmentIds']);
    expect(Object.isFrozen(INGESTION_TARGETS.Assay.missingnessFields)).toBe(true);
    expect(INGESTION_TARGETS.OmicsRun.missingnessFields).toEqual(['referenceAssembly', 'mixsChecklist', 'fileLinks']);
    expect(Object.isFrozen(INGESTION_TARGETS.OmicsRun.missingnessFields)).toBe(true);
  });

  it('names the OmicsRun modalities whose v2 entity is stored in Object Storage, frozen (RF029 AC4)', () => {
    const { otherStore } = INGESTION_TARGETS.OmicsRun;
    expect(otherStore).toEqual({ field: 'modality', values: ['transcriptomics', 'proteomics', 'metabolomics'], store: 'objectStorage' });
    expect(Object.isFrozen(otherStore)).toBe(true);
    expect(Object.isFrozen(otherStore.values)).toBe(true);
    for (const entityType of ['Dataset', 'WorkflowRun', 'OmicsQualification', 'Assay']) {
      expect(INGESTION_TARGETS[entityType]).not.toHaveProperty('otherStore');
    }
  });

  it('gives Assay alone its master mount\'s reference check and laboratoryId scope (#1182, #1219)', () => {
    const { validateAssayReferences } = require('../../../src/services/assayReferenceValidator');
    expect(INGESTION_TARGETS.Assay.validateReferences).toBe(validateAssayReferences);
    expect(INGESTION_TARGETS.Assay.scopeField).toBe('laboratoryId');
    for (const entityType of ['Dataset', 'WorkflowRun', 'OmicsQualification', 'OmicsRun']) {
      expect(INGESTION_TARGETS[entityType]).not.toHaveProperty('validateReferences');
      expect(INGESTION_TARGETS[entityType]).not.toHaveProperty('scopeField');
    }
  });

  it.each(['Telemetry', 'dataset', '', undefined, null, '__proto__', 'toString', 'constructor', 'hasOwnProperty'])(
    'resolves %s to null',
    (entityType) => {
      expect(resolveIngestionTarget(entityType)).toBeNull();
    }
  );
});
