import { describe, it, expect, vi, afterEach } from 'vitest';

process.env.ENCRYPTION_KEY = 'dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGtleXQ=';
process.env.ENCRYPTION_KEY_ID = 'test-key-1';

const patientService = require('../../src/services/patient.service');
const notificationService = require('../../src/services/notification.service');

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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PatientService.getPatient', () => {
  it('queries by participantId when an 8-digit string is provided', async () => {
    const patientsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({ participantId: '12345678', patientName: 'Ana' })
    });
    const db = makeFakeDb({ patients: patientsCollection });

    const result = await patientService.getPatient(db, '12345678');

    expect(patientsCollection.findOne).toHaveBeenCalledWith({ participantId: '12345678' });
    expect(result.participantId).toBe('12345678');
  });

  it('queries by ObjectId when the identifier is not an 8-digit string', async () => {
    const objectIdHex = '507f1f77bcf86cd799439011';
    const patientsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({ participantId: '12345678' })
    });
    const db = makeFakeDb({ patients: patientsCollection });

    await patientService.getPatient(db, objectIdHex);

    const callArg = patientsCollection.findOne.mock.calls[0][0];
    expect(callArg).toHaveProperty('_id');
  });
});

describe('PatientService.listPatients', () => {
  it('applies patientName and clinicalUnit filters and default limit/skip', async () => {
    // RF005/RNF007 (#575): patientName resolves via ParticipantIdentity to a
    // participantId $in filter, not a direct field match on Patient.
    const identitiesCollection = makeFakeCollection({
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ participantId: '12345678', patientName: 'Maria' }])
      })
    });
    const patientsCollection = makeFakeCollection({
      find: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([{ participantId: '12345678' }])
      }),
      countDocuments: vi.fn().mockResolvedValue(1)
    });
    const db = makeFakeDb({ patients: patientsCollection, participantIdentities: identitiesCollection });

    const result = await patientService.listPatients(db, { patientName: 'Maria', clinicalUnit: 'UTI' });

    expect(identitiesCollection.find).toHaveBeenCalledWith({ patientName: { $regex: 'Maria', $options: 'i' } });
    const queryArg = patientsCollection.find.mock.calls[0][0];
    expect(queryArg.participantId).toEqual({ $in: ['12345678'] });
    expect(queryArg.clinicalUnit).toBe('UTI');
    expect(result.limit).toBe(50);
    expect(result.skip).toBe(0);
    expect(result.total).toBe(1);
  });

  it('honors an explicit limit and skip and omits name/unit filters when absent', async () => {
    const patientsCollection = makeFakeCollection();
    const db = makeFakeDb({ patients: patientsCollection });

    const result = await patientService.listPatients(db, { limit: 5, skip: 10 });

    const queryArg = patientsCollection.find.mock.calls[0][0];
    expect(queryArg).not.toHaveProperty('patientName');
    expect(queryArg).not.toHaveProperty('clinicalUnit');
    expect(result.limit).toBe(5);
    expect(result.skip).toBe(10);
  });
});

