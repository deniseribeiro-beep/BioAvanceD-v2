import { describe, it, expect } from 'vitest';
const TerminologyConceptModel = require('../../../src/models/TerminologyConcept');

describe('TerminologyConceptModel', () => {
  const validData = {
    systemUri: 'http://purl.obolibrary.org/obo/hp.owl',
    code: 'HP:0001250',
    version: 'sample-2026-07-31',
    display: 'Seizure',
    sourceRecordId: 'HP:0001250',
    referenceDatasetReleaseId: 'release-uuid',
  };

  describe('validate', () => {
    it('validates minimal required fields', () => {
      const result = TerminologyConceptModel.validate(validData);
      expect(result.isValid).toBe(true);
    });

    it('rejects a missing code', () => {
      const { code, ...rest } = validData;
      const result = TerminologyConceptModel.validate(rest);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('code é obrigatório e deve ser string');
    });

    it('rejects a missing referenceDatasetReleaseId (every concept must trace to a release)', () => {
      const { referenceDatasetReleaseId, ...rest } = validData;
      const result = TerminologyConceptModel.validate(rest);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('referenceDatasetReleaseId é obrigatório e deve ser string');
    });

    it('rejects an unknown conceptStatus', () => {
      const result = TerminologyConceptModel.validate({ ...validData, conceptStatus: 'floating' });
      expect(result.isValid).toBe(false);
    });

    it('rejects a non-array synonyms', () => {
      const result = TerminologyConceptModel.validate({ ...validData, synonyms: 'not-an-array' });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('synonyms deve ser um array');
    });
  });

  describe('create', () => {
    it('defaults language to en and conceptStatus to active', () => {
      const doc = TerminologyConceptModel.create(validData);
      expect(doc.terminologyConceptId).toMatch(/^[0-9a-f-]{36}$/);
      expect(doc.language).toBe('en');
      expect(doc.conceptStatus).toBe('active');
      expect(doc.synonyms).toEqual([]);
      expect(doc.semanticType).toEqual([]);
    });

    it('carries through synonyms and obsolete conceptStatus', () => {
      const doc = TerminologyConceptModel.create({
        ...validData,
        conceptStatus: 'obsolete',
        synonyms: [{ term: 'Seizures', scope: 'exact' }],
      });
      expect(doc.conceptStatus).toBe('obsolete');
      expect(doc.synonyms).toEqual([{ term: 'Seizures', scope: 'exact' }]);
    });
  });
});
