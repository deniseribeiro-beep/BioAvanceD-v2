import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { validate } = require('../../../src/contracts/canonical/v1');

describe('canonical.v1.clinicalData (RF029 slice 2/6, #670)', () => {
  it('accepts a minimal payload with just participantId', () => {
    const { valid, errors } = validate('canonical.v1.clinicalData', { participantId: 'P-1' });
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
  });

  it('accepts a fully populated payload, including nested pharmacologyData', () => {
    const { valid, errors } = validate('canonical.v1.clinicalData', {
      participantId: 'P-1',
      charlsonConditions: ['diabetes'],
      bloodPressure: '120/80',
      clinicalObservations: 'estável',
      diseasePhenotypes: ['HP:0000118'],
      diseaseBiomarkers: ['CA-125'],
      biomarkersValues: { 'CA-125': 35 },
      diagnosisDefinition: 'suspeita clínica',
      pharmacologyData: { treatmentStatus: 'NAIVE', medicationName: 'x' },
    });
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
  });

  it('accepts an empty object — participantId is optional at the schema level (the gateway enforces it via references, not the contract)', () => {
    const { valid } = validate('canonical.v1.clinicalData', {});
    expect(valid).toBe(true);
  });

  it('rejects an unknown top-level field (additionalProperties: false)', () => {
    const { valid, errors } = validate('canonical.v1.clinicalData', { participantId: 'P-1', unknownField: 'x' });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.keyword === 'additionalProperties')).toBe(true);
  });

  it('rejects an unknown nested pharmacologyData field', () => {
    const { valid } = validate('canonical.v1.clinicalData', {
      participantId: 'P-1',
      pharmacologyData: { unknownField: 'x' },
    });
    expect(valid).toBe(false);
  });

  it('is still reachable, unchanged, as intakeSchema.clinical via $ref (behavior-preserving extraction)', () => {
    const result = validate('canonical.v1.intake', {
      participant: { participantId: 'p1' },
      consent: {},
      specimen: { specimenId: 's1', participantId: 'p1' },
      clinical: { bloodPressure: '120/80' },
      biomarkers: [],
    });
    expect(result.valid).toBe(true);
  });
});
