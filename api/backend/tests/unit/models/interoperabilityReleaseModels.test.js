import { describe, it, expect } from 'vitest';

// #1322, RF011 AC2/AC6, RNF024 C6 and RULE-035: InteroperabilityMappingRelease
// and FHIRProfileRegistry as Phase 1 structures. fieldsOf emits the catalog's
// fields, validate enforces each 1..1 and 1..* Core field, the closed sets,
// the coverage and IG conditions and RULE-035's approval fields, and create
// returns the validated document.

const { loadCanonicalDictionary } = require('../../../src/reference-data/canonical-dictionary/v2');
const InteroperabilityMappingReleaseModel = require('../../../src/models/InteroperabilityMappingRelease');
const FHIRProfileRegistryModel = require('../../../src/models/FHIRProfileRegistry');

const {
  STANDARDS, FHIR_VERSIONS, STATUSES, RESOURCE_TYPES,
} = InteroperabilityMappingReleaseModel;

const catalog = loadCanonicalDictionary();
const rowsOf = (entity) => catalog.filter((row) => row.entity === entity);

const CHECKSUM = `sha256:${'a'.repeat(64)}`;
const DEFINITION_HASH = `sha256:${'b'.repeat(64)}`;

const MODELS = {
  InteroperabilityMappingRelease: {
    model: InteroperabilityMappingReleaseModel,
    valid: {
      interoperabilityMappingReleaseId: 'mapping-release-1',
      standard: 'FHIR R4',
      mappingVersion: '1.0.0',
      mappingUri: 'object://synthetic/mappings/fhir-r4-1.0.0.json',
      checksum: CHECKSUM,
      authorId: 'actor-author-1',
      status: 'approved',
      roundTripLossReportUri: 'object://synthetic/mappings/round-trip-1.0.0.json',
      canonicalModelReleaseId: 'canonical-release-2.0.0',
      fhirVersion: '4.0.1',
      jurisdiction: [{ systemUri: 'urn:iso:std:iso:3166', code: 'BR', version: null, display: 'Brasil' }],
      profileRegistryIds: ['fhir-profile-1'],
      resourceTypes: ['Patient', 'Specimen'],
      identifierNamespaceRegistryIds: ['namespace-1'],
      terminologyReleaseIds: ['reference-release-1'],
      mappingDefinitionUri: 'object://synthetic/mappings/definition-1.0.0.json',
      mappingDefinitionHash: DEFINITION_HASH,
      conformanceTestReportUri: 'object://synthetic/mappings/conformance-1.0.0.json',
      coverageNumerator: 98,
      coverageDenominator: 100,
      coverageRatio: 0.98,
      roundTripLossesPresent: true,
      approvedBy: ['actor-approver-1'],
      approvedAt: new Date('2026-10-20T12:00:00Z'),
      effectivePeriod: { start: new Date('2026-10-21T00:00:00Z'), end: null },
    },
  },
  FHIRProfileRegistry: {
    model: FHIRProfileRegistryModel,
    valid: {
      fhirProfileRegistryId: 'fhir-profile-1',
      canonicalUrl: 'https://bioadvanced.dev/fhir/StructureDefinition/specimen',
      fhirVersion: 'R4',
      profileVersion: '1.0.0',
      identifierSystems: ['https://bioadvanced.dev/fhir/NamingSystem/specimen'],
      mappingReleaseId: 'mapping-release-1',
      status: 'approved',
    },
  },
};

describe.each(Object.entries(MODELS))('%s (RF011 AC2, #1322)', (entity, { model, valid }) => {
  const rows = rowsOf(entity);
  // The id is assigned by fieldsOf when absent, so it is never missing.
  const requiredFields = rows
    .filter((row) => row.requirement === 'Core' && /^1\.\./.test(row.cardinality) && row.type !== 'uuid')
    .map((row) => row.field);

  it('a valid document validates and create returns it', () => {
    expect(model.validate(valid)).toEqual({ isValid: true, errors: [] });
    expect(model.create(valid)).toEqual(model.fieldsOf(valid));
  });

  it('fieldsOf() with no argument emits exactly the catalog fields, in catalog order', () => {
    expect(rows.length).toBeGreaterThan(0);
    expect(Object.keys(model.fieldsOf())).toEqual(rows.map((row) => row.field));
  });

  it.each(requiredFields)('validate fails naming %s when it is absent', (field) => {
    const result = model.validate({ ...valid, [field]: undefined });
    expect(result.isValid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].startsWith(`${field} `)).toBe(true);
    expect(() => model.create({ ...valid, [field]: undefined })).toThrow(field);
  });
});

