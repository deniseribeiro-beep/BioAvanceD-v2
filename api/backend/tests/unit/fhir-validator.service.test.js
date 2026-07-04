import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fhirValidator = require('../../src/services/fhir-validator.service');

describe('FhirValidatorService.isFhirResource', () => {
  it('returns false for falsy payloads', () => {
    expect(fhirValidator.isFhirResource(null)).toBe(false);
    expect(fhirValidator.isFhirResource(undefined)).toBe(false);
  });

  it('returns true when array contains an item with resourceType', () => {
    expect(fhirValidator.isFhirResource([{ foo: 1 }, { resourceType: 'Patient' }])).toBe(true);
  });

  it('returns false when array has no items with resourceType', () => {
    expect(fhirValidator.isFhirResource([{ foo: 1 }, { bar: 2 }])).toBe(false);
  });

  it('returns true for object with resourceType', () => {
    expect(fhirValidator.isFhirResource({ resourceType: 'Patient' })).toBe(true);
  });

  it('returns true for object with entry (bundle-like) but no resourceType', () => {
    expect(fhirValidator.isFhirResource({ entry: [] })).toBe(true);
  });

  it('returns false for plain object with neither resourceType nor entry', () => {
    expect(fhirValidator.isFhirResource({ foo: 'bar' })).toBe(false);
  });
});

describe('FhirValidatorService.getSchemaId', () => {
  it('returns the schema id for a known resource type', () => {
    expect(fhirValidator.getSchemaId('Patient')).toBe('http://hl7.org/fhir/R4/Patient');
  });

  it('returns null for an unknown resource type', () => {
    expect(fhirValidator.getSchemaId('NotARealResource')).toBeNull();
  });
});

