import { describe, it, expect } from 'vitest';
import { _test } from './ClinicalIntakeWizard.jsx';

const { buildSubmissionPayload } = _test;

describe('ClinicalIntakeWizard buildSubmissionPayload', () => {
  it('#167: diagnosis payload only carries canonical camelCase keys, no legacy snake_case duplicates', () => {
    const formData = {
      isHealthyControl: false,
      patientID: '12345678',
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
});
