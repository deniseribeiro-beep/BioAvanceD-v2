import { describe, it, expect, vi, afterEach } from 'vitest';

process.env.ENCRYPTION_KEY = 'dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGtleXQ=';
process.env.ENCRYPTION_KEY_ID = 'test-key-1';

const patientService = require('../../src/services/patient.service');
const participantIdentityService = require('../../src/services/participantIdentity.service');
const notificationService = require('../../src/services/notification.service');

function makeCursor(rows = []) {
  return {
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(rows)
  };
}

function makeCollection(overrides = {}) {
  return {
    collectionName: 'patients-item8',
    findOne: vi.fn().mockResolvedValue(null),
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'inserted-item8' }),
    updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
    find: vi.fn().mockReturnValue(makeCursor([])),
    countDocuments: vi.fn().mockResolvedValue(0),
    createIndex: vi.fn().mockResolvedValue('ok'),
    dropIndex: vi.fn().mockResolvedValue('ok'),
    ...overrides
  };
}

function makeDb(collections = {}) {
  return {
    collection: vi.fn((name) => collections[name] || makeCollection({ collectionName: name }))
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PatientService item 8 branch closure - helpers and indexes', () => {
  it('clones dadosEspecificos entries with and without nested dados', () => {
    const source = {
      dadosEspecificos: [null, { tipo: 'Other' }, { tipo: 'Other', dados: { x: 1 } }]
    };
    const result = patientService.encryptSensitivePatientFields(source);
    expect(result.dadosEspecificos[0]).toBeNull();
    expect(result.dadosEspecificos[1]).toEqual({ tipo: 'Other' });
    expect(result.dadosEspecificos[2]).toEqual({ tipo: 'Other', dados: { x: 1 } });
    expect(result.dadosEspecificos[2]).not.toBe(source.dadosEspecificos[2]);
  });

  it('covers index early exits, create failure and both legacy-drop error outcomes', async () => {
    await expect(patientService.ensurePatientIndexes(null, 'x')).resolves.toBeUndefined();
    await expect(patientService.ensurePatientIndexes(makeCollection(), null)).resolves.toBeUndefined();

    const collection = makeCollection({
      createIndex: vi.fn()
        .mockRejectedValueOnce(new Error('create failed'))
        .mockResolvedValueOnce('ok'),
      dropIndex: vi.fn()
        .mockRejectedValueOnce(Object.assign(new Error('missing'), { codeName: 'IndexNotFound' }))
        .mockRejectedValueOnce(new Error('drop failed'))
    });
    await patientService.ensurePatientIndexes(collection, 'patients-item8-indexes');
    expect(collection.createIndex).toHaveBeenCalledTimes(2);
    expect(collection.dropIndex).toHaveBeenCalledTimes(2);

    await expect(patientService.ensurePatientIndexes(collection, 'patients-item8-indexes')).resolves.toBeUndefined();
  });

  it('covers phone unique constraint non-phone and keyValue-only phone paths', () => {
    expect(patientService.handlePhoneUniqueConstraint({ keyPattern: { email: 1 }, keyValue: { email: 'x' } })).toBeUndefined();
    expect(() => patientService.handlePhoneUniqueConstraint({ keyValue: { phone: ' 11999999999 ' } }))
      .toThrow('Telefone 11999999999 já cadastrado no sistema.');
  });
});

describe('PatientService item 8 branch closure - clinical unit resolution', () => {
  it('returns null when neither clinical unit field is supplied', async () => {
    await expect(patientService.resolveClinicalUnitSnapshot(makeDb(), {})).resolves.toBeNull();
  });

  it('returns an explicitly cleared snapshot when supplied values normalize empty', async () => {
    await expect(patientService.resolveClinicalUnitSnapshot(makeDb(), { clinicalUnitId: '', clinicalUnit: '   ' }))
      .resolves.toEqual({ clinicalUnitId: null, clinicalUnit: null, unitAcronym: null });
  });

  it('resolves by organizationId and falls back to generated acronym when acronym is blank', async () => {
    const organizations = makeCollection({
      findOne: vi.fn().mockResolvedValue({
        organizationId: 'UNIT-1',
        officialName: 'Unidade Clínica Central',
        acronym: ''
      })
    });
    const result = await patientService.resolveClinicalUnitSnapshot(makeDb({ organizations }), { clinicalUnitId: ' UNIT-1 ' });
    expect(result.clinicalUnitId).toBe('UNIT-1');
    expect(result.clinicalUnit).toBe('Unidade Clínica Central');
    expect(result.unitAcronym).toBeTruthy();
  });

  it('throws when organizationId is unknown and no name fallback is supplied', async () => {
    const organizations = makeCollection({ findOne: vi.fn().mockResolvedValue(null) });
    await expect(patientService.resolveClinicalUnitSnapshot(makeDb({ organizations }), { clinicalUnitId: 'UNKNOWN' }))
      .rejects.toThrow('Unidade clínica não encontrada');
  });

  it('resolves by normalized name including blank officialName/acronym fallbacks', async () => {
    const organizations = makeCollection({
      findOne: vi.fn().mockResolvedValue({
        organizationId: 'UNIT-2',
        officialName: '',
        acronym: ''
      })
    });
    const result = await patientService.resolveClinicalUnitSnapshot(makeDb({ organizations }), { clinicalUnit: 'Unit X' });
    expect(result).toEqual({ clinicalUnitId: 'UNIT-2', clinicalUnit: null, unitAcronym: '' });
  });

  it('falls back to normalized free-text clinical unit when no organization matches', async () => {
    const organizations = makeCollection({ findOne: vi.fn().mockResolvedValue(null) });
    const result = await patientService.resolveClinicalUnitSnapshot(makeDb({ organizations }), { clinicalUnit: '  unit fallback ' });
    expect(result.clinicalUnitId).toBeNull();
    expect(result.clinicalUnit).toBe('UNIT FALLBACK');
    expect(result.unitAcronym).toBeTruthy();
  });
});

