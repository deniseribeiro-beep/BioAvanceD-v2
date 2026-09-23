import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

process.env.ENCRYPTION_KEY = 'dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGtleXQ=';
process.env.ENCRYPTION_KEY_ID = 'test-key-1';

const patientService = require('../../src/services/patient.service');
const { ObjectId } = require('mongodb');

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
    dropIndex: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

function makeFakeDb(collectionsByName = {}) {
  return {
    collection: vi.fn((name) => collectionsByName[name] || makeFakeCollection())
  };
}

describe('PatientService.resolveClinicalUnitSnapshot', () => {
  it('returns null when neither clinicalUnitId nor clinicalUnit is present in the payload', async () => {
    const db = makeFakeDb({});
    const result = await patientService.resolveClinicalUnitSnapshot(db, {});
    expect(result).toBeNull();
  });

  it('returns all-null snapshot when both are present but normalize to empty', async () => {
    const db = makeFakeDb({});
    const result = await patientService.resolveClinicalUnitSnapshot(db, { clinicalUnitId: '', clinicalUnit: '' });
    expect(result).toEqual({ clinicalUnitId: null, clinicalUnit: null, unitAcronym: null });
  });

  it('throws when clinicalUnitId does not resolve to an organization and no clinicalUnit name is given', async () => {
    const db = makeFakeDb({ organizations: makeFakeCollection({ findOne: vi.fn().mockResolvedValue(null) }) });
    await expect(
      patientService.resolveClinicalUnitSnapshot(db, { clinicalUnitId: 'not-an-organization-id' })
    ).rejects.toThrow('Unidade clínica não encontrada');
  });

  it('resolves by organizationId when the organization exists', async () => {
    const id = new ObjectId().toString();
    const organizationsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({ organizationId: id, officialName: 'UTI Central', acronym: '' })
    });
    const db = makeFakeDb({ organizations: organizationsCollection });

    const result = await patientService.resolveClinicalUnitSnapshot(db, { clinicalUnitId: id });

    expect(result.clinicalUnitId).toBe(id);
    expect(result.clinicalUnit).toBe('UTI Central');
    expect(result.unitAcronym).toBeTruthy();
  });

  it('throws when a clinicalUnitId does not match any organization', async () => {
    const id = new ObjectId().toString();
    const organizationsCollection = makeFakeCollection({ findOne: vi.fn().mockResolvedValue(null) });
    const db = makeFakeDb({ organizations: organizationsCollection });

    await expect(
      patientService.resolveClinicalUnitSnapshot(db, { clinicalUnitId: id })
    ).rejects.toThrow('Unidade clínica não encontrada');
  });

  it('falls back to the clinicalUnit name lookup when clinicalUnitId does not resolve but a name is provided', async () => {
    const organizationsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({ organizationId: 'x1', officialName: 'UTI-B', acronym: 'UB' })
    });
    const db = makeFakeDb({ organizations: organizationsCollection });

    const result = await patientService.resolveClinicalUnitSnapshot(db, {
      clinicalUnitId: 'not-an-organization-id',
      clinicalUnit: 'uti-b'
    });

    expect(result.clinicalUnitId).toBe('x1');
    expect(result.clinicalUnit).toBe('UTI-B');
    expect(result.unitAcronym).toBe('UB');
  });

  it('returns all-null snapshot when clinicalUnitId is absent and clinicalUnit normalizes to empty', async () => {
    const db = makeFakeDb({});
    const result = await patientService.resolveClinicalUnitSnapshot(db, { clinicalUnit: '   ' });
    expect(result).toEqual({ clinicalUnitId: null, clinicalUnit: null, unitAcronym: null });
  });

  it('resolves clinicalUnitId against organizations when it matches an Organization reference (P1X-0356)', async () => {
    const organizationsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({
        organizationId: 'a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7',
        officialName: 'Hospital das Clínicas',
        acronym: 'HC'
      })
    });
    const db = makeFakeDb({ organizations: organizationsCollection });

    const result = await patientService.resolveClinicalUnitSnapshot(db, {
      clinicalUnitId: 'a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7'
    });

    expect(organizationsCollection.findOne).toHaveBeenCalledWith({
      organizationId: 'a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7'
    });
    expect(result).toEqual({
      clinicalUnitId: 'a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7',
      clinicalUnit: 'Hospital das Clínicas',
      unitAcronym: 'HC'
    });
  });

  it('throws when clinicalUnitId is Organization-reference-shaped but matches no Organization and no name is given', async () => {
    const organizationsCollection = makeFakeCollection({ findOne: vi.fn().mockResolvedValue(null) });
    const db = makeFakeDb({ organizations: organizationsCollection });

    await expect(
      patientService.resolveClinicalUnitSnapshot(db, { clinicalUnitId: 'a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7' })
    ).rejects.toThrow('Unidade clínica não encontrada');
  });

  it('falls back to a normalized-name-only snapshot when no organization matches by name', async () => {
    const organizationsCollection = makeFakeCollection({ findOne: vi.fn().mockResolvedValue(null) });
    const db = makeFakeDb({ organizations: organizationsCollection });

    const result = await patientService.resolveClinicalUnitSnapshot(db, { clinicalUnit: 'nova unidade' });

    expect(result.clinicalUnitId).toBeNull();
    expect(result.clinicalUnit).toBe('NOVA UNIDADE');
    expect(result.unitAcronym).toBeTruthy();
  });
});

