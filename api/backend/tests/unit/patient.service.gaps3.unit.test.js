import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

process.env.ENCRYPTION_KEY = 'dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGtleXQ=';
process.env.ENCRYPTION_KEY_ID = 'test-key-1';

const patientService = require('../../src/services/patient.service');
const { ObjectId } = require('mongodb');

function makeFakeCollection(overrides = {}) {
  return {
    findOne: vi.fn().mockResolvedValue(null),
    insertOne: vi.fn().mockResolvedValue({ insertedId: new ObjectId() }),
    updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
    find: vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([])
    }),
    countDocuments: vi.fn().mockResolvedValue(0),
    createIndex: vi.fn().mockResolvedValue(undefined),
    dropIndex: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

function makeFakeDb(collectionsByName = {}) {
  return {
    collection: vi.fn((name) => collectionsByName[name] || makeFakeCollection())
  };
}

describe('PatientService.createPatient — alphaGal/lysoGb3 folding', () => {
  function baseValidPayload(overrides = {}) {
    return {
      participantId: '12345678',
      patientName: 'Fabry Patient',
      birthDate: '01/01/1990',
      sex: 'F',
      identityDocument: '52998224725',
      recordNumber: 'REC-FABRY',
      clinicalUnit: 'UTI-A',
      email: 'fabry@example.com',
      phone: '11987654321',
      consentTemplateId: new ObjectId().toString(),
      ...overrides
    };
  }

  async function runCreate(patientData) {
    const consentTemplatesCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({ _id: new ObjectId(patientData.consentTemplateId) })
    });
    const patientsCollection = makeFakeCollection();
    const db = makeFakeDb({
      consent_templates: consentTemplatesCollection,
      patients: patientsCollection
    });
    const result = await patientService.createPatient(db, patientData, { skipConsentNotification: true });
    return { result, patientsCollection };
  }

  it('folds top-level alphaGal/lysoGb3 into a new Fabry dadosEspecificos entry and deletes the top-level keys', async () => {
    const payload = baseValidPayload({ alphaGal: 1.23, lysoGb3: 4.56 });

    const { result } = await runCreate(payload);

    expect(result.alphaGal).toBeUndefined();
    expect(result.lysoGb3).toBeUndefined();
    const fabryEntry = result.dadosEspecificos.find((entry) => entry.tipo === 'Fabry');
    expect(fabryEntry.dados.alphaGal).toBe(1.23);
    expect(fabryEntry.dados.lysoGb3).toBe(4.56);
  });

  it('merges alphaGal into an existing Fabry dadosEspecificos entry instead of creating a second one', async () => {
    const payload = baseValidPayload({
      alphaGal: 9.9,
      dadosEspecificos: [{ tipo: 'Fabry', dados: { existingField: 'keep-me' } }]
    });

    const { result } = await runCreate(payload);

    const fabryEntries = result.dadosEspecificos.filter((entry) => entry.tipo === 'Fabry');
    expect(fabryEntries).toHaveLength(1);
    expect(fabryEntries[0].dados.existingField).toBe('keep-me');
    expect(fabryEntries[0].dados.alphaGal).toBe(9.9);
    expect(fabryEntries[0].dados.lysoGb3).toBeUndefined();
  });

  it('does not touch dadosEspecificos when neither alphaGal nor lysoGb3 is present', async () => {
    const payload = baseValidPayload();

    const { result } = await runCreate(payload);

    expect(result.dadosEspecificos).toEqual([]);
  });
});

describe('PatientService.createPatient — non-phone duplicate-key error passthrough', () => {
  it('rethrows an 11000 error unchanged when it is not a phone-uniqueness conflict', async () => {
    const duplicateKeyError = Object.assign(new Error('E11000 duplicate key'), {
      code: 11000,
      keyPattern: { someOtherField: 1 },
      keyValue: { someOtherField: 'x' }
    });
    const consentTemplatesCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({ _id: new ObjectId() })
    });
    const patientsCollection = makeFakeCollection({
      insertOne: vi.fn().mockRejectedValue(duplicateKeyError)
    });
    const consentTemplateId = new ObjectId().toString();
    const db = makeFakeDb({ consent_templates: consentTemplatesCollection, patients: patientsCollection });

    await expect(
      patientService.createPatient(db, {
        participantId: '12345678',
        patientName: 'Someone',
        birthDate: '01/01/1990',
        sex: 'M',
        identityDocument: '52998224725',
        recordNumber: 'REC-X',
        clinicalUnit: 'UTI-A',
        email: 'someone@example.com',
        phone: '11987654321',
        consentTemplateId
      }, { skipConsentNotification: true })
    ).rejects.toBe(duplicateKeyError);
  });
});

