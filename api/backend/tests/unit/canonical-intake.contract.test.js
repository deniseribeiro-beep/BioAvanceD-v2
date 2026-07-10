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
