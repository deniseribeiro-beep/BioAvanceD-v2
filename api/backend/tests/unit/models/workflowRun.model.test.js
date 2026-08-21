import { describe, it, expect } from 'vitest';

const WorkflowRunModel = require('../../../src/models/WorkflowRun');

describe('WorkflowRunModel (RF027 AC#1/#2/#4, dict-02 ELM-0326..0336)', () => {
  const baseRun = {
    workflowId: 'variant-calling-pipeline',
    workflowVersion: '2.3.1',
    createdBy: 'User/user-1',
    startedAt: '2026-08-21T10:00:00.000Z',
    runStatus: 'succeeded',
  };

  describe('validate', () => {
    it('valid payload -> isValid true, no errors', () => {
      const result = WorkflowRunModel.validate({ ...baseRun });
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it.each([
      ['workflowId', { workflowId: '' }],
      ['workflowVersion', { workflowVersion: '' }],
      ['createdBy', { createdBy: '' }],
    ])('missing/invalid %s -> isValid false', (_field, override) => {
      const result = WorkflowRunModel.validate({ ...baseRun, ...override });
      expect(result.isValid).toBe(false);
    });

    it('missing startedAt -> isValid false', () => {
      const result = WorkflowRunModel.validate({ ...baseRun, startedAt: undefined });
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('startedAt é obrigatório e deve ser uma data válida');
    });

    it('startedAt not a valid date -> isValid false', () => {
      const result = WorkflowRunModel.validate({ ...baseRun, startedAt: 'not-a-date' });
      expect(result.isValid).toBe(false);
    });

    it('completedAt not a valid date -> isValid false', () => {
      const result = WorkflowRunModel.validate({ ...baseRun, completedAt: 'not-a-date' });
      expect(result.isValid).toBe(false);
    });

    it('completedAt omitted -> still valid (0..1 per dict-02)', () => {
      const result = WorkflowRunModel.validate({ ...baseRun });
      expect(result.isValid).toBe(true);
    });

    it('runStatus missing -> isValid false', () => {
      const result = WorkflowRunModel.validate({ ...baseRun, runStatus: undefined });
      expect(result.isValid).toBe(false);
    });

    it('runStatus out of enum -> isValid false', () => {
      const result = WorkflowRunModel.validate({ ...baseRun, runStatus: 'paused' });
      expect(result.isValid).toBe(false);
    });

    it.each(['queued', 'running', 'succeeded', 'failed', 'cancelled'])('runStatus %s -> isValid true', (runStatus) => {
      const result = WorkflowRunModel.validate({ ...baseRun, runStatus });
      expect(result.isValid).toBe(true);
    });

    it('containerImageDigest/softwareDependencies/parameters/inputFileIds/outputFileIds omitted -> still valid (0..1/0..* per dict-02)', () => {
      const result = WorkflowRunModel.validate({ ...baseRun });
      expect(result.isValid).toBe(true);
    });

    it('containerImageDigest not a string -> isValid false', () => {
      const result = WorkflowRunModel.validate({ ...baseRun, containerImageDigest: 42 });
      expect(result.isValid).toBe(false);
    });

    it('softwareDependencies not an array -> isValid false', () => {
      const result = WorkflowRunModel.validate({ ...baseRun, softwareDependencies: 'not-an-array' });
      expect(result.isValid).toBe(false);
    });

    it('softwareDependencies entry not an object -> isValid false', () => {
      const result = WorkflowRunModel.validate({ ...baseRun, softwareDependencies: ['not-an-object'] });
      expect(result.isValid).toBe(false);
    });

    it('softwareDependencies with valid object entries -> isValid true', () => {
      const result = WorkflowRunModel.validate({
        ...baseRun,
        softwareDependencies: [{ name: 'bwa', version: '0.7.17' }],
      });
      expect(result.isValid).toBe(true);
    });

    it('parameters not an object -> isValid false', () => {
      const result = WorkflowRunModel.validate({ ...baseRun, parameters: 'not-an-object' });
      expect(result.isValid).toBe(false);
    });

    it('parameters as an array -> isValid false', () => {
      const result = WorkflowRunModel.validate({ ...baseRun, parameters: ['not-an-object'] });
      expect(result.isValid).toBe(false);
    });

    it('inputFileIds not an array -> isValid false', () => {
      const result = WorkflowRunModel.validate({ ...baseRun, inputFileIds: 'not-an-array' });
      expect(result.isValid).toBe(false);
    });

    it('inputFileIds with a non-string entry -> isValid false', () => {
      const result = WorkflowRunModel.validate({ ...baseRun, inputFileIds: ['file-1', 42] });
      expect(result.isValid).toBe(false);
    });

    it('outputFileIds not an array -> isValid false', () => {
      const result = WorkflowRunModel.validate({ ...baseRun, outputFileIds: 'not-an-array' });
      expect(result.isValid).toBe(false);
    });

    it('outputFileIds with a non-string entry -> isValid false', () => {
      const result = WorkflowRunModel.validate({ ...baseRun, outputFileIds: ['file-1', 42] });
      expect(result.isValid).toBe(false);
    });
  });

  describe('create', () => {
    it('generates a uuid workflowRunId, preserves required fields, defaults optional ones', () => {
      const result = WorkflowRunModel.create({ ...baseRun });

      expect(result.workflowRunId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(result.workflowId).toBe('variant-calling-pipeline');
      expect(result.workflowVersion).toBe('2.3.1');
      expect(result.createdBy).toBe('User/user-1');
      expect(result.startedAt).toBeInstanceOf(Date);
      expect(result.completedAt).toBeNull();
      expect(result.containerImageDigest).toBeNull();
      expect(result.softwareDependencies).toEqual([]);
      expect(result.parameters).toBeNull();
      expect(result.inputFileIds).toEqual([]);
      expect(result.outputFileIds).toEqual([]);
      expect(result.runStatus).toBe('succeeded');
    });

    it('does not mutate the caller-provided softwareDependencies/inputFileIds/outputFileIds arrays', () => {
      const softwareDependencies = [{ name: 'bwa', version: '0.7.17' }];
      const inputFileIds = ['file-1'];
      const outputFileIds = ['file-2'];
      const result = WorkflowRunModel.create({ ...baseRun, softwareDependencies, inputFileIds, outputFileIds });

      result.softwareDependencies.push({ name: 'samtools', version: '1.17' });
      result.inputFileIds.push('file-3');
      result.outputFileIds.push('file-4');
      expect(softwareDependencies).toEqual([{ name: 'bwa', version: '0.7.17' }]);
      expect(inputFileIds).toEqual(['file-1']);
      expect(outputFileIds).toEqual(['file-2']);
    });

    it('preserves parameters as a shallow copy, not the caller-provided object reference', () => {
      const parameters = { threads: 8 };
      const result = WorkflowRunModel.create({ ...baseRun, parameters });

      result.parameters.threads = 16;
      expect(parameters).toEqual({ threads: 8 });
    });

    it('completedAt provided -> stored as a Date', () => {
      const result = WorkflowRunModel.create({ ...baseRun, completedAt: '2026-08-21T11:00:00.000Z' });
      expect(result.completedAt).toBeInstanceOf(Date);
    });
  });
});
