const test = require('node:test');
const assert = require('node:assert/strict');
const ParticipantModel = require('../../src/models/Patient');
const pacienteController = require('../../src/controllers/paciente.controller');

test('Patient model rejects canonical aliases with 422 metadata', () => {
  assert.throws(() => {
    ParticipantModel.create({
      participantId: '12345678',
      patientID: '12345678',
      patientName: 'Paciente',
      birthDate: '1990-01-01',
      sex: 'F',
      consentTemplateId: 'tpl-1'
    });
  }, (error) => error.statusCode === 422 && error.code === 'NON_CANONICAL_FIELD' && Array.isArray(error.fields));
});

test('Paciente controller rejects participant aliases before persistence', () => {
  assert.throws(() => {
    pacienteController.sanitizePatientPayload({
      patientId: '12345678',
      patientName: 'Paciente'
    });
  }, (error) => error.statusCode === 422 && error.code === 'NON_CANONICAL_FIELD' && error.fields.includes('patientId'));
});
