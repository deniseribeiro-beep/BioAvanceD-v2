import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { validate } = require('../../../src/contracts/canonical/v1');

describe('canonical.v1.workflow (RF029 slice 6/6, #674)', () => {
  it('accepts a fully populated payload', () => {
    const { valid, errors } = validate('canonical.v1.workflow', {
      workflowId: 'variant-calling-pipeline',
      workflowVersion: '2.3.1',
      createdBy: 'User/user-1',
      containerImageDigest: 'sha256:abc123',
      softwareDependencies: [{ name: 'gatk', version: '4.5.0' }],
      parameters: { referenceGenome: 'GRCh38' },
      inputFileIds: ['file-1'],
      outputFileIds: ['file-2'],
      startedAt: '2026-08-21T10:00:00.000Z',
      completedAt: '2026-08-21T11:00:00.000Z',
      runStatus: 'succeeded',
      hardwareProfile: { cpu: 'synthetic', gpu: null },
      randomSeed: 20260504,
      datasetSnapshotId: 'snapshot-synthetic-001',
      environmentManifestUri: 'object://synthetic/environment.json',
    });
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
  });

  it('accepts a minimal payload with just the required fields', () => {
    const { valid, errors } = validate('canonical.v1.workflow', {
      workflowId: 'variant-calling-pipeline',
      workflowVersion: '2.3.1',
      createdBy: 'User/user-1',
      startedAt: '2026-08-21T10:00:00.000Z',
      runStatus: 'succeeded',
      hardwareProfile: { cpu: 'synthetic' },
      environmentManifestUri: 'object://synthetic/environment.json',
    });
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
  });

  it('rejects an invalid runStatus (AC#2 cardinality)', () => {
    const { valid, errors } = validate('canonical.v1.workflow', {
      workflowId: 'variant-calling-pipeline',
      workflowVersion: '2.3.1',
      createdBy: 'User/user-1',
      startedAt: '2026-08-21T10:00:00.000Z',
      runStatus: 'paused',
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.keyword === 'enum')).toBe(true);
  });

  it('rejects a payload missing a required field (createdBy, AC#4)', () => {
    const { valid, errors } = validate('canonical.v1.workflow', {
      workflowId: 'variant-calling-pipeline',
      workflowVersion: '2.3.1',
      startedAt: '2026-08-21T10:00:00.000Z',
      runStatus: 'succeeded',
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.keyword === 'required')).toBe(true);
  });

  it('rejects an unknown top-level field (additionalProperties: false)', () => {
    const { valid, errors } = validate('canonical.v1.workflow', {
      workflowId: 'variant-calling-pipeline',
      workflowVersion: '2.3.1',
      createdBy: 'User/user-1',
      startedAt: '2026-08-21T10:00:00.000Z',
      runStatus: 'succeeded',
      unknownField: 'x',
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.keyword === 'additionalProperties')).toBe(true);
  });

  describe('the v2 provenance companions (V2E-0477..0480, #1322)', () => {
    const minimalRun = {
      workflowId: 'variant-calling-pipeline',
      workflowVersion: '2.3.1',
      createdBy: 'User/user-1',
      startedAt: '2026-08-21T10:00:00.000Z',
      runStatus: 'succeeded',
      hardwareProfile: { cpu: 'synthetic' },
      environmentManifestUri: 'object://synthetic/environment.json',
    };

    it('rejects a payload missing hardwareProfile (V2E-0477, 1..1)', () => {
      const { hardwareProfile: _omitted, ...payload } = minimalRun;
      const { valid, errors } = validate('canonical.v1.workflow', payload);
      expect(valid).toBe(false);
      expect(errors.some((e) => e.keyword === 'required')).toBe(true);
    });

    it('rejects an environmentManifestUri that is not an absolute URI (V2E-0480)', () => {
      const { valid, errors } = validate('canonical.v1.workflow', { ...minimalRun, environmentManifestUri: 'not a uri' });
      expect(valid).toBe(false);
      expect(errors.some((e) => e.keyword === 'pattern')).toBe(true);
    });

    it('rejects a fractional randomSeed (V2E-0478)', () => {
      const { valid, errors } = validate('canonical.v1.workflow', { ...minimalRun, randomSeed: 1.5 });
      expect(valid).toBe(false);
      expect(errors.some((e) => e.keyword === 'type')).toBe(true);
    });

    it('rejects a randomSeed beyond the safe integers', () => {
      const { valid, errors } = validate('canonical.v1.workflow', { ...minimalRun, randomSeed: 2 ** 60 });
      expect(valid).toBe(false);
      expect(errors.some((e) => e.keyword === 'maximum')).toBe(true);
    });

    it('accepts all four companions, a seed of 0 included', () => {
      const { valid, errors } = validate('canonical.v1.workflow', {
        ...minimalRun,
        randomSeed: 0,
        datasetSnapshotId: 'snapshot-synthetic-001',
      });
      expect(valid).toBe(true);
      expect(errors).toEqual([]);
    });
  });
});

