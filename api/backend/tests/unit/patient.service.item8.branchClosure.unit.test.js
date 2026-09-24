import { describe, it, expect, vi, afterEach } from 'vitest';

process.env.ENCRYPTION_KEY = 'dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGtleXQ=';
process.env.ENCRYPTION_KEY_ID = 'test-key-1';

const patientService = require('../../src/services/patient.service');
const PatientModel = require('../../src/models/Patient');
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
    expect(result).toEqual({ clinicalUnitId: 'UNIT-2', clinicalUnit: null, unitAcronym: null });
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
    const db = makeDb({ participants: patients });
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

  it('matches a duplicate through the real encrypted identity date contract', async () => {
    const raw = participantIdentityService.encryptIdentityFields({
      participantId: '12345678',
      patientName: 'Ana Silva',
      birthDate: new Date('1990-06-15T00:00:00.000Z'),
    });
    const identities = makeCollection({
      find: vi.fn().mockReturnValue(makeCursor([raw]))
    });
    expect(raw.birthDate).toBeNull();
    expect(raw.birthDateEncrypted).toBeTruthy();
    expect(participantIdentityService.decryptIdentity(raw).birthDate).toBeInstanceOf(Date);
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
    const result = await patientService.listPatients(makeDb({ participants: patients }), {});
    expect(result).toMatchObject({ total: 0, limit: 50, skip: 0 });
  });

  it('searches nonnumeric text without participant/date clauses', async () => {
    const patients = makeCollection({
      find: vi.fn().mockReturnValue(makeCursor([])),
      countDocuments: vi.fn().mockResolvedValue(0)
    });
    await expect(patientService.searchPatients(makeDb({ participants: patients }), 'Alpha')).resolves.toMatchObject({ total: 0 });
  });

  it('covers malformed slash parts and empty identity matches for a valid date', async () => {
    const patients = makeCollection({
      find: vi.fn().mockReturnValue(makeCursor([])),
      countDocuments: vi.fn().mockResolvedValue(0)
    });
    const identities = makeCollection({ find: vi.fn().mockReturnValue(makeCursor([])) });
    const db = makeDb({ participants: patients, participantIdentities: identities });

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
    await patientService.searchPatients(makeDb({ participants: patients }), 'Alpha', scope);
    expect(patients.find).toHaveBeenCalled();
  });
});

describe('PatientService item 8 branch closure - update variants', () => {
  function updateDb(updated = { participantId: '12345678' }) {
    const patients = makeCollection({
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
      findOne: vi.fn().mockResolvedValue(updated)
    });
    return { db: makeDb({ participants: patients }), participants };
  }

  it('covers unitAcronym null, email valid and nullable phone branches', async () => {
    const { db, participants } = updateDb();
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
      const { db, participants } = updateDb();
      await patientService.updatePatient(db, '507f1f77bcf86cd799439011', {});
      expect(patients.updateOne.mock.calls[0][0]).toHaveProperty('_id');
    }
    {
      const { db, participants } = updateDb({ participantId: 'fhir-x' });
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
    const db = makeDb({ participants: patients, participantIdentities: identities });
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
      await expect(patientService.updatePatient(makeDb({ participants: patients }), '12345678', {}))
        .rejects.toMatchObject({ statusCode: 409 });
    }
    {
      const dup = Object.assign(new Error('dup-email'), { code: 11000, keyValue: { email: 'x' } });
      const patients = makeCollection({ updateOne: vi.fn().mockRejectedValue(dup) });
      await expect(patientService.updatePatient(makeDb({ participants: patients }), '12345678', {}))
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
      const localDb = makeDb({ participants: patients });
      await expect(patientService.validateConsentToken(localDb, '1', 't')).rejects.toThrow();
    }

    const patients = makeCollection({
      findOne: vi.fn().mockResolvedValue({ participantId: '1', status: 'PENDING_CONSENT', consentToken: 't' })
    });
    await expect(patientService.validateConsentToken(makeDb({ participants: patients }), '1', 't'))
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

    const result = await patientService.resendConsentNotification(makeDb({ participants: patients, participantIdentities: identities }), '1');
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

    const result = await patientService.resendConsentNotification(makeDb({ participants: patients, participantIdentities: identities }), '2');
    expect(result.reusedToken).toBe(false);
    expect(patients.updateOne.mock.calls[0][1].$set.consentToken).toBe('new-token');
  });

  it('covers resend missing participant and wrong status', async () => {
    await expect(patientService.resendConsentNotification(makeDb(), null)).rejects.toThrow('participantId é obrigatório');

    for (const patient of [null, { participantId: '3', status: 'ACTIVE' }]) {
      const patients = makeCollection({ findOne: vi.fn().mockResolvedValue(patient) });
      await expect(patientService.resendConsentNotification(makeDb({ participants: patients }), '3')).rejects.toThrow();
    }
  });

  it('deletes by ObjectId and free-form participantId and covers deleted=false', async () => {
    {
      const patients = makeCollection({ deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }) });
      await expect(patientService.deletePatient(makeDb({ participants: patients }), '507f1f77bcf86cd799439011')).resolves.toBe(true);
      expect(patients.deleteOne.mock.calls[0][0]).toHaveProperty('_id');
    }
    {
      const patients = makeCollection({ deleteOne: vi.fn().mockResolvedValue({ deletedCount: 0 }) });
      await expect(patientService.deletePatient(makeDb({ participants: patients }), 'fhir-x')).resolves.toBe(false);
      expect(patients.deleteOne.mock.calls[0][0]).toEqual({ participantId: 'fhir-x' });
    }
  });
});


