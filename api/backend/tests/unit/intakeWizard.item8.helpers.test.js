import { afterEach, describe, expect, it, vi } from 'vitest';

const router = require('../../src/routes/intakeWizard');
const patientIdentityService = require('../../src/services/PatientIdentityService');

const {
  normalizeString,
  normalizeNumber,
  normalizeArray,
  normalizeObject,
  parseBirthDate,
  buildFallbackPatientID,
  resolvePatientID,
  buildClinicalData,
  buildPharmacologyData,
  buildSampleDocumentFromIntake,
  resolveMatchedPatient,
} = router._test;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('intakeWizard item 8 helper behavior', () => {
  it('normalizes primitive helper inputs without inventing values', () => {
    expect(normalizeString(null)).toBe('');
    expect(normalizeString('  value  ')).toBe('value');

    expect(normalizeNumber('2.5', 0)).toBe(2.5);
    expect(normalizeNumber('not-a-number', 7)).toBe(7);

    const array = ['a'];
    expect(normalizeArray(array)).toBe(array);
    expect(normalizeArray('a')).toEqual([]);

    const object = { a: 1 };
    expect(normalizeObject(object)).toBe(object);
    expect(normalizeObject(null)).toEqual({});
    expect(normalizeObject(['a'])).toEqual({});
  });

  it('parses valid Date, Brazilian and ISO birth dates and rejects invalid dates', () => {
    const date = new Date(1990, 4, 20, 13, 45);
    const fromDate = parseBirthDate(date);
    expect(fromDate).toBeInstanceOf(Date);
    expect(fromDate.getFullYear()).toBe(1990);
    expect(fromDate.getMonth()).toBe(4);
    expect(fromDate.getDate()).toBe(20);
    expect(fromDate.getHours()).toBe(0);

    const br = parseBirthDate('20/05/1990');
    expect(br).toBeInstanceOf(Date);
    expect(br.getFullYear()).toBe(1990);
    expect(br.getMonth()).toBe(4);
    expect(br.getDate()).toBe(20);

    expect(parseBirthDate('31/02/1990')).toBeNull();
    expect(parseBirthDate('1990-05-20')).toBeInstanceOf(Date);
    expect(parseBirthDate('not-a-date')).toBeNull();
    expect(parseBirthDate('')).toBeNull();
  });

  it('uses a supplied canonical 8-digit participantId and otherwise generates an 8-digit fallback', () => {
    expect(resolvePatientID({ participant: { participantId: ' 12345678 ' } })).toBe('12345678');

    vi.spyOn(Date, 'now').mockReturnValue(1234567890123);
    expect(buildFallbackPatientID()).toBe('67890123');
    expect(resolvePatientID({ participant: { participantId: 'legacy-id' } })).toBe('67890123');
  });

  it('builds empty-safe clinical data and normalizes all supported clinical collections', () => {
    expect(buildClinicalData()).toEqual({
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

    const data = buildClinicalData({
      diagnosis: {
        orphaCode: ' ORPHA:558 ',
        omimCode: 'OMIM:154700',
        icdCode: ' A00 ',
      },
      clinical: {
        diseasePhenotypes: [{ hpoId: 'HP:1' }],
        charlsonConditions: ['copd'],
        biomarkersValues: { hgb: 13 },
        allergies: [{ allergenCode: '1' }],
        familyHistories: [{ relationship: 'mother' }],
        procedures: [{ procedureCode: 'P1' }],
        observationRecords: [{ loincCode: '718-7' }],
        clinicalOutcomes: [{ outcomeType: 'stable' }],
      },
    });

    expect(data).toMatchObject({
      orphaCode: 'ORPHA:558',
      omimCode: '154700',
      cid: 'A00',
      phenotypes: [{ hpoId: 'HP:1' }],
      charlsonComorbidities: ['copd'],
      biomarkerValues: { hgb: 13 },
    });
    expect(data.allergies).toHaveLength(1);
    expect(data.familyHistories).toHaveLength(1);
    expect(data.procedures).toHaveLength(1);
    expect(data.observationRecords).toHaveLength(1);
    expect(data.clinicalOutcomes).toHaveLength(1);
  });

  it('normalizes pharmacology status, ATC prefix/class and optional dates', () => {
    expect(buildPharmacologyData()).toEqual({
      treatmentStatus: '',
      medicationName: null,
      atcCode: null,
      atcClass: null,
      lastDoseDate: null,
      washoutStartDate: null,
      washoutEndDate: null,
    });

    const inferredClass = buildPharmacologyData({
      clinical: {
        pharmacologyData: {
          treatmentStatus: ' on_treatment ',
          medicationName: ' Metformin ',
          atcCode: 'atc:a10ba02',
          lastDoseDate: '2026-01-10',
        },
      },
    });
    expect(inferredClass).toMatchObject({
      treatmentStatus: 'ON_TREATMENT',
      medicationName: 'Metformin',
      atcCode: 'A10BA02',
      atcClass: 'A',
      lastDoseDate: '2026-01-10',
    });

    const explicitClass = buildPharmacologyData({
      clinical: {
        pharmacologyData: {
          treatmentStatus: 'unsupported',
          atcCode: 'B01',
          atcClass: ' b ',
          washoutStartDate: '2026-02-01',
          washoutEndDate: '2026-02-03',
        },
      },
    });
    expect(explicitClass).toMatchObject({
      treatmentStatus: '',
      atcCode: 'B01',
      atcClass: 'B',
      washoutStartDate: '2026-02-01',
      washoutEndDate: '2026-02-03',
    });
  });

  it('builds a canonical sample document using the matched participant and explicit available status', () => {
    const doc = buildSampleDocumentFromIntake({
      participant: { participantId: '11112222' },
      specimen: {
        specimenStatus: ' AVAILABLE ',
        registeredAt: '2026-01-15T00:00:00.000Z',
        sampleType: 'PLASMA',
        sampleOrigin: 'VENOUS_BLOOD',
        extractionProtocol: 'EDTA',
        barcode: ' BC-1 ',
        quantity: '2.5',
        unit: ' mL ',
        linkedProject: ' Project-1 ',
        sprec: { sampleType: 'PLASMA' },
      },
      consent: { consentTemplateId: ' TCLE-1 ' },
    }, {
      _id: 'patient-object-id',
      participantId: '87654321',
    });

    expect(doc).toMatchObject({
      participantId: '87654321',
      patientObjectId: 'patient-object-id',
      sampleType: 'PLASMA',
      sampleOrigin: 'VENOUS_BLOOD',
      extractionProtocol: 'EDTA',
      barcode: 'BC-1',
      quantity: 2.5,
      unit: 'mL',
      specimenStatus: 'available',
      linkedProject: 'Project-1',
      consentTemplateId: 'TCLE-1',
    });
    expect(doc.registeredAt.toISOString()).toBe('2026-01-15T00:00:00.000Z');
  });

  it('builds quarantine-safe sample defaults when optional specimen metadata is absent', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1234567890123);
    const doc = buildSampleDocumentFromIntake({
      participant: { participantId: 'invalid' },
      specimen: {},
      consent: {},
    });

    expect(doc.participantId).toBe('67890123');
    expect(doc.patientObjectId).toBeNull();
    expect(doc.sampleType).toBe('UNKNOWN');
    expect(doc.sampleOrigin).toBe('UNKNOWN');
    expect(doc.extractionProtocol).toBe('UNKNOWN');
    expect(doc.barcode).toBeNull();
    expect(doc.quantity).toBe(0);
    expect(doc.unit).toBeNull();
    expect(doc.specimenStatus).toBe('quarantined');
    expect(doc.linkedProject).toBe('INTAKE_WIZARD');
    expect(doc.sprec).toEqual({});
    expect(doc.consentTemplateId).toBeNull();
  });

  it('delegates patient matching with normalized identity and parsed birth date', async () => {
    const match = vi.spyOn(patientIdentityService, 'matchOrUpsertParticipant')
      .mockResolvedValue({ created: false, patient: { participantId: '12345678' } });

    const db = {};
    const result = await resolveMatchedPatient(db, {
      participant: {
        participantId: '12345678',
        patientName: 'Synthetic Patient',
        birthDate: '20/05/1990',
        identityDocument: '  ABC-123  ',
      },
    });

    expect(result.patient.participantId).toBe('12345678');
    expect(match).toHaveBeenCalledWith(db, expect.objectContaining({
      participantId: '12345678',
      patientName: 'Synthetic Patient',
      identityDocument: 'ABC-123',
      birthDate: expect.any(Date),
    }));
  });

  it('delegates patient matching with null identityDocument when the field is blank', async () => {
    const match = vi.spyOn(patientIdentityService, 'matchOrUpsertParticipant')
      .mockResolvedValue({ created: true, patient: { participantId: '12345678' } });

    await resolveMatchedPatient({}, {
      participant: {
        participantId: '12345678',
        patientName: 'Synthetic Patient',
        birthDate: '1990-05-20',
        identityDocument: '   ',
      },
    });

    expect(match).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      identityDocument: null,
    }));
  });
});
