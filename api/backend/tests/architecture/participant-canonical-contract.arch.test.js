import { test, expect } from 'vitest';

const ParticipantModel = require('../../src/models/Patient');
const pacienteController = require('../../src/controllers/paciente.controller');

test('Patient model rejects canonical aliases with 422 metadata', () => {
  expect.assertions(3);
  try {
    ParticipantModel.create({
      participantId: '12345678',
      patientID: '12345678',
      patientName: 'Paciente',
      birthDate: '1990-01-01',
      sex: 'F',
      consentTemplateId: 'tpl-1'
    });
  } catch (error) {
    expect(error.statusCode).toBe(422);
    expect(error.code).toBe('NON_CANONICAL_FIELD');
    expect(Array.isArray(error.fields)).toBe(true);
  }
});

test('Paciente controller rejects participant aliases before persistence', () => {
  expect.assertions(3);
  try {
    pacienteController.sanitizePatientPayload({
      patientId: '12345678',
      patientName: 'Paciente'
    });
  } catch (error) {
    expect(error.statusCode).toBe(422);
    expect(error.code).toBe('NON_CANONICAL_FIELD');
    expect(error.fields.includes('patientId')).toBe(true);
  }
});
