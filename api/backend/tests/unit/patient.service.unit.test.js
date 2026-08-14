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

describe('PatientService.getEncryptedFieldMap', () => {
  it('returns map with expected fields', () => {
    const map = patientService.getEncryptedFieldMap();
    expect(map).toHaveProperty('representativeIdentityDocument', 'representativeIdentityDocumentEncrypted');
  });
});

describe('PatientService.encryptSensitivePatientFields', () => {
  it('returns unchanged object when no sensitive fields present', () => {
    const patient = { patientID: '12345678', name: 'João' };
    const result = patientService.encryptSensitivePatientFields(patient);
    expect(result.patientID).toBe('12345678');
    expect(result.name).toBe('João');
  });

  it('encrypts representativeIdentityDocument field', () => {
    const patient = { representativeIdentityDocument: '123.456.789-00' };
    const result = patientService.encryptSensitivePatientFields(patient);
    expect(result.representativeIdentityDocument).toBeNull();
    expect(result.representativeIdentityDocumentEncrypted).toBeDefined();
  });

  it('does not mutate original patient object', () => {
    const patient = { alphaGal: 2.0 };
    patientService.encryptSensitivePatientFields(patient);
    expect(patient.alphaGal).toBe(2.0);
  });

  it('handles empty patient object', () => {
    const result = patientService.encryptSensitivePatientFields({});
    expect(result).toBeDefined();
    expect(Object.keys(result)).toHaveLength(0);
  });
});

describe('PatientService.decryptSensitivePatientFields', () => {
  it('returns non-object input unchanged', () => {
    expect(patientService.decryptSensitivePatientFields(null)).toBeNull();
    expect(patientService.decryptSensitivePatientFields('string')).toBe('string');
  });

  it('roundtrip: encrypt then decrypt restores original value', () => {
    const patient = { patientID: '12345678', alphaGal: 4.7 };
    const encrypted = patientService.encryptSensitivePatientFields(patient);
    const decrypted = patientService.decryptSensitivePatientFields(encrypted);
    expect(decrypted.alphaGal).toBe(4.7);
  });

  it('roundtrip for string field', () => {
    const patient = { representativeIdentityDocument: '529.982.247-25' };
    const encrypted = patientService.encryptSensitivePatientFields(patient);
    const decrypted = patientService.decryptSensitivePatientFields(encrypted);
    expect(decrypted.representativeIdentityDocument).toBe('529.982.247-25');
  });

  it('preserves plain field when it already has a value', () => {
    const patient = { alphaGal: 5.0, alphaGalEncrypted: null };
    const result = patientService.decryptSensitivePatientFields(patient);
    expect(result.alphaGal).toBe(5.0);
  });

  it('returns copy without mutating input', () => {
    const patient = { alphaGal: 3.0 };
    const encrypted = patientService.encryptSensitivePatientFields(patient);
    const original = { ...encrypted };
    patientService.decryptSensitivePatientFields(encrypted);
    expect(encrypted.alphaGalEncrypted).toEqual(original.alphaGalEncrypted);
  });
});