describe('PatientService.ensurePatientIndexes', () => {
  it('does nothing when collection or collectionName is missing', async () => {
    await expect(patientService.ensurePatientIndexes(null, 'patients')).resolves.toBeUndefined();
    await expect(patientService.ensurePatientIndexes({}, null)).resolves.toBeUndefined();
  });

  // RF005/RNF007 (#575): patients_name_document_text_v1/patients_name_idx_v1
  // are dropped, not created. #1166 slice 4: so is the phone index, whose
  // column is gone -- only the recordNumber index is createIndex'd now.
  it('creates the one remaining index, drops the four legacy names, and memoizes so a second call is a no-op', async () => {
    const collection = makeFakeCollection();
    const collectionName = `patients_test_${Date.now()}`;

    await patientService.ensurePatientIndexes(collection, collectionName);
    expect(collection.createIndex).toHaveBeenCalledTimes(1);
    expect(collection.dropIndex).toHaveBeenCalledWith('patients_name_document_text_v1');
    expect(collection.dropIndex).toHaveBeenCalledWith('patients_name_idx_v1');

    await patientService.ensurePatientIndexes(collection, collectionName);
    expect(collection.createIndex).toHaveBeenCalledTimes(1);
    expect(collection.dropIndex).toHaveBeenCalledTimes(4);
  });

  // #1165: the v1 spec filtered on `{ $type: 'string', $ne: '' }`, and `$ne`
  // is not an operator Mongo accepts in a partialFilterExpression -- on
  // mongo:7 createIndex failed with code 67 (CannotCreateIndex), the catch
  // logged one warn, and phone uniqueness was never enforced, leaving
  // handlePhoneUniqueConstraint's "Telefone ... já cadastrado" branch unreachable.
  // `{ $gt: '' }` is the same intent ("a non-empty string") in a legal form,
  // and one the planner can also use for lookups (#1164).
  // #1166 slice 4: that v2 index is superseded in turn. The column it indexed
  // is no longer written, and phone uniqueness lives on
  // participant_identities_phone_hash_unique_v1.
  it('#1166: no longer builds a patients phone index, and drops v2', async () => {
    const collection = makeFakeCollection();

    await patientService.ensurePatientIndexes(collection, `patients_test_1166_${Date.now()}`);

    expect(collection.createIndex.mock.calls.find(([keys]) => keys.phone === 1)).toBeUndefined();
    expect(collection.dropIndex).toHaveBeenCalledWith('patients_phone_unique_sanitized_v2');
  });

  // The v1 name could not be created on any compose-pinned mongo:7, but the
  // drop costs nothing and keeps a collection from carrying both if it ever was.
  it('drops the superseded patients_phone_unique_sanitized_v1 name', async () => {
    const collection = makeFakeCollection();

    await patientService.ensurePatientIndexes(collection, `patients_test_1165_drop_${Date.now()}`);

    expect(collection.dropIndex).toHaveBeenCalledWith('patients_phone_unique_sanitized_v1');
  });

  it('logs a warning and continues when an index creation fails', async () => {
    const collection = makeFakeCollection({
      createIndex: vi.fn().mockRejectedValue(new Error('index conflict'))
    });
    const collectionName = `patients_test_fail_${Date.now()}`;

    await expect(patientService.ensurePatientIndexes(collection, collectionName)).resolves.toBeUndefined();
    expect(collection.createIndex).toHaveBeenCalledTimes(1);
  });
});

