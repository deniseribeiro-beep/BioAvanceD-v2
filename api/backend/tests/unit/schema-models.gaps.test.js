import { describe, it, expect } from 'vitest';

const Cid = require('../../src/models/Cid.js');
const Disease = require('../../src/models/Disease.js');
const DrugDictionary = require('../../src/models/DrugDictionary.js');
const Equipment = require('../../src/models/Equipment.schema.js');
const TemperaturePolicy = require('../../src/models/TemperaturePolicy.schema.js');

describe('Cid schema', () => {
  it('validates successfully with all required fields', () => {
    const doc = new Cid({
      Codigo_Tabulacao: 'C001',
      Descricao: 'Some disease',
      Codigos_CID10: 'A00',
    });

    const err = doc.validateSync();
    expect(err).toBeUndefined();
  });

  it('fails validation when required fields are missing', () => {
    const doc = new Cid({});
    const err = doc.validateSync();

    expect(err).toBeDefined();
    expect(err.errors.Codigo_Tabulacao).toBeDefined();
    expect(err.errors.Descricao).toBeDefined();
    expect(err.errors.Codigos_CID10).toBeDefined();
  });

  it('trims whitespace on trimmed string fields', () => {
    const doc = new Cid({
      Codigo_Tabulacao: '  C001  ',
      Descricao: '  Some disease  ',
      Codigos_CID10: '  A00  ',
    });

    expect(doc.Codigo_Tabulacao).toBe('C001');
    expect(doc.Descricao).toBe('Some disease');
    expect(doc.Codigos_CID10).toBe('A00');
  });

  it('defaults ORPHA/OMIM/names to null and array fields to empty arrays', () => {
    const doc = new Cid({
      Codigo_Tabulacao: 'C001',
      Descricao: 'Some disease',
      Codigos_CID10: 'A00',
    });

    expect(doc.ORPHA).toBeNull();
    expect(doc.OMIM).toBeNull();
    expect(doc.namePt).toBeNull();
    expect(doc.nameEn).toBeNull();
    expect(doc.nameEs).toBeNull();
    expect(doc.translations).toBeNull();
    expect(doc.names).toBeNull();
    expect(doc.aliases).toEqual([]);
    expect(doc.synonyms).toEqual([]);
    expect(doc.alternativeNames).toEqual([]);
    expect(doc.active).toBe(true);
  });
});

describe('Disease schema', () => {
  it('validates successfully with required fields', () => {
    const doc = new Disease({
      orpha_code: 'ORPHA:1',
      name: 'Rare Disease',
    });

    const err = doc.validateSync();
    expect(err).toBeUndefined();
  });

  it('fails validation when orpha_code or name is missing', () => {
    const doc = new Disease({});
    const err = doc.validateSync();

    expect(err).toBeDefined();
    expect(err.errors.orpha_code).toBeDefined();
    expect(err.errors.name).toBeDefined();
  });

  it('applies defaults for category, drug_classes, active and nested validation_requirements', () => {
    const doc = new Disease({
      orpha_code: 'ORPHA:1',
      name: 'Rare Disease',
    });

    expect(doc.disease_category).toBe('Outras Doencas Raras');
    expect(doc.drug_classes).toEqual([]);
    expect(doc.active).toBe(true);
    expect(doc.validation_requirements.miabis.requireTreatmentStatus).toBe(true);
    expect(doc.validation_requirements.biomarkers.required).toEqual([]);
    expect(doc.validation_requirements.pharmacology.treatmentStatuses).toEqual([
      'NAIVE',
      'TREATED',
      'WASHOUT',
    ]);
  });

  it('allows overriding nested validation_requirements fields', () => {
    const doc = new Disease({
      orpha_code: 'ORPHA:1',
      name: 'Rare Disease',
      validation_requirements: {
        miabis: { requireTreatmentStatus: false },
        biomarkers: { required: ['BRCA1'] },
      },
    });

    expect(doc.validation_requirements.miabis.requireTreatmentStatus).toBe(false);
    expect(doc.validation_requirements.biomarkers.required).toEqual(['BRCA1']);
  });
});

