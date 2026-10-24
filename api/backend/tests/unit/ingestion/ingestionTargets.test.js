import { describe, it, expect } from 'vitest';
const { INGESTION_TARGETS, resolveIngestionTarget } = require('../../../src/ingestion/ingestionTargets');

describe('ingestion/ingestionTargets (RF029, #1318)', () => {
  it('names exactly the Dataset, WorkflowRun, OmicsQualification, Assay, OmicsRun, Specimen and Participant targets, frozen', () => {
    expect(Object.keys(INGESTION_TARGETS)).toEqual(['Dataset', 'WorkflowRun', 'OmicsQualification', 'Assay', 'OmicsRun', 'Specimen', 'Participant']);
    expect(Object.isFrozen(INGESTION_TARGETS)).toBe(true);
    expect(resolveIngestionTarget('Dataset')).toMatchObject({ schemaId: 'canonical.v1.dataset', store: 'mongodb', collection: 'datasets', idField: 'datasetId' });
    expect(resolveIngestionTarget('WorkflowRun')).toMatchObject({ schemaId: 'canonical.v1.workflow', store: 'mongodb', collection: 'workflowRuns', idField: 'workflowRunId' });
    expect(resolveIngestionTarget('OmicsQualification')).toMatchObject({ schemaId: 'canonical.v1.omicsQualification', store: 'mongodb', collection: 'omicsQualifications', idField: 'omicsQualificationId' });
    expect(resolveIngestionTarget('Assay')).toMatchObject({ schemaId: 'canonical.v1.assay', store: 'mongodb', collection: 'assays', idField: 'assayId' });
    expect(resolveIngestionTarget('OmicsRun')).toMatchObject({ schemaId: 'canonical.v1.omicsRun', store: 'mongodb', collection: 'omicsRuns', idField: 'omicsRunId' });
    expect(resolveIngestionTarget('Specimen')).toMatchObject({ schemaId: 'canonical.v1.specimen', store: 'mongodb', collection: 'samples', idField: 'specimenId' });
    expect(resolveIngestionTarget('Participant')).toMatchObject({ schemaId: 'canonical.v1.participant', store: 'mongodb', collection: 'patients', idField: 'participantId' });
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
    expect(INGESTION_TARGETS.Specimen.missingnessFields).toEqual(['barcode', 'linkedProject', 'parentSpecimenIds', 'merkleRoot', 'sprec']);
    expect(Object.isFrozen(INGESTION_TARGETS.Specimen.missingnessFields)).toBe(true);
    expect(INGESTION_TARGETS.Participant.missingnessFields).toEqual([]);
    expect(Object.isFrozen(INGESTION_TARGETS.Participant.missingnessFields)).toBe(true);
  });

  it('names the OmicsRun modalities whose v2 entity is stored in Object Storage, frozen (RF029 AC4)', () => {
    const { otherStore } = INGESTION_TARGETS.OmicsRun;
    expect(otherStore).toEqual({ field: 'modality', values: ['transcriptomics', 'proteomics', 'metabolomics'], store: 'objectStorage' });
    expect(Object.isFrozen(otherStore)).toBe(true);
    expect(Object.isFrozen(otherStore.values)).toBe(true);
    for (const entityType of ['Dataset', 'WorkflowRun', 'OmicsQualification', 'Assay', 'Specimen', 'Participant']) {
      expect(INGESTION_TARGETS[entityType]).not.toHaveProperty('otherStore');
    }
  });

  it('gives Assay, Specimen and Participant alone their master mount\'s reference check and scope field (#1182, #1219)', () => {
    const { validateAssayReferences } = require('../../../src/services/assayReferenceValidator');
    const { validateSpecimenReferences } = require('../../../src/ingestion/specimenTarget');
    const { validateParticipantReferences } = require('../../../src/ingestion/participantTarget');
    expect(INGESTION_TARGETS.Assay.validateReferences).toBe(validateAssayReferences);
    expect(INGESTION_TARGETS.Assay.scopeField).toBe('laboratoryId');
    expect(INGESTION_TARGETS.Specimen.validateReferences).toBe(validateSpecimenReferences);
    expect(INGESTION_TARGETS.Specimen.scopeField).toBe('collectionSite');
    expect(INGESTION_TARGETS.Participant.validateReferences).toBe(validateParticipantReferences);
    expect(INGESTION_TARGETS.Participant.scopeField).toBe('clinicalUnitId');
    for (const entityType of ['Dataset', 'WorkflowRun', 'OmicsQualification', 'OmicsRun']) {
      expect(INGESTION_TARGETS[entityType]).not.toHaveProperty('validateReferences');
      expect(INGESTION_TARGETS[entityType]).not.toHaveProperty('scopeField');
    }
  });

  it('gives Specimen the sample model, a stamped organizationId, the mount\'s id and, alone, its graph projection (#1192, #1313)', () => {
    const { SampleModel } = require('../../../src/models/Sample');
    const { generateSpecimenId, appendSpecimenProjection } = require('../../../src/ingestion/specimenTarget');
    expect(Object.keys(INGESTION_TARGETS.Specimen)).toEqual(['schemaId', 'store', 'collection', 'idField', 'model', 'missingnessFields', 'validateReferences', 'scopeField', 'organizationField', 'generateId', 'appendProjection']);
    expect(Object.isFrozen(INGESTION_TARGETS.Specimen)).toBe(true);
    expect(INGESTION_TARGETS.Specimen.model).toBe(SampleModel);
    expect(INGESTION_TARGETS.Specimen.organizationField).toBe('organizationId');
    expect(INGESTION_TARGETS.Specimen.generateId).toBe(generateSpecimenId);
    expect(INGESTION_TARGETS.Specimen.appendProjection).toBe(appendSpecimenProjection);
    for (const entityType of ['Dataset', 'WorkflowRun', 'OmicsQualification', 'Assay', 'OmicsRun']) {
      expect(INGESTION_TARGETS[entityType]).not.toHaveProperty('organizationField');
      expect(INGESTION_TARGETS[entityType]).not.toHaveProperty('generateId');
    }
    for (const entityType of ['Dataset', 'WorkflowRun', 'OmicsQualification', 'Assay', 'OmicsRun', 'Participant']) {
      expect(INGESTION_TARGETS[entityType]).not.toHaveProperty('appendProjection');
    }
  });

  it('gives Participant the participant model, a stamped clinicalUnitId, the mount\'s 8-digit id and no graph projection', () => {
    const PatientModel = require('../../../src/models/Patient');
    const { generateParticipantId } = require('../../../src/ingestion/participantTarget');
    expect(Object.keys(INGESTION_TARGETS.Participant)).toEqual(['schemaId', 'store', 'collection', 'idField', 'model', 'missingnessFields', 'validateReferences', 'scopeField', 'organizationField', 'generateId', 'identityFields']);
    expect(Object.isFrozen(INGESTION_TARGETS.Participant)).toBe(true);
    expect(INGESTION_TARGETS.Participant.model).toBe(PatientModel);
    expect(INGESTION_TARGETS.Participant.organizationField).toBe('clinicalUnitId');
    expect(INGESTION_TARGETS.Participant.generateId).toBe(generateParticipantId);
  });

  it('gives Participant alone the civil identity fields it refuses, the union of the two identity lists, frozen', () => {
    const { LEGACY_PATIENT_IDENTITY_FIELDS, PARTICIPANT_IDENTITY_ONLY_FIELDS } = require('../../../src/utils/legacyPatientIdentityFields');
    const { identityFields } = INGESTION_TARGETS.Participant;
    expect(identityFields).toEqual([...LEGACY_PATIENT_IDENTITY_FIELDS, ...PARTICIPANT_IDENTITY_ONLY_FIELDS]);
    expect([...identityFields].sort()).toEqual(['birthDate', 'email', 'identityDocument', 'patientName', 'phone', 'recordNumber', 'representativeEmail', 'representativeIdentityDocument', 'representativeName', 'representativePhone']);
    expect(Object.isFrozen(identityFields)).toBe(true);
    for (const entityType of ['Dataset', 'WorkflowRun', 'OmicsQualification', 'Assay', 'OmicsRun', 'Specimen']) {
      expect(INGESTION_TARGETS[entityType]).not.toHaveProperty('identityFields');
    }
  });

  it.each(['Telemetry', 'dataset', '', undefined, null, '__proto__', 'toString', 'constructor', 'hasOwnProperty'])(
    'resolves %s to null',
    (entityType) => {
      expect(resolveIngestionTarget(entityType)).toBeNull();
    }
  );
});