describe('PatientService.checkIdentifierConflict', () => {
  it('returns null when neither identityDocument nor recordNumber is provided', async () => {
    const db = makeFakeDb({});
    const result = await patientService.checkIdentifierConflict(db, {});
    expect(result).toBeNull();
  });

  it('returns null when no existing patient matches the filters', async () => {
    const patientsCollection = makeFakeCollection({ findOne: vi.fn().mockResolvedValue(null) });
    const db = makeFakeDb({ patients: patientsCollection });

    const result = await patientService.checkIdentifierConflict(db, { identityDocument: '529.982.247-25' });
    expect(result).toBeNull();
  });

  it('flags identityDocument conflict when the normalized digits match (#561: resolved via ParticipantIdentity)', async () => {
    const participantIdentitiesCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({ identityDocument: '529.982.247-25' })
    });
    const db = makeFakeDb({ participantIdentities: participantIdentitiesCollection });

    const result = await patientService.checkIdentifierConflict(db, { identityDocument: '52998224725' });
    expect(result).toEqual({ field: 'identityDocument', value: '52998224725', existing: expect.anything() });
  });

  it('flags recordNumber conflict when identityDocument does not match but recordNumber does', async () => {
    const participantIdentitiesCollection = makeFakeCollection({ findOne: vi.fn().mockResolvedValue(null) });
    const patientsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({ identityDocument: '00000000000', recordNumber: 'RN-1' })
    });
    const db = makeFakeDb({ patients: patientsCollection, participantIdentities: participantIdentitiesCollection });

    const result = await patientService.checkIdentifierConflict(db, {
      identityDocument: '52998224725',
      recordNumber: 'RN-1'
    });
    expect(result).toEqual({ field: 'recordNumber', value: 'RN-1', existing: expect.anything() });
  });

  it('checks identityDocument (ParticipantIdentity) before recordNumber (Patient) when both are provided', async () => {
    const participantIdentitiesCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({ identityDocument: '52998224725' })
    });
    const patientsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({ recordNumber: 'RN-1' })
    });
    const db = makeFakeDb({ patients: patientsCollection, participantIdentities: participantIdentitiesCollection });

    const result = await patientService.checkIdentifierConflict(db, {
      identityDocument: '52998224725',
      recordNumber: 'RN-1'
    });
    expect(result.field).toBe('identityDocument');
    expect(patientsCollection.findOne).not.toHaveBeenCalled();
  });
});