describe('PatientService.normalizeClinicalUnit', () => {
  it('returns null for undefined', () => {
    expect(patientService.normalizeClinicalUnit(undefined)).toBeNull();
  });

  it('returns null for null', () => {
    expect(patientService.normalizeClinicalUnit(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(patientService.normalizeClinicalUnit('')).toBeNull();
  });

  it('uppercases the value', () => {
    expect(patientService.normalizeClinicalUnit('uti-a')).toBe('UTI-A');
  });

  it('trims whitespace', () => {
    expect(patientService.normalizeClinicalUnit('  UTI-B  ')).toBe('UTI-B');
  });
});

describe('PatientService.handlePhoneUniqueConstraint', () => {
  it('does nothing when error has no phone duplicate pattern', () => {
    const error = { code: 11000, keyPattern: { name: 1 }, keyValue: {} };
    expect(() => patientService.handlePhoneUniqueConstraint(error)).not.toThrow();
  });

  it('throws 409 when phone is in keyPattern', () => {
    const error = { code: 11000, keyPattern: { phone: 1 }, keyValue: { phone: '11999999999' } };
    try {
      patientService.handlePhoneUniqueConstraint(error);
      expect(true).toBe(false); // should not reach here
    } catch (e) {
      expect(e.statusCode).toBe(409);
      expect(e.message).toContain('11999999999');
    }
  });

  it('throws 409 when phone is in keyValue', () => {
    const error = { code: 11000, keyPattern: {}, keyValue: { phone: '11888888888' } };
    try {
      patientService.handlePhoneUniqueConstraint(error);
      expect(true).toBe(false);
    } catch (e) {
      expect(e.statusCode).toBe(409);
    }
  });
});

describe('PatientService.createPatient', () => {
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

  it('creates a patient with a generated 8-digit patientID and PENDING_CONSENT status', async () => {
    const patientsCollection = makeFakeCollection();
    const consentTemplatesCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({ _id: '507f1f77bcf86cd799439011', name: 'Template' })
    });
    const db = makeFakeDb({ patients: patientsCollection, consent_templates: consentTemplatesCollection });

    const encryptSpy = vi.spyOn(patientService, 'encryptSensitivePatientFields');

    const result = await patientService.createPatient(db, validPatientData({
      isDeceased: true,
      representativeName: 'João Representante',
      representativeEmail: 'joao@example.com',
      representativeIdentityDocument: '529.982.247-25',
      representativePhone: '11988887777'
    }), {
      skipConsentNotification: true,
      skipBiomarkerArtifacts: true
    });

    expect(result.participantId).toMatch(/^\d{8}$/);
    expect(result.status).toBe('PENDING_CONSENT');
    expect(patientsCollection.insertOne).toHaveBeenCalledTimes(1);
    expect(encryptSpy).toHaveBeenCalled();

    const insertedDoc = patientsCollection.insertOne.mock.calls[0][0];
    // Sensitive field must be encrypted (nulled out in plain form) before insert.
    expect(insertedDoc.representativeIdentityDocument).toBeNull();
    expect(insertedDoc.representativeIdentityDocumentEncrypted).toBeDefined();

    encryptSpy.mockRestore();
  });

  it('rejects creation when an identifier conflict (duplicate identityDocument) exists', async () => {
    // RF005/RNF007 (#575): identityDocument conflicts are checked against
    // ParticipantIdentity, not the Patient collection.
    const identitiesCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({ _id: 'x', identityDocument: '52998224725' })
    });
    const patientsCollection = makeFakeCollection();
    const consentTemplatesCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({ _id: '507f1f77bcf86cd799439011' })
    });
    const db = makeFakeDb({
      patients: patientsCollection,
      participantIdentities: identitiesCollection,
      consent_templates: consentTemplatesCollection
    });

    await expect(
      patientService.createPatient(db, validPatientData({ identityDocument: '529.982.247-25' }), {
        skipConsentNotification: true,
        skipBiomarkerArtifacts: true
      })
    ).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('identityDocument') });

    expect(patientsCollection.insertOne).not.toHaveBeenCalled();
  });
});

describe('PatientService.getPatient', () => {
  it('returns a decrypted patient when found by 8-digit participantId', async () => {
    const encrypted = patientService.encryptSensitivePatientFields({ participantId: '12345678', alphaGal: 4.2 });
    const patientsCollection = makeFakeCollection({ findOne: vi.fn().mockResolvedValue(encrypted) });
    const db = makeFakeDb({ patients: patientsCollection });

    const result = await patientService.getPatient(db, '12345678');

    expect(patientsCollection.findOne).toHaveBeenCalledWith({ participantId: '12345678' });
    expect(result.alphaGal).toBe(4.2);
  });

  it('returns null when patient is not found', async () => {
    const patientsCollection = makeFakeCollection({ findOne: vi.fn().mockResolvedValue(null) });
    const db = makeFakeDb({ patients: patientsCollection });

    const result = await patientService.getPatient(db, '99999999');

    expect(result).toBeNull();
  });
});

