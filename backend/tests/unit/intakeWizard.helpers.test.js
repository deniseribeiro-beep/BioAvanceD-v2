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
      demographic: { patientName: 'Paciente Exemplo' },
      sample: {},
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
      biomarkers_values: { foo: 1 },
    });
  });

  it('buildPharmacologyData normaliza aliases legacy e novos', () => {
    const pharmacology = helpers.buildPharmacologyData({
      clinical: {
        pharmacologyData: {
          treatment_status: 'on_treatment',
          drug_name: 'Migalastat',
          atc_code: 'a16ax27',
        },
      },
    });

    expect(pharmacology.treatment_status).toBe('ON_TREATMENT');
    expect(pharmacology.drug_name).toBe('Migalastat');
    expect(pharmacology.atc_code).toBe('A16AX27');
    expect(pharmacology.atc_level_1).toBe('A');
    expect(pharmacology.medication_name).toBe('Migalastat');
  });

  it('buildSampleDocumentFromIntake usa matched patient quando disponível', () => {
    const document = helpers.buildSampleDocumentFromIntake(
      {
        demographic: { patientName: 'Paciente Teste', patientID: '12345678' },
        sample: {
          sampleType: 'Sangue',
          sampleOrigin: 'Hospital A',
          extractionProtocol: 'EDTA',
          quantity: 2,
          quality: 'GOOD',
          linkedProject: 'Projeto X',
          registrationDate: '2026-04-13T10:00:00.000Z',
        },
        consent: { tcle_template_id: 'template-1' },
      },
      {
        _id: 'patient-object-1',
        patientID: '12345678',
        patientName: 'Paciente Teste',
      }
    );

    expect(document.patientID).toBe('12345678');
    expect(document.patientObjectId).toBe('patient-object-1');
    expect(document.sampleType).toBe('Sangue');
    expect(document.consentTemplateId).toBe('template-1');
    expect(document.status).toBe('AVAILABLE');
  });

  it('calcularQualidade retorna categoria esperada', () => {
    expect(helpers.calcularQualidade(15, 5)).toBe('Ótima');
    expect(helpers.calcularQualidade(45, 10)).toBe('Subótima');
    expect(helpers.calcularQualidade(120, 25)).toBe('Ruim');
  });

  it('resolveRecipientAndTemplate prioriza email do paciente e seleciona template do consentimento', () => {
    const result = helpers.resolveRecipientAndTemplate({
      demographic: {
        patientName: 'Paciente Teste',
        pseudoId: '12345678',
        email: 'paciente@example.test',
      },
      consent: { tcle_template_id: 'template-42' },
    });

    expect(result.patientName).toBe('Paciente Teste');
    expect(result.patientId).toBe('12345678');
    expect(result.recipientEmail).toBe('paciente@example.test');
    expect(result.templateId).toBe('template-42');
  });
});