describe('PatientService.updatePatient — non-phone duplicate-key error passthrough', () => {
  it('rethrows an 11000 error unchanged when it is not a phone-uniqueness conflict', async () => {
    const duplicateKeyError = Object.assign(new Error('E11000 duplicate key'), {
      code: 11000,
      keyPattern: { someOtherField: 1 },
      keyValue: {}
    });
    const patientsCollection = makeFakeCollection({
      updateOne: vi.fn().mockRejectedValue(duplicateKeyError)
    });
    const db = makeFakeDb({ patients: patientsCollection });

    await expect(
      patientService.updatePatient(db, '12345678', { patientName: 'New Name' })
    ).rejects.toBe(duplicateKeyError);
  });
});

describe('PatientService.getPatient — error propagation', () => {
  it('logs and rethrows when the collection lookup throws', async () => {
    const patientsCollection = makeFakeCollection({
      findOne: vi.fn().mockRejectedValue(new Error('db down'))
    });
    const db = makeFakeDb({ patients: patientsCollection });

    await expect(patientService.getPatient(db, '12345678')).rejects.toThrow('db down');
  });
});

describe('PatientService.listPatients — error propagation', () => {
  it('logs and rethrows when the collection query throws', async () => {
    const patientsCollection = makeFakeCollection({
      find: vi.fn().mockImplementation(() => { throw new Error('db down'); })
    });
    const db = makeFakeDb({ patients: patientsCollection });

    await expect(patientService.listPatients(db, {})).rejects.toThrow('db down');
  });
});

describe('PatientService.deletePatient — error propagation and ObjectId branch in log', () => {
  it('logs and rethrows when deleteOne throws', async () => {
    const patientsCollection = makeFakeCollection({
      deleteOne: vi.fn().mockRejectedValue(new Error('db down'))
    });
    const db = makeFakeDb({ patients: patientsCollection });

    await expect(patientService.deletePatient(db, '12345678')).rejects.toThrow('db down');
  });

  it('logs with N/A participantId when deleting by ObjectId (non-8-digit identifier)', async () => {
    const id = new ObjectId();
    const patientsCollection = makeFakeCollection({
      deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 })
    });
    const db = makeFakeDb({ patients: patientsCollection });

    const result = await patientService.deletePatient(db, id.toString());
    expect(result).toBe(true);
  });
});

describe('PatientService.resolveClinicalUnitSnapshot — remaining normalization branches', () => {
  it('treats a clinicalUnitId present but null the same as absent when only clinicalUnit name is given', async () => {
    const organizationsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({ organizationId: 'unit-1', officialName: 'Enfermaria', acronym: '' })
    });
    const db = makeFakeDb({ organizations: organizationsCollection, patients: makeFakeCollection() });

    const result = await patientService.resolveClinicalUnitSnapshot(db, {
      clinicalUnitId: null,
      clinicalUnit: 'Enfermaria'
    });

    expect(result.clinicalUnit).toBe('Enfermaria');
    expect(result.clinicalUnitId).toBe('unit-1');
  });

  it('returns all-null when clinicalUnitId normalizes to empty and no clinicalUnit name is present at all', async () => {
    const db = makeFakeDb({});
    const result = await patientService.resolveClinicalUnitSnapshot(db, { clinicalUnitId: '   ' });
    expect(result).toEqual({ clinicalUnitId: null, clinicalUnit: null, unitAcronym: null });
  });

  it('generates an acronym via fillAcronym when the matched-by-name organization has no stored acronym', async () => {
    const organizationsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({ organizationId: 'unit-2', officialName: 'Pediatria', acronym: '' })
    });
    const db = makeFakeDb({ organizations: organizationsCollection });

    const result = await patientService.resolveClinicalUnitSnapshot(db, { clinicalUnit: 'pediatria' });

    expect(result.clinicalUnitId).toBe('unit-2');
    expect(result.unitAcronym).toBeTruthy();
  });
});