describe('PatientService item 8 branch closure - identifier and duplicate checks', () => {
  it('uses plaintext identityDocument lookup shape when blind-index candidates are empty', async () => {
    vi.spyOn(participantIdentityService, 'computeBlindIndexCandidates').mockReturnValue([]);
    const identities = makeCollection({ findOne: vi.fn().mockResolvedValue(null) });
    const db = makeDb({ participantIdentities: identities });
    await expect(patientService.checkIdentifierConflict(db, { identityDocument: '52998224725' })).resolves.toBeNull();
    expect(identities.findOne).toHaveBeenCalledWith({
      $or: [{ identityDocument: '52998224725' }]
    });
  });

  it('returns a recordNumber conflict when a patient record already exists', async () => {
    const patients = makeCollection({ findOne: vi.fn().mockResolvedValue({ participantId: '12345678' }) });
    const db = makeDb({ patients });
    const result = await patientService.checkIdentifierConflict(db, { recordNumber: ' REC-1 ' });
    expect(result).toMatchObject({ field: 'recordNumber', value: 'REC-1' });
  });

  it('covers duplicate check missing-fields, non-string date and invalid date branches', async () => {
    const identities = makeCollection({ find: vi.fn().mockReturnValue(makeCursor([])) });
    const db = makeDb({ participantIdentities: identities });

    await expect(patientService.checkDuplicatePatient(db, { patientName: '', birthDate: '2020-01-01' })).resolves.toBeNull();
    await expect(patientService.checkDuplicatePatient(db, { patientName: 'A', birthDate: 12345 })).resolves.toBeNull();
    await expect(patientService.checkDuplicatePatient(db, { patientName: 'A', birthDate: 'not-a-date' })).resolves.toBeNull();
  });

  it('covers ISO string duplicate date and an identity missing comparison fields', async () => {
    const identities = makeCollection({
      find: vi.fn().mockReturnValue(makeCursor([{ participantId: 'x' }]))
    });
    vi.spyOn(participantIdentityService, 'decryptIdentity').mockReturnValue({ patientName: null, birthDate: null });
    const db = makeDb({ participantIdentities: identities });
    await expect(patientService.checkDuplicatePatient(db, { patientName: 'Ana', birthDate: '1990-06-15' })).resolves.toBeNull();
  });

  it('covers matching duplicate when decrypted birthDate is a string', async () => {
    const raw = { participantId: 'dup' };
    const identities = makeCollection({
      find: vi.fn().mockReturnValue(makeCursor([raw]))
    });
    vi.spyOn(participantIdentityService, 'decryptIdentity').mockReturnValue({
      patientName: 'Ana Silva',
      birthDate: '1990-06-15T00:00:00.000Z'
    });
    const db = makeDb({ participantIdentities: identities });
    const result = await patientService.checkDuplicatePatient(db, { patientName: '  ana   silva ', birthDate: '1990-06-15' });
    expect(result).toBe(raw);
  });

  it('fails open when identity lookup throws', async () => {
    const identities = makeCollection({
      find: vi.fn(() => { throw new Error('lookup down'); })
    });
    const db = makeDb({ participantIdentities: identities });
    await expect(patientService.checkDuplicatePatient(db, { patientName: 'Ana', birthDate: new Date(1990, 5, 15) }))
      .resolves.toBeNull();
  });
});

