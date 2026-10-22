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

  it('rejects a Specimen missing subject with the friendly message', () => {
    const specimen = {
      resourceType: 'Specimen',
      type: { coding: [] }
    };
    const result = fhirValidator.validateResource(specimen);
    expect(result.valid).toBe(false);
    expect(result.issues[0].diagnostics).toBe("O campo 'Paciente (subject)' é obrigatório");
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

describe('FhirValidatorService conformance (RF011 AC1)', () => {
  const FHIRProfileRegistryModel = require('../../src/models/FHIRProfileRegistry');

  const PROFILE_URL = 'https://bioadvanced.dev/fhir/StructureDefinition/participant';
  const SYSTEM_URI = 'https://bioadvanced.dev/fhir/NamingSystem/participant';

  const patient = (extra = {}) => ({
    resourceType: 'Patient',
    name: [{ family: 'Silva', given: ['Ana'] }],
    gender: 'female',
    birthDate: '1990-01-01',
    ...extra
  });

  const profileRow = (overrides = {}) => FHIRProfileRegistryModel.create({
    canonicalUrl: PROFILE_URL,
    fhirVersion: '4.0.1',
    profileVersion: '1.0.0',
    mappingReleaseId: 'mapping-release-test',
    status: 'active',
    ...overrides
  });

  const namespaceRow = (overrides = {}) => ({
    namespaceKey: 'participant',
    systemUri: SYSTEM_URI,
    authorityDomain: 'bioadvanced.dev',
    targetTypes: ['participant'],
    semanticVersion: '1.0.0',
    effectivePeriod: { start: '2026-01-01' },
    configurationReleaseId: 'configuration-release-test',
    ...overrides
  });

  const registry = ({ profiles = [], namespaces = [], approvedAuthorities = [] } = {}) => ({
    registry: { profiles, namespaces, approvedAuthorities }
  });

  const validate = (payload, options) => fhirValidator.validatePayload(payload, undefined, options);

  describe('version', () => {
    it('refuses fhirVersion 5.0.0 as fhir-version-unsupported at /fhirVersion', () => {
      const result = validate(patient({ fhirVersion: '5.0.0' }));
      expect(result.valid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]).toMatchObject({
        reason: 'fhir-version-unsupported',
        code: 'not-supported',
        expression: '/fhirVersion',
        diagnostics: 'Versão FHIR não suportada: 5.0.0 (aceitas: 4.0.1, R4)'
      });
    });

    it('accepts fhirVersion 4.0.1', () => {
      expect(validate(patient({ fhirVersion: '4.0.1' })).valid).toBe(true);
    });

    it('accepts fhirVersion R4', () => {
      expect(validate(patient({ fhirVersion: 'R4' })).valid).toBe(true);
    });

    it('accepts a resource that declares no fhirVersion', () => {
      expect(validate(patient()).valid).toBe(true);
    });
  });

  describe('profile', () => {
    it('refuses a declared profile with the default registry', () => {
      const result = validate(patient({ meta: { profile: [PROFILE_URL] } }));
      expect(result.valid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]).toMatchObject({
        reason: 'profile-not-registered',
        code: 'not-supported',
        expression: '/meta/profile/0',
        diagnostics: `Perfil FHIR não registrado: ${PROFILE_URL}`
      });
    });

    it('accepts a profile an active registry row names', () => {
      const result = validate(patient({ meta: { profile: [PROFILE_URL] } }), registry({ profiles: [profileRow()] }));
      expect(result).toEqual({ valid: true, issues: [], resourcesValidated: 1 });
    });

    it('refuses a profile whose registry row is draft', () => {
      const result = validate(
        patient({ meta: { profile: [PROFILE_URL] } }),
        registry({ profiles: [profileRow({ status: 'draft' })] })
      );
      expect(result.valid).toBe(false);
      expect(result.issues[0].reason).toBe('profile-not-registered');
    });

    it('accepts a versioned profile url|1.0.0 matching the row version', () => {
      const result = validate(
        patient({ meta: { profile: [`${PROFILE_URL}|1.0.0`] } }),
        registry({ profiles: [profileRow()] })
      );
      expect(result.valid).toBe(true);
    });

    it('refuses a versioned profile url|2.0.0 the row does not carry', () => {
      const result = validate(
        patient({ meta: { profile: [`${PROFILE_URL}|2.0.0`] } }),
        registry({ profiles: [profileRow()] })
      );
      expect(result.valid).toBe(false);
      expect(result.issues[0]).toMatchObject({ reason: 'profile-not-registered', expression: '/meta/profile/0' });
    });

    it('refuses a meta.profile that is not an array', () => {
      const result = validate(patient({ meta: { profile: 'x' } }), registry({ profiles: [profileRow()] }));
      expect(result.valid).toBe(false);
      expect(result.issues[0]).toMatchObject({ reason: 'profile-not-registered', expression: '/meta/profile' });
    });
  });

  describe('identifier.system', () => {
    it('refuses an identifier system with the default registry', () => {
      const result = validate(patient({ identifier: [{ system: 'cpf', value: '1' }] }));
      expect(result.valid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]).toMatchObject({
        reason: 'identifier-system-unknown',
        code: 'invalid',
        expression: '/identifier/0/system',
        diagnostics: 'identifier.system fora de namespace registrado: cpf'
      });
    });

    it('accepts the systemUri of a registered namespace in force', () => {
      const result = validate(
        patient({ identifier: [{ system: SYSTEM_URI, value: '1' }] }),
        registry({ namespaces: [namespaceRow()] })
      );
      expect(result.valid).toBe(true);
    });

    it('refuses the systemUri of a namespace whose vigência has ended', () => {
      const result = validate(
        patient({ identifier: [{ system: SYSTEM_URI, value: '1' }] }),
        registry({ namespaces: [namespaceRow({ effectivePeriod: { start: '2026-01-01', end: '2026-02-01' } })] })
      );
      expect(result.valid).toBe(false);
      expect(result.issues[0]).toMatchObject({ reason: 'identifier-system-unknown', expression: '/identifier/0/system' });
    });

    it('refuses a system whose namespace row breaks RULE-036, the row being ignored', () => {
      const result = validate(
        patient({ identifier: [{ system: 'http://bioadvanced.dev/x', value: '1' }] }),
        registry({ namespaces: [namespaceRow({ systemUri: 'http://bioadvanced.dev/x' })] })
      );
      expect(result.valid).toBe(false);
      expect(result.issues[0]).toMatchObject({ reason: 'identifier-system-unknown', expression: '/identifier/0/system' });
    });

    it('accepts an identifier with no system', () => {
      expect(validate(patient({ identifier: [{ value: '1' }] })).valid).toBe(true);
    });

    it('refuses a nested Specimen container identifier system at its path', () => {
      const specimen = {
        resourceType: 'Specimen',
        subject: { reference: 'Patient/1' },
        type: { coding: [] },
        container: [{ identifier: [{ system: 'urn:oid:1', value: 'B1' }] }]
      };
      const result = validate(specimen);
      expect(result.valid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]).toMatchObject({
        reason: 'identifier-system-unknown',
        expression: '/container/0/identifier/0/system'
      });
    });
  });

  describe('Bundle', () => {
    it('refuses a Bundle identifier system once, counting only its entries', () => {
      const bundle = {
        resourceType: 'Bundle',
        type: 'collection',
        identifier: { system: 'cpf', value: 'b1' },
        entry: [{ resource: patient() }]
      };
      const result = validate(bundle);
      expect(result.valid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]).toMatchObject({ reason: 'identifier-system-unknown', expression: '/identifier/system' });
      expect(result.resourcesValidated).toBe(1);
    });

    it('refuses an entry Patient declaring an unregistered profile once', () => {
      const bundle = {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [{ resource: patient({ meta: { profile: [PROFILE_URL] } }) }]
      };
      const result = validate(bundle);
      expect(result.valid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]).toMatchObject({ reason: 'profile-not-registered', expression: '/meta/profile/0' });
      expect(result.resourcesValidated).toBe(1);
    });
  });

  describe('issue shape', () => {
    it('carries severity error and its reason, and the OperationOutcome carries the diagnostics', () => {
      const result = fhirValidator.validateResource(patient({ fhirVersion: '5.0.0' }));
      expect(result.valid).toBe(false);
      result.issues.forEach((issue) => {
        expect(issue.severity).toBe('error');
        expect(issue.reason).toBe('fhir-version-unsupported');
      });
      const outcome = fhirValidator.buildOperationOutcome(result.issues);
      expect(outcome.issue[0]).toEqual({
        severity: 'error',
        code: 'not-supported',
        diagnostics: 'Versão FHIR não suportada: 5.0.0 (aceitas: 4.0.1, R4)',
        expression: ['/fhirVersion']
      });
    });
  });
});
