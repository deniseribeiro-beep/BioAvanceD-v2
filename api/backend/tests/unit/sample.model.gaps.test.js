import { describe, it, expect } from 'vitest';
const { SampleModel: Sample } = require('../../src/models/Sample');
const { SAMPLE_ORIGIN_IDS, EXTRACTION_PROTOCOL_IDS } = require('../../src/config/constants/specimen.constants');

const validData = {
  patientID: '12345678',
  sampleType: 'PLASMA',
  sampleOrigin: SAMPLE_ORIGIN_IDS[0],
  extractionProtocol: EXTRACTION_PROTOCOL_IDS[0],
  quantity: 10,
  unit: 'mL',
  quality: 'GOOD',
  linkedProject: 'PROJ-001',
  registerDate: new Date().toISOString(),
};

describe('Sample.validate - date branches', () => {
  it('accepts a Date instance for registrationDate', () => {
    const result = Sample.validate({ ...validData, registerDate: undefined, registrationDate: new Date() });
    expect(result.isValid).toBe(true);
  });

  it('accepts a valid ISO string for registrationDate', () => {
    const result = Sample.validate({ ...validData, registerDate: undefined, registrationDate: '2026-01-01T00:00:00.000Z' });
    expect(result.isValid).toBe(true);
  });

  it('rejects an invalid ISO string for registrationDate', () => {
    const result = Sample.validate({ ...validData, registerDate: undefined, registrationDate: 'not-a-date' });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('registrationDate deve ser uma data válida'))).toBe(true);
  });

  it('rejects a non-Date/non-string registrationDate', () => {
    const result = Sample.validate({ ...validData, registrationDate: 12345 });
    expect(result.errors.some(e => e.includes('registrationDate deve ser Date ou string ISO'))).toBe(true);
  });

  it('accepts a Date instance for withdrawalDate', () => {
    const result = Sample.validate({ ...validData, withdrawalDate: new Date() });
    expect(result.isValid).toBe(true);
  });

  it('accepts a valid ISO string for withdrawalDate', () => {
    const result = Sample.validate({ ...validData, withdrawalDate: '2026-01-01T00:00:00.000Z' });
    expect(result.isValid).toBe(true);
  });

  it('rejects an invalid ISO string for withdrawalDate', () => {
    const result = Sample.validate({ ...validData, withdrawalDate: 'not-a-date' });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('withdrawalDate deve ser uma data válida'))).toBe(true);
  });

  it('rejects a non-Date/non-string withdrawalDate', () => {
    const result = Sample.validate({ ...validData, withdrawalDate: 12345 });
    expect(result.errors.some(e => e.includes('withdrawalDate deve ser Date ou string ISO'))).toBe(true);
  });
});

describe('Sample.validate - status branches', () => {
  it('rejects an invalid currentStatus', () => {
    const result = Sample.validate({ ...validData, currentStatus: 'Bogus' });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('currentStatus deve ser'))).toBe(true);
  });

  it('accepts a valid currentStatus', () => {
    const result = Sample.validate({ ...validData, currentStatus: 'Available' });
    expect(result.isValid).toBe(true);
  });

  it('rejects an invalid lifecycle status', () => {
    const result = Sample.validate({ ...validData, status: 'BOGUS' });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('status deve ser'))).toBe(true);
  });

  it('accepts a valid lifecycle status', () => {
    const result = Sample.validate({ ...validData, status: 'AVAILABLE' });
    expect(result.isValid).toBe(true);
  });
});

describe('Sample.validate - barcode and quality omission', () => {
  it('rejects a non-string barcode', () => {
    const result = Sample.validate({ ...validData, barcode: 12345 });
    expect(result.errors.some(e => e.includes('barcode deve ser string'))).toBe(true);
  });

  it('accepts a valid string barcode', () => {
    const result = Sample.validate({ ...validData, barcode: 'BC-001' });
    expect(result.isValid).toBe(true);
  });

  it('rejects when quality is missing', () => {
    const { quality: _q, ...data } = validData;
    const result = Sample.validate(data);
    expect(result.errors.some(e => e.includes('quality é obrigatório'))).toBe(true);
  });

  it('rejects when quantity is missing', () => {
    const { quantity: _q, ...data } = validData;
    const result = Sample.validate(data);
    expect(result.errors.some(e => e.includes('quantity é obrigatório'))).toBe(true);
  });
});