describe('PatientService.listPatients', () => {
  it('passes patientName and clinicalUnit filters into the collection query and returns pagination shape', async () => {
    // RF005/RNF007 (#575): patientName resolves via ParticipantIdentity to a
    // participantId $in filter, not a direct field match on Patient.
    const toArrayMock = vi.fn().mockResolvedValue([{ participantId: '12345678' }]);
    const findMock = vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      toArray: toArrayMock
    });
    const identitiesCollection = makeFakeCollection({
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ participantId: '12345678', patientName: 'Maria' }])
      })
    });
    const patientsCollection = makeFakeCollection({
      find: findMock,
      countDocuments: vi.fn().mockResolvedValue(1)
    });
    const db = makeFakeDb({ patients: patientsCollection, participantIdentities: identitiesCollection });

    const result = await patientService.listPatients(db, { patientName: 'Maria', clinicalUnit: 'UTI-A', limit: 10, skip: 5 });

    expect(findMock).toHaveBeenCalledWith({
      participantId: { $in: ['12345678'] },
      clinicalUnit: 'UTI-A'
    });
    expect(result.total).toBe(1);
    expect(result.limit).toBe(10);
    expect(result.skip).toBe(5);
    expect(result.patients).toHaveLength(1);
  });

  it('defaults limit/skip and query when no filters provided', async () => {
    const findMock = vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([])
    });
    const patientsCollection = makeFakeCollection({ find: findMock });
    const db = makeFakeDb({ patients: patientsCollection });

    const result = await patientService.listPatients(db);

    expect(findMock).toHaveBeenCalledWith({});
    expect(result.limit).toBe(50);
    expect(result.skip).toBe(0);
  });
});

describe('PatientService.searchPatients', () => {
  it('returns empty result for an empty search term without querying the collection', async () => {
    const patientsCollection = makeFakeCollection();
    const db = makeFakeDb({ patients: patientsCollection });

    const result = await patientService.searchPatients(db, '   ');

    expect(result).toEqual({ patients: [], total: 0 });
    expect(patientsCollection.find).not.toHaveBeenCalled();
  });

  it('searches by recordNumber/clinicalUnit/etc for a normal term', async () => {
    const findMock = vi.fn().mockReturnValue({ limit: vi.fn().mockReturnThis(), toArray: vi.fn().mockResolvedValue([{ patientID: '12345678' }]) });
    const patientsCollection = makeFakeCollection({ find: findMock, countDocuments: vi.fn().mockResolvedValue(1) });
    const db = makeFakeDb({ patients: patientsCollection });

    const result = await patientService.searchPatients(db, 'UTI-A');

    expect(findMock).toHaveBeenCalled();
    const passedQuery = findMock.mock.calls[0][0];
    expect(passedQuery.$or).toEqual(
      expect.arrayContaining([{ clinicalUnit: { $regex: 'UTI-A', $options: 'i' } }])
    );
    expect(result.total).toBe(1);
    expect(result.patients).toHaveLength(1);
  });
});

describe('PatientService.updatePatient', () => {
  it('encrypts sensitive fields in updateData before writing and returns success', async () => {
    const patientsCollection = makeFakeCollection({
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
      findOne: vi.fn().mockResolvedValue({ patientID: '12345678', phone: '11999999999' })
    });
    const db = makeFakeDb({ patients: patientsCollection });
    const tsSpy = vi.spyOn(patientBiomarkerTimeseriesService, 'writePatientBiomarkers').mockResolvedValue(undefined);

    const result = await patientService.updatePatient(db, '12345678', { representativeIdentityDocument: '529.982.247-25' });

    expect(result).toEqual({ success: true });
    // First updateOne call is the actual patient update; its $set must have the sensitive field encrypted.
    const firstUpdateCall = patientsCollection.updateOne.mock.calls[0];
    expect(firstUpdateCall[1].$set.representativeIdentityDocument).toBeNull();
    expect(firstUpdateCall[1].$set.representativeIdentityDocumentEncrypted).toBeDefined();

    tsSpy.mockRestore();
  });

  it('rejects update when patient is not found (matchedCount 0)', async () => {
    const patientsCollection = makeFakeCollection({
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 0 })
    });
    const db = makeFakeDb({ patients: patientsCollection });

    await expect(patientService.updatePatient(db, '12345678', { alphaGal: 1.0 })).rejects.toThrow('Paciente não encontrado');
  });
});

