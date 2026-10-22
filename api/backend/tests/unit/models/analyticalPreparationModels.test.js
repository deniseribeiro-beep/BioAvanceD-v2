import { describe, it, expect } from 'vitest';

// #1318, RF029 AC8 and RNF030 C2-C5: the seven inactive analytical-preparation
// structures. fieldsOf emits the catalog's fields, validate enforces each
// 1..1 and 1..* Core field and the coded and format checks, and create
// returns the validated document.

const { loadCanonicalDictionary } = require('../../../src/reference-data/canonical-dictionary/v2');
const DatasetSnapshotModel = require('../../../src/models/DatasetSnapshot');
const DatasetPartitionModel = require('../../../src/models/DatasetPartition');
const FeatureDefinitionModel = require('../../../src/models/FeatureDefinition');
const LabelDefinitionModel = require('../../../src/models/LabelDefinition');
const CohortDefinitionModel = require('../../../src/models/CohortDefinition');
const DeidentificationProcessModel = require('../../../src/models/DeidentificationProcess');
const DatasetRepresentativenessAssessmentModel = require('../../../src/models/DatasetRepresentativenessAssessment');

const catalog = loadCanonicalDictionary();
const rowsOf = (entity) => catalog.filter((row) => row.entity === entity);

const CHECKSUM = `sha256:${'a'.repeat(64)}`;

const MODELS = {
  DatasetSnapshot: {
    model: DatasetSnapshotModel,
    valid: {
      datasetSnapshotId: 'snapshot-1',
      datasetId: 'dataset-1',
      memberManifestUri: 'object://synthetic/members.json',
      queryDefinition: 'participants with consent for research',
      filterDefinition: { cohort: 'synthetic' },
      policySnapshot: { accessPolicyId: 'policy-1', version: '1.0.0' },
      referenceVersions: ['release-1'],
      checksum: CHECKSUM,
      createdAt: '2026-10-22T10:00:00.000Z',
    },
  },
  DatasetPartition: {
    model: DatasetPartitionModel,
    valid: {
      datasetPartitionId: 'partition-1',
      snapshotId: 'snapshot-1',
      partitionType: 'test',
      strategy: 'participant',
      seed: 20260504,
      groupingUnit: 'participant',
      memberManifestUri: 'object://synthetic/test-members.json',
      leakageCheckResult: 'pass',
    },
  },
  FeatureDefinition: {
    model: FeatureDefinitionModel,
    valid: {
      featureDefinitionId: 'feature-1',
      featureName: 'baseline_hba1c',
      semantics: 'HbA1c at enrolment',
      dataType: 'decimal',
      unit: { systemUri: 'http://unitsofmeasure.org', code: '%', version: null, display: '%' },
      transformation: 'last value in window',
      timeWindow: { start: '2026-01-01T00:00:00.000Z', end: '2026-06-30T00:00:00.000Z' },
      semanticVersion: '1.0.0',
      leakageRisk: 'low',
      inputRefs: ['observation-definition-1'],
    },
  },
  LabelDefinition: {
    model: LabelDefinitionModel,
    valid: {
      labelDefinitionId: 'label-1',
      concept: { systemUri: 'http://snomed.info/sct', code: '44054006', version: null, display: 'Diabetes mellitus type 2' },
      method: 'chart review',
      source: 'condition-1',
      temporalAnchor: 'enrolment',
      uncertainty: { kappa: 0.8 },
      semanticVersion: '1.0.0',
      restrictions: ['research only'],
    },
  },
  CohortDefinition: {
    model: CohortDefinitionModel,
    valid: {
      cohortDefinitionId: 'cohort-1',
      population: 'adults with type 2 diabetes',
      inclusionCriteria: [{ code: '44054006' }],
      exclusionCriteria: [{ code: '46635009' }],
      timeWindow: { start: '2026-01-01T00:00:00.000Z', end: null },
      terminologyVersions: ['snomed-2026-01'],
      datasetSnapshotId: 'snapshot-1',
      checksum: CHECKSUM,
    },
  },
  DeidentificationProcess: {
    model: DeidentificationProcessModel,
    valid: {
      deidentificationProcessId: 'deid-1',
      methodVersion: '2.1.0',
      fieldTransformations: [{ field: 'birthDate', transformation: 'year only' }],
      riskAssessmentId: 'risk-1',
      keyReference: 'kms://synthetic/key-1',
      responsibleActorId: 'user-1',
      inputSnapshotId: 'snapshot-1',
      outputFileIds: ['file-1'],
    },
  },
  DatasetRepresentativenessAssessment: {
    model: DatasetRepresentativenessAssessmentModel,
    valid: {
      representativenessAssessmentId: 'representativeness-1',
      snapshotId: 'snapshot-1',
      authorizedStrata: ['sex', 'age_band'],
      distributionMetrics: [{ stratum: 'sex', value: 0.5 }],
      missingnessMetrics: [{ field: 'hba1c', missing: 0.1 }],
      suppressionThreshold: 5,
      limitations: ['single site'],
      assessedAt: '2026-10-22T10:00:00.000Z',
    },
  },
};

