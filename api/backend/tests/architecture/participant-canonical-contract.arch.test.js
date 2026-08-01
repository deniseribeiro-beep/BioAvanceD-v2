// node:test-only by contract (README.md Test Strategy — vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375. History: #138, #148, #182, #375, #393.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const ParticipantModel = require('../../src/models/Patient');
const pacienteController = require('../../src/controllers/paciente.controller');

test('Patient model rejects canonical aliases with 422 metadata', () => {
  let threw = false;
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
    threw = true;
    assert.strictEqual(error.statusCode, 422);
    assert.strictEqual(error.code, 'NON_CANONICAL_FIELD');
    assert.strictEqual(Array.isArray(error.fields), true);
  }
  assert.ok(threw, 'expected ParticipantModel.create to throw for non-canonical fields');
});

test('Paciente controller rejects participant aliases before persistence', () => {
  let threw = false;
  try {
    pacienteController.sanitizePatientPayload({
      patientId: '12345678',
      patientName: 'Paciente'
    });
  } catch (error) {
    threw = true;
    assert.strictEqual(error.statusCode, 422);
    assert.strictEqual(error.code, 'NON_CANONICAL_FIELD');
    assert.strictEqual(error.fields.includes('patientId'), true);
  }
  assert.ok(threw, 'expected sanitizePatientPayload to throw for non-canonical fields');
});
