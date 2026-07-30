import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

process.env.ENCRYPTION_KEY = 'dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGtleXQ=';
process.env.ENCRYPTION_KEY_ID = 'test-key-1';

const patientService = require('../../src/services/patient.service');
const notificationService = require('../../src/services/notification.service');
const patientBiomarkerTimeseriesService = require('../../src/services/patientBiomarkerTimeseries.service');

function makeFakeCollection(overrides = {}) {
  return {
    findOne: vi.fn().mockResolvedValue(null),
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'fake-id-1' }),
    updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
    find: vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([])
    }),
    countDocuments: vi.fn().mockResolvedValue(0),
    createIndex: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

function makeFakeDb(collectionsByName = {}) {
  return {
    collection: vi.fn((name) => collectionsByName[name] || makeFakeCollection())
  };
}

function validPatientData(overrides = {}) {
  return {
    participantId: '12345678',
    patientName: 'Maria Silva',
    birthDate: '01/01/1990',
    sex: 'F',
    email: 'maria@example.com',
    consentTemplateId: '507f1f77bcf86cd799439011',
    ...overrides
  };
}

describe('PatientService.createPatient additional branches', () => {
  it('rejects when consentTemplateId is not a valid ObjectId', async () => {
    const db = makeFakeDb();

    await expect(
      patientService.createPatient(db, validPatientData({ consentTemplateId: 'not-an-object-id' }), {
        skipConsentNotification: true,
        skipBiomarkerArtifacts: true
      })
    ).rejects.toThrow('consentTemplateId inválido');
  });

  it('rejects when consentTemplateId does not match any template', async () => {
    const consentTemplatesCollection = makeFakeCollection({ findOne: vi.fn().mockResolvedValue(null) });
    const db = makeFakeDb({ consent_templates: consentTemplatesCollection });

    await expect(
      patientService.createPatient(db, validPatientData(), {
        skipConsentNotification: true,
        skipBiomarkerArtifacts: true
      })
    ).rejects.toThrow('Template de consentimento não encontrado');
  });

  it('rejects when a duplicate patient (same name + birthDate) already exists', async () => {
    const consentTemplatesCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({ _id: '507f1f77bcf86cd799439011' })
    });
    const patientsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue(null),
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ patientName: 'Maria Silva', birthDate: new Date(1990, 0, 1) }])
      })
    });
    const db = makeFakeDb({ patients: patientsCollection, consent_templates: consentTemplatesCollection });

    await expect(
      patientService.createPatient(db, validPatientData(), {
        skipConsentNotification: true,
        skipBiomarkerArtifacts: true
      })
    ).rejects.toThrow(/Paciente duplicado/);
  });

  it('uppercases a fallback-generated unitAcronym derived from clinicalUnit', async () => {
    const consentTemplatesCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({ _id: '507f1f77bcf86cd799439011' })
    });
    const organizationsCollection = makeFakeCollection({ findOne: vi.fn().mockResolvedValue(null) });
    const patientsCollection = makeFakeCollection();
    const db = makeFakeDb({
      patients: patientsCollection,
      consent_templates: consentTemplatesCollection,
      organizations: organizationsCollection
    });

    const result = await patientService.createPatient(db, validPatientData({ clinicalUnit: 'unidade de terapia intensiva' }), {
      skipConsentNotification: true,
      skipBiomarkerArtifacts: true
    });

    expect(result.unitAcronym).toBe(result.unitAcronym.toUpperCase());
    expect(result.unitAcronym.length).toBeGreaterThan(0);
  });

  it('enqueues the consent notification and stamps consentNotifiedAt when not skipped', async () => {
    const consentTemplatesCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({ _id: '507f1f77bcf86cd799439011' })
    });
    const patientsCollection = makeFakeCollection();
    const db = makeFakeDb({ patients: patientsCollection, consent_templates: consentTemplatesCollection });

    const enqueueSpy = vi.spyOn(notificationService, 'enqueueConsentNotification').mockResolvedValue(undefined);

    await patientService.createPatient(db, validPatientData(), { skipBiomarkerArtifacts: true });

    expect(enqueueSpy).toHaveBeenCalled();
    const secondUpdateCall = patientsCollection.updateOne.mock.calls.find(
      (call) => call[1]?.$set?.consentNotifiedAt
    );
    expect(secondUpdateCall).toBeDefined();

    enqueueSpy.mockRestore();
  });

  it('swallows a notification failure instead of rejecting patient creation', async () => {
    const consentTemplatesCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({ _id: '507f1f77bcf86cd799439011' })
    });
    const patientsCollection = makeFakeCollection();
    const db = makeFakeDb({ patients: patientsCollection, consent_templates: consentTemplatesCollection });

    const enqueueSpy = vi.spyOn(notificationService, 'enqueueConsentNotification').mockRejectedValue(new Error('smtp down'));

    const result = await patientService.createPatient(db, validPatientData(), { skipBiomarkerArtifacts: true });

    expect(result.participantId).toMatch(/^\d{8}$/);

    enqueueSpy.mockRestore();
  });

  it('converts a phone duplicate-key error surfaced during insert into a 409', async () => {
    const consentTemplatesCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({ _id: '507f1f77bcf86cd799439011' })
    });
    const duplicateKeyError = Object.assign(new Error('E11000 duplicate key'), {
      code: 11000,
      keyPattern: { phone: 1 },
      keyValue: { phone: '11999999999' }
    });
    const patientsCollection = makeFakeCollection({
      insertOne: vi.fn().mockRejectedValue(duplicateKeyError)
    });
    const db = makeFakeDb({ patients: patientsCollection, consent_templates: consentTemplatesCollection });

    await expect(
      patientService.createPatient(db, validPatientData({ phone: '11999999999' }), {
        skipConsentNotification: true,
        skipBiomarkerArtifacts: true
      })
    ).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('11999999999') });
  });
});

