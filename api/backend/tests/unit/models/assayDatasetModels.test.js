import { describe, it, expect } from 'vitest';

const AssayModel = require('../../../src/models/Assay');
const DatasetModel = require('../../../src/models/Dataset');

describe('AssayModel (RF007 AC#6, dict-02 ELM-0286..0297)', () => {
  const baseAssay = {
    studyId: 'study-1',
    specimenIds: ['specimen-1'],
    assayType: 'RNA sequencing',
    protocolId: 'protocol-1',
    operatorId: 'user-1',
    laboratoryId: 'org-1',
    assayDateTime: '2026-08-19T10:00:00.000Z',
    intendedUse: 'RNA-seq discovery',
  };

  describe('validate', () => {
    it('valid payload -> isValid true, no errors', () => {
      const result = AssayModel.validate({ ...baseAssay });
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it.each([
      ['studyId', { studyId: '' }],
      ['specimenIds', { specimenIds: [] }],
      ['specimenIds', { specimenIds: 'not-an-array' }],
      ['assayType', { assayType: '' }],
      ['protocolId', { protocolId: '' }],
      ['operatorId', { operatorId: '' }],
      ['laboratoryId', { laboratoryId: '' }],
      ['intendedUse', { intendedUse: '' }],
    ])('missing/invalid %s -> isValid false', (_field, override) => {
      const result = AssayModel.validate({ ...baseAssay, ...override });
      expect(result.isValid).toBe(false);
    });

    it('missing assayDateTime -> isValid false', () => {
      const result = AssayModel.validate({ ...baseAssay, assayDateTime: undefined });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('assayDateTime é obrigatório e deve ser uma data válida');
    });

    it('assayDateTime not a valid date -> isValid false', () => {
      const result = AssayModel.validate({ ...baseAssay, assayDateTime: 'not-a-date' });
      expect(result.isValid).toBe(false);
    });

    it('specimenIds with a non-string entry -> isValid false', () => {
      const result = AssayModel.validate({ ...baseAssay, specimenIds: ['specimen-1', 42] });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('specimenIds deve conter apenas strings não vazias');
    });

    it('omicsDomain/assayBatchId/controls omitted -> still valid (0..1/0..* per dict-02)', () => {
      const result = AssayModel.validate({ ...baseAssay });
      expect(result.isValid).toBe(true);
    });

    it('controls not an array -> isValid false', () => {
      const result = AssayModel.validate({ ...baseAssay, controls: 'not-an-array' });
      expect(result.isValid).toBe(false);
    });
  });

  describe('create', () => {
    it('generates a uuid assayId, preserves required fields, defaults optional ones', () => {
      const result = AssayModel.create({ ...baseAssay });

      expect(result.assayId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(result.studyId).toBe('study-1');
      expect(result.specimenIds).toEqual(['specimen-1']);
      expect(result.assayDateTime).toBeInstanceOf(Date);
      expect(result.omicsDomain).toBeNull();
      expect(result.assayBatchId).toBeNull();
      expect(result.controls).toEqual([]);
    });

    it('does not mutate the caller-provided specimenIds array', () => {
      const specimenIds = ['specimen-1'];
      const result = AssayModel.create({ ...baseAssay, specimenIds });

      result.specimenIds.push('specimen-2');
      expect(specimenIds).toEqual(['specimen-1']);
    });
  });
});

describe('DatasetModel (RF007 AC#6, dict-02 ELM-0416..0423)', () => {
  const baseDataset = {
    datasetTitle: 'RNA-seq cohort 2026',
    datasetVersion: '1.0.0',
    creators: [{ name: 'Dr. Silva', orcid: '0000-0000-0000-0001' }],
    license: 'CC-BY-4.0',
  };

  describe('validate', () => {
    it('valid payload -> isValid true, no errors', () => {
      const result = DatasetModel.validate({ ...baseDataset });
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it.each([
      ['datasetTitle', { datasetTitle: '' }],
      ['datasetVersion', { datasetVersion: '' }],
      ['creators', { creators: [] }],
      ['creators', { creators: 'not-an-array' }],
      ['license', { license: '' }],
    ])('missing/invalid %s -> isValid false', (_field, override) => {
      const result = DatasetModel.validate({ ...baseDataset, ...override });
      expect(result.isValid).toBe(false);
    });

    it('doi/roCrateManifest/distributionFiles omitted -> still valid', () => {
      const result = DatasetModel.validate({ ...baseDataset });
      expect(result.isValid).toBe(true);
    });

    it('distributionFiles not an array -> isValid false', () => {
      const result = DatasetModel.validate({ ...baseDataset, distributionFiles: 'not-an-array' });
      expect(result.isValid).toBe(false);
    });
  });

  describe('create', () => {
    it('generates a uuid datasetId, defaults distributionFiles/doi/roCrateManifest', () => {
      const result = DatasetModel.create({ ...baseDataset });

      expect(result.datasetId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(result.datasetTitle).toBe('RNA-seq cohort 2026');
      expect(result.distributionFiles).toEqual([]);
      expect(result.doi).toBeNull();
      expect(result.roCrateManifest).toBeNull();
    });

    it('does not mutate the caller-provided creators array', () => {
      const creators = [{ name: 'Dr. Silva' }];
      const result = DatasetModel.create({ ...baseDataset, creators });

      result.creators.push({ name: 'Dr. Souza' });
      expect(creators).toEqual([{ name: 'Dr. Silva' }]);
    });
  });
});