describe('PatientService.checkDuplicatePatient', () => {
  it('returns null when patientName or birthDate is missing', async () => {
    const db = makeFakeDb({});
    const result = await patientService.checkDuplicatePatient(db, { patientName: 'Maria' });
    expect(result).toBeNull();
  });

  it('returns null when birthDate string cannot be parsed into a valid Date', async () => {
    const db = makeFakeDb({});
    const result = await patientService.checkDuplicatePatient(db, {
      patientName: 'Maria',
      birthDate: 'not-a-date'
    });
    expect(result).toBeNull();
  });

  it('finds a duplicate by normalized name and DD/MM/YYYY birthDate string (#561: resolved via ParticipantIdentity)', async () => {
    const toArrayMock = vi.fn().mockResolvedValue([
      { patientName: '  Maria   Silva ', birthDate: new Date(1990, 0, 1) }
    ]);
    const participantIdentitiesCollection = makeFakeCollection({
      find: vi.fn().mockReturnValue({ toArray: toArrayMock })
    });
    const db = makeFakeDb({ participantIdentities: participantIdentitiesCollection });

    const result = await patientService.checkDuplicatePatient(db, {
      patientName: 'maria silva',
      birthDate: '01/01/1990'
    });

    expect(result).not.toBeNull();
    expect(result.patientName).toBe('  Maria   Silva ');
  });

  it('accepts a birthDate already given as a Date instance and returns null when no name matches', async () => {
    const toArrayMock = vi.fn().mockResolvedValue([{ patientName: 'Other Person', birthDate: new Date(1990, 0, 1) }]);
    const participantIdentitiesCollection = makeFakeCollection({
      find: vi.fn().mockReturnValue({ toArray: toArrayMock })
    });
    const db = makeFakeDb({ participantIdentities: participantIdentitiesCollection });

    const result = await patientService.checkDuplicatePatient(db, {
      patientName: 'maria silva',
      birthDate: new Date(1990, 0, 1)
    });

    expect(result).toBeNull();
  });

  it('returns null and logs when the collection lookup throws', async () => {
    const participantIdentitiesCollection = makeFakeCollection({
      find: vi.fn().mockImplementation(() => { throw new Error('db down'); })
    });
    const db = makeFakeDb({ participantIdentities: participantIdentitiesCollection });

    const result = await patientService.checkDuplicatePatient(db, { patientName: 'Maria', birthDate: '01/01/1990' });
    expect(result).toBeNull();
  });
});

describe('PatientService.getPatient / updatePatient / deletePatient — ObjectId lookup path', () => {
  it('getPatient queries by ObjectId when participantId is not an 8-digit string', async () => {
    const id = new ObjectId();
    const patientsCollection = makeFakeCollection({ findOne: vi.fn().mockResolvedValue({ _id: id }) });
    const db = makeFakeDb({ patients: patientsCollection });

    await patientService.getPatient(db, id.toString());

    expect(patientsCollection.findOne).toHaveBeenCalledWith({ _id: expect.any(ObjectId) });
  });

  it('deletePatient queries by ObjectId when participantId is not an 8-digit string', async () => {
    const id = new ObjectId();
    const patientsCollection = makeFakeCollection({ deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }) });
    const db = makeFakeDb({ patients: patientsCollection });

    const result = await patientService.deletePatient(db, id.toString());

    expect(patientsCollection.deleteOne).toHaveBeenCalledWith({ _id: expect.any(ObjectId) });
    expect(result).toBe(true);
  });

  it('updatePatient queries by ObjectId when participantId is not an 8-digit string', async () => {
    const id = new ObjectId();
    const patientsCollection = makeFakeCollection({
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
      findOne: vi.fn().mockResolvedValue({ _id: id })
    });
    const db = makeFakeDb({ patients: patientsCollection });

    await patientService.updatePatient(db, id.toString(), { alphaGal: 1.0 });

    expect(patientsCollection.updateOne).toHaveBeenCalledWith(
      { _id: expect.any(ObjectId) },
      expect.anything()
    );
  });
});