describe('PatientService.updatePatient additional branches', () => {
  it('rejects when the new email is invalid', async () => {
    const db = makeFakeDb();
    await expect(
      patientService.updatePatient(db, '12345678', { email: 'not-an-email' })
    ).rejects.toThrow('Email (email) inválido');
  });

  it('rejects when the new phone has too few digits', async () => {
    const db = makeFakeDb();
    await expect(
      patientService.updatePatient(db, '12345678', { phone: '123' })
    ).rejects.toThrow('Telefone (phone) inválido');
  });

  it('resolves and merges a clinicalUnit snapshot into updateData', async () => {
    const organizationsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({ organizationId: 'unit-1', officialName: 'UTI Adulto', acronym: 'UTIA' })
    });
    const patientsCollection = makeFakeCollection({
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
      findOne: vi.fn().mockResolvedValue({ patientID: '12345678' })
    });
    const db = makeFakeDb({ patients: patientsCollection, organizations: organizationsCollection });
    const tsSpy = vi.spyOn(patientBiomarkerTimeseriesService, 'writePatientBiomarkers').mockResolvedValue(undefined);

    await patientService.updatePatient(db, '12345678', { clinicalUnit: 'UTI Adulto' });

    const setPayload = patientsCollection.updateOne.mock.calls[0][1].$set;
    expect(setPayload.clinicalUnit).toBe('UTI Adulto');
    expect(setPayload.unitAcronym).toBe('UTIA');

    tsSpy.mockRestore();
  });

  it('merges representativeEmail from the existing patient record when re-affirming isDeceased (issue #90)', async () => {
    const patientsCollection = makeFakeCollection({
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
      findOne: vi.fn().mockResolvedValue({
        patientID: '12345678',
        isDeceased: true,
        representativeName: 'João Representante',
        representativeEmail: 'joao@example.com',
        representativeIdentityDocument: '52998224725',
        representativePhone: '11988887777'
      })
    });
    const db = makeFakeDb({ patients: patientsCollection });
    const tsSpy = vi.spyOn(patientBiomarkerTimeseriesService, 'writePatientBiomarkers').mockResolvedValue(undefined);

    await patientService.updatePatient(db, '12345678', { isDeceased: true });

    const setPayload = patientsCollection.updateOne.mock.calls[0][1].$set;
    expect(setPayload.representativeEmail).toBe('joao@example.com');

    tsSpy.mockRestore();
  });

  it('converts a height value under 3 (meters) to centimeters', async () => {
    const patientsCollection = makeFakeCollection({
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
      findOne: vi.fn().mockResolvedValue({ patientID: '12345678' })
    });
    const db = makeFakeDb({ patients: patientsCollection });
    const tsSpy = vi.spyOn(patientBiomarkerTimeseriesService, 'writePatientBiomarkers').mockResolvedValue(undefined);

    await patientService.updatePatient(db, '12345678', { height: 1.75 });

    const setPayload = patientsCollection.updateOne.mock.calls[0][1].$set;
    expect(setPayload.heightCm).toBe(175);
    expect(setPayload.height).toBeUndefined();

    tsSpy.mockRestore();
  });

  it('keeps a height value already in centimeters unconverted', async () => {
    const patientsCollection = makeFakeCollection({
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
      findOne: vi.fn().mockResolvedValue({ patientID: '12345678' })
    });
    const db = makeFakeDb({ patients: patientsCollection });
    const tsSpy = vi.spyOn(patientBiomarkerTimeseriesService, 'writePatientBiomarkers').mockResolvedValue(undefined);

    await patientService.updatePatient(db, '12345678', { height: 175 });

    const setPayload = patientsCollection.updateOne.mock.calls[0][1].$set;
    expect(setPayload.heightCm).toBe(175);

    tsSpy.mockRestore();
  });

  it('queries by ObjectId when patientID is not an 8-digit string', async () => {
    const objectIdHex = '507f1f77bcf86cd799439011';
    const patientsCollection = makeFakeCollection({
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
      findOne: vi.fn().mockResolvedValue({ patientID: '12345678' })
    });
    const db = makeFakeDb({ patients: patientsCollection });
    const tsSpy = vi.spyOn(patientBiomarkerTimeseriesService, 'writePatientBiomarkers').mockResolvedValue(undefined);

    await patientService.updatePatient(db, objectIdHex, { alphaGal: 2.0 });

    const updateQuery = patientsCollection.updateOne.mock.calls[0][0];
    expect(updateQuery).toHaveProperty('_id');

    tsSpy.mockRestore();
  });

  it('converts a phone duplicate-key error surfaced during update into a 409', async () => {
    const duplicateKeyError = Object.assign(new Error('E11000 duplicate key'), {
      code: 11000,
      keyPattern: { phone: 1 },
      keyValue: { phone: '11999999999' }
    });
    const patientsCollection = makeFakeCollection({
      updateOne: vi.fn().mockRejectedValue(duplicateKeyError)
    });
    const db = makeFakeDb({ patients: patientsCollection });

    await expect(
      patientService.updatePatient(db, '12345678', { phone: '11999999999' })
    ).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('11999999999') });
  });
});
