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
    const clinicalUnitsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({ _id: 'unit-1', name: 'Enfermaria', acronym: '' })
    });
    const db = makeFakeDb({ clinical_units: clinicalUnitsCollection, patients: makeFakeCollection() });

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

  it('generates an acronym via fillAcronym when the matched-by-name unit has no stored acronym', async () => {
    const clinicalUnitsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({ _id: 'unit-2', name: 'Pediatria', acronym: '' })
    });
    const db = makeFakeDb({ clinical_units: clinicalUnitsCollection });

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