describe('DrugDictionary schema', () => {
  it('validates successfully with only the required name field', () => {
    const doc = new DrugDictionary({ name: 'Aspirin' });
    const err = doc.validateSync();
    expect(err).toBeUndefined();
  });

  it('fails validation when name is missing', () => {
    const doc = new DrugDictionary({});
    const err = doc.validateSync();

    expect(err).toBeDefined();
    expect(err.errors.name).toBeDefined();
  });

  it('uppercases atc_code and atc_level_1', () => {
    const doc = new DrugDictionary({
      name: 'Aspirin',
      atc_code: 'n02ba01',
      atc_level_1: 'n',
    });

    expect(doc.atc_code).toBe('N02BA01');
    expect(doc.atc_level_1).toBe('N');
  });

  it('applies defaults for source, active and array fields', () => {
    const doc = new DrugDictionary({ name: 'Aspirin' });

    expect(doc.source).toBe('LOCAL');
    expect(doc.active).toBe(true);
    expect(doc.atc_classifications).toEqual([]);
    expect(doc.synonyms).toEqual([]);
    expect(doc.disease_categories).toEqual([]);
  });
});

describe('Equipment schema', () => {
  it('validates successfully with all required fields', () => {
    const doc = new Equipment({
      name: 'Freezer A',
      model: 'FZ-100',
      serialNumber: 'SN123',
      purchaseDate: new Date('2024-01-01'),
    });

    const err = doc.validateSync();
    expect(err).toBeUndefined();
  });

  it('fails validation when required fields are missing', () => {
    const doc = new Equipment({});
    const err = doc.validateSync();

    expect(err).toBeDefined();
    expect(err.errors.name).toBeDefined();
    expect(err.errors.model).toBeDefined();
    expect(err.errors.serialNumber).toBeDefined();
    expect(err.errors.purchaseDate).toBeDefined();
  });

  it('defaults status to Active and trims string fields', () => {
    const doc = new Equipment({
      name: '  Freezer A  ',
      model: '  FZ-100  ',
      serialNumber: '  SN123  ',
      purchaseDate: new Date('2024-01-01'),
    });

    expect(doc.status).toBe('Active');
    expect(doc.name).toBe('Freezer A');
    expect(doc.model).toBe('FZ-100');
    expect(doc.serialNumber).toBe('SN123');
  });
});

describe('TemperaturePolicy schema', () => {
  it('validates successfully with all required fields', () => {
    const doc = new TemperaturePolicy({
      name: 'Cold storage',
      targetTemp: -20,
      minTemp: -25,
      maxTemp: -15,
    });

    const err = doc.validateSync();
    expect(err).toBeUndefined();
  });

  it('fails validation when required fields are missing', () => {
    const doc = new TemperaturePolicy({});
    const err = doc.validateSync();

    expect(err).toBeDefined();
    expect(err.errors.name).toBeDefined();
    expect(err.errors.targetTemp).toBeDefined();
    expect(err.errors.minTemp).toBeDefined();
    expect(err.errors.maxTemp).toBeDefined();
  });

  it('defaults hysteresis to 0.5 when omitted', () => {
    const doc = new TemperaturePolicy({
      name: 'Cold storage',
      targetTemp: -20,
      minTemp: -25,
      maxTemp: -15,
    });

    expect(doc.hysteresis).toBe(0.5);
  });

  it('allows overriding hysteresis', () => {
    const doc = new TemperaturePolicy({
      name: 'Cold storage',
      targetTemp: -20,
      minTemp: -25,
      maxTemp: -15,
      hysteresis: 1.5,
    });

    expect(doc.hysteresis).toBe(1.5);
  });
});
