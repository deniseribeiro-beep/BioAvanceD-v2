import { describe, it, expect } from 'vitest';

// RNF008 AC3 (#1496): ResearchResource (P1X-0013..0035) and its links
// ResearchResourceCollection (P1X-0142..0146) and ResearchResourceBiobank
// (P1X-0147..0151), the dictionary's only path from a collection to its
// biobank. fieldsOf emits the catalog's fields, validate enforces each 1..1
// and 1..* Core field, the list and number fields and the effectivePeriod,
// create never throws, and a link counts only while in force over [start, end).

const { loadCanonicalDictionary } = require('../../../src/reference-data/canonical-dictionary/v2');
const ResearchResourceModel = require('../../../src/models/ResearchResource');
const ResearchResourceCollectionModel = require('../../../src/models/ResearchResourceCollection');
const ResearchResourceBiobankModel = require('../../../src/models/ResearchResourceBiobank');
const { associationInForce } = require('../../../src/models/researchResourceAssociation');

const catalog = loadCanonicalDictionary();
const rowsOf = (entity) => catalog.filter((row) => row.entity === entity);

const VALID_RESOURCE = {
  researchResourceId: 'rr-1',
  acronym: 'CS',
  name: 'Coorte Sintética',
  url: 'https://resource.example.org',
  contactInformation: [{ email: 'contato@example.org' }],
  description: 'Recurso de teste',
  sampleSource: 'human',
  sexCategories: ['female', 'male'],
  ageLow: 18,
  ageHigh: 90.5,
  ageLowUnit: 'a',
  ageHighUnit: 'a',
  datasetTypes: [{ coding: [{ code: 'genomic' }] }],
  sampleTypes: [{ coding: [{ code: 'blood' }] }],
  storageTemperatures: [{ coding: [{ code: '-80' }] }],
  diseases: [{ code: 'C50' }],
  sampleCollectionSettings: ['hospital'],
  researchResourceDesigns: ['cohort'],
  useAccessConditions: [{ coding: [{ code: 'GRU' }] }],
  researchResourceStatus: 'active',
  totalNumberOfSubjects: 120,
  inclusionCriteria: ['adult'],
  publications: [{ system: 'doi', value: '10.1000/x' }],
};

const VALID_COLLECTION_LINK = {
  associationId: 'assoc-1',
  researchResourceId: 'rr-1',
  collectionId: 'col-1',
  associationRole: 'member',
  effectivePeriod: { start: '2026-01-01T00:00:00Z', end: '2027-01-01T00:00:00Z' },
};

const VALID_BIOBANK_LINK = {
  associationId: 'assoc-2',
  researchResourceId: 'rr-1',
  biobankId: 'biobank-1',
  associationRole: 'holder',
  effectivePeriod: { start: '2026-01-01T00:00:00Z' },
};

const MODELS = {
  ResearchResource: {
    model: ResearchResourceModel,
    valid: VALID_RESOURCE,
    required: ['name', 'contactInformation', 'sexCategories', 'sampleTypes'],
    fieldCount: 23,
  },
  ResearchResourceCollection: {
    model: ResearchResourceCollectionModel,
    valid: VALID_COLLECTION_LINK,
    required: ['researchResourceId', 'collectionId'],
    fieldCount: 5,
  },
  ResearchResourceBiobank: {
    model: ResearchResourceBiobankModel,
    valid: VALID_BIOBANK_LINK,
    required: ['researchResourceId', 'biobankId'],
    fieldCount: 5,
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

  it.each(required)('rejects a payload missing %s, naming the field', (field) => {
    const data = { ...valid };
    delete data[field];
    const result = model.validate(data);
    expect(result.isValid).toBe(false);
    expect(result.errors.join(' | ')).toContain(`${field} é obrigatório para ${entity}`);
  });

  it('create({}) does not throw and returns every fieldsOf key plus createdAt and updatedAt', () => {
    const created = model.create({});
    expect(Object.keys(created)).toEqual([...Object.keys(model.fieldsOf()), 'createdAt', 'updatedAt']);
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.updatedAt).toBeInstanceOf(Date);
  });
});