describe('PatientService item 8 branch closure - canonical residual matrix', () => {
  function validPatient(overrides = {}) {
    return {
      participantId: '12345678',
      patientName: 'Paciente Sintético',
      birthDate: '1990-06-15',
      sex: 'F',
      email: 'synthetic@example.test',
      consentTemplateId: '507f1f77bcf86cd799439011',
      ...overrides
    };
  }

  function creationDb() {
    const template = makeCollection({
      findOne: vi.fn().mockResolvedValue({ _id: '507f1f77bcf86cd799439011' })
    });
    const patients = makeCollection();
    const identities = makeCollection({
      find: vi.fn().mockReturnValue(makeCursor([]))
    });
    const organizations = makeCollection({ findOne: vi.fn().mockResolvedValue(null) });
    return {
      db: makeDb({ participants: patients, participantIdentities: identities,
        consentTemplates: template,
        consentTemplates: template,
        organizations
      }),
      patients,
      identities
    };
  }

  it('reports a phone-key duplicate even when Mongo omits keyValue.phone', () => {
    expect(() => patientService.handlePhoneUniqueConstraint({
      keyPattern: { phone: 1 },
      keyValue: {}
    })).toThrow('Telefone  já cadastrado');
  });

  it('normalizes an explicitly undefined clinicalUnitId with a valid name fallback', async () => {
    const organizations = makeCollection({ findOne: vi.fn().mockResolvedValue(null) });
    await expect(patientService.resolveClinicalUnitSnapshot(
      makeDb({ organizations }),
      { clinicalUnitId: undefined, clinicalUnit: ' Unidade Sintética ' }
    )).resolves.toMatchObject({
      clinicalUnitId: null,
      clinicalUnit: 'UNIDADE SINTÉTICA'
    });
  });

  it('accepts a complete deceased representative and preserves normalized civil identity', () => {
    const payload = {
      isDeceased: true,
      representativeName: ' Representante Sintético ',
      representativeEmail: ' REP@example.test ',
      representativeIdentityDocument: '529.982.247-25',
      representativePhone: '(11) 98888-7777'
    };
    patientService.applyDeceasedRepresentativeRules(payload);
    expect(payload).toMatchObject({
      isDeceased: true,
      representativeName: 'Representante Sintético',
      representativeEmail: 'rep@example.test',
      representativeIdentityDocument: '52998224725',
      representativePhone: '11988887777'
    });
  });

  it('returns no record-number conflict when the canonical patient collection has no match', async () => {
    const patients = makeCollection({ findOne: vi.fn().mockResolvedValue(null) });
    await expect(patientService.checkIdentifierConflict(
      makeDb({ participants: patients }),
      { recordNumber: ' SYN-001 ' }
    )).resolves.toBeNull();
  });

  it('creates a synthetic patient with default options and keeps civil identity segregated', async () => {
    const { db, patients, identities } = creationDb();
    vi.spyOn(notificationService, 'buildConsentLink').mockReturnValue('https://example.test/consent');
    vi.spyOn(notificationService, 'enqueueConsentNotification').mockResolvedValue(undefined);

    const result = await patientService.createPatient(db, validPatient());

    expect(result.status).toBe('PENDING_CONSENT');
    const persisted = patients.insertOne.mock.calls[0][0];
    expect(persisted).not.toHaveProperty('patientName');
    expect(persisted).not.toHaveProperty('birthDate');
    expect(identities.insertOne).toHaveBeenCalledOnce();
  });

  it('rejects missing civil identity fields only after resolving a valid consent template', async () => {
    {
      const { db } = creationDb();
      await expect(patientService.createPatient(
        db,
        validPatient({ patientName: '' }),
        { skipConsentNotification: true }
      )).rejects.toThrow('patientName é obrigatório');
    }
    {
      const { db } = creationDb();
      await expect(patientService.createPatient(
        db,
        validPatient({ birthDate: null }),
        { skipConsentNotification: true }
      )).rejects.toThrow('birthDate é obrigatório');
    }
  });

  it('lists using the default filter object and exercises all governed filters', async () => {
    const patients = makeCollection({
      find: vi.fn().mockReturnValue(makeCursor([])),
      countDocuments: vi.fn().mockResolvedValue(0)
    });
    const identities = makeCollection({
      find: vi.fn().mockReturnValue(makeCursor([{ participantId: '12345678' }]))
    });
    const db = makeDb({ participants: patients, participantIdentities: identities });

    await expect(patientService.listPatients(db)).resolves.toMatchObject({ total: 0, limit: 50, skip: 0 });
    await expect(patientService.listPatients(db, {
      patientName: 'Sintético',
      clinicalUnit: 'UNIT TEST',
      organizationScope: { type: 'global' },
      limit: 10,
      skip: 2
    })).resolves.toMatchObject({ limit: 10, skip: 2 });
  });

  it('searches participant, numeric, slash, ISO and invalid date branches with segregated identity matches', async () => {
    const patients = makeCollection({
      find: vi.fn().mockReturnValue(makeCursor([])),
      countDocuments: vi.fn().mockResolvedValue(0)
    });
    const identities = makeCollection({
      find: vi.fn().mockReturnValue(makeCursor([{ participantId: '12345678' }]))
    });
    const db = makeDb({ participants: patients, participantIdentities: identities });

    await patientService.searchPatients(db, '12345678');
    await patientService.searchPatients(db, '15/06/1990');
    await patientService.searchPatients(db, '1990-06-15');
    await patientService.searchPatients(db, 'invalid-date');
    expect(patients.find).toHaveBeenCalledTimes(4);
  });

  it('updates with default options and no optional mutation fields', async () => {
    const patients = makeCollection({
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
      findOne: vi.fn().mockResolvedValue({ participantId: '12345678' })
    });
    await expect(patientService.updatePatient(
      makeDb({ participants: patients }),
      '12345678',
      {}
    )).resolves.toEqual({ success: true });
  });
});