describe('PatientService.deletePatient', () => {
  it('returns true when a patient was deleted', async () => {
    const patientsCollection = makeFakeCollection({
      deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 })
    });
    const db = makeFakeDb({ patients: patientsCollection });

    const result = await patientService.deletePatient(db, '12345678');

    expect(patientsCollection.deleteOne).toHaveBeenCalledWith({ participantId: '12345678' });
    expect(result).toBe(true);
  });

  it('returns false when no patient matched for deletion', async () => {
    const patientsCollection = makeFakeCollection({
      deleteOne: vi.fn().mockResolvedValue({ deletedCount: 0 })
    });
    const db = makeFakeDb({ patients: patientsCollection });

    const result = await patientService.deletePatient(db, '99999999');

    expect(result).toBe(false);
  });
});

describe('PatientService.validateConsentToken', () => {
  it('throws when patientID or token is missing', async () => {
    const db = makeFakeDb({});
    await expect(patientService.validateConsentToken(db, null, 'tok')).rejects.toThrow('obrigatórios');
    await expect(patientService.validateConsentToken(db, '12345678', null)).rejects.toThrow('obrigatórios');
  });

  it('throws when the patient is not found', async () => {
    const patientsCollection = makeFakeCollection({ findOne: vi.fn().mockResolvedValue(null) });
    const db = makeFakeDb({ patients: patientsCollection });

    await expect(patientService.validateConsentToken(db, '12345678', 'tok')).rejects.toThrow('não encontrado');
  });

  it('throws when the patient is not pending consent', async () => {
    const patientsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({ patientID: '12345678', status: 'ACTIVE' })
    });
    const db = makeFakeDb({ patients: patientsCollection });

    await expect(patientService.validateConsentToken(db, '12345678', 'tok')).rejects.toThrow('não está pendente');
  });

  it('throws when the token does not match', async () => {
    const patientsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({ patientID: '12345678', status: 'PENDING_CONSENT', consentToken: 'real-token' })
    });
    const db = makeFakeDb({ patients: patientsCollection });

    await expect(patientService.validateConsentToken(db, '12345678', 'wrong-token')).rejects.toThrow('Token inválido');
  });

  it('throws when the token has expired', async () => {
    const patientsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({
        patientID: '12345678',
        status: 'PENDING_CONSENT',
        consentToken: 'tok',
        consentTokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
      })
    });
    const db = makeFakeDb({ patients: patientsCollection });

    await expect(patientService.validateConsentToken(db, '12345678', 'tok')).rejects.toThrow('Token expirado');
  });

  it('returns valid:true for a matching, unexpired token', async () => {
    const patientsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({
        participantId: '12345678',
        status: 'PENDING_CONSENT',
        consentToken: 'tok',
        consentTokenExpiresAt: new Date(Date.now() + 100000).toISOString(),
      })
    });
    const db = makeFakeDb({ patients: patientsCollection });

    const result = await patientService.validateConsentToken(db, '12345678', 'tok');

    expect(result).toEqual({ valid: true, participantId: '12345678' });
  });
});

describe('PatientService.acceptConsentToken', () => {
  it('validates the token then activates the patient and clears the token', async () => {
    const patientsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({
        participantId: '12345678',
        status: 'PENDING_CONSENT',
        consentToken: 'tok',
      }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 })
    });
    const db = makeFakeDb({ patients: patientsCollection });

    const result = await patientService.acceptConsentToken(db, '12345678', 'tok');

    expect(result).toEqual({ success: true, participantId: '12345678' });
    expect(patientsCollection.updateOne).toHaveBeenCalledWith(
      { participantId: '12345678' },
      { $set: expect.objectContaining({ status: 'ACTIVE', consentToken: null, consentTokenExpiresAt: null }) }
    );
  });

  it('propagates validation failure without updating', async () => {
    const patientsCollection = makeFakeCollection({ findOne: vi.fn().mockResolvedValue(null) });
    const db = makeFakeDb({ patients: patientsCollection });

    await expect(patientService.acceptConsentToken(db, '12345678', 'tok')).rejects.toThrow('não encontrado');
    expect(patientsCollection.updateOne).not.toHaveBeenCalled();
  });
});