describe('ResearchResource list, number and url fields', () => {
  it.each([[[]], [[{}]], [[{ email: '' }]], [{ email: 'a@b.org' }], ['a@b.org']])('rejects contactInformation %j', (contactInformation) => {
    expect(errorsOf(ResearchResourceModel, { ...VALID_RESOURCE, contactInformation })).toContain('contactInformation');
  });

  it('rejects an empty code in sexCategories', () => {
    expect(errorsOf(ResearchResourceModel, { ...VALID_RESOURCE, sexCategories: ['female', ''] })).toContain('sexCategories');
  });

  it('rejects an empty sampleTypes list', () => {
    expect(errorsOf(ResearchResourceModel, { ...VALID_RESOURCE, sampleTypes: [] })).toContain('sampleTypes');
  });

  it('rejects a url that is not a URI', () => {
    expect(errorsOf(ResearchResourceModel, { ...VALID_RESOURCE, url: 'not a url' })).toContain('url');
  });

  it.each(['sampleCollectionSettings', 'researchResourceDesigns', 'inclusionCriteria'])('rejects an empty code in %s', (field) => {
    expect(errorsOf(ResearchResourceModel, { ...VALID_RESOURCE, [field]: ['ok', ''] })).toContain(field);
  });

  it.each(['datasetTypes', 'storageTemperatures', 'diseases', 'useAccessConditions', 'publications'])('rejects %s given as an object, not a list', (field) => {
    expect(errorsOf(ResearchResourceModel, { ...VALID_RESOURCE, [field]: { code: 'x' } })).toContain(`${field} deve ser uma lista`);
  });

  it.each([['ageLow', '18'], ['ageHigh', Infinity]])('rejects %s = %s, not a finite number', (field, value) => {
    expect(errorsOf(ResearchResourceModel, { ...VALID_RESOURCE, [field]: value })).toContain(field);
  });

  it.each([[-1], [1.5], ['10']])('rejects totalNumberOfSubjects = %j', (totalNumberOfSubjects) => {
    expect(errorsOf(ResearchResourceModel, { ...VALID_RESOURCE, totalNumberOfSubjects })).toContain('totalNumberOfSubjects');
  });

  it('create keeps a caller-supplied researchResourceId and generates one when none is given', () => {
    expect(ResearchResourceModel.create(VALID_RESOURCE).researchResourceId).toBe('rr-1');
    expect(ResearchResourceModel.create({}).researchResourceId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe.each([
  ['ResearchResourceCollection', ResearchResourceCollectionModel, VALID_COLLECTION_LINK],
  ['ResearchResourceBiobank', ResearchResourceBiobankModel, VALID_BIOBANK_LINK],
])('%s effectivePeriod and role', (_entity, model, valid) => {
  it('refuses an effectivePeriod given as a string', () => {
    const result = model.validate({ ...valid, effectivePeriod: '2026-01-01/2027-01-01' });
    expect(result.isValid).toBe(false);
    expect(result.errors.join(' | ')).toContain('effectivePeriod deve ser um período');
  });

  it('refuses an effectivePeriod whose end is not after its start', () => {
    const at = '2026-06-01T00:00:00Z';
    const result = model.validate({ ...valid, effectivePeriod: { start: at, end: at } });
    expect(result.isValid).toBe(false);
    expect(result.errors.join(' | ')).toContain('effectivePeriod.end deve ser posterior');
  });

  it('refuses an effectivePeriod start that is not a date', () => {
    expect(errorsOf(model, { ...valid, effectivePeriod: { start: 'never' } })).toContain('effectivePeriod.start');
  });

  it('refuses an empty associationRole', () => {
    expect(errorsOf(model, { ...valid, associationRole: ' ' })).toContain('associationRole');
  });
});

describe('associationInForce', () => {
  const now = new Date('2026-06-01T00:00:00Z');
  const period = { start: '2026-01-01T00:00:00Z', end: '2026-06-01T00:00:00Z' };

  it('is true with no effectivePeriod', () => {
    expect(associationInForce({ researchResourceId: 'rr-1' }, now)).toBe(true);
  });

  it('is false before its start', () => {
    expect(associationInForce({ effectivePeriod: { start: '2026-06-02T00:00:00Z' } }, now)).toBe(false);
  });

  it('is false at its end', () => {
    expect(associationInForce({ effectivePeriod: period }, now)).toBe(false);
  });

  it('is true inside its period', () => {
    expect(associationInForce({ effectivePeriod: period }, new Date('2026-03-01T00:00:00Z'))).toBe(true);
  });
});