describe('PatientService item 8 branch closure - residual canonical outcomes', () => {
  function validPatient(overrides = {}) {
    return {
      participantId: '12345678',
      patientName: 'Paciente Sintético',
      birthDate: '1990-06-15',
      sex: 'F',
      email: 'synthetic@example.test',
      consentTemplateId: '507f1f77bcf86cd799439011',
      ...overrides
    };
  }

  function creationDb() {
    const template = makeCollection({
      findOne: vi.fn().mockResolvedValue({ _id: '507f1f77bcf86cd799439011' })
    });
    const patients = makeCollection();
    const identities = makeCollection({
      find: vi.fn().mockReturnValue(makeCursor([]))
    });
    return {
      db: makeDb({ participants: patients, participantIdentities: identities,
        consentTemplates: template,
        consentTemplates: template,
        organizations: makeCollection({ findOne: vi.fn().mockResolvedValue(null) }),
        studies: makeCollection()
      }),
      patients,
      identities
    };
  }

  it('short-circuits index setup after a collection name is registered', async () => {
    const collection = makeCollection({ collectionName: 'patients-item8-index-once' });
    await patientService.ensurePatientIndexes(collection, collection.collectionName);
    await patientService.ensurePatientIndexes(collection, collection.collectionName);
    expect(collection.createIndex).toHaveBeenCalledTimes(2);
  });

  it('uses the canonical patients fallback name and non-duplicate phone outcomes', async () => {
    const patients = makeCollection({ collectionName: '' });
    const db = makeDb({ participants: patients });
    await expect(patientService.listPatients(db)).resolves.toMatchObject({ total: 0 });
    expect(patientService.handlePhoneUniqueConstraint(null)).toBeUndefined();
    expect(() => patientService.handlePhoneUniqueConstraint({
      keyPattern: { phone: 1 },
      keyValue: { phone: '11999999999' }
    })).toThrow('Telefone 11999999999 já cadastrado');
  });

  it('normalizes nullable clinical and representative identity inputs', () => {
    expect(patientService.normalizeClinicalUnit(null)).toBeNull();
    expect(patientService.normalizerepresentativeIdentityDocument(null)).toBeNull();
    expect(patientService.normalizeEmail(null)).toBeNull();
    expect(patientService.normalizePhone(null)).toBeNull();
  });

  it('rejects each governed deceased-representative invalid shape', () => {
    const base = {
      isDeceased: true,
      representativeName: 'Representante',
      representativeEmail: 'rep@example.test',
      representativeIdentityDocument: '52998224725',
      representativePhone: '11988887777'
    };
    expect(() => patientService.applyDeceasedRepresentativeRules({
      ...base,
      representativeEmail: 'invalido'
    })).toThrow('Email do representante legal inválido');
    expect(() => patientService.applyDeceasedRepresentativeRules({
      ...base,
      representativeIdentityDocument: '123'
    })).toThrow('identityDocument do representante legal inválido');
    expect(() => patientService.applyDeceasedRepresentativeRules({
      ...base,
      representativePhone: '123'
    })).toThrow('Telefone do representante legal inválido');
  });

  it('checks duplicate identity using Date input and blind-index candidates', async () => {
    const raw = { participantId: 'dup-date' };
    const identities = makeCollection({
      find: vi.fn().mockReturnValue(makeCursor([raw]))
    });
    vi.spyOn(participantIdentityService, 'computeBlindIndexCandidates').mockReturnValue(['hash-date']);
    vi.spyOn(participantIdentityService, 'decryptIdentity').mockReturnValue({
      patientName: 'Paciente Sintético',
      birthDate: new Date(1990, 5, 15)
    });
    await expect(patientService.checkDuplicatePatient(
      makeDb({ participantIdentities: identities }),
      { patientName: 'Paciente Sintético', birthDate: new Date(1990, 5, 15) }
    )).resolves.toBe(raw);
    expect(identities.find).toHaveBeenCalledWith({
      $or: [{ birthDateHash: { $in: ['hash-date'] } }]
    });
  });

  it('folds top-level Fabry values into the canonical dadosEspecificos shape', async () => {
    const { db, participants } = creationDb();
    vi.spyOn(notificationService, 'buildConsentLink').mockReturnValue('https://example.test/consent');
    vi.spyOn(notificationService, 'enqueueConsentNotification').mockResolvedValue(undefined);
    await patientService.createPatient(db, validPatient({
      alphaGal: 1.2,
      dadosEspecificos: [{ tipo: 'Fabry', dados: { lysoGb3: 2.3 } }]
    }), { skipConsentNotification: true });
    const persisted = patients.insertOne.mock.calls[0][0];
    expect(persisted.dadosEspecificos).toEqual([
      { tipo: 'Fabry', dados: { lysoGb3: 2.3, alphaGal: 1.2 } }
    ]);
    expect(persisted).not.toHaveProperty('alphaGal');
  });

  it('rejects invalid canonical model data after civil identity checks', async () => {
    const { db } = creationDb();
    await expect(patientService.createPatient(
      db,
      validPatient({ unexpectedField: 'not-canonical' }),
      { skipConsentNotification: true }
    )).rejects.toThrow();
  });

  it('formats both supported identifier-conflict messages', async () => {
    for (const conflict of [
      { field: 'identityDocument', value: '52998224725' },
      { field: 'recordNumber', value: 'SYN-001' }
    ]) {
      const { db } = creationDb();
      vi.spyOn(patientService, 'checkIdentifierConflict').mockResolvedValueOnce(conflict);
      await expect(patientService.createPatient(
        db,
        validPatient(),
        { skipConsentNotification: true }
      )).rejects.toMatchObject({ statusCode: 409 });
    }
  });

  it('covers malformed hyphenated search date and identity sync absence', async () => {
    const patients = makeCollection({
      find: vi.fn().mockReturnValue(makeCursor([])),
      countDocuments: vi.fn().mockResolvedValue(0),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
      findOne: vi.fn().mockResolvedValue({})
    });
    const identities = makeCollection({ find: vi.fn().mockReturnValue(makeCursor([])) });
    const db = makeDb({ participants: patients, participantIdentities: identities });
    await patientService.searchPatients(db, '2020-invalid-date');
    await expect(patientService.updatePatient(db, '12345678', {
      patientName: 'Identidade Sintética'
    })).resolves.toEqual({ success: true });
    expect(identities.updateOne).not.toHaveBeenCalled();
  });
});