describe('PatientService item 8 branch closure - list and search', () => {
  it('lists without optional filters and with explicit zero-like defaults', async () => {
    const patients = makeCollection({
      find: vi.fn().mockReturnValue(makeCursor([])),
      countDocuments: vi.fn().mockResolvedValue(0)
    });
    const result = await patientService.listPatients(makeDb({ patients }), {});
    expect(result).toMatchObject({ total: 0, limit: 50, skip: 0 });
  });

  it('searches nonnumeric text without participant/date clauses', async () => {
    const patients = makeCollection({
      find: vi.fn().mockReturnValue(makeCursor([])),
      countDocuments: vi.fn().mockResolvedValue(0)
    });
    await expect(patientService.searchPatients(makeDb({ patients }), 'Alpha')).resolves.toMatchObject({ total: 0 });
  });

  it('covers malformed slash parts and empty identity matches for a valid date', async () => {
    const patients = makeCollection({
      find: vi.fn().mockReturnValue(makeCursor([])),
      countDocuments: vi.fn().mockResolvedValue(0)
    });
    const identities = makeCollection({ find: vi.fn().mockReturnValue(makeCursor([])) });
    const db = makeDb({ patients, participantIdentities: identities });

    await patientService.searchPatients(db, '12/34');
    await patientService.searchPatients(db, '15/06/1990');
    expect(patients.find).toHaveBeenCalledTimes(2);
  });

  it('covers organization-scoped search', async () => {
    const patients = makeCollection({
      find: vi.fn().mockReturnValue(makeCursor([])),
      countDocuments: vi.fn().mockResolvedValue(0)
    });
    const scope = { type: 'global' };
    await patientService.searchPatients(makeDb({ patients }), 'Alpha', scope);
    expect(patients.find).toHaveBeenCalled();
  });
});

describe('PatientService item 8 branch closure - update variants', () => {
  function updateDb(updated = { participantId: '12345678' }) {
    const patients = makeCollection({
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
      findOne: vi.fn().mockResolvedValue(updated)
    });
    return { db: makeDb({ patients }), patients };
  }

  it('covers unitAcronym null, email valid and nullable phone branches', async () => {
    const { db, patients } = updateDb();
    await patientService.updatePatient(db, '12345678', {
      unitAcronym: '',
      email: 'OK@example.com',
      phone: null
    });
    const payload = patients.updateOne.mock.calls[0][1].$set;
    expect(payload.unitAcronym).toBeNull();
    expect(payload.email).toBe('ok@example.com');
    expect(payload.phone).toBeNull();
  });

  it('covers phone empty string branch', async () => {
    const { db } = updateDb();
    await expect(patientService.updatePatient(db, '12345678', { phone: '' })).resolves.toEqual({ success: true });
  });

  it('strips participantId and skips height conversion for null/invalid/already-heightCm values', async () => {
    for (const update of [
      { participantId: '99999999', height: null },
      { height: 'not-number' },
      { height: 1.75, heightCm: 170 }
    ]) {
      const { db } = updateDb();
      await expect(patientService.updatePatient(db, '12345678', { ...update })).resolves.toEqual({ success: true });
    }
  });

  it('queries ObjectId and free-form identifiers on update', async () => {
    {
      const { db, patients } = updateDb();
      await patientService.updatePatient(db, '507f1f77bcf86cd799439011', {});
      expect(patients.updateOne.mock.calls[0][0]).toHaveProperty('_id');
    }
    {
      const { db, patients } = updateDb({ participantId: 'fhir-x' });
      await patientService.updatePatient(db, 'fhir-x', {});
      expect(patients.updateOne.mock.calls[0][0]).toEqual({ participantId: 'fhir-x' });
    }
  });

  it('syncs each identity field including null birthDate', async () => {
    const identities = makeCollection();
    const patients = makeCollection({
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
      findOne: vi.fn().mockResolvedValue({ participantId: '12345678' })
    });
    const db = makeDb({ patients, participantIdentities: identities });
    await patientService.updatePatient(db, '12345678', {
      patientName: 'Nova',
      birthDate: null,
      identityDocument: '52998224725'
    });
    expect(identities.updateOne).toHaveBeenCalled();
    const set = identities.updateOne.mock.calls[0][1].$set;
    expect(set.patientName).toBe('Nova');
    expect(set.birthDate).toBeNull();
    expect(set.identityDocument).toBe('52998224725');
  });

  it('converts a phone duplicate-key on update and preserves non-phone duplicate errors', async () => {
    {
      const dup = Object.assign(new Error('dup'), { code: 11000, keyValue: { phone: '11999999999' } });
      const patients = makeCollection({ updateOne: vi.fn().mockRejectedValue(dup) });
      await expect(patientService.updatePatient(makeDb({ patients }), '12345678', {}))
        .rejects.toMatchObject({ statusCode: 409 });
    }
    {
      const dup = Object.assign(new Error('dup-email'), { code: 11000, keyValue: { email: 'x' } });
      const patients = makeCollection({ updateOne: vi.fn().mockRejectedValue(dup) });
      await expect(patientService.updatePatient(makeDb({ patients }), '12345678', {}))
        .rejects.toThrow('dup-email');
    }
  });
});

