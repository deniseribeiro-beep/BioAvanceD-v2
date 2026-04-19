import { describe, it, expect, beforeEach, vi } from 'vitest';
const SampleGraphValidator = require('../../src/services/SampleGraphValidator');
const { generateSampleHash } = require('../../src/services/MerkleService');

function buildSample(overrides = {}) {
  const sample = {
    _id: '507f1f77bcf86cd799439011',
    sampleID: 'S-0001',
    patientID: '12345678',
    tcle_id: 'tcle-001',
    quality_category: 'A',
    clinical_data: {
      orphaCode: 'ORPHA:324',
      cid: 'E75.2',
      biomarkers_values: {
        'Lyso-Gb3': '4.2',
        'Atividade de Alfa-galactosidase A': '2.1',
      },
    },
    pharmacology_data: {
      treatment_status: 'ON_TREATMENT',
      drug_name: 'Migalastat',
      atc_code: 'A16AX27',
      atc_level_1: 'A',
    },
  };

  const merged = {
    ...sample,
    ...overrides,
    clinical_data: {
      ...sample.clinical_data,
      ...(overrides.clinical_data || {}),
    },
    pharmacology_data: {
      ...sample.pharmacology_data,
      ...(overrides.pharmacology_data || {}),
    },
  };

  merged.merkle_root = generateSampleHash(merged);
  return merged;
}

describe('SampleGraphValidator', () => {
  let db;
  let samplesCollection;
  let consentsCollection;
  let diseaseDictionaryCollection;
  let medicationDictionaryCollection;
  let sampleMovementsCollection;
  let validator;

  beforeEach(() => {
    samplesCollection = {
      findOne: vi.fn(),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    };

    consentsCollection = {
      findOne: vi.fn(),
    };

    diseaseDictionaryCollection = {
      findOne: vi.fn().mockResolvedValue({
        orpha_code: '324',
        name: 'Doenca de Fabry',
        disease_category: 'Erros Inatos do Metabolismo',
        drug_classes: ['A'],
        validation_requirements: {
          miabis: { requireTreatmentStatus: true },
          biomarkers: {
            required: ['Lyso-Gb3', 'Atividade de Alfa-galactosidase A'],
            recommended: [],
          },
          pharmacology: {
            required: ['treatment_status'],
            recommended: [],
            treatmentStatuses: ['NAIVE', 'TREATED', 'ON_TREATMENT', 'WASHOUT'],
          },
        },
      }),
    };

    medicationDictionaryCollection = {
      findOne: vi.fn().mockResolvedValue({
        atc_code: 'A16AX27',
        drug_class: 'A',
        active: true,
      }),
    };

    sampleMovementsCollection = {
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([]),
            next: vi.fn().mockResolvedValue(null),
          }),
        }),
      }),
      findOne: vi.fn().mockResolvedValue(null),
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'movement-1' }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    };

    const countersCollection = {
      findOneAndUpdate: vi.fn().mockResolvedValue({ value: { seq: 1 } }),
    };

    db = {
      listCollections: () => ({
        toArray: async () => ([{ name: 'samples' }, { name: 'consents' }]),
      }),
      collection: (name) => {
        if (name === 'samples') return samplesCollection;
        if (name === 'consents' || name === 'patientConsents') return consentsCollection;
        if (name === 'disease_dictionary' || name === 'diseaseDictionary') return diseaseDictionaryCollection;
        if (name === 'medication_dictionary' || name === 'medicationDictionary') return medicationDictionaryCollection;
        if (name === 'sample_movements' || name === 'sampleMovements') return sampleMovementsCollection;
        if (name === 'counters') return countersCollection;
        throw new Error(`Unexpected collection name: ${name}`);
      },
    };

    validator = new SampleGraphValidator(db);
  });

  it('valida o nó de Ética com sucesso e falha', async () => {
    const validSample = buildSample();

    samplesCollection.findOne.mockResolvedValue(validSample);
    consentsCollection.findOne.mockResolvedValue({ status: 'ACTIVE', patientID: '12345678' });

    const successReport = await validator.validateSampleCompliance(validSample._id);
    expect(successReport.graphPath.ethics.valid).toBe(true);

    consentsCollection.findOne.mockResolvedValue({ status: 'REVOKED', patientID: '12345678' });
    const failReport = await validator.validateSampleCompliance(validSample._id);
    expect(failReport.graphPath.ethics.valid).toBe(false);
  });

  it('valida o nó de Qualidade com sucesso e falha', async () => {
    const goodSample = buildSample({ quality_category: 'B' });
    samplesCollection.findOne.mockResolvedValue(goodSample);
    consentsCollection.findOne.mockResolvedValue({ status: 'ACTIVE', patientID: '12345678' });

    const successReport = await validator.validateSampleCompliance(goodSample._id);
    expect(successReport.graphPath.quality.valid).toBe(true);

    const badSample = buildSample({ quality_category: 'C' });
    samplesCollection.findOne.mockResolvedValue(badSample);
    const failReport = await validator.validateSampleCompliance(badSample._id);
    expect(failReport.graphPath.quality.valid).toBe(false);
    expect(failReport.suggestedStatus).toBe('QUARANTINE');
  });

  it('valida o nó de Clínica com sucesso e falha em Fabry sem biomarcadores', async () => {
    const completeSample = buildSample();
    samplesCollection.findOne.mockResolvedValue(completeSample);
    consentsCollection.findOne.mockResolvedValue({ status: 'ACTIVE', patientID: '12345678' });

    const successReport = await validator.validateSampleCompliance(completeSample._id);
    expect(successReport.graphPath.clinical.valid).toBe(true);

    const incompleteFabrySample = buildSample({
      clinical_data: {
        orphaCode: 'ORPHA:324',
        cid: 'E75.2',
        biomarkers_values: {
          'Lyso-Gb3': 'n/a',
          'Atividade de Alfa-galactosidase A': '2.1',
        },
      },
    });
    samplesCollection.findOne.mockResolvedValue(incompleteFabrySample);

    const failReport = await validator.validateSampleCompliance(incompleteFabrySample._id);
    expect(failReport.graphPath.clinical.valid).toBe(false);
    expect(failReport.suggestedStatus).toBe('BLOCKED');
  });

  it('valida o nó de Integridade com sucesso e falha por tampering', async () => {
    const validSample = buildSample();
    samplesCollection.findOne.mockResolvedValue(validSample);
    consentsCollection.findOne.mockResolvedValue({ status: 'ACTIVE', patientID: '12345678' });

    const successReport = await validator.validateSampleCompliance(validSample._id);
    expect(successReport.graphPath.integrity.valid).toBe(true);

    const tampered = {
      ...validSample,
      clinical_data: {
        ...validSample.clinical_data,
        biomarkers_values: {
          ...validSample.clinical_data.biomarkers_values,
          'Lyso-Gb3': '99.9',
        },
      },
    };
    samplesCollection.findOne.mockResolvedValue(tampered);

    const failReport = await validator.validateSampleCompliance(tampered._id);
    expect(failReport.graphPath.integrity.valid).toBe(false);
    expect(failReport.suggestedStatus).toBe('BLOCKED');
  });
});