describe.each(Object.entries(MODELS))('%s (RF029 AC8, RNF030, #1318)', (entity, { model, valid }) => {
  const rows = rowsOf(entity);
  // The id is assigned by fieldsOf when absent, so it is never missing.
  const requiredFields = rows
    .filter((row) => row.requirement === 'Core' && /^1\.\./.test(row.cardinality) && row.type !== 'uuid')
    .map((row) => row.field);

  it('a valid document validates and create returns it', () => {
    expect(model.validate(valid)).toEqual({ isValid: true, errors: [] });
    expect(model.create(valid)).toEqual(model.fieldsOf(valid));
  });

  it('fieldsOf() with no argument emits exactly the catalog fields, in catalog order', () => {
    expect(rows.length).toBeGreaterThan(0);
    expect(Object.keys(model.fieldsOf())).toEqual(rows.map((row) => row.field));
  });

  it.each(requiredFields)('validate fails naming %s when it is absent', (field) => {
    const result = model.validate({ ...valid, [field]: undefined });
    expect(result.isValid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].startsWith(`${field} `)).toBe(true);
    // create stamps an absent createdAt or assessedAt with now instead.
    if (!['createdAt', 'assessedAt'].includes(field)) {
      expect(() => model.create({ ...valid, [field]: undefined })).toThrow(field);
    }
  });
});