describe('PatientService.decryptSensitivePatientFields — empty-string plain value falls back to decrypting', () => {
  it('decrypts the encrypted payload when the plain field is an empty string', () => {
    const encrypted = patientService.encryptSensitivePatientFields({ representativeIdentityDocument: '52998224725' });
    const doc = { ...encrypted, representativeIdentityDocument: '' };

    const result = patientService.decryptSensitivePatientFields(doc);

    expect(result.representativeIdentityDocument).toBe('52998224725');
  });
});

describe('PatientService — branches no other case reaches (#1337)', () => {
  const participantIdentityService = require('../../src/services/participantIdentity.service');
  const logger = require('../../src/utils/logger');

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // A keyless stack (#1083): no blind index can be computed, so every
  // identity matcher falls back to the plaintext column.
  function keyless() {
    vi.spyOn(participantIdentityService, 'computeBlindIndexCandidates').mockReturnValue([]);
  }

  function findReturning(rows) {
    return vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue(rows)
    });
  }

  describe('encrypt/decryptSensitivePatientFields', () => {
    it('keeps a dadosEspecificos entry that is null or has no dados as it is', () => {
      const result = patientService.encryptSensitivePatientFields({
        dadosEspecificos: [null, { tipo: 'Outro' }]
      });

      expect(result.dadosEspecificos).toEqual([null, { tipo: 'Outro' }]);
    });

    it('keeps a plaintext value already present instead of decrypting its payload', () => {
      const result = patientService.decryptSensitivePatientFields({
        representativeIdentityDocument: '52998224725',
        representativeIdentityDocumentEncrypted: { bogus: true }
      });

      expect(result.representativeIdentityDocument).toBe('52998224725');
    });
  });

  describe('ensurePatientIndexes', () => {
    it('drops every legacy index and logs nothing when each is already gone', async () => {
      const warn = vi.spyOn(logger, 'warn');
      const collection = {
        dropIndex: vi.fn().mockRejectedValue(Object.assign(new Error('index not found'), { codeName: 'IndexNotFound' }))
      };

      await patientService.ensurePatientIndexes(collection, 'patients_1337_index_not_found');

      expect(collection.dropIndex).toHaveBeenCalledTimes(5);
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('handlePhoneUniqueConstraint', () => {
    it('returns without throwing when the error carries no key pattern or value', () => {
      expect(patientService.handlePhoneUniqueConstraint(undefined)).toBeUndefined();
    });

    it('answers 409 with an empty phone when neither the caller nor the error names one', () => {
      let thrown;
      try {
        patientService.handlePhoneUniqueConstraint({ keyPattern: { phone: 1 } });
      } catch (error) {
        thrown = error;
      }

      expect(thrown.statusCode).toBe(409);
      expect(thrown.message).toBe('Telefone  já cadastrado no sistema.');
    });
  });

  describe('assertPhoneAvailable', () => {
    it('reads no identity when no blind index can be computed', async () => {
      keyless();
      const db = makeFakeDb();

      await expect(patientService.assertPhoneAvailable(db, makeFakeCollection(), { participantId: '12345678' }, '11987654321'))
        .resolves.toBeUndefined();
      expect(db.collection).not.toHaveBeenCalled();
    });
  });

  describe('resolveClinicalUnitSnapshot', () => {
    it('returns a null name and acronym for an organization found by id with neither stored', async () => {
      const organizations = makeFakeCollection({ findOne: vi.fn().mockResolvedValue({ organizationId: 'ORG-1' }) });
      const db = makeFakeDb({ organizations });

      const result = await patientService.resolveClinicalUnitSnapshot(db, { clinicalUnitId: 'ORG-1' });

      expect(result).toEqual({ clinicalUnitId: 'ORG-1', clinicalUnit: null, unitAcronym: null });
    });

    it('returns a null name and acronym for an organization found by name with neither stored', async () => {
      const organizations = makeFakeCollection({ findOne: vi.fn().mockResolvedValue({ organizationId: 'ORG-2' }) });
      const db = makeFakeDb({ organizations });

      const result = await patientService.resolveClinicalUnitSnapshot(db, { clinicalUnit: 'Pediatria' });

      expect(result).toEqual({ clinicalUnitId: 'ORG-2', clinicalUnit: null, unitAcronym: null });
    });
  });

  describe('applyDeceasedRepresentativeRules', () => {
    it('refuses a deceased participant whose representative name is not text', () => {
      expect(() => patientService.applyDeceasedRepresentativeRules({
        isDeceased: true,
        representativeName: 42,
        representativeEmail: 'rep@example.com',
        representativeIdentityDocument: '52998224725',
        representativePhone: '11987654321'
      })).toThrow('Para paciente falecido');
    });
  });

  describe('checkIdentifierConflict / checkDuplicatePatient on a keyless stack', () => {
    it('matches the identity document on its plaintext column', async () => {
      keyless();
      const existing = { participantId: '87654321' };
      const participantIdentities = makeFakeCollection({ findOne: vi.fn().mockResolvedValue(existing) });
      const db = makeFakeDb({ participantIdentities });

      const result = await patientService.checkIdentifierConflict(db, { identityDocument: '529.982.247-25' });

      expect(participantIdentities.findOne).toHaveBeenCalledWith({ $or: [{ identityDocument: '52998224725' }] });
      expect(result).toEqual({ field: 'identityDocument', value: '52998224725', existing });
    });

    it('queries the plaintext birthDate range and skips an identity with no name', async () => {
      keyless();
      // The service's catch turns a crash into null, so only a silent
      // logger.error tells skipping the nameless identity from crashing on it.
      const errorSpy = vi.spyOn(logger, 'error');
      const participantIdentities = makeFakeCollection({
        find: findReturning([{ participantId: '87654321', birthDate: new Date('1990-01-01T12:00:00.000Z') }])
      });
      const db = makeFakeDb({ participantIdentities });

      const result = await patientService.checkDuplicatePatient(db, { patientName: 'Ana Silva', birthDate: '01/01/1990' });

      expect(result).toBeNull();
      const filter = participantIdentities.find.mock.calls[0][0];
      expect(filter.$or).toHaveLength(1);
      expect(filter.$or[0].birthDate.$gte).toBeInstanceOf(Date);
      expect(filter.$or[0].birthDate.$lt).toBeInstanceOf(Date);
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe('createPatient', () => {
    function payload(overrides = {}) {
      return {
        participantId: '12345678',
        patientName: 'Fabry Patient',
        birthDate: '01/01/1990',
        sex: 'F',
        identityDocument: '52998224725',
        recordNumber: 'REC-FABRY',
        clinicalUnit: 'UTI-A',
        email: 'fabry@example.com',
        phone: '11987654321',
        consentTemplateId: new ObjectId().toString(),
        ...overrides
      };
    }

    async function create(patientData) {
      const consentTemplates = makeFakeCollection({
        findOne: vi.fn().mockResolvedValue({ _id: new ObjectId(patientData.consentTemplateId) })
      });
      const db = makeFakeDb({ consent_templates: consentTemplates, patients: makeFakeCollection() });
      return patientService.createPatient(db, patientData, { skipConsentNotification: true });
    }

    it('folds a lysoGb3 given alone into a Fabry entry with no alphaGal', async () => {
      const result = await create(payload({ lysoGb3: 4.56 }));

      const fabryEntry = result.dadosEspecificos.find((entry) => entry.tipo === 'Fabry');
      expect(fabryEntry.dados).toEqual({ lysoGb3: 4.56 });
    });

    it('refuses a blank patientName', async () => {
      await expect(create(payload({ patientName: '   ' }))).rejects.toThrow('patientName é obrigatório');
    });

    it('refuses a missing birthDate', async () => {
      await expect(create(payload({ birthDate: undefined }))).rejects.toThrow('birthDate é obrigatório');
    });

    it('answers 422 with the validation errors when a required Patient field is missing', async () => {
      await expect(create(payload({ sex: undefined }))).rejects.toMatchObject({
        statusCode: 422,
        details: expect.arrayContaining(['sex é obrigatório'])
      });
    });
  });

  describe('searchPatients', () => {
    it('queries the plaintext birthDate on a keyless stack and adds no participant arm when none matches', async () => {
      keyless();
      const participantIdentities = makeFakeCollection({ find: findReturning([]) });
      const patients = makeFakeCollection();
      const db = makeFakeDb({ participantIdentities, patients });

      await patientService.searchPatients(db, '01/01/1990');

      const identityFilter = participantIdentities.find.mock.calls[0][0];
      expect(identityFilter.$or[0].birthDate.$gte).toBeInstanceOf(Date);
      const query = patients.find.mock.calls[0][0];
      expect(query.$or.some((arm) => arm.participantId)).toBe(false);
    });

    it('limits the search to the caller organization scope', async () => {
      const patients = makeFakeCollection();
      const db = makeFakeDb({ patients });

      await patientService.searchPatients(db, 'UTI', { scope: 'organization', organizationIds: ['org-1'] });

      const query = patients.find.mock.calls[0][0];
      expect(query.clinicalUnitId).toEqual({ $in: ['org-1'] });
    });
  });

  describe('updatePatient', () => {
    function updateDb(patientRow = null) {
      const patients = makeFakeCollection({ findOne: vi.fn().mockResolvedValue(patientRow) });
      const participantIdentities = makeFakeCollection();
      return { db: makeFakeDb({ patients, participantIdentities }), patients, participantIdentities };
    }

    it('answers 422 INVALID_FIELD_TYPE for a field of the wrong type', async () => {
      const { db } = updateDb();

      await expect(patientService.updatePatient(db, '12345678', { sex: 5 })).rejects.toMatchObject({
        statusCode: 422,
        code: 'INVALID_FIELD_TYPE',
        fields: ['sex deve ser um texto']
      });
    });

    it('stores a consent date given as a string as a Date', async () => {
      const { db, patients } = updateDb();

      await patientService.updatePatient(db, '12345678', { consentNotifiedAt: '2026-01-02T00:00:00.000Z' });

      const set = patients.updateOne.mock.calls[0][1].$set;
      expect(set.consentNotifiedAt).toEqual(new Date('2026-01-02T00:00:00.000Z'));
    });

    it('trims and uppercases a unitAcronym, and stores an empty one as null', async () => {
      const first = updateDb();
      await patientService.updatePatient(first.db, '12345678', { unitAcronym: ' uti ' });
      expect(first.patients.updateOne.mock.calls[0][1].$set.unitAcronym).toBe('UTI');

      const second = updateDb();
      await patientService.updatePatient(second.db, '12345678', { unitAcronym: '' });
      expect(second.patients.updateOne.mock.calls[0][1].$set.unitAcronym).toBeNull();
    });

    it('applies the representative rules against an empty record when the participant is not found first', async () => {
      const { db, patients, participantIdentities } = updateDb(null);

      await patientService.updatePatient(db, '12345678', { isDeceased: false });

      expect(participantIdentities.findOne).not.toHaveBeenCalled();
      expect(patients.updateOne.mock.calls[0][1].$set.isDeceased).toBe(false);
    });

    it('never writes a new participantId', async () => {
      const { db, patients } = updateDb();

      await patientService.updatePatient(db, '12345678', { participantId: '99999999', notes: 'x' });

      const set = patients.updateOne.mock.calls[0][1].$set;
      expect(set).not.toHaveProperty('participantId');
      expect(set.notes).toBe('x');
    });

    it('drops a null height and a non-numeric one without writing heightCm', async () => {
      for (const height of [null, 'abc']) {
        const { db, patients } = updateDb();
        await patientService.updatePatient(db, '12345678', { height });
        const set = patients.updateOne.mock.calls[0][1].$set;
        expect(set).not.toHaveProperty('height');
        expect(set).not.toHaveProperty('heightCm');
      }
    });

    it('unsets the legacy patients.recordNumber and syncs the number to the identity', async () => {
      const { db, patients, participantIdentities } = updateDb({ participantId: '12345678' });

      await patientService.updatePatient(db, '12345678', { recordNumber: '  REC-9  ' });

      expect(patients.updateOne.mock.calls[0][1].$unset).toEqual({ recordNumber: '' });
      expect(patients.updateOne.mock.calls[0][1].$set).not.toHaveProperty('recordNumber');
      expect(participantIdentities.updateOne).toHaveBeenCalledTimes(1);
    });
  });

  describe('acceptConsentToken', () => {
    it('refuses a null manifestation as a manifestation rejection', async () => {
      const { hashConsentToken } = require('../../src/utils/consentTokenHash');
      const patients = makeFakeCollection({
        findOne: vi.fn().mockResolvedValue({
          participantId: '12345678',
          status: 'PENDING_CONSENT',
          consentTokenHash: hashConsentToken('tok')
        })
      });
      const db = makeFakeDb({ patients });

      const error = await patientService.acceptConsentToken(db, '12345678', 'tok', null).catch((e) => e);

      expect(patientService.isConsentManifestationRejection(error)).toBe(true);
      expect(patients.updateOne).not.toHaveBeenCalled();
    });
  });
});
