import { describe, it, expect } from 'vitest';

const Cid = require('../../src/models/Cid.js');
const Disease = require('../../src/models/Disease.js');
const DrugDictionary = require('../../src/models/DrugDictionary.js');
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
    // #1206: biomarker knowledge lives on BiomarkerAssociation, not here.
    expect(doc.validation_requirements.toObject()).not.toHaveProperty('biomarkers');
    expect(doc.validation_requirements.pharmacology.treatmentStatuses).toEqual([
      'NAIVE',
      'TREATED',
      'WASHOUT',
    ]);
  });

  it('allows overriding nested validation_requirements fields and drops a sent biomarkers key (#1206)', () => {
    const doc = new Disease({
      orpha_code: 'ORPHA:1',
      name: 'Rare Disease',
      validation_requirements: {
        miabis: { requireTreatmentStatus: false },
        biomarkers: { required: ['BRCA1'] },
      },
    });

    expect(doc.validation_requirements.miabis.requireTreatmentStatus).toBe(false);
    expect(doc.toObject().validation_requirements).not.toHaveProperty('biomarkers');
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

describe('TemperaturePolicy schema', () => {
  it('validates successfully with all required fields', () => {
    const doc = new TemperaturePolicy({
      name: 'Cold storage',
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
    expect(err.errors.targetTemp).toBeUndefined(); // #1197: no setpoint
    expect(err.errors.minTemp).toBeDefined();
    expect(err.errors.maxTemp).toBeDefined();
  });

  it('defaults hysteresis to 0.5 when omitted', () => {
    const doc = new TemperaturePolicy({
      name: 'Cold storage',
      minTemp: -25,
      maxTemp: -15,
    });

    expect(doc.hysteresis).toBe(0.5);
  });

  it('allows overriding hysteresis', () => {
    const doc = new TemperaturePolicy({
      name: 'Cold storage',
      minTemp: -25,
      maxTemp: -15,
      hysteresis: 1.5,
    });

    expect(doc.hysteresis).toBe(1.5);
  });

  describe('#678 dict-02 ThresholdProfile alignment', () => {
    it('defaults metricType, ruleVersion and effectivePeriod.start, leaves minimumDuration/effectivePeriod.end null', () => {
      const doc = new TemperaturePolicy({
        name: 'Cold storage',
        minTemp: -25,
        maxTemp: -15,
      });

      expect(doc.metricType).toBe('temperature');
      expect(doc.ruleVersion).toBe('1.0.0');
      expect(doc.effectivePeriod.start).toBeInstanceOf(Date);
      expect(doc.effectivePeriod.end).toBeNull();
      expect(doc.minimumDuration).toBeNull();

      const err = doc.validateSync();
      expect(err).toBeUndefined();
    });

    it('allows overriding metricType, ruleVersion, effectivePeriod and minimumDuration', () => {
      const start = new Date('2026-01-01T00:00:00Z');
      const end = new Date('2026-12-31T00:00:00Z');
      const doc = new TemperaturePolicy({
        name: 'Cold storage',
        minTemp: -25,
        maxTemp: -15,
        metricType: 'humidity',
        ruleVersion: '2.0.0',
        effectivePeriod: { start, end },
        minimumDuration: 30,
      });

      expect(doc.metricType).toBe('humidity');
      expect(doc.ruleVersion).toBe('2.0.0');
      expect(doc.effectivePeriod.start).toEqual(start);
      expect(doc.effectivePeriod.end).toEqual(end);
      expect(doc.minimumDuration).toBe(30);
    });
  });
});