describe('PatientService item 8 branch closure - final predicate matrix', () => {
  function patient(overrides = {}) {
    return {
      participantId: '12345678',
      patientName: 'Paciente Sintético',
      birthDate: '1990-06-15',
      sex: 'F',
      consentTemplateId: '507f1f77bcf86cd799439011',
      ...overrides
    };
  }

  function dbForCreate({ study = null } = {}) {
    const template = makeCollection({
      findOne: vi.fn().mockResolvedValue({ _id: '507f1f77bcf86cd799439011' })
    });
    return {
      participants: makeCollection(),
      db: makeDb({
        participants: makeCollection(),
        participantIdentities: makeCollection({ find: vi.fn().mockReturnValue(makeCursor([])) }),
        consentTemplates: template,
        consentTemplates: template,
        organizations: makeCollection({ findOne: vi.fn().mockResolvedValue(null) }),
        studies: makeCollection({ findOne: vi.fn().mockResolvedValue(study) })
      })
    };
  }

  it('returns null for normalized whitespace-only values', () => {
    expect(patientService.normalizeClinicalUnit('   ')).toBeNull();
    expect(patientService.normalizerepresentativeIdentityDocument('---')).toBeNull();
  });

  it('keeps a canonical organization acronym when present', async () => {
    const organizations = makeCollection({
      findOne: vi.fn().mockResolvedValue({
        organizationId: 'UNIT-CANONICAL',
        officialName: 'Unidade Canônica',
        acronym: 'UC'
      })
    });
    await expect(patientService.resolveClinicalUnitSnapshot(
      makeDb({ organizations }),
      { clinicalUnitId: 'UNIT-CANONICAL' }
    )).resolves.toEqual({
      clinicalUnitId: 'UNIT-CANONICAL',
      clinicalUnit: 'Unidade Canônica',
      unitAcronym: 'UC'
    });
  });

  it('uses the keyless birth-date range when blind indexes are unavailable', async () => {
    const identities = makeCollection({ find: vi.fn().mockReturnValue(makeCursor([])) });
    vi.spyOn(participantIdentityService, 'computeBlindIndexCandidates').mockReturnValue([]);
    await expect(patientService.checkDuplicatePatient(
      makeDb({ participantIdentities: identities }),
      { patientName: 'Paciente Sintético', birthDate: new Date(1990, 5, 15) }
    )).resolves.toBeNull();
    expect(identities.find).toHaveBeenCalledWith({
      $or: [{ birthDate: { $gte: expect.any(Date), $lt: expect.any(Date) } }]
    });
  });

  it('folds lysoGb3 without an existing Fabry block', async () => {
    const template = makeCollection({
      findOne: vi.fn().mockResolvedValue({ _id: '507f1f77bcf86cd799439011' })
    });
    const patients = makeCollection();
    const db = makeDb({ participants: patients, participantIdentities: makeCollection({ find: vi.fn().mockReturnValue(makeCursor([])) }),
      consentTemplates: template,
      consentTemplates: template,
      organizations: makeCollection({ findOne: vi.fn().mockResolvedValue(null) })
    });
    await patientService.createPatient(
      db,
      patient({ lysoGb3: 2.3 }),
      { skipConsentNotification: true }
    );
    expect(patients.insertOne.mock.calls[0][0].dadosEspecificos).toEqual([
      { tipo: 'Fabry', dados: { lysoGb3: 2.3 } }
    ]);
  });

  it('accepts linkage to an active canonical study', async () => {
    const template = makeCollection({
      findOne: vi.fn().mockResolvedValue({ _id: '507f1f77bcf86cd799439011' })
    });
    const patients = makeCollection();
    const db = makeDb({ participants: patients, participantIdentities: makeCollection({ find: vi.fn().mockReturnValue(makeCursor([])) }),
      consentTemplates: template,
      consentTemplates: template,
      organizations: makeCollection({ findOne: vi.fn().mockResolvedValue(null) }),
      studies: makeCollection({
        findOne: vi.fn().mockResolvedValue({ studyId: 'STUDY-1', studyStatus: 'active' })
      })
    });
    await expect(patientService.createPatient(
      db,
      patient({ studyId: 'STUDY-1' }),
      { skipConsentNotification: true }
    )).resolves.toMatchObject({ studyId: 'STUDY-1' });
  });
});


