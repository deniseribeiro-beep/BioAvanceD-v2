import { describe, it, expect } from 'vitest';
import { _test } from './ClinicalIntakeWizard.jsx';

const { buildSubmissionPayload } = _test;

describe('ClinicalIntakeWizard buildSubmissionPayload', () => {
  it('#167: diagnosis payload only carries canonical camelCase keys, no legacy snake_case duplicates', () => {
    const formData = {
      isHealthyControl: false,
      participantId: '12345678',
      patientName: 'Paciente Teste',
      collectionInstitution: 'Hospital Teste',
      collectionInstitutionAcronym: 'HT',
      linkedProject: 'PROJ-1',
      diagnosisCidDescription: 'Some Disease',
      diagnosisDefinition: 'A rare condition',
      diagnosisCidCode: 'E70.0',
      diagnosisOrphaCode: 'ORPHA:123',
      diagnosisOmimCode: '123456',
    };

    const payload = buildSubmissionPayload(formData);

    expect(payload.diagnosis).toEqual({
      diagnosisName: 'Some Disease',
      icdCode: 'E70.0',
      orphaCode: 'ORPHA:123',
      omimCode: '123456',
      definition: 'A rare condition',
    });
  });

  it('#522: clinical.charlsonConditions carries the checked comorbidity slugs as an array, matching what buildClinicalData reads (api/backend/src/routes/intakeWizard.js)', () => {
    const comorbidityDefinitions = [
      { slug: 'diabetes', label: 'Diabetes' },
      { slug: 'hypertension', label: 'Hypertension' },
      { slug: 'ckd', label: 'Chronic Kidney Disease' },
    ];
    const formData = {
      isHealthyControl: false,
      participantId: '12345678',
      patientName: 'Paciente Teste',
      collectionInstitution: 'Hospital Teste',
      collectionInstitutionAcronym: 'HT',
      linkedProject: 'PROJ-1',
      diabetes: true,
      hypertension: false,
      ckd: true,
    };

    const payload = buildSubmissionPayload(formData, comorbidityDefinitions);

    expect(payload.clinical.charlsonConditions).toEqual(['diabetes', 'ckd']);
    expect(payload.clinical.comorbidities).toBeUndefined();
  });

  it('#699: participant/specimen match the canonical.v1.intake AJV contract shape', () => {
    const formData = {
      isHealthyControl: true,
      participantId: '',
      patientName: 'Paciente Teste',
      birthDate: '01011990',
      prontuario: 'PRONT-1',
      collectionInstitution: 'Hospital Teste',
      collectionInstitutionAcronym: 'HT',
      linkedProject: 'PROJ-1',
      sprecCode: 'BLD-PL1-A-N-N-A-N',
      sprecMatrixType: 'fluid',
      sprecSampleType: 'BLD',
    };

    const payload = buildSubmissionPayload(formData);

    // recordNumber, not the legacy prontuario field name (additionalProperties: false).
    expect(payload.participant.recordNumber).toBe('PRONT-1');
    expect(payload.participant.prontuario).toBeUndefined();
    // bare date, not a full ISO datetime (format: 'date').
    expect(payload.participant.birthDate).toBe('1990-01-01');
    // required, non-empty even for a new patient the server hasn't assigned an id to yet.
    expect(payload.participant.participantId).toBe('placeholder');
    expect(payload.specimen.participantId).toBe('placeholder');
    expect(payload.specimen.specimenId).toBe('placeholder');
    // no equivalent in the contract -- dropped, not sent.
    expect(payload.specimen.collectionInstitution).toBeUndefined();
    expect(payload.specimen.collectionInstitutionAcronym).toBeUndefined();
    // flat strings with a top-level code/version, not nested {code, label} axis objects.
    expect(payload.specimen.sprec.code).toBe('BLD-PL1-A-N-N-A-N');
    expect(payload.specimen.sprec.version).toBe('SPREC-2.0');
    expect(payload.specimen.sprec.sampleType).toBe('BLD');
    expect(typeof payload.specimen.sprec.sampleType).toBe('string');
  });

  it('#701: specimen.sampleType/sampleOrigin/extractionProtocol carry the real MIABIS selections, not the SPREC axis codes', () => {
    const formData = {
      isHealthyControl: true,
      participantId: '',
      patientName: 'Paciente Teste',
      birthDate: '01011990',
      prontuario: 'PRONT-1',
      collectionInstitution: 'Hospital Teste',
      collectionInstitutionAcronym: 'HT',
      linkedProject: 'PROJ-1',
      sprecCode: 'BLD-PL1-A-N-N-A-N',
      sprecMatrixType: 'fluid',
      // SPREC axis values -- a different, larger vocabulary than MIABIS
      // (real SPREC codes, e.g. BLD/PL1), never a substitute for the
      // MIABIS-coded fields below (#701).
      sprecSampleType: 'BLD',
      sprecPrimaryContainer: 'PL1',
      // Real MIABIS-coded selections, distinct from the SPREC axis fields.
      sampleType: 'PLASMA',
      sampleOrigin: 'VENOUS_BLOOD',
      extractionProtocol: 'TUBE_EDTA',
    };

    const payload = buildSubmissionPayload(formData);

    expect(payload.specimen.sampleType).toBe('PLASMA');
    expect(payload.specimen.sampleOrigin).toBe('VENOUS_BLOOD');
    expect(payload.specimen.extractionProtocol).toBe('TUBE_EDTA');
    // The SPREC axis codes still travel separately, untouched, under sprec.*.
    expect(payload.specimen.sprec.sampleType).toBe('BLD');
    expect(payload.specimen.sprec.primaryContainer).toBe('PL1');
  });
});