describe('PatientService.resendConsentNotification', () => {
  let buildMetaSpy, buildLinkSpy, enqueueSpy;

  beforeEach(() => {
    buildMetaSpy = vi.spyOn(notificationService, 'buildConsentMetadata').mockReturnValue({
      token: 'new-token',
      createdAt: new Date('2026-01-01'),
      expiresAt: new Date('2026-01-08'),
    });
    buildLinkSpy = vi.spyOn(notificationService, 'buildConsentLink').mockReturnValue('https://consent.link/new-token');
    enqueueSpy = vi.spyOn(notificationService, 'enqueueConsentNotification').mockResolvedValue(undefined);
  });

  afterEach(() => {
    buildMetaSpy.mockRestore();
    buildLinkSpy.mockRestore();
    enqueueSpy.mockRestore();
  });

  it('throws when patientID is missing', async () => {
    const db = makeFakeDb({});
    await expect(patientService.resendConsentNotification(db, null)).rejects.toThrow('obrigatório');
  });

  it('throws when the patient is not found', async () => {
    const patientsCollection = makeFakeCollection({ findOne: vi.fn().mockResolvedValue(null) });
    const db = makeFakeDb({ patients: patientsCollection });

    await expect(patientService.resendConsentNotification(db, '12345678')).rejects.toThrow('não encontrado');
  });

  it('throws when the patient is not pending consent', async () => {
    const patientsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({ patientID: '12345678', status: 'ACTIVE' })
    });
    const db = makeFakeDb({ patients: patientsCollection });

    await expect(patientService.resendConsentNotification(db, '12345678')).rejects.toThrow('não está pendente');
  });

  it('generates a new token when no valid token exists', async () => {
    const patientsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({ _id: 'p1', patientID: '12345678', status: 'PENDING_CONSENT' }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 })
    });
    const db = makeFakeDb({ patients: patientsCollection });

    const result = await patientService.resendConsentNotification(db, '12345678');

    expect(buildMetaSpy).toHaveBeenCalled();
    expect(result.reusedToken).toBe(false);
    expect(patientsCollection.updateOne).toHaveBeenCalledWith(
      { _id: 'p1' },
      { $set: expect.objectContaining({ consentToken: 'new-token' }) }
    );
  });

  it('resolves patientName via ParticipantIdentity before building/sending the notification (#561/#564)', async () => {
    const patientsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({ _id: 'p1', participantId: '12345678', status: 'PENDING_CONSENT' }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 })
    });
    const participantIdentitiesCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({ participantId: '12345678', patientName: 'Maria Silva' }),
    });
    const db = makeFakeDb({ patients: patientsCollection, participantIdentities: participantIdentitiesCollection });

    await patientService.resendConsentNotification(db, '12345678');

    expect(buildLinkSpy).toHaveBeenCalledWith(expect.objectContaining({ patientName: 'Maria Silva' }), expect.any(String));
    expect(enqueueSpy).toHaveBeenCalledWith(expect.objectContaining({ patientName: 'Maria Silva' }), expect.any(String));
  });

  it('reuses the existing token when it is still valid', async () => {
    const patientsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({
        _id: 'p1',
        patientID: '12345678',
        status: 'PENDING_CONSENT',
        consentToken: 'still-valid',
        consentTokenExpiresAt: new Date(Date.now() + 100000).toISOString(),
      }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 })
    });
    const db = makeFakeDb({ patients: patientsCollection });

    const result = await patientService.resendConsentNotification(db, '12345678');

    expect(result.reusedToken).toBe(true);
    expect(buildMetaSpy).not.toHaveBeenCalled();
    expect(buildLinkSpy).toHaveBeenCalledWith(expect.objectContaining({ patientID: '12345678' }), 'still-valid');
    const updatePayload = patientsCollection.updateOne.mock.calls[0][1].$set;
    expect(updatePayload.consentToken).toBeUndefined();
  });
});