describe('PatientService item 8 branch closure - clinical decision endpoints', () => {
  it('normalizes optional clinical text for null and supplied values', () => {
    expect(patientService.normalizeOptionalClinicalText(null)).toBe('');
    expect(patientService.normalizeOptionalClinicalText(' UNIT-X ')).toBe('UNIT-X');
  });

  it('falls through from unknown organization id to the supplied canonical name', async () => {
    const organizations = makeCollection({ findOne: vi.fn().mockResolvedValue(null) });
    await expect(patientService.resolveClinicalUnitSnapshot(
      makeDb({ organizations }),
      { clinicalUnitId: 'UNKNOWN', clinicalUnit: ' Unidade Alternativa ' }
    )).resolves.toMatchObject({
      clinicalUnitId: null,
      clinicalUnit: 'UNIDADE ALTERNATIVA'
    });
  });

  it('resolves canonical name with populated official name and acronym', async () => {
    const organizations = makeCollection({
      findOne: vi.fn().mockResolvedValue({
        organizationId: 'UNIT-BY-NAME',
        officialName: 'Unidade por Nome',
        acronym: 'UPN'
      })
    });
    await expect(patientService.resolveClinicalUnitSnapshot(
      makeDb({ organizations }),
      { clinicalUnit: 'Unidade por Nome' }
    )).resolves.toEqual({
      clinicalUnitId: 'UNIT-BY-NAME',
      clinicalUnit: 'Unidade por Nome',
      unitAcronym: 'UPN'
    });
  });

  it('creates with normalized free-text clinical unit and derived acronym', async () => {
    const template = makeCollection({
      findOne: vi.fn().mockResolvedValue({ _id: '507f1f77bcf86cd799439011' })
    });
    const patients = makeCollection();
    const db = makeDb({ participants: patients, participantIdentities: makeCollection({ find: vi.fn().mockReturnValue(makeCursor([])) }),
      consentTemplates: template,
      consentTemplates: template,
      organizations: makeCollection({ findOne: vi.fn().mockResolvedValue(null) })
    });
    const result = await patientService.createPatient(db, {
      participantId: '12345678',
      patientName: 'Paciente Sintético',
      birthDate: '1990-06-15',
      sex: 'F',
      clinicalUnit: ' Unidade Sintética ',
      consentTemplateId: '507f1f77bcf86cd799439011'
    }, { skipConsentNotification: true });
    expect(result).toMatchObject({
      clinicalUnit: 'UNIDADE SINTÉTICA',
      unitAcronym: expect.any(String)
    });
  });

  it('forces the canonical clinicalUnitId lookup branch explicitly', async () => {
    const organizations = makeCollection({
      findOne: vi.fn().mockRejectedValue(new Error('ID_LOOKUP_REACHED'))
    });
    const normalizeSpy = vi.spyOn(patientService, 'normalizeOptionalClinicalText')
      .mockImplementation((value) => value === 'FORCE-ID' ? 'FORCE-ID' : '');

    await expect(patientService.resolveClinicalUnitSnapshot(
      makeDb({ organizations }),
      { clinicalUnitId: 'FORCE-ID' }
    )).rejects.toThrow('ID_LOOKUP_REACHED');

    expect(organizations.findOne).toHaveBeenCalledWith({ organizationId: 'FORCE-ID' });
    normalizeSpy.mockRestore();
  });

  it('forces the canonical model invalid-validation branch explicitly', async () => {
    const template = makeCollection({
      findOne: vi.fn().mockResolvedValue({ _id: '507f1f77bcf86cd799439011' })
    });
    const db = makeDb({
      participants: makeCollection(),
      participantIdentities: makeCollection({ find: vi.fn().mockReturnValue(makeCursor([])) }),
      consentTemplates: template,
      consentTemplates: template,
      organizations: makeCollection({ findOne: vi.fn().mockResolvedValue(null) })
    });
    const validateSpy = vi.spyOn(PatientModel, 'validate').mockReturnValue({
      isValid: false,
      errors: ['forced-invalid-model']
    });

    await expect(patientService.createPatient(db, {
      patientName: 'Paciente Sintético',
      birthDate: '1990-06-15',
      sex: 'F',
      consentTemplateId: '507f1f77bcf86cd799439011'
    }, { skipConsentNotification: true })).rejects.toThrow('forced-invalid-model');

    validateSpy.mockRestore();
  });


  it('covers empty canonical organization name and acronym fallbacks by organizationId', async () => {
    const organizations = makeCollection({
      findOne: vi.fn().mockResolvedValue({
        organizationId: 'UNIT-EMPTY',
        officialName: '',
        acronym: ''
      })
    });

    await expect(patientService.resolveClinicalUnitSnapshot(
      makeDb({ organizations }),
      { clinicalUnitId: 'UNIT-EMPTY' }
    )).resolves.toEqual({
      clinicalUnitId: 'UNIT-EMPTY',
      clinicalUnit: null,
      unitAcronym: null
    });

    expect(organizations.findOne).toHaveBeenCalledWith({ organizationId: 'UNIT-EMPTY' });
  });


  it('covers resolveClinicalUnitSnapshot default payload and clinical-name helper outcomes', async () => {
    await expect(patientService.resolveClinicalUnitSnapshot(makeDb())).resolves.toBeNull();

    expect(patientService.resolveClinicalUnitName(' Unidade Canônica ')).toBe('Unidade Canônica');
    expect(patientService.resolveClinicalUnitName('   ')).toBeNull();
    expect(patientService.resolveClinicalUnitName(null)).toBeNull();
  });

});
