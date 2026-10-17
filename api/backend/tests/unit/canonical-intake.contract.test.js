import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const { validate } = require('../../src/contracts/canonical/v1');

const baseIntake = {
  participant: { participantId: 'p1' },
  consent: {},
  specimen: { specimenId: 's1', participantId: 'p1' },
  clinical: {},
  biomarkers: []
};

describe('canonical.v1.intake diagnosis sub-schema', () => {
  it('accepts explicit null for optional diagnosis string fields (issue #169)', () => {
    const { valid, errors } = validate('canonical.v1.intake', {
      ...baseIntake,
      diagnosis: {
        diagnosisName: null,
        icdCode: 'E70.0',
        orphaCode: 'ORPHA:123',
        omimCode: null,
        definition: null
      }
    });

    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });
});

describe('canonical.v1.intake specimen.parentSpecimenIds (dict-02 ELM-0120, #1371)', () => {
  const withParents = (parentSpecimenIds) => ({
    ...baseIntake,
    specimen: { ...baseIntake.specimen, parentSpecimenIds }
  });

  it('accepts a list of parent specimen ids', () => {
    const { valid, errors } = validate('canonical.v1.intake', withParents(['SP-1', 'SP-2']));

    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it('accepts a specimen that names no parent', () => {
    const { valid, errors } = validate('canonical.v1.intake', baseIntake);

    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it.each([
    ['a single string', 'SP-1'],
    ['an empty id', ['']],
    ['a duplicate id', ['SP-1', 'SP-1']]
  ])('rejects %s', (_label, parentSpecimenIds) => {
    const { valid, errors } = validate('canonical.v1.intake', withParents(parentSpecimenIds));

    expect(valid).toBe(false);
    expect(errors.some((error) => error.instancePath.startsWith('/specimen/parentSpecimenIds'))).toBe(true);
  });
});

describe('canonical.v1.intake organizationId (#1376)', () => {
  it('accepts a top-level organizationId string, the organization the intake stamps', () => {
    const { valid, errors } = validate('canonical.v1.intake', { ...baseIntake, organizationId: 'org-a' });

    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it('rejects a non-string organizationId', () => {
    const { valid, errors } = validate('canonical.v1.intake', { ...baseIntake, organizationId: 42 });

    expect(valid).toBe(false);
    expect(errors.some((error) => error.instancePath === '/organizationId')).toBe(true);
  });
});