describe('PatientService.searchPatients — date-search branches', () => {
  function findWithResults(results) {
    return vi.fn().mockReturnValue({ limit: vi.fn().mockReturnThis(), toArray: vi.fn().mockResolvedValue(results) });
  }

  it('adds a participantId $in filter, resolved via ParticipantIdentity, for a valid DD/MM/YYYY term (#561)', async () => {
    const findMock = findWithResults([]);
    const patientsCollection = makeFakeCollection({ find: findMock, countDocuments: vi.fn().mockResolvedValue(0) });
    const identitiesFindMock = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([{ participantId: '11111111' }]) });
    const participantIdentitiesCollection = makeFakeCollection({ find: identitiesFindMock });
    const db = makeFakeDb({ patients: patientsCollection, participantIdentities: participantIdentitiesCollection });

    await patientService.searchPatients(db, '15/03/2000');

    const identityQuery = identitiesFindMock.mock.calls[0][0];
    // #1104: birthDate is ciphertext-only, so the day-range branch is gone and
    // the query narrows on birthDateHash alone -- the same shape the other
    // three birthDate matching sites now use.
    expect(identityQuery.$or.some((clause) => clause.birthDateHash)).toBe(true);
    expect(identityQuery.$or.some((clause) => clause.birthDate)).toBe(false);

    const passedQuery = findMock.mock.calls[0][0];
    expect(passedQuery.$or).toEqual(expect.arrayContaining([{ participantId: { $in: ['11111111'] } }]));
  });

  it('does not add a birthDate filter when a slash-term does not split into 3 parts', async () => {
    const findMock = findWithResults([]);
    const patientsCollection = makeFakeCollection({ find: findMock, countDocuments: vi.fn().mockResolvedValue(0) });
    const db = makeFakeDb({ patients: patientsCollection });

    await patientService.searchPatients(db, '15/2000');

    const passedQuery = findMock.mock.calls[0][0];
    expect(passedQuery.$or.some((clause) => clause.birthDate)).toBe(false);
  });

  it('adds a participantId $in filter, resolved via ParticipantIdentity, for a valid YYYY-MM-DD term (#561)', async () => {
    const findMock = findWithResults([]);
    const patientsCollection = makeFakeCollection({ find: findMock, countDocuments: vi.fn().mockResolvedValue(0) });
    const identitiesFindMock = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([{ participantId: '22222222' }]) });
    const participantIdentitiesCollection = makeFakeCollection({ find: identitiesFindMock });
    const db = makeFakeDb({ patients: patientsCollection, participantIdentities: participantIdentitiesCollection });

    await patientService.searchPatients(db, '2000-03-15');

    const passedQuery = findMock.mock.calls[0][0];
    expect(passedQuery.$or).toEqual(expect.arrayContaining([{ participantId: { $in: ['22222222'] } }]));
  });

  it('does not add a birthDate filter for an unparseable YYYY-MM-DD-shaped term', async () => {
    const findMock = findWithResults([]);
    const patientsCollection = makeFakeCollection({ find: findMock, countDocuments: vi.fn().mockResolvedValue(0) });
    const db = makeFakeDb({ patients: patientsCollection });

    await patientService.searchPatients(db, 'not-a-date');

    const passedQuery = findMock.mock.calls[0][0];
    expect(passedQuery.$or.some((clause) => clause.birthDate)).toBe(false);
  });

  it('adds a numeric recordNumber clause when the term parses as a number', async () => {
    const findMock = findWithResults([]);
    const patientsCollection = makeFakeCollection({ find: findMock, countDocuments: vi.fn().mockResolvedValue(0) });
    const db = makeFakeDb({ patients: patientsCollection });

    await patientService.searchPatients(db, '42');

    const passedQuery = findMock.mock.calls[0][0];
    expect(passedQuery.$or).toEqual(expect.arrayContaining([{ recordNumber: 42 }]));
  });

  it('logs and rethrows when the collection lookup throws', async () => {
    const patientsCollection = makeFakeCollection({
      find: vi.fn().mockImplementation(() => { throw new Error('db down'); })
    });
    const db = makeFakeDb({ patients: patientsCollection });

    await expect(patientService.searchPatients(db, 'UTI-A')).rejects.toThrow('db down');
  });
});