describe('Sample.validate - storageLocation branches', () => {
  it('rejects a non-object storageLocation', () => {
    const result = Sample.validate({ ...validData, storageLocation: 'A1' });
    expect(result.errors.some(e => e.includes('storageLocation deve ser um objeto'))).toBe(true);
  });

  it('rejects a non-string boxId', () => {
    const result = Sample.validate({ ...validData, storageLocation: { boxId: 123, position: 'A1' } });
    expect(result.errors.some(e => e.includes('storageLocation.boxId'))).toBe(true);
  });

  it('rejects a non-string position', () => {
    const result = Sample.validate({ ...validData, storageLocation: { boxId: 'box1', position: 999 } });
    expect(result.errors.some(e => e.includes('storageLocation.position deve ser uma string'))).toBe(true);
  });

  it('rejects a malformed position string', () => {
    const result = Sample.validate({ ...validData, storageLocation: { boxId: 'box1', position: '11A' } });
    expect(result.errors.some(e => e.includes('storageLocation.position deve seguir formato'))).toBe(true);
  });

  it('accepts a well-formed storageLocation', () => {
    const result = Sample.validate({ ...validData, storageLocation: { boxId: 'box1', position: 'A1' } });
    expect(result.isValid).toBe(true);
  });
});

describe('Sample.validate - sampleType/sampleOrigin/extractionProtocol type guards', () => {
  it('rejects a non-string sampleType', () => {
    const result = Sample.validate({ ...validData, sampleType: 123 });
    expect(result.errors.some(e => e.includes('sampleType é obrigatório'))).toBe(true);
  });

  it('rejects a non-string sampleOrigin', () => {
    const result = Sample.validate({ ...validData, sampleOrigin: 123 });
    expect(result.errors.some(e => e.includes('sampleOrigin é obrigatório'))).toBe(true);
  });

  it('rejects a non-string extractionProtocol', () => {
    const result = Sample.validate({ ...validData, extractionProtocol: 123 });
    expect(result.errors.some(e => e.includes('extractionProtocol é obrigatório'))).toBe(true);
  });
});

describe('Sample.validateSampleType / validateSampleOrigin / validateExtractionType', () => {
  it('validateSampleType returns false for non-string input', () => {
    expect(Sample.validateSampleType(123)).toBe(false);
    expect(Sample.validateSampleType(null)).toBe(false);
  });

  it('validateSampleOrigin returns false for non-string input', () => {
    expect(Sample.validateSampleOrigin(123)).toBe(false);
    expect(Sample.validateSampleOrigin(null)).toBe(false);
  });

  it('validateExtractionType returns false for non-string input', () => {
    expect(Sample.validateExtractionType(123)).toBe(false);
    expect(Sample.validateExtractionType(null)).toBe(false);
  });

  it('validateExtractionType returns true for a known protocol id', () => {
    expect(Sample.validateExtractionType(EXTRACTION_PROTOCOL_IDS[0])).toBe(true);
  });
});

