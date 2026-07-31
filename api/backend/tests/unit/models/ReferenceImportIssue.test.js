import { describe, it, expect } from 'vitest';
const ReferenceImportIssueModel = require('../../../src/models/ReferenceImportIssue');

describe('ReferenceImportIssueModel', () => {
  const validData = {
    referenceImportRunId: 'run-uuid',
    referenceDatasetReleaseId: 'release-uuid',
    entityType: 'TerminologyConcept',
    errorCode: 'MISSING_CODE',
    errorMessage: 'Registro sem código.',
  };

  describe('validate', () => {
    it('validates minimal required fields', () => {
      const result = ReferenceImportIssueModel.validate(validData);
      expect(result.isValid).toBe(true);
    });

    it('rejects a missing errorMessage', () => {
      const { errorMessage, ...rest } = validData;
      const result = ReferenceImportIssueModel.validate(rest);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('errorMessage é obrigatório e deve ser string');
    });

    it('rejects an unknown severity', () => {
      const result = ReferenceImportIssueModel.validate({ ...validData, severity: 'catastrophic' });
      expect(result.isValid).toBe(false);
    });

    it('rejects an unknown resolutionStatus', () => {
      const result = ReferenceImportIssueModel.validate({ ...validData, resolutionStatus: 'shrugged_off' });
      expect(result.isValid).toBe(false);
    });
  });

  describe('create', () => {
    it('defaults severity to error and resolutionStatus to open', () => {
      const doc = ReferenceImportIssueModel.create(validData);
      expect(doc.referenceImportIssueId).toMatch(/^[0-9a-f-]{36}$/);
      expect(doc.severity).toBe('error');
      expect(doc.resolutionStatus).toBe('open');
      expect(doc.detectedAt).toBeInstanceOf(Date);
      expect(doc.resolvedAt).toBeNull();
      expect(doc.rawValue).toBeNull();
    });

    it('preserves an explicit rawValue and severity', () => {
      const doc = ReferenceImportIssueModel.create({ ...validData, severity: 'fatal', rawValue: { id: '' } });
      expect(doc.severity).toBe('fatal');
      expect(doc.rawValue).toEqual({ id: '' });
    });
  });
});
