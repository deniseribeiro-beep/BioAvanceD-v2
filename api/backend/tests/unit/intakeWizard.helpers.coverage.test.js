import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const router = require('../../src/routes/intakeWizard.js');
const helpers = router._test;

describe('intakeWizard item 8 helper coverage', () => {
  it('normalizes primitive, numeric, array and object inputs across fallback branches', () => {
    expect(helpers.normalizeString(null)).toBe('');
    expect(helpers.normalizeString('  value  ')).toBe('value');

    expect(helpers.normalizeNumber('3.5', 99)).toBe(3.5);
    expect(helpers.normalizeNumber('not-a-number', 99)).toBe(99);

    const array = ['a'];
    expect(helpers.normalizeArray(array)).toBe(array);
    expect(helpers.normalizeArray('a')).toEqual([]);

    const object = { a: 1 };
    expect(helpers.normalizeObject(object)).toBe(object);
    expect(helpers.normalizeObject(null)).toEqual({});
    expect(helpers.normalizeObject([])).toEqual({});
  });

  it('parses Date, Brazilian date, ISO date, blanks and invalid dates', () => {
    const sourceDate = new Date(2026, 8, 18, 15, 30, 0);
    const normalizedDate = helpers.parseBirthDate(sourceDate);
    expect(normalizedDate).toBeInstanceOf(Date);
    expect(normalizedDate.getHours()).toBe(0);

    const brDate = helpers.parseBirthDate('18/09/2026');
    expect(brDate.getFullYear()).toBe(2026);
    expect(brDate.getMonth()).toBe(8);
    expect(brDate.getDate()).toBe(18);

    expect(helpers.parseBirthDate('2026-09-18T20:00:00.000Z')).toBeInstanceOf(Date);
    expect(helpers.parseBirthDate('')).toBeNull();
    expect(helpers.parseBirthDate('   ')).toBeNull();
    expect(helpers.parseBirthDate('31/02/2026')).toBeNull();
    expect(helpers.parseBirthDate('definitely-not-a-date')).toBeNull();
    expect(helpers.parseBirthDate(new Date('invalid'))).toBeNull();
  });

  it('keeps an eight-digit participant id and generates a fallback otherwise', () => {
    expect(helpers.resolvePatientID({ participant: { participantId: '12345678' } })).toBe('12345678');

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1760000012345);
    try {
      expect(helpers.resolvePatientID({ participant: { participantId: 'bad-id' } })).toBe('00012345');
      expect(helpers.buildFallbackPatientID()).toBe('00012345');
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('builds clinical data from populated and absent sections without retaining legacy shapes', () => {
    expect(helpers.buildClinicalData()).toEqual({
      orphaCode: '',
      omimCode: '',
      cid: '',
      phenotypes: [],
      charlsonComorbidities: [],
      biomarkerValues: {},
      allergies: [],
      familyHistories: [],
      procedures: [],
      observationRecords: [],
      clinicalOutcomes: [],
    });

    const result = helpers.buildClinicalData({
      diagnosis: { orphaCode: 'ORPHA:1', omimCode: 'OMIM:154700', icdCode: 'A01' },
      clinical: {
        diseasePhenotypes: [{ hpoId: 'HP:1' }],
        charlsonConditions: ['ckd'],
        biomarkersValues: { hb: 12 },
        allergies: [{ allergenCode: '1' }],
        familyHistories: [{ relationship: 'mother' }],
        procedures: [{ procedureCode: 'p' }],
        observationRecords: [{ loincCode: '718-7' }],
        clinicalOutcomes: [{ outcomeType: 'stable' }],
      },
    });

    expect(result).toMatchObject({
      orphaCode: 'ORPHA:1',
      omimCode: '154700',
      cid: 'A01',
      biomarkerValues: { hb: 12 },
    });
    expect(result.phenotypes).toHaveLength(1);
  });

  it('covers pharmacology status, ATC-class and optional-date branches', () => {
    expect(helpers.buildPharmacologyData()).toEqual({
      treatmentStatus: '',
      medicationName: null,
      atcCode: null,
      atcClass: null,
      lastDoseDate: null,
      washoutStartDate: null,
      washoutEndDate: null,
    });

    const washout = helpers.buildPharmacologyData({
      clinical: {
        pharmacologyData: {
          treatmentStatus: 'washout',
          medicationName: 'Drug',
          atcCode: 'atc:A10BA02',
          lastDoseDate: '2026-09-01',
          washoutStartDate: '2026-09-02',
          washoutEndDate: '2026-09-05',
        },
      },
    });
    expect(washout).toMatchObject({
      treatmentStatus: 'WASHOUT',
      medicationName: 'Drug',
      atcCode: 'A10BA02',
      atcClass: 'A',
      lastDoseDate: '2026-09-01',
      washoutStartDate: '2026-09-02',
      washoutEndDate: '2026-09-05',
    });

    const explicitClass = helpers.buildPharmacologyData({
      clinical: {
        pharmacologyData: {
          treatmentStatus: 'unexpected',
          atcCode: 'B01',
          atcClass: 'custom',
        },
      },
    });
    expect(explicitClass.treatmentStatus).toBe('');
    expect(explicitClass.atcClass).toBe('CUSTOM');
    expect(explicitClass.medicationName).toBeNull();
  });

  it('builds specimen defaults and explicit values with and without a matched patient', () => {
    const fallback = helpers.buildSampleDocumentFromIntake({
      participant: { participantId: '12345678' },
      specimen: {},
      consent: {},
    });
    expect(fallback).toMatchObject({
      participantId: '12345678',
      patientObjectId: null,
      sampleType: 'UNKNOWN',
      sampleOrigin: 'UNKNOWN',
      extractionProtocol: 'UNKNOWN',
      barcode: null,
      quantity: 0,
      unit: null,
      specimenStatus: 'quarantined',
      linkedProject: 'INTAKE_WIZARD',
      consentTemplateId: null,
    });
    expect(fallback.registeredAt).toBeInstanceOf(Date);

    const explicit = helpers.buildSampleDocumentFromIntake({
      participant: { participantId: '87654321' },
      consent: { consentTemplateId: 'template-1' },
      specimen: {
        sampleType: 'PLASMA',
        sampleOrigin: 'LAB',
        extractionProtocol: 'P-1',
        barcode: 'BC-1',
        registeredAt: '2026-09-18T12:00:00.000Z',
        quantity: '2.5',
        unit: 'mL',
        specimenStatus: 'available',
        linkedProject: 'study-1',
        sprec: { sampleType: 'PLASMA' },
      },
    }, { _id: 'mongo-patient-1', participantId: '99999999' });

    expect(explicit).toMatchObject({
      participantId: '99999999',
      patientObjectId: 'mongo-patient-1',
      sampleType: 'PLASMA',
      sampleOrigin: 'LAB',
      extractionProtocol: 'P-1',
      barcode: 'BC-1',
      quantity: 2.5,
      unit: 'mL',
      specimenStatus: 'available',
      linkedProject: 'study-1',
      consentTemplateId: 'template-1',
    });
  });

  it('executes both quality helper call shapes', () => {
    const legacy = helpers.calcularQualidade(15, -80);
    expect(legacy).toBeDefined();

    const canonical = helpers.calcularQualidade({
      matrixType: 'fluid',
      sprec: { matrixType: 'fluid', preCentrifugation: '' },
      documentation_insufficient: true,
    });
    expect(canonical).toBeDefined();
  });
});