describe('InteroperabilityMappingRelease checks', () => {
  const model = InteroperabilityMappingReleaseModel;
  const { valid } = MODELS.InteroperabilityMappingRelease;
  const failsNaming = (data, field) => {
    const result = model.validate(data);
    expect(result.isValid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].startsWith(`${field} `)).toBe(true);
  };

  it.each([
    ['standard', STANDARDS, ['FHIR R4'], 'HL7 v2'],
    ['fhirVersion', FHIR_VERSIONS, ['4.0.1', 'R4'], '5.0.0'],
    ['status', STATUSES, ['draft', 'candidate', 'approved', 'active', 'superseded', 'retired'], 'published'],
  ])('%s is a closed, exported set that rejects an outside value', (field, exported, expected, outside) => {
    expect(exported).toEqual(expected);
    expect(model.validate({ ...valid, [field]: outside }).errors).toEqual([`${field} inválido: ${outside}`]);
  });

  it('resourceTypes is the exported set of RF011 AC4 and rejects an outside value', () => {
    expect(RESOURCE_TYPES).toEqual([
      'Patient', 'Specimen', 'Consent', 'Observation', 'DiagnosticReport',
      'Provenance', 'AuditEvent', 'DocumentReference', 'ResearchStudy',
    ]);
    expect(model.validate({ ...valid, resourceTypes: ['Patient', 'Encounter'] }).errors)
      .toEqual(['resourceTypes inválido: Encounter']);
  });

  it('coverageNumerator 0 validates, with ratio 0', () => {
    expect(model.validate({ ...valid, coverageNumerator: 0, coverageRatio: 0 }).isValid).toBe(true);
    expect(model.validate({
      ...valid, coverageNumerator: 0, coverageDenominator: 0, coverageRatio: 0,
    }).isValid).toBe(true);
  });

  it('a numerator above the denominator fails', () => {
    failsNaming({ ...valid, coverageNumerator: 101, coverageRatio: 1 }, 'coverageNumerator');
  });

  it('a ratio that disagrees with numerator/denominator fails', () => {
    failsNaming({ ...valid, coverageRatio: 0.5 }, 'coverageRatio');
  });

  it('an IG canonical without an IG version fails', () => {
    failsNaming({ ...valid, implementationGuideCanonical: 'https://bioadvanced.dev/fhir/ImplementationGuide/core' }, 'implementationGuideVersion');
    expect(model.validate({
      ...valid,
      implementationGuideCanonical: 'https://bioadvanced.dev/fhir/ImplementationGuide/core',
      implementationGuideVersion: '1.0.0',
    }).isValid).toBe(true);
  });

  it('a profile without an IG canonical fails', () => {
    failsNaming({ ...valid, profile: 'br-core' }, 'implementationGuideCanonical');
  });

  it.each(['approved', 'active', 'superseded'])('status %s without approvedAt fails (RULE-035)', (status) => {
    failsNaming({ ...valid, status, approvedAt: undefined }, 'approvedAt');
  });

  it('status draft without approvedAt or effectivePeriod validates', () => {
    expect(model.validate({
      ...valid, status: 'draft', approvedAt: undefined, effectivePeriod: undefined,
    }).isValid).toBe(true);
  });

  it('status approved without effectivePeriod fails (RULE-035)', () => {
    failsNaming({ ...valid, effectivePeriod: undefined }, 'effectivePeriod');
  });

  it('an effectivePeriod whose end is not after its start fails', () => {
    const start = valid.effectivePeriod.start;
    failsNaming({ ...valid, effectivePeriod: { start, end: start } }, 'effectivePeriod.end');
    expect(model.validate({
      ...valid, effectivePeriod: { start, end: new Date('2027-10-21T00:00:00Z') },
    }).isValid).toBe(true);
  });

  it('supersedesReleaseId equal to the release\'s own id fails', () => {
    failsNaming({ ...valid, supersedesReleaseId: valid.interoperabilityMappingReleaseId }, 'supersedesReleaseId');
    expect(model.validate({ ...valid, supersedesReleaseId: 'mapping-release-0' }).isValid).toBe(true);
  });

  it('a jurisdiction entry without code fails', () => {
    failsNaming({ ...valid, jurisdiction: [{ systemUri: 'urn:iso:std:iso:3166' }] }, 'jurisdiction[0]');
  });

  it('roundTripLossesPresent false validates and the string "false" fails', () => {
    expect(model.validate({ ...valid, roundTripLossesPresent: false }).isValid).toBe(true);
    failsNaming({ ...valid, roundTripLossesPresent: 'false' }, 'roundTripLossesPresent');
  });

  it.each(['checksum', 'mappingDefinitionHash'])('a non-SHA-256 %s fails', (field) => {
    failsNaming({ ...valid, [field]: 'md5:abc' }, field);
  });
});

describe('FHIRProfileRegistry checks', () => {
  const { valid } = MODELS.FHIRProfileRegistry;

  it('rejects fhirVersion 5.0.0', () => {
    expect(FHIRProfileRegistryModel.validate({ ...valid, fhirVersion: '5.0.0' }).errors)
      .toEqual(['fhirVersion inválido: 5.0.0']);
  });

  it('rejects a status outside the release set', () => {
    expect(FHIRProfileRegistryModel.validate({ ...valid, status: 'published' }).errors)
      .toEqual(['status inválido: published']);
  });
});
