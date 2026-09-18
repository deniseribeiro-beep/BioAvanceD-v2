import { describe, expect, it } from 'vitest';

const DatasetModel = require('../../src/models/Dataset');
const ImportJob = require('../../src/models/ImportJob');
const EnvironmentalExcursionModel = require('../../src/models/EnvironmentalExcursion');
const TerminologyConceptModel = require('../../src/models/TerminologyConcept');
const TerminologyRelationModel = require('../../src/models/TerminologyRelation');
const ReferenceImportIssueModel = require('../../src/models/ReferenceImportIssue');

describe('additional simple model branch coverage for item 8', () => {
  it('covers Dataset optional validation and create branches', () => {
    const base = {
      datasetTitle: 'Dataset',
      datasetVersion: 'v1',
      creators: ['User/1'],
      license: 'CC0',
    };

    const invalid = DatasetModel.validate({
      ...base,
      doi: 123,
      roCrateManifest: 456,
      distributionFiles: 'not-array',
    });
    expect(invalid.errors).toEqual(expect.arrayContaining([
      'doi deve ser string',
      'roCrateManifest deve ser string',
      'distributionFiles deve ser um array',
    ]));

    expect(DatasetModel.validate({
      ...base,
      doi: null,
      roCrateManifest: null,
      distributionFiles: null,
    })).toEqual({ isValid: true, errors: [] });

    const explicit = DatasetModel.create({
      ...base,
      datasetId: 'dataset-1',
      doi: '10.1234/test',
      distributionFiles: ['File/1'],
      roCrateManifest: 'File/manifest',
    });
    expect(explicit).toEqual(expect.objectContaining({
      datasetId: 'dataset-1',
      doi: '10.1234/test',
      distributionFiles: ['File/1'],
      roCrateManifest: 'File/manifest',
    }));

    const defaults = DatasetModel.create(base);
    expect(defaults.doi).toBeNull();
    expect(defaults.distributionFiles).toEqual([]);
    expect(defaults.roCrateManifest).toBeNull();
  });

  it('covers ImportJob explicit/default constructor and validation branches', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const explicit = ImportJob.create({
      jobID: 'job-1',
      userID: 'user-1',
      dataType: 'samples',
      filePath: '/tmp/file.csv',
      fileName: 'file.csv',
      fileSize: 123,
      status: 'processing',
      progress: 55,
      totalRecords: 10,
      successCount: 5,
      errorCount: 1,
      metadata: { x: 1 },
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      completedAt: now,
      fhirResources: [{ resourceType: 'Specimen' }],
    });

    expect(explicit.toJSON()).toEqual(expect.objectContaining({
      jobID: 'job-1',
      userID: 'user-1',
      dataType: 'samples',
      fileName: 'file.csv',
      fileSize: 123,
      status: 'processing',
      progress: 55,
      totalRecords: 10,
      successCount: 5,
      errorCount: 1,
      metadata: { x: 1 },
      startedAt: now,
      completedAt: now,
    }));

    const defaults = ImportJob.create({ dataType: 'patients', fileName: 'patients.csv' });
    expect(defaults.jobID).toBeNull();
    expect(defaults.userID).toBeNull();
    expect(defaults.filePath).toBeNull();
    expect(defaults.fileSize).toBeNull();
    expect(defaults.status).toBe('pending');
    expect(defaults.progress).toBe(0);
    expect(defaults.metadata).toEqual({});
    expect(defaults.fhirResources).toEqual([]);

    expect(ImportJob.validate({ dataType: 'invalid', fileName: 'x.csv' }).errors)
      .toContain('Tipo de dados inválido');
    expect(ImportJob.validate({ dataType: 'results', filePath: '/tmp/x' }))
      .toEqual({ isValid: true, errors: [] });
  });

  it('covers EnvironmentalExcursion explicit numeric/date/default branches', () => {
    const explicit = EnvironmentalExcursionModel.create({
      excursionId: 'exc-1',
      equipmentId: 'eq-1',
      startDateTime: '2026-01-01T00:00:00.000Z',
      endDateTime: '2026-01-01T01:00:00.000Z',
      minimumValue: '-90',
      maximumValue: '-70',
      affectedSpecimenIds: ['S1'],
      excursionStatus: 'closed',
      excursionType: 'missing_reading',
      impactAssessment: 'none',
      quarantineActionId: 'Q1',
      triggeringPolicyId: 'P1',
      originalReading: '-80',
    });
    expect(explicit).toEqual(expect.objectContaining({
      excursionId: 'exc-1',
      equipmentId: 'eq-1',
      minimumValue: -90,
      maximumValue: -70,
      affectedSpecimenIds: ['S1'],
      excursionStatus: 'closed',
      excursionType: 'missing_reading',
      impactAssessment: 'none',
      quarantineActionId: 'Q1',
      triggeringPolicyId: 'P1',
      originalReading: -80,
    }));
    expect(explicit.endDateTime).toBeInstanceOf(Date);

    const defaults = EnvironmentalExcursionModel.create({
      startDateTime: '2026-01-01T00:00:00.000Z',
      minimumValue: null,
      maximumValue: undefined,
      originalReading: null,
    });
    expect(defaults.equipmentId).toBeNull();
    expect(defaults.endDateTime).toBeNull();
    expect(defaults.minimumValue).toBeNull();
    expect(defaults.maximumValue).toBeNull();
    expect(defaults.affectedSpecimenIds).toEqual([]);
    expect(defaults.excursionStatus).toBe('under_assessment');
    expect(defaults.excursionType).toBe('temperature_out_of_range');
    expect(defaults.originalReading).toBeNull();
  });

  it('covers TerminologyConcept optional validation and explicit-date branches', () => {
    const base = {
      systemUri: 'urn:test',
      code: 'C1',
      version: 'v1',
      display: 'Concept',
      sourceRecordId: 'row-1',
      referenceDatasetReleaseId: 'release-1',
    };

    const invalid = TerminologyConceptModel.validate({
      ...base,
      systemUri: 1,
      code: 2,
      version: 3,
      display: 4,
      synonyms: 'syn',
      semanticType: 'type',
      sourceRecordId: 5,
      referenceDatasetReleaseId: 6,
      conceptStatus: 'active',
    });
    expect(invalid.errors).toEqual(expect.arrayContaining([
      'systemUri é obrigatório e deve ser string',
      'code é obrigatório e deve ser string',
      'version é obrigatório e deve ser string',
      'display é obrigatório e deve ser string',
      'synonyms deve ser um array',
      'semanticType deve ser um array',
      'sourceRecordId é obrigatório e deve ser string',
      'referenceDatasetReleaseId é obrigatório e deve ser string',
    ]));

    const explicit = TerminologyConceptModel.create({
      ...base,
      terminologyConceptId: 'concept-1',
      language: 'pt-BR',
      definition: 'definition',
      synonyms: ['A'],
      conceptStatus: 'deprecated',
      semanticType: ['type'],
      properties: { p: 1 },
      validFrom: '2026-01-01T00:00:00.000Z',
      validTo: '2026-12-31T00:00:00.000Z',
      replacementCode: 'C2',
    });
    expect(explicit).toEqual(expect.objectContaining({
      terminologyConceptId: 'concept-1',
      language: 'pt-BR',
      synonyms: ['A'],
      conceptStatus: 'deprecated',
      semanticType: ['type'],
      replacementCode: 'C2',
    }));
    expect(explicit.validFrom).toBeInstanceOf(Date);
    expect(explicit.validTo).toBeInstanceOf(Date);

    const defaults = TerminologyConceptModel.create(base);
    expect(defaults.language).toBe('en');
    expect(defaults.definition).toBeNull();
    expect(defaults.synonyms).toEqual([]);
    expect(defaults.semanticType).toEqual([]);
    expect(defaults.validFrom).toBeNull();
    expect(defaults.validTo).toBeNull();
  });

  it('covers TerminologyRelation optional validation and explicit/default create branches', () => {
    const base = {
      sourceConceptId: 'C1',
      targetConceptId: 'C2',
      relationType: 'is_a',
      relationVersion: 'v1',
      referenceDatasetReleaseId: 'release-1',
    };

    const invalid = TerminologyRelationModel.validate({
      ...base,
      sourceConceptId: 1,
      targetConceptId: 2,
      relationStatus: 'active',
      evidenceReferences: 'not-array',
      referenceDatasetReleaseId: 3,
    });
    expect(invalid.errors).toEqual(expect.arrayContaining([
      'sourceConceptId é obrigatório e deve ser string',
      'targetConceptId é obrigatório e deve ser string',
      'evidenceReferences deve ser um array',
      'referenceDatasetReleaseId é obrigatório e deve ser string',
    ]));

    const explicit = TerminologyRelationModel.create({
      ...base,
      terminologyRelationId: 'rel-1',
      relationSystem: 'urn:rel',
      relationStatus: 'deprecated',
      evidenceLevel: 'high',
      evidenceReferences: ['Ref/1'],
      relationProperties: { p: 1 },
      sourceRecordId: 'row-1',
    });
    expect(explicit).toEqual(expect.objectContaining({
      terminologyRelationId: 'rel-1',
      relationSystem: 'urn:rel',
      relationStatus: 'deprecated',
      evidenceLevel: 'high',
      evidenceReferences: ['Ref/1'],
      sourceRecordId: 'row-1',
    }));

    const defaults = TerminologyRelationModel.create(base);
    expect(defaults.relationSystem).toBeNull();
    expect(defaults.relationStatus).toBe('active');
    expect(defaults.evidenceLevel).toBeNull();
    expect(defaults.evidenceReferences).toEqual([]);
    expect(defaults.sourceRecordId).toBeNull();
  });

  it('covers ReferenceImportIssue required-type and explicit date/raw-value branches', () => {
    const base = {
      referenceImportRunId: 'run-1',
      referenceDatasetReleaseId: 'release-1',
      entityType: 'TerminologyConcept',
      errorCode: 'E1',
      errorMessage: 'bad row',
    };

    const invalid = ReferenceImportIssueModel.validate({
      ...base,
      referenceImportRunId: 1,
      referenceDatasetReleaseId: 2,
      entityType: 3,
      errorCode: 4,
      errorMessage: 5,
      severity: 'error',
      resolutionStatus: 'open',
    });
    expect(invalid.errors).toEqual(expect.arrayContaining([
      'referenceImportRunId é obrigatório e deve ser string',
      'referenceDatasetReleaseId é obrigatório e deve ser string',
      'entityType é obrigatório e deve ser string',
      'errorCode é obrigatório e deve ser string',
      'errorMessage é obrigatório e deve ser string',
    ]));

    const explicit = ReferenceImportIssueModel.create({
      ...base,
      referenceImportIssueId: 'issue-1',
      sourceRecordId: 'row-1',
      rowNumber: 7,
      fieldPath: 'code',
      rawValue: '',
      severity: 'fatal',
      resolutionStatus: 'corrected',
      quarantinePayloadUri: 's3://bucket/key',
      detectedAt: '2026-01-01T00:00:00.000Z',
      resolvedAt: '2026-01-02T00:00:00.000Z',
      resolvedBy: 'User/1',
      resolutionNotes: 'fixed',
    });
    expect(explicit).toEqual(expect.objectContaining({
      referenceImportIssueId: 'issue-1',
      sourceRecordId: 'row-1',
      rowNumber: 7,
      fieldPath: 'code',
      rawValue: '',
      severity: 'fatal',
      resolutionStatus: 'corrected',
      resolvedBy: 'User/1',
    }));
    expect(explicit.detectedAt).toBeInstanceOf(Date);
    expect(explicit.resolvedAt).toBeInstanceOf(Date);

    const defaults = ReferenceImportIssueModel.create(base);
    expect(defaults.rowNumber).toBeNull();
    expect(defaults.rawValue).toBeNull();
    expect(defaults.severity).toBe('error');
    expect(defaults.resolutionStatus).toBe('open');
    expect(defaults.resolvedAt).toBeNull();
  });
});