describe('PatientService.searchPatients', () => {
  it('returns an empty result for a blank search term', async () => {
    const db = makeFakeDb();

    const result = await patientService.searchPatients(db, '   ');

    expect(result).toEqual({ patients: [], total: 0 });
  });

  it('adds a participantId clause for an 8-digit numeric term', async () => {
    const patientsCollection = makeFakeCollection();
    const db = makeFakeDb({ patients: patientsCollection });

    await patientService.searchPatients(db, '12345678');

    const queryArg = patientsCollection.find.mock.calls[0][0];
    expect(queryArg.$or).toContainEqual({ participantId: '12345678' });
  });

  it('parses a DD/MM/YYYY date term into a birthDate range clause', async () => {
    // RF005/RNF007 (#575): birthDate matching queries ParticipantIdentity;
    // a hit there becomes a participantId $in clause on the Patient query.
    const identitiesCollection = makeFakeCollection({
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ participantId: '11112222' }])
      })
    });
    const patientsCollection = makeFakeCollection();
    const db = makeFakeDb({ patients: patientsCollection, participantIdentities: identitiesCollection });

    await patientService.searchPatients(db, '15/06/1990');

    const identityQueryArg = identitiesCollection.find.mock.calls[0][0];
    expect(identityQueryArg.birthDate.$gte).toEqual(new Date(1990, 5, 15));
    expect(identityQueryArg.birthDate.$lt).toEqual(new Date(1990, 5, 16));

    const queryArg = patientsCollection.find.mock.calls[0][0];
    const participantClause = queryArg.$or.find((clause) => clause.participantId && clause.participantId.$in);
    expect(participantClause).toEqual({ participantId: { $in: ['11112222'] } });
  });

  it('does not add a birthDate clause for a malformed DD/MM/YYYY term', async () => {
    const patientsCollection = makeFakeCollection();
    const db = makeFakeDb({ patients: patientsCollection });

    await patientService.searchPatients(db, 'aa/bb/cccc');

    const queryArg = patientsCollection.find.mock.calls[0][0];
    const birthClause = queryArg.$or.find((clause) => clause.birthDate);
    expect(birthClause).toBeUndefined();
  });

  it('parses a YYYY-MM-DD date term into a birthDate range clause', async () => {
    // RF005/RNF007 (#575): birthDate matching queries ParticipantIdentity;
    // a hit there becomes a participantId $in clause on the Patient query.
    const identitiesCollection = makeFakeCollection({
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ participantId: '33334444' }])
      })
    });
    const patientsCollection = makeFakeCollection();
    const db = makeFakeDb({ patients: patientsCollection, participantIdentities: identitiesCollection });

    await patientService.searchPatients(db, '1990-06-15');

    // The source parses the term with `new Date(term)` (UTC midnight) then reconstructs
    // start/end from its *local* year/month/date components, so the expected value must
    // be derived the same way rather than assuming the literal calendar date survives.
    const parsedUtc = new Date('1990-06-15');
    const expectedStart = new Date(parsedUtc.getFullYear(), parsedUtc.getMonth(), parsedUtc.getDate());

    const identityQueryArg = identitiesCollection.find.mock.calls[0][0];
    expect(identityQueryArg.birthDate.$gte).toEqual(expectedStart);

    const queryArg = patientsCollection.find.mock.calls[0][0];
    const participantClause = queryArg.$or.find((clause) => clause.participantId && clause.participantId.$in);
    expect(participantClause).toEqual({ participantId: { $in: ['33334444'] } });
  });

  it('does not add a birthDate clause for an invalid YYYY-MM-DD term', async () => {
    const patientsCollection = makeFakeCollection();
    const db = makeFakeDb({ patients: patientsCollection });

    await patientService.searchPatients(db, 'not-a-date');

    const queryArg = patientsCollection.find.mock.calls[0][0];
    const birthClause = queryArg.$or.find((clause) => clause.birthDate);
    expect(birthClause).toBeUndefined();
  });

  it('returns decrypted patients and total from the query results', async () => {
    const patientsCollection = makeFakeCollection({
      find: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([{ participantId: '12345678', patientName: 'Ana' }])
      }),
      countDocuments: vi.fn().mockResolvedValue(1)
    });
    const db = makeFakeDb({ patients: patientsCollection });

    const result = await patientService.searchPatients(db, 'Ana');

    expect(result.total).toBe(1);
    expect(result.patients).toHaveLength(1);
  });
});

describe('PatientService.updatePatient error/query branches', () => {
  it('throws "Paciente não encontrado" when matchedCount is 0', async () => {
    const patientsCollection = makeFakeCollection({
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 0 })
    });
    const db = makeFakeDb({ patients: patientsCollection });

    await expect(
      patientService.updatePatient(db, '12345678', { patientName: 'Nova' })
    ).rejects.toThrow('Paciente não encontrado');
  });

  it('queries by participantId (not ObjectId) for an 8-digit identifier', async () => {
    const patientsCollection = makeFakeCollection({
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
      findOne: vi.fn().mockResolvedValue({ participantId: '12345678' })
    });
    const db = makeFakeDb({ patients: patientsCollection });

    await patientService.updatePatient(db, '12345678', { patientName: 'Nova' });

    const updateQuery = patientsCollection.updateOne.mock.calls[0][0];
    expect(updateQuery).toEqual({ participantId: '12345678' });
  });
});

