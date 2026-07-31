import { describe, it, expect } from 'vitest';
const TerminologyRelationModel = require('../../../src/models/TerminologyRelation');

describe('TerminologyRelationModel', () => {
  const validData = {
    sourceConceptId: 'concept-uuid-1',
    targetConceptId: 'concept-uuid-2',
    relationType: 'is_a',
    relationVersion: 'sample-2026-07-31',
    referenceDatasetReleaseId: 'release-uuid',
  };

  describe('validate', () => {
    it('validates minimal required fields', () => {
      const result = TerminologyRelationModel.validate(validData);
      expect(result.isValid).toBe(true);
    });

    it('rejects an unknown relationType (mappings must be explicit, §7.3)', () => {
      const result = TerminologyRelationModel.validate({ ...validData, relationType: 'kinda_related' });
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.startsWith('relationType'))).toBe(true);
    });

    it('rejects a missing targetConceptId', () => {
      const { targetConceptId, ...rest } = validData;
      const result = TerminologyRelationModel.validate(rest);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('targetConceptId é obrigatório e deve ser string');
    });

    it('rejects a non-array evidenceReferences', () => {
      const result = TerminologyRelationModel.validate({ ...validData, evidenceReferences: 'PMID:123' });
      expect(result.isValid).toBe(false);
    });
  });

  describe('create', () => {
    it('defaults relationStatus to active', () => {
      const doc = TerminologyRelationModel.create(validData);
      expect(doc.terminologyRelationId).toMatch(/^[0-9a-f-]{36}$/);
      expect(doc.relationStatus).toBe('active');
      expect(doc.evidenceReferences).toEqual([]);
      expect(doc.relationProperties).toBeNull();
    });
  });
});