describe('PatientService item 8 branch closure - consent and deletion', () => {
  it('covers every validateConsentToken rejection and a valid token without expiry', async () => {
    const db = makeDb();
    await expect(patientService.validateConsentToken(db, null, null)).rejects.toThrow('obrigatórios');

    for (const patient of [
      null,
      { participantId: '1', status: 'ACTIVE', consentToken: 't' },
      { participantId: '1', status: 'PENDING_CONSENT', consentToken: 'other' },
      { participantId: '1', status: 'PENDING_CONSENT', consentToken: 't', consentTokenExpiresAt: new Date(Date.now() - 1000) }
    ]) {
      const patients = makeCollection({ findOne: vi.fn().mockResolvedValue(patient) });
      const localDb = makeDb({ patients });
      await expect(patientService.validateConsentToken(localDb, '1', 't')).rejects.toThrow();
    }

    const patients = makeCollection({
      findOne: vi.fn().mockResolvedValue({ participantId: '1', status: 'PENDING_CONSENT', consentToken: 't' })
    });
    await expect(patientService.validateConsentToken(makeDb({ patients }), '1', 't'))
      .resolves.toEqual({ valid: true, participantId: '1' });
  });

  it('resends using a valid existing token and no ParticipantIdentity row', async () => {
    const expires = new Date(Date.now() + 60_000);
    const patient = {
      _id: 'p1',
      participantId: '1',
      status: 'PENDING_CONSENT',
      consentToken: 'reuse-me',
      consentTokenCreatedAt: new Date(Date.now() - 1000),
      consentTokenExpiresAt: expires
    };
    const patients = makeCollection({
      findOne: vi.fn().mockResolvedValue(patient),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 })
    });
    const identities = makeCollection({ findOne: vi.fn().mockResolvedValue(null) });
    vi.spyOn(notificationService, 'buildConsentLink').mockReturnValue('http://consent');
    vi.spyOn(notificationService, 'enqueueConsentNotification').mockResolvedValue(undefined);

    const result = await patientService.resendConsentNotification(makeDb({ patients, participantIdentities: identities }), '1');
    expect(result.reusedToken).toBe(true);
    const updatePayload = patients.updateOne.mock.calls[0][1].$set;
    expect(updatePayload).not.toHaveProperty('consentToken');
  });

  it('regenerates an expired token and decrypts a ParticipantIdentity row', async () => {
    const patient = {
      _id: 'p2',
      participantId: '2',
      status: 'PENDING_CONSENT',
      consentToken: 'old',
      consentTokenCreatedAt: null,
      consentTokenExpiresAt: new Date(Date.now() - 1000)
    };
    const patients = makeCollection({
      findOne: vi.fn().mockResolvedValue(patient),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 })
    });
    const identities = makeCollection({ findOne: vi.fn().mockResolvedValue({ participantId: '2' }) });
    vi.spyOn(participantIdentityService, 'decryptIdentity').mockReturnValue({ patientName: 'Ana' });
    vi.spyOn(notificationService, 'buildConsentMetadata').mockReturnValue({
      token: 'new-token',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000)
    });
    vi.spyOn(notificationService, 'buildConsentLink').mockReturnValue('http://consent');
    vi.spyOn(notificationService, 'enqueueConsentNotification').mockResolvedValue(undefined);

    const result = await patientService.resendConsentNotification(makeDb({ patients, participantIdentities: identities }), '2');
    expect(result.reusedToken).toBe(false);
    expect(patients.updateOne.mock.calls[0][1].$set.consentToken).toBe('new-token');
  });

  it('covers resend missing participant and wrong status', async () => {
    await expect(patientService.resendConsentNotification(makeDb(), null)).rejects.toThrow('participantId é obrigatório');

    for (const patient of [null, { participantId: '3', status: 'ACTIVE' }]) {
      const patients = makeCollection({ findOne: vi.fn().mockResolvedValue(patient) });
      await expect(patientService.resendConsentNotification(makeDb({ patients }), '3')).rejects.toThrow();
    }
  });

  it('deletes by ObjectId and free-form participantId and covers deleted=false', async () => {
    {
      const patients = makeCollection({ deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }) });
      await expect(patientService.deletePatient(makeDb({ patients }), '507f1f77bcf86cd799439011')).resolves.toBe(true);
      expect(patients.deleteOne.mock.calls[0][0]).toHaveProperty('_id');
    }
    {
      const patients = makeCollection({ deleteOne: vi.fn().mockResolvedValue({ deletedCount: 0 }) });
      await expect(patientService.deletePatient(makeDb({ patients }), 'fhir-x')).resolves.toBe(false);
      expect(patients.deleteOne.mock.calls[0][0]).toEqual({ participantId: 'fhir-x' });
    }
  });
});