describe('canonical.v1.omicsQualification (RF029 slice 6/6, #674)', () => {
  it('accepts a fully populated payload', () => {
    const { valid, errors } = validate('canonical.v1.omicsQualification', {
      targetAssay: 'A-1',
      qcRuleSetVersion: 'v2.1',
      qcMetrics: [{ metric: 'readDepth', value: 30 }],
      qualificationDecision: 'eligible',
      limitations: 'Low input RNA quality',
    });
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
  });

  it('accepts a minimal payload with just the required fields', () => {
    const { valid, errors } = validate('canonical.v1.omicsQualification', {
      targetAssay: 'A-1',
      qcRuleSetVersion: 'v2.1',
      qcMetrics: [{ metric: 'readDepth', value: 30 }],
      qualificationDecision: 'eligible',
    });
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
  });

  it('rejects an empty qcMetrics array (AC#2 cardinality)', () => {
    const { valid, errors } = validate('canonical.v1.omicsQualification', {
      targetAssay: 'A-1',
      qcRuleSetVersion: 'v2.1',
      qcMetrics: [],
      qualificationDecision: 'eligible',
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.keyword === 'minItems')).toBe(true);
  });

  it('rejects a payload missing a required field (targetAssay)', () => {
    const { valid, errors } = validate('canonical.v1.omicsQualification', {
      qcRuleSetVersion: 'v2.1',
      qcMetrics: [{ metric: 'readDepth', value: 30 }],
      qualificationDecision: 'eligible',
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.keyword === 'required')).toBe(true);
  });

  it('rejects an unknown top-level field (additionalProperties: false)', () => {
    const { valid, errors } = validate('canonical.v1.omicsQualification', {
      targetAssay: 'A-1',
      qcRuleSetVersion: 'v2.1',
      qcMetrics: [{ metric: 'readDepth', value: 30 }],
      qualificationDecision: 'eligible',
      unknownField: 'x',
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.keyword === 'additionalProperties')).toBe(true);
  });
});

describe('canonical.v1.omicsRun (RF029 slice 6/6, #674)', () => {
  it('accepts a fully populated payload', () => {
    const { valid, errors } = validate('canonical.v1.omicsRun', {
      modality: 'genomics',
      referenceAssembly: 'GRCh38',
      mixsChecklist: 'MIxS 6.0',
      fileLinks: [{ role: 'raw_reads', fileId: 'file-1' }],
    });
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
  });

  it('accepts a minimal payload with just the required fields', () => {
    const { valid, errors } = validate('canonical.v1.omicsRun', {
      modality: 'microbiome',
    });
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
  });

  it('rejects an invalid modality (AC#2 cardinality)', () => {
    const { valid, errors } = validate('canonical.v1.omicsRun', {
      modality: 'astrology',
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.keyword === 'enum')).toBe(true);
  });

  it('rejects a fileLinks entry missing fileId', () => {
    const { valid, errors } = validate('canonical.v1.omicsRun', {
      modality: 'genomics',
      fileLinks: [{ role: 'raw_reads' }],
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.keyword === 'required')).toBe(true);
  });

  it('rejects an unknown top-level field (additionalProperties: false)', () => {
    const { valid, errors } = validate('canonical.v1.omicsRun', {
      modality: 'genomics',
      unknownField: 'x',
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.keyword === 'additionalProperties')).toBe(true);
  });
});
