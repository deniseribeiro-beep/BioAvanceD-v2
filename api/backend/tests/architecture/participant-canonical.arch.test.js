const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const FILES = [
  path.resolve(__dirname, '../../src/models/Patient.js'),
  path.resolve(__dirname, '../../src/services/patient.service.js'),
  path.resolve(__dirname, '../../src/services/PatientIdentityService.js'),
  path.resolve(__dirname, '../../src/utils/patientAnonymization.js'),
  path.resolve(__dirname, '../../src/controllers/paciente.controller.js'),
  path.resolve(__dirname, '../../src/services/consent.service.js'),
  path.resolve(__dirname, '../../src/services/consent.validator.js'),
  path.resolve(__dirname, '../../src/models/PatientConsent.js'),
  path.resolve(__dirname, '../../../../frontend/src/hooks/usePatients.ts'),
  path.resolve(__dirname, '../../../../frontend/src/views/PatientsPage.tsx'),
  path.resolve(__dirname, '../../../../frontend/src/components/UI/PatientSearchInput.tsx'),
];

const FORBIDDEN = ['patientID', 'patientId', 'pseudoId', 'mongoPatientId', 'representativeCpf'];

test('participant runtime stays canonical in active files', () => {
  const hits = [];
  for (const file of FILES) {
    const content = fs.readFileSync(file, 'utf8');
    for (const term of FORBIDDEN) {
      if (content.includes(term)) {
        hits.push({ file, term });
      }
    }
  }
  assert.deepEqual(hits, []);
});