describe('SampleModel.create - additional field normalization', () => {
  it('normalizes quality_score, rcs_score, final_grade, p_bio, grade_route, calculation_trace and external_quality_assessment', () => {
    const sample = Sample.create({
      ...validData,
      quality_score: '4.5',
      rcs_score: '80',
      final_grade: 'A',
      p_bio: '0.9',
      grade_route: 'auto',
      calculation_trace: { step: 1 },
      external_quality_assessment: { provider: 'lab-x' },
    });

    expect(sample.quality_score).toBe(4.5);
    expect(sample.rcs_score).toBe(80);
    expect(sample.final_grade).toBe('A');
    expect(sample.p_bio).toBe(0.9);
    expect(sample.grade_route).toBe('auto');
    expect(sample.calculation_trace).toEqual({ step: 1 });
    expect(sample.external_quality_assessment).toEqual({ provider: 'lab-x' });
  });

  it('defaults quality_score/rcs_score/external_quality_assessment when invalid or absent', () => {
    const sample = Sample.create({ ...validData });
    expect(sample.quality_score).toBeNull();
    expect(sample.rcs_score).toBeNull();
    expect(sample.final_grade).toBe('');
    expect(sample.p_bio).toBeNull();
    expect(sample.grade_route).toBeNull();
    expect(sample.calculation_trace).toEqual({});
    expect(sample.external_quality_assessment).toBeNull();
  });

  it('normalizes clinical_data with phenotypes, comorbidities and biomarkers', () => {
    const sample = Sample.create({
      ...validData,
      clinical_data: {
        orphaCode: 'ORPHA:1',
        omimCode: 'OMIM:1',
        cid: 'E70',
        phenotypes: ['HP:0001'],
        charlsonComorbidities: ['diabetes'],
        biomarkers_values: { glucose: 90 },
      },
    });

    expect(sample.clinical_data.orphaCode).toBe('ORPHA:1');
    expect(sample.clinical_data.phenotypes).toEqual(['HP:0001']);
    expect(sample.clinical_data.charlsonComorbidities).toEqual(['diabetes']);
    expect(sample.clinical_data.biomarkers_values).toEqual({ glucose: 90 });
  });

  it('normalizes pharmacology_data including legacy aliases', () => {
    const sample = Sample.create({
      ...validData,
      pharmacology_data: {
        treatment_status: 'ON_TREATMENT',
        medication_name: 'DrugX',
        medication_code: 'ATC1',
        medication_drug_class: 'ClassA',
        last_dose_date: '2026-01-01T00:00:00.000Z',
        washout_start_date: '2026-01-02T00:00:00.000Z',
        washout_end_date: '2026-01-03T00:00:00.000Z',
      },
    });

    expect(sample.pharmacology_data.drug_name).toBe('DrugX');
    expect(sample.pharmacology_data.atc_code).toBe('ATC1');
    expect(sample.pharmacology_data.atc_level_1).toBe('ClassA');
    expect(sample.pharmacology_data.last_dose_date).toBeInstanceOf(Date);
    expect(sample.pharmacology_data.washout_start_date).toBeInstanceOf(Date);
    expect(sample.pharmacology_data.washout_end_date).toBeInstanceOf(Date);
  });

  it('normalizes storageLocation when provided, defaults otherwise', () => {
    const withLocation = Sample.create({ ...validData, storageLocation: { boxId: 'box1', position: 'A1' } });
    expect(withLocation.storageLocation).toEqual({ boxId: 'box1', position: 'A1' });

    const withoutLocation = Sample.create({ ...validData });
    expect(withoutLocation.storageLocation).toEqual({ boxId: null, position: null });
  });

  it('uses receivedTime and processingStatus defaults/overrides', () => {
    const sample = Sample.create({ ...validData, receivedTime: '2026-02-01T00:00:00.000Z', processingStatus: 'completed' });
    expect(sample.receivedTime).toBeInstanceOf(Date);
    expect(sample.processingStatus).toBe('completed');

    const defaultSample = Sample.create({ ...validData });
    expect(defaultSample.processingStatus).toBe('pending');
  });

  it('derives registerDate from registrationDate when registerDate is absent', () => {
    const sample = Sample.create({ ...validData, registerDate: undefined, registrationDate: '2026-03-01T00:00:00.000Z' });
    expect(sample.registerDate).toBeInstanceOf(Date);
    expect(sample.registerDate.toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });

  it('falls back tcle_id/consentTemplateId between each other', () => {
    const sample = Sample.create({ ...validData, tcle_id: 'tcle-1' });
    expect(sample.tcle_id).toBe('tcle-1');
    expect(sample.consentTemplateId).toBe('tcle-1');
  });

  it('preserves penalty_log array and defaults to empty array otherwise', () => {
    const withLog = Sample.create({ ...validData, penalty_log: [{ reason: 'late' }] });
    expect(withLog.penalty_log).toEqual([{ reason: 'late' }]);

    const withoutLog = Sample.create({ ...validData, penalty_log: 'not-an-array' });
    expect(withoutLog.penalty_log).toEqual([]);
  });
});

describe('SampleModel.getResults', () => {
  it('resolves with results from the db collection', async () => {
    const docs = [{ id: 1 }, { id: 2 }];
    const db = {
      collection: () => ({
        find: () => ({ toArray: async () => docs }),
      }),
    };

    const results = await Sample.getResults(db, 'sample-1');
    expect(results).toEqual(docs);
  });

  it('wraps errors from the db collection', async () => {
    const db = {
      collection: () => ({
        find: () => { throw new Error('boom'); },
      }),
    };

    await expect(Sample.getResults(db, 'sample-1')).rejects.toThrow('Erro ao buscar arquivos de analise: boom');
  });
});
