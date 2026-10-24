import { describe, it, expect } from 'vitest';

// #1320, RF018 AC10 and V2E-0354..0360: the RCSRulePackage model. fieldsOf
// emits the catalog's fields, validate enforces each 1..1 and 1..* Core
// field, the SemVer version, the SHA-256 checksum and the release lifecycle
// status, and create returns the validated document deep-frozen. No
// collection is registered for it.

const fs = require('fs');
const path = require('path');
const { loadCanonicalDictionary } = require('../../../src/reference-data/canonical-dictionary/v2');
const RcsRulePackageModel = require('../../../src/models/RcsRulePackage');

const catalog = loadCanonicalDictionary();
const rowsOf = (entity) => catalog.filter((row) => row.entity === entity);

const BACKEND_ROOT = path.resolve(__dirname, '../../..');

const VALID = {
  rcsRulePackageId: 'rcs-package-001',
  semanticVersion: '1.0.0',
  sprecMappingReleaseId: 'sprec-map-001',
  checksum: `sha256:${'a'.repeat(64)}`,
  governanceGateVersion: '1.0.0',
  status: 'active',
  validationEvidenceIds: ['rcs-validation-synthetic-001'],
};

describe('RCSRulePackage', () => {
  it('fieldsOf() with no argument emits exactly the catalog fields, in catalog order', () => {
    const rows = rowsOf('RCSRulePackage');
    expect(rows.length).toBeGreaterThan(0);
    expect(Object.keys(RcsRulePackageModel.fieldsOf())).toEqual(rows.map((row) => row.field));
  });

  it('fieldsOf keeps only the seven catalog fields', () => {
    expect(Object.keys(RcsRulePackageModel.fieldsOf({ ...VALID, extra: 'x' })))
      .toEqual(Object.keys(VALID));
  });

  it('a valid document validates and create returns it deep-frozen', () => {
    expect(RcsRulePackageModel.validate(VALID)).toEqual({ isValid: true, errors: [] });
    const created = RcsRulePackageModel.create(VALID);
    expect(created).toEqual(VALID);
    expect(Object.isFrozen(created)).toBe(true);
    expect(Object.isFrozen(created.validationEvidenceIds)).toBe(true);
    expect(Object.isFrozen(VALID.validationEvidenceIds)).toBe(false);
  });

  it.each(['semanticVersion', 'sprecMappingReleaseId', 'checksum', 'governanceGateVersion', 'status', 'validationEvidenceIds'])(
    'validate fails naming %s when it is absent',
    (field) => {
      const result = RcsRulePackageModel.validate({ ...VALID, [field]: undefined });
      expect(result.isValid).toBe(false);
      expect(result.errors.some((error) => error.startsWith(`${field} `))).toBe(true);
      expect(() => RcsRulePackageModel.create({ ...VALID, [field]: undefined })).toThrow(field);
    },
  );

  it('validate fails naming rcsRulePackageId when it is blank', () => {
    expect(RcsRulePackageModel.validate({ ...VALID, rcsRulePackageId: ' ' }).errors)
      .toEqual(['rcsRulePackageId é obrigatório para RCSRulePackage (1..1)']);
  });

  it('refuses a semanticVersion that is not SemVer (V2E-0355)', () => {
    expect(RcsRulePackageModel.validate({ ...VALID, semanticVersion: 'RCS-GOV-1.0' }).errors)
      .toEqual(['semanticVersion deve ser SemVer (MAJOR.MINOR.PATCH) para RCSRulePackage (1..1): RCS-GOV-1.0']);
  });

  it('accepts a governanceGateVersion that is not SemVer (V2E-0358)', () => {
    expect(RcsRulePackageModel.validate({ ...VALID, governanceGateVersion: 'RCS-GOV-1.0' }).isValid).toBe(true);
  });

  it('refuses the dictionary example checksum, which is not a digest (V2E-0357)', () => {
    expect(RcsRulePackageModel.validate({ ...VALID, checksum: 'sha256:synthetic-rcs' }).errors)
      .toEqual(['checksum deve ser um digest SHA-256 para RCSRulePackage (1..1): sha256:synthetic-rcs']);
  });

  it('refuses a status outside the release lifecycle (V2E-0359)', () => {
    expect(RcsRulePackageModel.validate({ ...VALID, status: 'published' }).errors)
      .toEqual(['status inválido para RCSRulePackage (1..1): published']);
  });

  it('refuses an empty validationEvidenceIds (V2E-0360, 1..*)', () => {
    expect(RcsRulePackageModel.validate({ ...VALID, validationEvidenceIds: [] }).errors)
      .toEqual(['validationEvidenceIds é obrigatório para RCSRulePackage (1..*, Reference)']);
  });

  it('refuses a blank validationEvidenceIds entry (V2E-0360)', () => {
    expect(RcsRulePackageModel.validate({ ...VALID, validationEvidenceIds: [''] }).errors)
      .toEqual(['validationEvidenceIds é obrigatório para RCSRulePackage (1..*, Reference)']);
  });

  it('create throws on an invalid input', () => {
    expect(() => RcsRulePackageModel.create({ ...VALID, status: 'published' })).toThrow('status inválido');
  });

  it('registers no collection', () => {
    for (const file of ['src/config/collections.js', 'src/config/env.js']) {
      expect(fs.readFileSync(path.join(BACKEND_ROOT, file), 'utf8')).not.toContain('rcsRulePackages');
    }
  });
});
