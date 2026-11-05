import { describe, it, expect, vi, afterEach } from 'vitest';

process.env.ENCRYPTION_KEY = 'dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGtleXQ=';
process.env.ENCRYPTION_KEY_ID = 'test-key-1';

const patientService = require('../../src/services/patient.service');
const notificationService = require('../../src/services/notification.service');
const { hashConsentToken } = require('../../src/utils/consentTokenHash');
const { ObjectId } = require('mongodb');
const { createMatchingCollection } = require('../factories/filter.factory');

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

// A patients collection that answers by filter (#1336), with the index calls
// getPatientsCollection makes.
function seededPatients(docs) {
  return { ...createMatchingCollection(docs), createIndex: vi.fn().mockResolvedValue(undefined) };
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

  // #1336: this case once checked only that the filter HAD an `_id`, against
  // a stub that answered the same patient for any filter. Two seeded patients
  // make the `_id` value decide.
  it('queries by ObjectId when the identifier is not an 8-digit string', async () => {
    const target = { _id: new ObjectId(), participantId: '22222222' };
    const patientsCollection = seededPatients([{ _id: new ObjectId(), participantId: '11111111' }, target]);
    const db = makeFakeDb({ patients: patientsCollection });

    const result = await patientService.getPatient(db, target._id.toString());

    expect(result.participantId).toBe('22222222');
  });

  // #603: FHIR-imported participants get a non-numeric, non-24-hex
  // participantId (fhir-import-staging.service.js commitBatch upserts
  // Patient docs keyed on `{ participantId: normalized.participantId }`,
  // not `_id`). Before the fix, this fell into the ObjectId branch and
  // `new ObjectId(...)` threw synchronously instead of querying by
  // participantId.
  it('queries by participantId (not ObjectId) for a FHIR-style non-numeric id', async () => {
    const fhirStyleId = 'rf011-debug-1234567890';
    const patientsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({ participantId: fhirStyleId })
    });
    const db = makeFakeDb({ patients: patientsCollection });

    const result = await patientService.getPatient(db, fhirStyleId);

    expect(patientsCollection.findOne).toHaveBeenCalledWith({ participantId: fhirStyleId });
    expect(result.participantId).toBe(fhirStyleId);
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

    // #1104: an exact match on the name's blind index, not a substring $regex
    // over the plaintext, which is no longer written.
    const identityCrypto = require('../../src/services/participantIdentity.service');
    expect(identitiesCollection.find).toHaveBeenCalledWith({
      patientNameHash: { $in: identityCrypto.computeBlindIndexCandidates('patientName', 'Maria') },
    });
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

  it('parses a DD/MM/YYYY date term into a birthDateHash clause (#1104)', async () => {
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

    const participantIdentityService = require('../../src/services/participantIdentity.service');
    const identityQueryArg = identitiesCollection.find.mock.calls[0][0];
    // #1104: birthDate is ciphertext-only, so the parsed term drives a
    // birthDateHash clause rather than a plaintext range. Asserting the hash
    // of the expected calendar day still pins the DD/MM/YYYY parsing, which
    // is what this test is for.
    const hashClause = identityQueryArg.$or.find((clause) => clause.birthDateHash);
    expect(hashClause.birthDateHash.$in).toContain(
      participantIdentityService.computeBlindIndex('birthDate', new Date(1990, 5, 15))
    );
    expect(identityQueryArg.$or.some((clause) => clause.birthDate)).toBe(false);

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

  it('parses a YYYY-MM-DD date term into a birthDateHash clause (#1104)', async () => {
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

    // #1412: the term is its literal calendar day in every zone, not
    // new Date(term)'s UTC midnight read back through local getters.
    const participantIdentityService = require('../../src/services/participantIdentity.service');
    const identityQueryArg = identitiesCollection.find.mock.calls[0][0];
    const hashClause = identityQueryArg.$or.find((clause) => clause.birthDateHash);
    expect(hashClause.birthDateHash.$in).toContain(
      participantIdentityService.computeBlindIndex('birthDate', '15/06/1990')
    );
    expect(identityQueryArg.$or.some((clause) => clause.birthDate)).toBe(false);

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

  // #604: same fix pattern as #603 (getPatient) — FHIR-imported participants
  // get a non-numeric, non-24-hex participantId. Before the fix this fell
  // into updatePatient's ObjectId branch and `new ObjectId(...)` threw
  // synchronously instead of querying by participantId.
  it('queries by participantId (not ObjectId) for a FHIR-style non-numeric id', async () => {
    const fhirStyleId = 'rf011-debug-1234567890';
    const patientsCollection = makeFakeCollection({
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
      findOne: vi.fn().mockResolvedValue({ participantId: fhirStyleId })
    });
    const db = makeFakeDb({ patients: patientsCollection });

    await patientService.updatePatient(db, fhirStyleId, { patientName: 'Nova' });

    const updateQuery = patientsCollection.updateOne.mock.calls[0][0];
    expect(updateQuery).toEqual({ participantId: fhirStyleId });
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

  it('keeps a matching token valid after the participant is no longer pending', async () => {
    const patientsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({
        participantId: '12345678',
        status: 'ACTIVE',
        consentTokenHash: hashConsentToken('tok'),
      })
    });
    const db = makeFakeDb({ patients: patientsCollection });

    await expect(patientService.validateConsentToken(db, '12345678', 'tok')).resolves.toEqual({
      valid: true,
      participantId: '12345678',
      patientStatus: 'ACTIVE',
    });
  });

  it('rejects when the token does not match', async () => {
    const patientsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({
        participantId: '12345678',
        status: 'PENDING_CONSENT',
        consentTokenHash: hashConsentToken('right-token')
      })
    });
    const db = makeFakeDb({ patients: patientsCollection });

    await expect(patientService.validateConsentToken(db, '12345678', 'wrong-token')).rejects.toThrow(
      'Token inválido'
    );
  });

  it('rejects when the patient has no consentTokenHash stored', async () => {
    const patientsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({
        participantId: '12345678',
        status: 'PENDING_CONSENT',
        consentTokenHash: null
      })
    });
    const db = makeFakeDb({ patients: patientsCollection });

    await expect(patientService.validateConsentToken(db, '12345678', 'tok')).rejects.toThrow(
      'Token inválido'
    );
  });

  // #1049: no plaintext fallback. A legacy row that still holds the token in
  // clear and no hash is refused until the migration converts it.
  it('rejects a legacy row holding only a plaintext consentToken, even with the right token', async () => {
    const patientsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({
        participantId: '12345678',
        status: 'PENDING_CONSENT',
        consentToken: 'tok',
        consentTokenExpiresAt: new Date(Date.now() + 60000)
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
        consentTokenHash: hashConsentToken('tok'),
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
        consentTokenHash: hashConsentToken('tok'),
        consentTokenExpiresAt: new Date(Date.now() + 60000)
      })
    });
    const db = makeFakeDb({ patients: patientsCollection });

    const result = await patientService.validateConsentToken(db, '12345678', 'tok');

    expect(result).toEqual({ valid: true, participantId: '12345678', patientStatus: 'PENDING_CONSENT' });
  });
});

