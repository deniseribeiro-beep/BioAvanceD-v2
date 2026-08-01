import { describe, it, expect } from 'vitest';
const FoundationDataRunModel = require('../../../src/models/FoundationDataRun');

describe('FoundationDataRunModel', () => {
  const validData = {
    pipelineVersion: '1.0.0',
    schemaVersion: '1.3.0',
    dictionaryVersion: '1.3.0',
    environment: 'test',
    deploymentId: 'bioavanced-test-20260801',
    executionMode: 'apply',
    configurationChecksum: 'sha256:config',
    dictionaryChecksum: 'sha256:dictionary',
    initiatedBy: 'system:foundation-data-pipeline',
  };

  describe('validate', () => {
    it('validates minimal required fields', () => {
      const result = FoundationDataRunModel.validate(validData);
      expect(result.isValid).toBe(true);
    });

    it('rejects a missing dictionaryChecksum', () => {
      const { dictionaryChecksum, ...rest } = validData;
      const result = FoundationDataRunModel.validate(rest);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('dictionaryChecksum é obrigatório e deve ser string');
    });

    it('rejects an unknown environment', () => {
      const result = FoundationDataRunModel.validate({ ...validData, environment: 'moon' });
      expect(result.isValid).toBe(false);
    });

    it('rejects an unknown executionMode', () => {
      const result = FoundationDataRunModel.validate({ ...validData, executionMode: 'teleport' });
      expect(result.isValid).toBe(false);
    });

    it('rejects an unknown runStatus', () => {
      const result = FoundationDataRunModel.validate({ ...validData, runStatus: 'teleported' });
      expect(result.isValid).toBe(false);
    });

    it('rejects a non-array steps', () => {
      const result = FoundationDataRunModel.validate({ ...validData, steps: 'nope' });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('steps deve ser um array');
    });

    it('rejects a non-object validationSummary', () => {
      const result = FoundationDataRunModel.validate({ ...validData, validationSummary: ['nope'] });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('validationSummary deve ser um objeto');
    });
  });

  describe('create', () => {
    it('fills defaults for a freshly planned run', () => {
      const doc = FoundationDataRunModel.create(validData);
      expect(doc.foundationDataRunId).toMatch(/^[0-9a-f-]{36}$/);
      expect(doc.runStatus).toBe('planned');
      expect(doc.steps).toEqual([]);
      expect(doc.validationSummary).toEqual({});
      expect(doc.errorSummary).toBeNull();
      expect(doc.previousRunId).toBeNull();
      expect(doc.startedAt).toBeInstanceOf(Date);
      expect(doc.completedAt).toBeNull();
    });

    it('carries through explicit status, steps and previousRunId', () => {
      const doc = FoundationDataRunModel.create({
        ...validData,
        runStatus: 'completed',
        steps: [{ step: 'miabis-minimal', status: 'completed' }],
        validationSummary: { passed: 3, failed: 0 },
        previousRunId: 'prior-run-uuid',
      });
      expect(doc.runStatus).toBe('completed');
      expect(doc.steps).toHaveLength(1);
      expect(doc.validationSummary).toEqual({ passed: 3, failed: 0 });
      expect(doc.previousRunId).toBe('prior-run-uuid');
    });
  });
});
