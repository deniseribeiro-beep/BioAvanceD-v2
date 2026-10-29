import { describe, it, expect } from 'vitest';

// #1320, RF018 and V2E-0361..0368: the RCSValidationStudy model. fieldsOf
// emits the catalog's fields, validate enforces each 1..1 and 1..* Core
// field and the protocol URI, and create returns the validated document
// deep-frozen. No collection holds it.

const { loadCanonicalDictionary } = require('../../../src/reference-data/canonical-dictionary/v2');
const RcsValidationStudyModel = require('../../../src/models/RcsValidationStudy');

const catalog = loadCanonicalDictionary();
const rowsOf = (entity) => catalog.filter((row) => row.entity === entity);

const VALID = {
  rcsValidationStudyId: 'rcs-validation-synthetic-001',
  contextOfUse: 'research biospecimen triage',
  rulePackageId: 'rcs-package-001',
  expertPanelDefinition: 'to be defined before external validation',
  outcomes: ['agreement', 'discrimination'],
  metrics: ['weighted-kappa'],
  protocolUri: 'object://synthetic/rcs-validation.pdf',
  status: 'planned',
};

const refuses = (overrides, field) => {
  const result = RcsValidationStudyModel.validate({ ...VALID, ...overrides });
  expect(result.isValid).toBe(false);
  expect(result.errors.some((error) => error.startsWith(`${field} `))).toBe(true);
};

describe('RCSValidationStudy', () => {
  it('fieldsOf() with no argument emits exactly the catalog fields, in catalog order', () => {
    const rows = rowsOf('RCSValidationStudy');
    expect(rows.length).toBeGreaterThan(0);
    expect(Object.keys(RcsValidationStudyModel.fieldsOf())).toEqual(rows.map((row) => row.field));
  });

  it('fieldsOf keeps only the eight catalog fields', () => {
    expect(Object.keys(RcsValidationStudyModel.fieldsOf({ ...VALID, extra: 'x' })))
      .toEqual(Object.keys(VALID));
  });

  it('a valid document validates and create returns it deep-frozen', () => {
    expect(RcsValidationStudyModel.validate(VALID)).toEqual({ isValid: true, errors: [] });
    const created = RcsValidationStudyModel.create(VALID);
    expect(created).toEqual(VALID);
    expect(Object.isFrozen(created)).toBe(true);
    expect(Object.isFrozen(created.outcomes)).toBe(true);
    expect(Object.isFrozen(VALID.outcomes)).toBe(false);
  });

  it('refuses a blank rulePackageId (V2E-0363)', () => {
    refuses({ rulePackageId: '  ' }, 'rulePackageId');
  });

  it('refuses an empty outcomes (V2E-0365, 1..*)', () => {
    refuses({ outcomes: [] }, 'outcomes');
  });

  it('refuses a blank metrics entry (V2E-0366)', () => {
    refuses({ metrics: ['weighted-kappa', ''] }, 'metrics');
  });

  it('refuses a protocolUri that is not a URI (V2E-0367)', () => {
    refuses({ protocolUri: 'not a uri' }, 'protocolUri');
  });

  it('refuses a missing status (V2E-0368)', () => {
    refuses({ status: undefined }, 'status');
  });

  it('create throws on an invalid input', () => {
    expect(() => RcsValidationStudyModel.create({ ...VALID, contextOfUse: undefined, expertPanelDefinition: '' }))
      .toThrow(/contextOfUse .*; expertPanelDefinition /);
  });
});
