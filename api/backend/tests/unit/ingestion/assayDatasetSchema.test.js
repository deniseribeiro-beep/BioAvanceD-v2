import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { validate } = require('../../../src/contracts/canonical/v1');

describe('canonical.v1.assay (RF029 slice 5/6, #673)', () => {
  it('accepts a fully populated payload', () => {
    const { valid, errors } = validate('canonical.v1.assay', {
      studyId: 'ST-1',
      specimenIds: ['S-1', 'S-2'],
      assayType: 'RNA sequencing',
      omicsDomain: 'genomics',
      protocolId: 'P-1',
      operatorId: 'OP-1',
      laboratoryId: 'LAB-1',
      assayDateTime: '2026-08-20T12:00:00.000Z',
      assayBatchId: 'RUN-2026-001',
      controls: [{ controlType: 'positive' }],
      reagentLotIds: ['RL-1'],
      equipmentIds: ['EQ-1'],
      intendedUse: 'RNA-seq discovery',
    });
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
  });

  it('accepts a minimal payload with just the required fields', () => {
    const { valid, errors } = validate('canonical.v1.assay', {
      studyId: 'ST-1',
      specimenIds: ['S-1'],
      assayType: 'RNA sequencing',
      protocolId: 'P-1',
      operatorId: 'OP-1',
      laboratoryId: 'LAB-1',
      assayDateTime: '2026-08-20T12:00:00.000Z',
      intendedUse: 'RNA-seq discovery',
    });
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
  });

  it('rejects an empty specimenIds array (AC#2 cardinality)', () => {
    const { valid, errors } = validate('canonical.v1.assay', {
      studyId: 'ST-1',
      specimenIds: [],
      assayType: 'RNA sequencing',
      protocolId: 'P-1',
      operatorId: 'OP-1',
      laboratoryId: 'LAB-1',
      assayDateTime: '2026-08-20T12:00:00.000Z',
      intendedUse: 'RNA-seq discovery',
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.keyword === 'minItems')).toBe(true);
  });

  it('rejects a payload missing a required field (studyId)', () => {
    const { valid, errors } = validate('canonical.v1.assay', {
      specimenIds: ['S-1'],
      assayType: 'RNA sequencing',
      protocolId: 'P-1',
      operatorId: 'OP-1',
      laboratoryId: 'LAB-1',
      assayDateTime: '2026-08-20T12:00:00.000Z',
      intendedUse: 'RNA-seq discovery',
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.keyword === 'required')).toBe(true);
  });

  it('rejects an unknown top-level field (additionalProperties: false)', () => {
    const { valid, errors } = validate('canonical.v1.assay', {
      studyId: 'ST-1',
      specimenIds: ['S-1'],
      assayType: 'RNA sequencing',
      protocolId: 'P-1',
      operatorId: 'OP-1',
      laboratoryId: 'LAB-1',
      assayDateTime: '2026-08-20T12:00:00.000Z',
      intendedUse: 'RNA-seq discovery',
      unknownField: 'x',
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.keyword === 'additionalProperties')).toBe(true);
  });
});

describe('canonical.v1.dataset (RF029 slice 5/6, #673)', () => {
  it('accepts a fully populated payload', () => {
    const { valid, errors } = validate('canonical.v1.dataset', {
      datasetTitle: 'Cohort RNA-seq release 1',
      datasetVersion: '1.0.0',
      creators: [{ name: 'Denise Ribeiro', orcid: '0000-0000-0000-0000' }],
      doi: '10.1234/example',
      license: 'CC BY 4.0',
      distributionFiles: [],
      roCrateManifest: 'objstore://datasets/D-1/ro-crate-metadata.json',
    });
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
  });

  it('accepts a minimal payload with just the required fields', () => {
    const { valid, errors } = validate('canonical.v1.dataset', {
      datasetTitle: 'Cohort RNA-seq release 1',
      datasetVersion: '1.0.0',
      creators: [{ name: 'Denise Ribeiro' }],
      license: 'CC BY 4.0',
    });
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
  });

  it('rejects an empty creators array (AC#2 cardinality)', () => {
    const { valid, errors } = validate('canonical.v1.dataset', {
      datasetTitle: 'Cohort RNA-seq release 1',
      datasetVersion: '1.0.0',
      creators: [],
      license: 'CC BY 4.0',
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.keyword === 'minItems')).toBe(true);
  });

  it('rejects a payload missing a required field (license)', () => {
    const { valid, errors } = validate('canonical.v1.dataset', {
      datasetTitle: 'Cohort RNA-seq release 1',
      datasetVersion: '1.0.0',
      creators: [{ name: 'Denise Ribeiro' }],
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.keyword === 'required')).toBe(true);
  });

  it('rejects an unknown top-level field (additionalProperties: false)', () => {
    const { valid, errors } = validate('canonical.v1.dataset', {
      datasetTitle: 'Cohort RNA-seq release 1',
      datasetVersion: '1.0.0',
      creators: [{ name: 'Denise Ribeiro' }],
      license: 'CC BY 4.0',
      unknownField: 'x',
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.keyword === 'additionalProperties')).toBe(true);
  });
});