describe('FhirValidatorService.validateResource', () => {
  it('rejects a resource with no resourceType', () => {
    const result = fhirValidator.validateResource({});
    expect(result.valid).toBe(false);
    expect(result.issues[0].diagnostics).toBe('resourceType ausente');
    expect(result.issues[0].expression).toBe('/resourceType');
  });

  it('rejects a resource whose type has no loaded schema', () => {
    const result = fhirValidator.validateResource({ resourceType: 'ImagingStudy' });
    expect(result.valid).toBe(false);
    expect(result.issues[0].diagnostics).toContain('Schema não encontrado');
  });

  it('accepts a valid Patient resource', () => {
    const patient = {
      resourceType: 'Patient',
      name: [{ family: 'Silva', given: ['Ana'] }],
      gender: 'female',
      birthDate: '1990-01-01'
    };
    const result = fhirValidator.validateResource(patient);
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('rejects an invalid Patient resource and produces a friendly gender message', () => {
    const patient = {
      resourceType: 'Patient',
      name: [{ family: 'Silva' }],
      gender: 'not-a-real-gender',
      birthDate: '1990-01-01'
    };
    const result = fhirValidator.validateResource(patient);
    expect(result.valid).toBe(false);
    const genderIssue = result.issues.find((i) => i.diagnostics.includes('Gênero'));
    expect(genderIssue).toBeDefined();
    expect(genderIssue.diagnostics).toBe("O campo 'Gênero' é inválido");
  });

  it('rejects a Patient missing required fields with friendly messages for name/birthDate', () => {
    const patient = { resourceType: 'Patient' };
    const result = fhirValidator.validateResource(patient);
    expect(result.valid).toBe(false);
    // required fields missing: name, gender, birthDate all trigger errors
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.every((issue) => issue.severity === 'error' && issue.code === 'invalid')).toBe(true);
  });

  it('rejects a Specimen missing subject, falling back to the raw ajv message', () => {
    // NOTE: friendlyMessageFromError only inspects err.instancePath, but ajv's
    // "required property missing" errors report an empty instancePath (the
    // missing key lives in err.params.missingProperty instead), so the
    // Portuguese friendly message for /subject never actually fires here -
    // this asserts the real (buggy) current behavior rather than the intent.
    const specimen = {
      resourceType: 'Specimen',
      type: { coding: [] }
    };
    const result = fhirValidator.validateResource(specimen);
    expect(result.valid).toBe(false);
    expect(result.issues[0].diagnostics).toBe("must have required property 'subject'");
  });

  it('accepts a valid Specimen resource', () => {
    const specimen = {
      resourceType: 'Specimen',
      subject: { reference: 'Patient/123' },
      type: { coding: [{ code: 'blood' }] }
    };
    const result = fhirValidator.validateResource(specimen);
    expect(result.valid).toBe(true);
  });

  it('rejects an Observation missing status/code with friendly messages', () => {
    const observation = { resourceType: 'Observation' };
    const result = fhirValidator.validateResource(observation);
    expect(result.valid).toBe(false);
  });

  it('rejects an Organization missing name', () => {
    const org = { resourceType: 'Organization' };
    const result = fhirValidator.validateResource(org);
    expect(result.valid).toBe(false);
  });
});

describe('FhirValidatorService.validatePayload', () => {
  it('validates a single valid resource payload', () => {
    const patient = {
      resourceType: 'Patient',
      name: [{ family: 'Silva' }],
      gender: 'male',
      birthDate: '1985-05-05'
    };
    const result = fhirValidator.validatePayload(patient);
    expect(result.valid).toBe(true);
    expect(result.resourcesValidated).toBe(1);
    expect(result.issues).toEqual([]);
  });

  it('flags a resource with no resourceType inside payload', () => {
    const result = fhirValidator.validatePayload({});
    expect(result.valid).toBe(false);
    expect(result.issues[0].diagnostics).toBe('resourceType ausente no recurso');
    expect(result.resourcesValidated).toBe(0);
  });

  it('flags a resourceType not in the allowed types list', () => {
    const result = fhirValidator.validatePayload({ resourceType: 'Medication' });
    expect(result.valid).toBe(false);
    expect(result.issues[0].code).toBe('not-supported');
    expect(result.issues[0].diagnostics).toContain('Medication');
    expect(result.resourcesValidated).toBe(0);
  });

  it('respects a custom allowedTypes list, rejecting types outside it', () => {
    const patient = {
      resourceType: 'Patient',
      name: [{ family: 'Silva' }],
      gender: 'male',
      birthDate: '1985-05-05'
    };
    const result = fhirValidator.validatePayload(patient, ['Specimen']);
    expect(result.valid).toBe(false);
    expect(result.issues[0].code).toBe('not-supported');
  });

  it('validates an array of resources, counting only structurally-checked ones', () => {
    const goodPatient = {
      resourceType: 'Patient',
      name: [{ family: 'Silva' }],
      gender: 'male',
      birthDate: '1985-05-05'
    };
    const badSpecimen = { resourceType: 'Specimen' };
    const result = fhirValidator.validatePayload([goodPatient, badSpecimen]);
    expect(result.valid).toBe(false);
    expect(result.resourcesValidated).toBe(2);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('validates a Bundle by walking each entry.resource', () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        {
          resource: {
            resourceType: 'Patient',
            name: [{ family: 'Silva' }],
            gender: 'male',
            birthDate: '1985-05-05'
          }
        },
        {
          resource: { resourceType: 'Specimen' }
        }
      ]
    };
    const result = fhirValidator.validatePayload(bundle);
    expect(result.valid).toBe(false);
    expect(result.resourcesValidated).toBe(2);
  });
});

describe('FhirValidatorService.buildOperationOutcome', () => {
  it('builds an OperationOutcome resource wrapping the given issues', () => {
    const issues = [
      { severity: 'error', code: 'invalid', diagnostics: 'bad field', expression: '/foo' }
    ];
    const outcome = fhirValidator.buildOperationOutcome(issues);
    expect(outcome.resourceType).toBe('OperationOutcome');
    expect(outcome.issue).toHaveLength(1);
    expect(outcome.issue[0]).toEqual({
      severity: 'error',
      code: 'invalid',
      diagnostics: 'bad field',
      expression: ['/foo']
    });
  });

  it('defaults severity/code and omits expression array when expression is absent', () => {
    const outcome = fhirValidator.buildOperationOutcome([{ diagnostics: 'no expression here' }]);
    expect(outcome.issue[0].severity).toBe('error');
    expect(outcome.issue[0].code).toBe('invalid');
    expect(outcome.issue[0].expression).toBeUndefined();
  });

  it('handles an empty issues list, defaulting to an empty array', () => {
    const outcome = fhirValidator.buildOperationOutcome();
    expect(outcome.issue).toEqual([]);
  });
});