describe('PatientService.validateConsentToken', () => {
  it('rejects when participantId or token is missing', async () => {
    const db = makeFakeDb();
    await expect(patientService.validateConsentToken(db, null, 'tok')).rejects.toThrow(
      'participantId e token são obrigatórios'
    );
    await expect(patientService.validateConsentToken(db, '12345678', null)).rejects.toThrow(
      'participantId e token são obrigatórios'
    );
  });

  it('rejects when the patient is not found', async () => {
    const patientsCollection = makeFakeCollection({ findOne: vi.fn().mockResolvedValue(null) });
    const db = makeFakeDb({ patients: patientsCollection });

    await expect(patientService.validateConsentToken(db, '12345678', 'tok')).rejects.toThrow(
      'Paciente não encontrado'
    );
  });

  it('rejects when the patient status is not PENDING_CONSENT', async () => {
    const patientsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({ participantId: '12345678', status: 'ACTIVE' })
    });
    const db = makeFakeDb({ patients: patientsCollection });

    await expect(patientService.validateConsentToken(db, '12345678', 'tok')).rejects.toThrow(
      'Paciente não está pendente de consentimento'
    );
  });

  it('rejects when the token does not match', async () => {
    const patientsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({
        participantId: '12345678',
        status: 'PENDING_CONSENT',
        consentToken: 'right-token'
      })
    });
    const db = makeFakeDb({ patients: patientsCollection });

    await expect(patientService.validateConsentToken(db, '12345678', 'wrong-token')).rejects.toThrow(
      'Token inválido'
    );
  });

  it('rejects when the patient has no consentToken stored', async () => {
    const patientsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({
        participantId: '12345678',
        status: 'PENDING_CONSENT',
        consentToken: null
      })
    });
    const db = makeFakeDb({ patients: patientsCollection });

    await expect(patientService.validateConsentToken(db, '12345678', 'tok')).rejects.toThrow(
      'Token inválido'
    );
  });

  it('rejects when the token is expired', async () => {
    const patientsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({
        participantId: '12345678',
        status: 'PENDING_CONSENT',
        consentToken: 'tok',
        consentTokenExpiresAt: new Date(Date.now() - 60000)
      })
    });
    const db = makeFakeDb({ patients: patientsCollection });

    await expect(patientService.validateConsentToken(db, '12345678', 'tok')).rejects.toThrow(
      'Token expirado'
    );
  });

  it('resolves with valid: true for a matching, unexpired token', async () => {
    const patientsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({
        participantId: '12345678',
        status: 'PENDING_CONSENT',
        consentToken: 'tok',
        consentTokenExpiresAt: new Date(Date.now() + 60000)
      })
    });
    const db = makeFakeDb({ patients: patientsCollection });

    const result = await patientService.validateConsentToken(db, '12345678', 'tok');

    expect(result).toEqual({ valid: true, participantId: '12345678' });
  });
});

describe('PatientService.acceptConsentToken', () => {
  it('activates the patient and clears the consent token after validating it', async () => {
    const patientsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({
        participantId: '12345678',
        status: 'PENDING_CONSENT',
        consentToken: 'tok',
        consentTokenExpiresAt: new Date(Date.now() + 60000)
      }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 })
    });
    const db = makeFakeDb({ patients: patientsCollection });

    const result = await patientService.acceptConsentToken(db, '12345678', 'tok');

    expect(result).toEqual({ success: true, participantId: '12345678' });
    const setPayload = patientsCollection.updateOne.mock.calls[0][1].$set;
    expect(setPayload.status).toBe('ACTIVE');
    expect(setPayload.consentToken).toBeNull();
  });

  it('propagates the validation error and never calls updateOne when the token is invalid', async () => {
    const patientsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({
        participantId: '12345678',
        status: 'PENDING_CONSENT',
        consentToken: 'right-token'
      })
    });
    const db = makeFakeDb({ patients: patientsCollection });

    await expect(patientService.acceptConsentToken(db, '12345678', 'wrong-token')).rejects.toThrow(
      'Token inválido'
    );
    expect(patientsCollection.updateOne).not.toHaveBeenCalled();
  });
});