describe('PatientService.acceptConsentToken', () => {
  // #821: acceptance now records a Consent first; that behaviour is pinned in
  // patient.service.unit.test.js. Stubbed here so this case keeps covering
  // the status/token write that follows it.
  it('activates the patient and keeps the panel token after validating it', async () => {
    const consentService = require('../../src/services/consent.service');
    const consentPanel = require('../../src/services/consentPanel.service');
    vi.spyOn(consentService, 'getActiveTemplateForParticipant').mockResolvedValue({ _id: 'tpl-1', active: true, permissions: [], validTo: '2027-01-01T00:00:00.000Z' });
    vi.spyOn(consentService, 'createPatientConsent').mockResolvedValue({ consentId: 'uuid-1', consentVersion: '1' });
    vi.spyOn(consentPanel, 'recordPanelLinkCommunication').mockResolvedValue(undefined);
    const patientsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({
        participantId: '12345678',
        status: 'PENDING_CONSENT',
        consentTokenHash: hashConsentToken('tok'),
        consentTokenExpiresAt: new Date(Date.now() + 60000)
      }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 })
    });
    const db = makeFakeDb({ patients: patientsCollection });

    const result = await patientService.acceptConsentToken(db, '12345678', 'tok', {
      consentTemplateId: 'tpl-1',
      responses: {}
    });

    expect(result).toEqual({ success: true, participantId: '12345678', consentId: 'uuid-1', consentVersion: '1' });
    const setPayload = patientsCollection.updateOne.mock.calls[0][1].$set;
    expect(setPayload.status).toBe('ACTIVE');
    expect(setPayload.consentTokenExpiresAt).toEqual(new Date('2027-01-01T00:00:00.000Z'));
    expect(setPayload.consentTokenHash).toBeUndefined();
  });

  it('propagates the validation error and never calls updateOne when the token is invalid', async () => {
    const patientsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({
        participantId: '12345678',
        status: 'PENDING_CONSENT',
        consentTokenHash: hashConsentToken('right-token')
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

  it('rejects when a consent is already in force', async () => {
    const patientsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({ participantId: '12345678', status: 'ACTIVE' })
    });
    const consents = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({ participantId: '12345678', status: 'ACTIVE' })
    });
    const db = makeFakeDb({ patients: patientsCollection, patientConsents: consents });

    await expect(patientService.resendConsentNotification(db, '12345678')).rejects.toThrow(
      'Paciente não está pendente de consentimento'
    );
  });

  // #1049: the resend used to re-send an unexpired stored token, which needed
  // it in plaintext at rest. It now always mints, and the old link dies.
  it('mints a fresh token even when the stored one is unexpired (#1049)', async () => {
    const futureExpiry = new Date(Date.now() + 60000);
    const newExpiry = new Date(Date.now() + 3600000);
    const patientsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({
        _id: 'p1',
        participantId: '12345678',
        status: 'PENDING_CONSENT',
        consentTokenHash: hashConsentToken('existing-token'),
        consentTokenExpiresAt: futureExpiry
      }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 })
    });
    const db = makeFakeDb({ patients: patientsCollection });

    const buildMetadataSpy = vi.spyOn(notificationService, 'buildConsentMetadata').mockReturnValue({
      token: 'minted-token',
      createdAt: new Date(),
      expiresAt: newExpiry
    });
    const buildLinkSpy = vi.spyOn(notificationService, 'buildConsentLink').mockReturnValue('http://link');
    vi.spyOn(notificationService, 'enqueueConsentNotification').mockResolvedValue(undefined);

    const result = await patientService.resendConsentNotification(db, '12345678');

    expect(buildMetadataSpy).toHaveBeenCalled();
    expect(buildLinkSpy).toHaveBeenCalledWith(expect.anything(), 'minted-token');
    expect(result).not.toHaveProperty('reusedToken');
    expect(result.consentTokenExpiresAt).toEqual(newExpiry);
    const setPayload = patientsCollection.updateOne.mock.calls[0][1].$set;
    expect(setPayload.consentTokenHash).toBe(hashConsentToken('minted-token'));
    expect(setPayload).not.toHaveProperty('consentToken');
  });

  it('removes a legacy plaintext consentToken in the same write (#1049)', async () => {
    const patientsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({
        _id: 'p1',
        participantId: '12345678',
        status: 'PENDING_CONSENT',
        consentToken: 'legacy-plaintext'
      }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 })
    });
    const db = makeFakeDb({ patients: patientsCollection });

    vi.spyOn(notificationService, 'buildConsentLink').mockReturnValue('http://link');
    vi.spyOn(notificationService, 'enqueueConsentNotification').mockResolvedValue(undefined);

    await patientService.resendConsentNotification(db, '12345678');

    expect(patientsCollection.updateOne.mock.calls[0][1].$unset).toEqual({ consentToken: '' });
  });

  // #1104: this read went straight to identity.patientName off a raw
  // participantIdentities document, with no decryptIdentity anywhere in the
  // path -- so a ciphertext-only row would have sent the consent invitation
  // with an undefined patient name.
  it('#1104: decrypts a ciphertext-only identity before putting patientName on the notification', async () => {
    const participantIdentityService = require('../../src/services/participantIdentity.service');
    const encrypted = participantIdentityService.encryptIdentityFields({
      participantId: '12345678',
      patientName: 'Ana Silva',
    });
    const patientsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({
        _id: 'p1',
        participantId: '12345678',
        status: 'PENDING_CONSENT',
        consentTokenHash: hashConsentToken('existing-token'),
        consentTokenExpiresAt: new Date(Date.now() + 60000)
      }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 })
    });
    const identitiesCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({ ...encrypted, patientName: null })
    });
    const db = makeFakeDb({ patients: patientsCollection, participantIdentities: identitiesCollection });

    vi.spyOn(notificationService, 'buildConsentLink').mockReturnValue('http://link');
    const enqueueSpy = vi.spyOn(notificationService, 'enqueueConsentNotification').mockResolvedValue(undefined);

    await patientService.resendConsentNotification(db, '12345678');

    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.objectContaining({ patientName: 'Ana Silva' }),
      'http://link'
    );
  });

  // #1166 slice 2: the contact is identity data. With the Patient document
  // holding none (the slice-4 end state), the invitation still has to reach
  // the address on the identity record.
  it('#1166: takes email and phone from the decrypted identity, not the Patient document', async () => {
    const participantIdentityService = require('../../src/services/participantIdentity.service');
    const encrypted = participantIdentityService.encryptIdentityFields({
      participantId: '12345678',
      patientName: 'Ana Silva',
      email: 'ana@example.com',
      phone: '11987654321',
    });
    const patientsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({
        _id: 'p1',
        participantId: '12345678',
        status: 'PENDING_CONSENT',
        consentTokenHash: hashConsentToken('existing-token'),
        consentTokenExpiresAt: new Date(Date.now() + 60000)
      }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 })
    });
    const identitiesCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({ ...encrypted, patientName: null, email: null, phone: null })
    });
    const db = makeFakeDb({ patients: patientsCollection, participantIdentities: identitiesCollection });

    vi.spyOn(notificationService, 'buildConsentLink').mockReturnValue('http://link');
    const enqueueSpy = vi.spyOn(notificationService, 'enqueueConsentNotification').mockResolvedValue(undefined);

    await patientService.resendConsentNotification(db, '12345678');

    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'ana@example.com', phone: '11987654321' }),
      'http://link'
    );
  });

  it('generates a new token when there is no valid existing one', async () => {
    const newExpiry = new Date(Date.now() + 3600000);
    const patientsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({
        _id: 'p1',
        participantId: '12345678',
        status: 'PENDING_CONSENT',
        consentTokenHash: null,
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

    expect(result).not.toHaveProperty('reusedToken');
    expect(result.consentTokenExpiresAt).toEqual(newExpiry);
    const setPayload = patientsCollection.updateOne.mock.calls[0][1].$set;
    expect(setPayload.consentTokenHash).toBe(hashConsentToken('new-token'));
  });

  it('generates a new token when the existing token has expired', async () => {
    const pastExpiry = new Date(Date.now() - 60000);
    const newExpiry = new Date(Date.now() + 3600000);
    const patientsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({
        _id: 'p1',
        participantId: '12345678',
        status: 'PENDING_CONSENT',
        consentTokenHash: hashConsentToken('stale-token'),
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

    expect(result).not.toHaveProperty('reusedToken');
    const setPayload = patientsCollection.updateOne.mock.calls[0][1].$set;
    expect(setPayload.consentTokenHash).toBe(hashConsentToken('fresh-token'));
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

  // #1336: as in getPatient's ObjectId case, the `_id` value decides which
  // of two seeded patients is deleted.
  it('queries by ObjectId for a non-8-digit identifier', async () => {
    const keep = { _id: new ObjectId(), participantId: '11111111' };
    const target = { _id: new ObjectId(), participantId: '22222222' };
    const patientsCollection = seededPatients([keep, target]);
    const db = makeFakeDb({ patients: patientsCollection });

    const result = await patientService.deletePatient(db, target._id.toString());

    expect(result).toBe(true);
    expect(patientsCollection.docs).toEqual([keep]);
  });

  // #604: same fix pattern as #603 (getPatient) — FHIR-imported participants
  // get a non-numeric, non-24-hex participantId. Before the fix this fell
  // into deletePatient's ObjectId branch and `new ObjectId(...)` threw
  // synchronously instead of querying by participantId.
  it('queries by participantId (not ObjectId) for a FHIR-style non-numeric id', async () => {
    const fhirStyleId = 'rf011-debug-1234567890';
    const patientsCollection = makeFakeCollection({
      deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 })
    });
    const db = makeFakeDb({ patients: patientsCollection });

    const result = await patientService.deletePatient(db, fhirStyleId);

    expect(patientsCollection.deleteOne).toHaveBeenCalledWith({ participantId: fhirStyleId });
    expect(result).toBe(true);
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
