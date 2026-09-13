import { describe, it, expect } from 'vitest';
const ReferenceDatasetReleaseModel = require('../../../src/models/ReferenceDatasetRelease');

describe('ReferenceDatasetReleaseModel', () => {
  const validData = {
    sourceId: 'SRC_HPO',
    datasetCode: 'HPO',
    datasetName: 'Human Phenotype Ontology',
    systemUri: 'http://purl.obolibrary.org/obo/hp.owl',
    datasetVersion: 'sample-2026-07-31',
    retrievalUri: 'file:///tmp/hpo-sample.jsonl',
    license: 'CC BY 4.0',
    sourceChecksum: 'sha256:abc',
    parserVersion: '1.0.0',
    mappingVersion: '1.0.0',
  };

  describe('validate', () => {
    it('validates minimal required fields', () => {
      const result = ReferenceDatasetReleaseModel.validate(validData);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects a missing datasetCode', () => {
      const { datasetCode, ...rest } = validData;
      const result = ReferenceDatasetReleaseModel.validate(rest);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('datasetCode é obrigatório e deve ser string');
    });

    it('rejects an unknown accessMethod', () => {
      const result = ReferenceDatasetReleaseModel.validate({ ...validData, accessMethod: 'telepathy' });
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.startsWith('accessMethod'))).toBe(true);
    });

    it('rejects an unknown releaseStatus', () => {
      const result = ReferenceDatasetReleaseModel.validate({ ...validData, releaseStatus: 'unknown_status' });
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.startsWith('releaseStatus'))).toBe(true);
    });

    it('rejects a missing sourceChecksum (AC 10 gate)', () => {
      const { sourceChecksum, ...rest } = validData;
      const result = ReferenceDatasetReleaseModel.validate(rest);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('sourceChecksum é obrigatório e deve ser string (SHA-256)');
    });
  });

  describe('create', () => {
    it('fills defaults and generates a uuid', () => {
      const doc = ReferenceDatasetReleaseModel.create(validData);
      expect(doc.referenceDatasetReleaseId).toMatch(/^[0-9a-f-]{36}$/);
      expect(doc.releaseStatus).toBe('planned');
      expect(doc.accessMethod).toBe('manual_upload');
      expect(doc.sourceFormat).toEqual([]);
      expect(doc.previousReleaseId).toBeNull();
      expect(doc.createdAt).toBeInstanceOf(Date);
      expect(doc.updatedAt).toBeInstanceOf(Date);
    });

    it('preserves an explicit releaseStatus and previousReleaseId', () => {
      const doc = ReferenceDatasetReleaseModel.create({
        ...validData,
        releaseStatus: 'active',
        previousReleaseId: 'prior-uuid',
      });
      expect(doc.releaseStatus).toBe('active');
      expect(doc.previousReleaseId).toBe('prior-uuid');
    });
  });
});