describe('PatientService.resendConsentNotification', () => {
  it('rejects when participantId is missing', async () => {
    const db = makeFakeDb();
    await expect(patientService.resendConsentNotification(db, null)).rejects.toThrow(
      'participantId é obrigatório'
    );
  });

  it('rejects when the patient is not found', async () => {
    const patientsCollection = makeFakeCollection({ findOne: vi.fn().mockResolvedValue(null) });
    const db = makeFakeDb({ patients: patientsCollection });

    await expect(patientService.resendConsentNotification(db, '12345678')).rejects.toThrow(
      'Paciente não encontrado'
    );
  });

  it('rejects when the patient status is not PENDING_CONSENT', async () => {
    const patientsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({ participantId: '12345678', status: 'ACTIVE' })
    });
    const db = makeFakeDb({ patients: patientsCollection });

    await expect(patientService.resendConsentNotification(db, '12345678')).rejects.toThrow(
      'Paciente não está pendente de consentimento'
    );
  });

  it('reuses an existing unexpired token instead of generating a new one', async () => {
    const futureExpiry = new Date(Date.now() + 60000);
    const patientsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({
        _id: 'p1',
        participantId: '12345678',
        status: 'PENDING_CONSENT',
        consentToken: 'existing-token',
        consentTokenExpiresAt: futureExpiry
      }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 })
    });
    const db = makeFakeDb({ patients: patientsCollection });

    const buildMetadataSpy = vi.spyOn(notificationService, 'buildConsentMetadata');
    vi.spyOn(notificationService, 'buildConsentLink').mockReturnValue('http://link');
    vi.spyOn(notificationService, 'enqueueConsentNotification').mockResolvedValue(undefined);

    const result = await patientService.resendConsentNotification(db, '12345678');

    expect(buildMetadataSpy).not.toHaveBeenCalled();
    expect(result.reusedToken).toBe(true);
    expect(result.consentTokenExpiresAt).toEqual(futureExpiry);
    const setPayload = patientsCollection.updateOne.mock.calls[0][1].$set;
    expect(setPayload).not.toHaveProperty('consentToken');
  });

  it('generates a new token when there is no valid existing one', async () => {
    const newExpiry = new Date(Date.now() + 3600000);
    const patientsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({
        _id: 'p1',
        participantId: '12345678',
        status: 'PENDING_CONSENT',
        consentToken: null,
        consentTokenExpiresAt: null
      }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 })
    });
    const db = makeFakeDb({ patients: patientsCollection });

    vi.spyOn(notificationService, 'buildConsentMetadata').mockReturnValue({
      token: 'new-token',
      createdAt: new Date(),
      expiresAt: newExpiry
    });
    vi.spyOn(notificationService, 'buildConsentLink').mockReturnValue('http://link');
    vi.spyOn(notificationService, 'enqueueConsentNotification').mockResolvedValue(undefined);

    const result = await patientService.resendConsentNotification(db, '12345678');

    expect(result.reusedToken).toBe(false);
    expect(result.consentTokenExpiresAt).toEqual(newExpiry);
    const setPayload = patientsCollection.updateOne.mock.calls[0][1].$set;
    expect(setPayload.consentToken).toBe('new-token');
  });

  it('generates a new token when the existing token has expired', async () => {
    const pastExpiry = new Date(Date.now() - 60000);
    const newExpiry = new Date(Date.now() + 3600000);
    const patientsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({
        _id: 'p1',
        participantId: '12345678',
        status: 'PENDING_CONSENT',
        consentToken: 'stale-token',
        consentTokenExpiresAt: pastExpiry
      }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 })
    });
    const db = makeFakeDb({ patients: patientsCollection });

    vi.spyOn(notificationService, 'buildConsentMetadata').mockReturnValue({
      token: 'fresh-token',
      createdAt: new Date(),
      expiresAt: newExpiry
    });
    vi.spyOn(notificationService, 'buildConsentLink').mockReturnValue('http://link');
    vi.spyOn(notificationService, 'enqueueConsentNotification').mockResolvedValue(undefined);

    const result = await patientService.resendConsentNotification(db, '12345678');

    expect(result.reusedToken).toBe(false);
    const setPayload = patientsCollection.updateOne.mock.calls[0][1].$set;
    expect(setPayload.consentToken).toBe('fresh-token');
  });
});

describe('PatientService.deletePatient', () => {
  it('queries by participantId for an 8-digit identifier and returns true on success', async () => {
    const patientsCollection = makeFakeCollection({
      deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 })
    });
    const db = makeFakeDb({ patients: patientsCollection });

    const result = await patientService.deletePatient(db, '12345678');

    expect(patientsCollection.deleteOne).toHaveBeenCalledWith({ participantId: '12345678' });
    expect(result).toBe(true);
  });

  it('queries by ObjectId for a non-8-digit identifier', async () => {
    const objectIdHex = '507f1f77bcf86cd799439011';
    const patientsCollection = makeFakeCollection({
      deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 })
    });
    const db = makeFakeDb({ patients: patientsCollection });

    await patientService.deletePatient(db, objectIdHex);

    const callArg = patientsCollection.deleteOne.mock.calls[0][0];
    expect(callArg).toHaveProperty('_id');
  });

  it('returns false when no document was deleted', async () => {
    const patientsCollection = makeFakeCollection({
      deleteOne: vi.fn().mockResolvedValue({ deletedCount: 0 })
    });
    const db = makeFakeDb({ patients: patientsCollection });

    const result = await patientService.deletePatient(db, '12345678');

    expect(result).toBe(false);
  });
});