describe('DatasetSnapshot checks', () => {
  const { valid } = MODELS.DatasetSnapshot;

  it('rejects a checksum that is not SHA-256', () => {
    const result = DatasetSnapshotModel.validate({ ...valid, checksum: 'md5:abc' });
    expect(result.errors).toEqual(['checksum deve ser um digest SHA-256: md5:abc']);
  });

  it('accepts an empty filterDefinition object as present', () => {
    expect(DatasetSnapshotModel.validate({ ...valid, filterDefinition: {} }).isValid).toBe(true);
  });

  it('rejects a filterDefinition that is not an object', () => {
    expect(DatasetSnapshotModel.validate({ ...valid, filterDefinition: 'all' }).isValid).toBe(false);
  });

  it('create stamps an absent createdAt with now', () => {
    const before = Date.now();
    const created = DatasetSnapshotModel.create({ ...valid, createdAt: undefined });
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.createdAt.getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe('DatasetPartition checks', () => {
  const { valid } = MODELS.DatasetPartition;

  it('exports the closed sets', () => {
    expect(DatasetPartitionModel.PARTITION_TYPES).toEqual(['train', 'validation', 'test']);
    expect(DatasetPartitionModel.LEAKAGE_CHECK_RESULTS).toEqual(['pass', 'fail']);
  });

  it('rejects a partitionType outside train|validation|test', () => {
    expect(DatasetPartitionModel.validate({ ...valid, partitionType: 'holdout' }).errors)
      .toEqual(['partitionType inválido: holdout']);
  });

  it('rejects a leakageCheckResult outside pass|fail', () => {
    expect(DatasetPartitionModel.validate({ ...valid, leakageCheckResult: 'unknown' }).errors)
      .toEqual(['leakageCheckResult inválido: unknown']);
  });

  it('accepts seed 0 as a value', () => {
    expect(DatasetPartitionModel.fieldsOf({ ...valid, seed: 0 }).seed).toBe(0);
    expect(DatasetPartitionModel.validate({ ...valid, seed: 0 }).isValid).toBe(true);
  });

  it('rejects a non-integer seed', () => {
    expect(DatasetPartitionModel.validate({ ...valid, seed: 1.5 }).isValid).toBe(false);
    expect(DatasetPartitionModel.validate({ ...valid, seed: '42' }).isValid).toBe(false);
  });

  it('keeps strategy and groupingUnit open codes', () => {
    expect(DatasetPartitionModel.validate({ ...valid, strategy: 'site', groupingUnit: 'family' }).isValid).toBe(true);
  });
});

describe('FeatureDefinition checks', () => {
  const { valid } = MODELS.FeatureDefinition;

  it('exports the leakageRisk set', () => {
    expect(FeatureDefinitionModel.LEAKAGE_RISKS).toEqual(['none', 'low', 'medium', 'high']);
  });

  it('rejects a leakageRisk outside none|low|medium|high', () => {
    expect(FeatureDefinitionModel.validate({ ...valid, leakageRisk: 'severe' }).errors)
      .toEqual(['leakageRisk inválido: severe']);
  });

  it('rejects a semanticVersion that is not SemVer', () => {
    expect(FeatureDefinitionModel.validate({ ...valid, semanticVersion: 'v1' }).errors)
      .toEqual(['semanticVersion deve ser SemVer (MAJOR.MINOR.PATCH): v1']);
  });

  it('accepts an absent unit and timeWindow (0..1)', () => {
    const result = FeatureDefinitionModel.validate({ ...valid, unit: undefined, timeWindow: undefined });
    expect(result.isValid).toBe(true);
    expect(FeatureDefinitionModel.fieldsOf({ ...valid, unit: undefined, timeWindow: undefined }))
      .toMatchObject({ unit: null, timeWindow: null });
  });

  it('rejects a unit without systemUri and code', () => {
    expect(FeatureDefinitionModel.validate({ ...valid, unit: { display: '%' } }).errors)
      .toEqual(['unit deve ser um Coding com systemUri e code']);
  });

  it('rejects a timeWindow whose end is before its start', () => {
    const timeWindow = { start: '2026-06-30T00:00:00.000Z', end: '2026-01-01T00:00:00.000Z' };
    expect(FeatureDefinitionModel.validate({ ...valid, timeWindow }).errors)
      .toEqual(['timeWindow.end não pode ser anterior a timeWindow.start']);
  });

  it('stores a timeWindow as a {start, end} Period of Dates', () => {
    const { timeWindow } = FeatureDefinitionModel.fieldsOf(valid);
    expect(timeWindow.start).toEqual(new Date('2026-01-01T00:00:00.000Z'));
    expect(timeWindow.end).toEqual(new Date('2026-06-30T00:00:00.000Z'));
  });
});

describe('LabelDefinition checks', () => {
  const { valid } = MODELS.LabelDefinition;

  it('rejects a concept without systemUri and code', () => {
    expect(LabelDefinitionModel.validate({ ...valid, concept: { display: 'Diabetes' } }).errors)
      .toEqual(['concept é obrigatório para LabelDefinition (1..1, Coding com systemUri e code)']);
  });

  it('rejects a semanticVersion that is not SemVer', () => {
    expect(LabelDefinitionModel.validate({ ...valid, semanticVersion: '1.0' }).isValid).toBe(false);
  });

  it('accepts absent restrictions (0..*) and rejects an empty entry', () => {
    expect(LabelDefinitionModel.validate({ ...valid, restrictions: undefined }).isValid).toBe(true);
    expect(LabelDefinitionModel.validate({ ...valid, restrictions: [''] }).isValid).toBe(false);
  });
});

describe('CohortDefinition checks', () => {
  const { valid } = MODELS.CohortDefinition;

  it('rejects a timeWindow whose end is before its start', () => {
    const timeWindow = { start: '2026-06-30T00:00:00.000Z', end: '2026-01-01T00:00:00.000Z' };
    expect(CohortDefinitionModel.validate({ ...valid, timeWindow }).errors)
      .toEqual(['timeWindow.end não pode ser anterior a timeWindow.start']);
  });

  it('rejects a timeWindow without a start', () => {
    expect(CohortDefinitionModel.validate({ ...valid, timeWindow: { end: '2026-01-01T00:00:00.000Z' } }).errors)
      .toEqual(['timeWindow.start deve ser uma data ISO 8601']);
  });

  it('accepts an open-ended timeWindow', () => {
    expect(CohortDefinitionModel.fieldsOf(valid).timeWindow.end).toBeNull();
    expect(CohortDefinitionModel.validate(valid).isValid).toBe(true);
  });

  it('rejects a checksum that is not SHA-256', () => {
    expect(CohortDefinitionModel.validate({ ...valid, checksum: 'abc' }).isValid).toBe(false);
  });

  it('accepts absent exclusionCriteria (0..*) and rejects a non-object entry', () => {
    expect(CohortDefinitionModel.validate({ ...valid, exclusionCriteria: undefined }).isValid).toBe(true);
    expect(CohortDefinitionModel.validate({ ...valid, exclusionCriteria: ['smoker'] }).isValid).toBe(false);
  });
});

describe('DeidentificationProcess checks', () => {
  const { valid } = MODELS.DeidentificationProcess;

  it('rejects a methodVersion that is not SemVer', () => {
    expect(DeidentificationProcessModel.validate({ ...valid, methodVersion: '2.1' }).errors)
      .toEqual(['methodVersion deve ser SemVer (MAJOR.MINOR.PATCH): 2.1']);
  });

  it('accepts an absent keyReference (0..1) and rejects an empty one', () => {
    expect(DeidentificationProcessModel.validate({ ...valid, keyReference: undefined }).isValid).toBe(true);
    expect(DeidentificationProcessModel.validate({ ...valid, keyReference: '' }).isValid).toBe(false);
  });
});

describe('DatasetRepresentativenessAssessment checks', () => {
  const { valid } = MODELS.DatasetRepresentativenessAssessment;

  it('accepts suppressionThreshold 0 as a value', () => {
    expect(DatasetRepresentativenessAssessmentModel.fieldsOf({ ...valid, suppressionThreshold: 0 }).suppressionThreshold).toBe(0);
    expect(DatasetRepresentativenessAssessmentModel.validate({ ...valid, suppressionThreshold: 0 }).isValid).toBe(true);
  });

  it('rejects an empty authorizedStrata entry', () => {
    expect(DatasetRepresentativenessAssessmentModel.validate({ ...valid, authorizedStrata: ['sex', ''] }).isValid).toBe(false);
  });

  it('create stamps an absent assessedAt with now', () => {
    const created = DatasetRepresentativenessAssessmentModel.create({ ...valid, assessedAt: undefined });
    expect(created.assessedAt).toBeInstanceOf(Date);
  });
});
