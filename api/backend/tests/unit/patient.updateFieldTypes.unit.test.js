import { describe, it, expect, vi } from 'vitest';

process.env.ENCRYPTION_KEY = 'dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGtleXQ=';
process.env.ENCRYPTION_KEY_ID = 'test-key-1';

const PatientModel = require('../../src/models/Patient');
const patientService = require('../../src/services/patient.service');
const { LEGACY_PATIENT_IDENTITY_FIELDS } = require('../../src/utils/legacyPatientIdentityFields');

// #1277: updatePatient used to check the value types of a few named fields
// only. Every other field's value went into the $set as sent.

function makeFakeCollection(overrides = {}) {
  return {
    findOne: vi.fn().mockResolvedValue({ participantId: '12345678' }),
    updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    createIndex: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

function makeFakeDb(collectionsByName = {}) {
  return {
    collection: vi.fn((name) => collectionsByName[name] || makeFakeCollection())
  };
}

describe('PatientModel.FIELD_TYPES (#1277)', () => {
  it('declares a type for every field the update allow-list accepts', () => {
    const accepted = [...PatientModel.CANONICAL_FIELDS, ...LEGACY_PATIENT_IDENTITY_FIELDS];
    expect(accepted.filter((field) => !PatientModel.FIELD_TYPES[field])).toEqual([]);
    expect(Object.keys(PatientModel.FIELD_TYPES).filter((field) => !accepted.includes(field))).toEqual([]);
  });
});

describe('PatientModel.validateUpdateTypes (#1277)', () => {
  it.each([
    ['sex', 1, 'sex deve ser um texto'],
    ['recordNumber', { $gt: '' }, 'recordNumber deve ser um texto'],
    ['status', ['ACTIVE'], 'status deve ser um texto'],
    ['studyId', 42, 'studyId deve ser um texto'],
    ['isDeceased', 'true', 'isDeceased deve ser verdadeiro ou falso'],
    ['anamneseGeral', 'texto livre', 'anamneseGeral deve ser um objeto'],
    ['anamneseGeral', [], 'anamneseGeral deve ser um objeto'],
    ['dadosEspecificos', { a: 1 }, 'dadosEspecificos deve ser uma lista'],
    ['consentAcceptedAt', 'not a date', 'consentAcceptedAt deve ser uma data'],
    ['consentAcceptedAt', 1700000000000, 'consentAcceptedAt deve ser uma data'],
    ['sex', null, 'sex não pode ser nulo'],
    ['dadosEspecificos', null, 'dadosEspecificos não pode ser nulo']
  ])('refuses %s = %j', (field, value, message) => {
    expect(PatientModel.validateUpdateTypes({ [field]: value })).toEqual([message]);
  });

  it('accepts well-typed values, nulls on nullable fields, and absent keys', () => {
    expect(PatientModel.validateUpdateTypes({
      sex: 'F',
      status: 'ACTIVE',
      isDeceased: false,
      anamneseGeral: { alergias: 'nenhuma' },
      dadosEspecificos: [],
      consentAcceptedAt: '2026-10-02T12:00:00.000Z',
      consentNotifiedAt: new Date(),
      studyId: null,
      identityDocument: null,
      phone: undefined
    })).toEqual([]);
  });

  it('leaves keys it does not declare to the controller allow-list', () => {
    expect(PatientModel.validateUpdateTypes({ alphaGal: 2.0, height: 1.75 })).toEqual([]);
  });

  it('names every offending field', () => {
    expect(PatientModel.validateUpdateTypes({ sex: 1, studyId: 2 })).toEqual([
      'sex deve ser um texto',
      'studyId deve ser um texto'
    ]);
  });
});

describe('PatientService.updatePatient field types (#1277)', () => {
  it('refuses a wrong type with a 422 naming the field, before any write', async () => {
    const patientsCollection = makeFakeCollection();
    const db = makeFakeDb({ patients: patientsCollection });

    await expect(
      patientService.updatePatient(db, '12345678', { status: { $ne: 'ACTIVE' } })
    ).rejects.toMatchObject({ statusCode: 422, code: 'INVALID_FIELD_TYPE', message: 'status deve ser um texto' });
    expect(patientsCollection.updateOne).not.toHaveBeenCalled();
  });

  it('stores a consent date sent as a string as a Date', async () => {
    const patientsCollection = makeFakeCollection();
    const db = makeFakeDb({ patients: patientsCollection });

    await patientService.updatePatient(db, '12345678', { consentAcceptedAt: '2026-10-02T12:00:00.000Z' });

    const setPayload = patientsCollection.updateOne.mock.calls[0][1].$set;
    expect(setPayload.consentAcceptedAt).toBeInstanceOf(Date);
    expect(setPayload.consentAcceptedAt.toISOString()).toBe('2026-10-02T12:00:00.000Z');
  });
});
