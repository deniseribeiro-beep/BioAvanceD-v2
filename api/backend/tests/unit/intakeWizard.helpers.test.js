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
    expect(document.lifecycleStatus).toBe('QUARANTINE');
  });

  it('calcularQualidade nao usa mais heuristica legada numerica', () => {
    const result = helpers.calcularQualidade(15, 5);

    expect(result.model_version).toBe('RCS-GOV-1.0');
    expect(result.final_grade).toBe('E');
    expect(result.grade_route).toBe('Governance failure');
  });

  it('resolveRecipientAndTemplate prioriza email do paciente e seleciona template do consentimento', () => {
    const result = helpers.resolveRecipientAndTemplate({
      participant: {
        patientName: 'Paciente Teste',
        participantId: '12345678',
        email: 'paciente@example.test',
      },
      consent: { consentTemplateId: 'template-42' },
    });

    expect(result.patientName).toBe('Paciente Teste');
    expect(result.patientId).toBe('12345678');
    expect(result.recipientEmail).toBe('paciente@example.test');
    expect(result.templateId).toBe('template-42');
  });

  it('ensureConsentEmailSent rejeita quando falta nome do paciente', async () => {
    const result = await helpers.ensureConsentEmailSent({
      participant: {},
      consent: { consentTemplateId: 'template-1' },
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.message).toMatch(/Nome do paciente/);
  });

  it('ensureConsentEmailSent rejeita quando falta o template de TCLE', async () => {
    const result = await helpers.ensureConsentEmailSent({
      participant: { patientName: 'Paciente Teste' },
      consent: {},
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.message).toMatch(/TCLE/);
  });

  it('ensureConsentEmailSent rejeita quando falta e-mail do destinatario', async () => {
    const result = await helpers.ensureConsentEmailSent({
      participant: { patientName: 'Paciente Teste' },
      consent: { consentTemplateId: 'template-1' },
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.message).toMatch(/E-mail/);
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
    const db = { collection: () => patientsCollection };

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
