import { describe, it, expect } from 'vitest';
const ReferenceImportRunModel = require('../../../src/models/ReferenceImportRun');

describe('ReferenceImportRunModel', () => {
  const validData = {
    referenceDatasetReleaseId: 'release-uuid',
    datasetCode: 'HPO',
    idempotencyKey: 'HPO:sample-2026-07-31:sha256:abc',
    inputChecksum: 'sha256:abc',
    initiatedBy: 'system:reference-data-bootstrap',
  };

  describe('validate', () => {
    it('validates minimal required fields', () => {
      const result = ReferenceImportRunModel.validate(validData);
      expect(result.isValid).toBe(true);
    });

    it('rejects a missing idempotencyKey', () => {
      const { idempotencyKey, ...rest } = validData;
      const result = ReferenceImportRunModel.validate(rest);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('idempotencyKey é obrigatório e deve ser string');
    });

    it('rejects an unknown importMode', () => {
      const result = ReferenceImportRunModel.validate({ ...validData, importMode: 'teleport' });
      expect(result.isValid).toBe(false);
    });

    it('rejects an unknown runStatus', () => {
      const result = ReferenceImportRunModel.validate({ ...validData, runStatus: 'teleported' });
      expect(result.isValid).toBe(false);
    });

    it('rejects a non-numeric recordsRejected', () => {
      const result = ReferenceImportRunModel.validate({ ...validData, recordsRejected: '10' });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('recordsRejected deve ser numérico');
    });
  });

  describe('create', () => {
    it('fills defaults for a freshly planned run', () => {
      const doc = ReferenceImportRunModel.create(validData);
      expect(doc.referenceImportRunId).toMatch(/^[0-9a-f-]{36}$/);
      expect(doc.importMode).toBe('full');
      expect(doc.runStatus).toBe('planned');
      expect(doc.recordsRead).toBe(0);
      expect(doc.recordsRejected).toBe(0);
      expect(doc.foundationDataRunId).toBeNull();
      expect(doc.checkpoint).toBeNull();
      expect(doc.startedAt).toBeInstanceOf(Date);
      expect(doc.completedAt).toBeNull();
    });

    it('carries through explicit counts and status', () => {
      const doc = ReferenceImportRunModel.create({
        ...validData,
        runStatus: 'completed',
        recordsRead: 10,
        recordsInserted: 8,
        recordsRejected: 2,
      });
      expect(doc.runStatus).toBe('completed');
      expect(doc.recordsRead).toBe(10);
      expect(doc.recordsInserted).toBe(8);
      expect(doc.recordsRejected).toBe(2);
    });
  });
});
