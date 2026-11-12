import { describe, it, expect } from 'vitest';

const intakeWizardRoute = require('../../src/routes/intakeWizard');
const helpers = intakeWizardRoute._test;

describe('intakeWizard helpers', () => {
  it('parseBirthDate aceita formatos ISO e dd/mm/yyyy', () => {
    const iso = helpers.parseBirthDate('2026-04-13T12:00:00.000Z');
    const br = helpers.parseBirthDate('13/04/2026');

    expect(iso).toBeInstanceOf(Date);
    expect(br).toBeInstanceOf(Date);
    expect(br.getFullYear()).toBe(2026);
    expect(br.getMonth()).toBe(3);
    expect(br.getDate()).toBe(13);
  });

  it('resolvePatientID retorna fallback de 8 dígitos quando não há ID válido', () => {
    const resolved = helpers.resolvePatientID({
      participant: { patientName: 'Paciente Exemplo' },
      specimen: {},
    });

    expect(resolved).toMatch(/^\d{8}$/);
  });

  it('buildClinicalData normaliza dados clínicos e biomarcadores', () => {
    const clinical = helpers.buildClinicalData({
      diagnosis: { orphaCode: ' 1234 ', omimCode: ' 5678 ', icdCode: 'A01' },
      clinical: {
        diseasePhenotypes: ['p1'],
        charlsonConditions: ['c1'],
        biomarkersValues: { foo: 1 },
      },
    });

    expect(clinical).toEqual({
      orphaCode: '1234',
      omimCode: '5678',
      cid: 'A01',
      phenotypes: ['p1'],
      charlsonComorbidities: ['c1'],
      biomarkerValues: { foo: 1 },
      // #708-711 added these array fields to buildClinicalData's output;
      // this test's `toEqual` (full-shape) expectation was never updated
      // for them until #712 (which adds clinicalOutcomes) surfaced the gap.
      allergies: [],
      familyHistories: [],
      procedures: [],
      observationRecords: [],
      clinicalOutcomes: [],
    });
  });

  it('buildPharmacologyData normaliza campos canônicos', () => {
    const pharmacology = helpers.buildPharmacologyData({
      clinical: {
        pharmacologyData: {
          treatmentStatus: 'on_treatment',
          medicationName: 'Migalastat',
          atcCode: 'a16ax27',
        },
      },
    });

    expect(pharmacology.treatmentStatus).toBe('ON_TREATMENT');
    expect(pharmacology.medicationName).toBe('Migalastat');
    expect(pharmacology.atcCode).toBe('A16AX27');
    expect(pharmacology.atcClass).toBe('A');
  });

  it('buildSampleDocumentFromIntake usa matched patient quando disponível', () => {
    const document = helpers.buildSampleDocumentFromIntake(
      {
        participant: { patientName: 'Paciente Teste', participantId: '12345678' },
        specimen: {
          sampleType: 'Sangue',
          sampleOrigin: 'Hospital A',
          extractionProtocol: 'EDTA',
          quantity: 2,
          linkedProject: 'Projeto X',
          registeredAt: '2026-04-13T10:00:00.000Z',
        },
        consent: { consentTemplateId: 'template-1' },
      },
      {
        _id: 'patient-object-1',
        participantId: '12345678',
        patientName: 'Paciente Teste',
      }
    );

    expect(document.participantId).toBe('12345678');
    expect(document.patientObjectId).toBe('patient-object-1');
    expect(document.sampleType).toBe('Sangue');
    expect(document.consentTemplateId).toBe('template-1');
    expect(document.specimenStatus).toBe('quarantined');
  });

  it('calcularQualidade nao usa mais heuristica legada numerica', () => {
    const result = helpers.calcularQualidade(15, 5);

    expect(result.model_version).toBe('RCS-GOV-1.0');
    expect(result.final_grade).toBe('E');
    expect(result.grade_route).toBe('Governance failure');
  });

  it('buildSampleDocumentFromIntake falls back to fallback quantity when quantity is non-numeric', () => {
    const document = helpers.buildSampleDocumentFromIntake({
      participant: { patientName: 'Paciente Teste' },
      specimen: { quantity: 'not-a-number' },
    });

    expect(document.quantity).toBe(0);
  });

  it('buildSampleDocumentFromIntake accepts an explicit valid specimenStatus instead of defaulting (#415)', () => {
    const document = helpers.buildSampleDocumentFromIntake({
      participant: { patientName: 'Paciente Teste' },
      specimen: { specimenStatus: 'available' },
    });

    expect(document.specimenStatus).toBe('available');
  });

  it('buildSampleDocumentFromIntake carries the trimmed specimen.collectionId (RF004 AC2, #1497)', () => {
    const document = helpers.buildSampleDocumentFromIntake({
      participant: { patientName: 'Paciente Teste' },
      specimen: { collectionId: ' COL-1 ' },
    });

    expect(document.collectionId).toBe('COL-1');
  });

  it('buildSampleDocumentFromIntake gives a null collectionId when the specimen names none (#1497)', () => {
    const document = helpers.buildSampleDocumentFromIntake({
      participant: { patientName: 'Paciente Teste' },
      specimen: {},
    });

    expect(document.collectionId).toBeNull();
  });

  it('buildSampleDocumentFromIntake gives a null collectionId for a blank specimen.collectionId (#1497)', () => {
    const document = helpers.buildSampleDocumentFromIntake({
      participant: { patientName: 'Paciente Teste' },
      specimen: { collectionId: '' },
    });

    expect(document.collectionId).toBeNull();
  });

  it('buildSampleDocumentFromIntake derives specimenStatus quarantined for any non-available specimenStatus (#415)', () => {
    const document = helpers.buildSampleDocumentFromIntake({
      participant: { patientName: 'Paciente Teste' },
      specimen: { specimenStatus: 'quarantined' },
    });

    expect(document.specimenStatus).toBe('quarantined');
  });

  it('buildSampleDocumentFromIntake defaults registeredAt to now when specimen.registeredAt is absent', () => {
    const before = Date.now();
    const document = helpers.buildSampleDocumentFromIntake({
      participant: { patientName: 'Paciente Teste' },
      specimen: {},
    });
    const after = Date.now();

    expect(document.registeredAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(document.registeredAt.getTime()).toBeLessThanOrEqual(after + 1000);
  });

  it('buildSampleDocumentFromIntake falls back to sprec.sampleType and UNKNOWN for sampleOrigin/extractionProtocol', () => {
    const document = helpers.buildSampleDocumentFromIntake({
      participant: { patientName: 'Paciente Teste' },
      specimen: { sprec: { sampleType: 'Plasma' } },
    });

    expect(document.sampleType).toBe('Plasma');
    expect(document.sampleOrigin).toBe('UNKNOWN');
    expect(document.extractionProtocol).toBe('UNKNOWN');
  });

  it('buildSampleDocumentFromIntake defaults sampleType/sampleOrigin fully to UNKNOWN when nothing is provided', () => {
    const document = helpers.buildSampleDocumentFromIntake({
      participant: { patientName: 'Paciente Teste' },
      specimen: {},
    });

    expect(document.sampleType).toBe('UNKNOWN');
    expect(document.sampleOrigin).toBe('UNKNOWN');
  });

  it('buildSampleDocumentFromIntake carries specimen.parentSpecimenIds trimmed (ELM-0120, #1371)', () => {
    const document = helpers.buildSampleDocumentFromIntake({
      participant: { patientName: 'Paciente Teste' },
      specimen: { parentSpecimenIds: [' SP-1 ', 'SP-2'] },
    });

    expect(document.parentSpecimenIds).toEqual(['SP-1', 'SP-2']);
  });

  it('buildSampleDocumentFromIntake carries no parent when the specimen names none (#1371)', () => {
    const document = helpers.buildSampleDocumentFromIntake({
      participant: { patientName: 'Paciente Teste' },
      specimen: {},
    });

    expect(document.parentSpecimenIds).toEqual([]);
  });

  it('buildPharmacologyData returns null/empty fields when nothing is set', () => {
    const pharmacology = helpers.buildPharmacologyData({});

    expect(pharmacology.treatmentStatus).toBe('');
    expect(pharmacology.medicationName).toBeNull();
    expect(pharmacology.atcCode).toBeNull();
    expect(pharmacology.atcClass).toBeNull();
    expect(pharmacology.lastDoseDate).toBeNull();
    expect(pharmacology.washoutStartDate).toBeNull();
    expect(pharmacology.washoutEndDate).toBeNull();
  });

  it('buildPharmacologyData discards an unrecognized treatmentStatus and derives atcClass from atcCode', () => {
    const pharmacology = helpers.buildPharmacologyData({
      clinical: {
        pharmacologyData: {
          treatmentStatus: 'BOGUS_STATUS',
          atcCode: 'ATC:b01ac06',
        },
      },
    });

    expect(pharmacology.treatmentStatus).toBe('');
    expect(pharmacology.atcCode).toBe('B01AC06');
    expect(pharmacology.atcClass).toBe('B');
  });

  it('resolvePatientID returns the participantId as-is when it is already 8 digits', () => {
    const resolved = helpers.resolvePatientID({ participant: { participantId: '87654321' } });
    expect(resolved).toBe('87654321');
  });

  it('resolveMatchedPatient calls the real PatientIdentityService method (regression for #165)', async () => {
    const insertedDocs = [];
    const patientsCollection = {
      findOne: async () => null,
      insertOne: async (doc) => {
        insertedDocs.push(doc);
        return { insertedId: 'patient-object-1' };
      },
    };
    // RF005/RNF007 (#575): patientName/birthDate/identityDocument are
    // written to ParticipantIdentity, not Patient — needs its own mock.
    const identitiesCollection = {
      updateOne: async () => ({ acknowledged: true }),
    };
    const db = {
      collection: (name) => (name === 'participantIdentities' ? identitiesCollection : patientsCollection),
    };

    const result = await helpers.resolveMatchedPatient(db, {
      participant: {
        participantId: '12345678',
        patientName: 'Paciente Teste',
        birthDate: '2000-01-01',
        identityDocument: '11122233344',
      },
      legalRepresentative: {},
    });

    expect(result.created).toBe(true);
    expect(result.patient.participantId).toBe('12345678');
    expect(insertedDocs).toHaveLength(1);
    expect(insertedDocs[0].participantId).toBe('12345678');
  });
});
