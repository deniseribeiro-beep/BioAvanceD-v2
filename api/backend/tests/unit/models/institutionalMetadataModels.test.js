import { describe, it, expect } from 'vitest';

// #1322, RF020 AC1: Biobank (ELM-0032..0038, P1X-0036..0043) and Network
// (P1X-0001..0012), the entities the MIABIS export reads. fieldsOf emits the
// catalog's fields, validate enforces each 1..1 and 1..* Core field, the
// country codes, the contact and the list fields, and create never throws.

const { loadCanonicalDictionary } = require('../../../src/reference-data/canonical-dictionary/v2');
const BiobankModel = require('../../../src/models/Biobank');
const NetworkModel = require('../../../src/models/Network');

const catalog = loadCanonicalDictionary();
const rowsOf = (entity) => catalog.filter((row) => row.entity === entity);

const VALID_BIOBANK = {
  biobankId: 'biobank-1',
  biobankName: 'Biobanco Sintético',
  biobankDescription: 'Biobanco de teste',
  legalEntityId: 'org-1',
  biobankStatus: 'active',
  infrastructureCapabilities: [{ coding: [{ code: 'storage' }] }],
  bioprocessingCapabilities: [],
  acronym: 'BS',
  url: 'https://biobank.example.org',
  countryCode: 'BR',
  contactInformation: { email: 'contato@example.org' },
  infrastructuralCapabilities: ['storage'],
  organisationalCapabilities: ['training'],
  bioprocessingAnalyticalCapabilities: ['dna-extraction'],
  qualityManagementStandards: [{ coding: [{ code: 'ISO 20387' }] }],
};

const VALID_NETWORK = {
  networkId: 'network-1',
  acronym: 'RS',
  name: 'Rede Sintética',
  url: 'https://network.example.org',
  juristicPerson: 'org-1',
  countryCodes: ['BR', 'PT'],
  contactInformation: { email: 'rede@example.org' },
  description: 'Rede de teste',
  networkStatus: 'active',
  networkMembers: ['biobank-1'],
  commonCollaborationTopics: ['sample-sharing'],
  networkType: 'national',
};

const MODELS = {
  Biobank: {
    model: BiobankModel,
    valid: VALID_BIOBANK,
    required: ['biobankName', 'biobankDescription', 'legalEntityId', 'biobankStatus'],
    fieldCount: 15,
  },
  Network: {
    model: NetworkModel,
    valid: VALID_NETWORK,
    required: ['name', 'description', 'juristicPerson', 'networkStatus'],
    fieldCount: 12,
  },
};

const errorsOf = (model, data) => model.validate(data).errors.join(' | ');

describe.each(Object.entries(MODELS))('%s', (entity, { model, valid, required, fieldCount }) => {
  it('fieldsOf() with no argument emits exactly the catalog fields, in catalog order', () => {
    const rows = rowsOf(entity);
    expect(rows).toHaveLength(fieldCount);
    expect(Object.keys(model.fieldsOf())).toEqual(rows.map((row) => row.field));
  });

  it('accepts a full valid payload', () => {
    expect(model.validate(valid)).toEqual({ isValid: true, errors: [] });
  });

  it.each(required.flatMap((field) => [
    [field, undefined], [field, null], [field, ''], [field, '   '],
  ]))('rejects %s = %j, naming the field', (field, value) => {
    const data = { ...valid, [field]: value };
    if (value === undefined) delete data[field];
    const result = model.validate(data);
    expect(result.isValid).toBe(false);
    expect(errorsOf(model, data)).toContain(field);
  });

  it.each([[{}], [[]], ['a@b'], [{ email: '' }], [null]])('rejects contactInformation %j', (contactInformation) => {
    const result = model.validate({ ...valid, contactInformation });
    expect(result.isValid).toBe(false);
    expect(result.errors.join(' | ')).toContain('contactInformation');
  });

  it('accepts contactInformation with one filled contact', () => {
    expect(model.validate({ ...valid, contactInformation: { email: 'a@b.org' } }).isValid).toBe(true);
  });

  it('rejects a url that is not a URI and accepts an absent one', () => {
    expect(errorsOf(model, { ...valid, url: 'not a url' })).toContain('url');
    const { url, ...withoutUrl } = valid;
    expect(model.validate(withoutUrl).isValid).toBe(true);
  });

  it('create({}) does not throw and returns every fieldsOf key plus createdAt and updatedAt', () => {
    const created = model.create({});
    expect(Object.keys(created)).toEqual([...Object.keys(model.fieldsOf()), 'createdAt', 'updatedAt']);
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.updatedAt).toBeInstanceOf(Date);
  });
});

describe('Biobank country and list fields', () => {
  it('rejects a countryCode that is not ISO 3166-1 alpha-2', () => {
    expect(errorsOf(BiobankModel, { ...VALID_BIOBANK, countryCode: 'BRA' })).toContain('countryCode');
  });

  it('rejects a missing countryCode', () => {
    expect(errorsOf(BiobankModel, { ...VALID_BIOBANK, countryCode: null })).toContain('countryCode');
  });

  it('rejects organisationalCapabilities given as a string, not a list', () => {
    expect(errorsOf(BiobankModel, { ...VALID_BIOBANK, organisationalCapabilities: 'x' })).toContain('organisationalCapabilities');
  });

  it('rejects an empty code in infrastructuralCapabilities', () => {
    expect(errorsOf(BiobankModel, { ...VALID_BIOBANK, infrastructuralCapabilities: ['storage', ''] })).toContain('infrastructuralCapabilities');
  });

  it('rejects qualityManagementStandards given as an object, not a list', () => {
    expect(errorsOf(BiobankModel, { ...VALID_BIOBANK, qualityManagementStandards: { code: 'ISO' } })).toContain('qualityManagementStandards');
  });

  it('create upper-cases countryCode and keeps a caller-supplied biobankId', () => {
    const created = BiobankModel.create({ ...VALID_BIOBANK, countryCode: ' br ' });
    expect(created.countryCode).toBe('BR');
    expect(created.biobankId).toBe('biobank-1');
  });

  it('create generates a biobankId when none is given', () => {
    expect(BiobankModel.create({}).biobankId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('Network country and list fields', () => {
  it.each([[[]], [['BR', 'x1']], ['BR'], [null]])('rejects countryCodes %j', (countryCodes) => {
    expect(errorsOf(NetworkModel, { ...VALID_NETWORK, countryCodes })).toContain('countryCodes');
  });

  it('rejects an empty networkMembers reference', () => {
    expect(errorsOf(NetworkModel, { ...VALID_NETWORK, networkMembers: ['', 'n-1'] })).toContain('networkMembers');
  });

  it('rejects commonCollaborationTopics given as a string, not a list', () => {
    expect(errorsOf(NetworkModel, { ...VALID_NETWORK, commonCollaborationTopics: 'x' })).toContain('commonCollaborationTopics');
  });

  it('create upper-cases each country code and keeps a caller-supplied networkId', () => {
    const created = NetworkModel.create({ ...VALID_NETWORK, countryCodes: ['br', ' pt '] });
    expect(created.countryCodes).toEqual(['BR', 'PT']);
    expect(created.networkId).toBe('network-1');
  });
});
