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
    ...overrides
  };
}

function makeFakeDb(collectionsByName = {}) {
  return {
    collection: vi.fn((name) => collectionsByName[name] || makeFakeCollection())
  };
}

describe('PatientService.encryptSensitivePatientFields — extra branches', () => {
  it('leaves an empty-string plain value untouched and never adds the encrypted field (encryptValue returns null)', () => {
    const patient = { representativeIdentityDocument: '' };
    const result = patientService.encryptSensitivePatientFields(patient);

    // encryptValue() returns null for '', so encryptedPayload is falsy: the plain
    // field must NOT be nulled out, and the *Encrypted sibling must not be created.
    expect(result.representativeIdentityDocument).toBe('');
    expect(result.representativeIdentityDocumentEncrypted).toBeUndefined();
  });

  it('encrypts a sensitive field found only inside a Fabry dadosEspecificos entry, without adding a top-level plain key', () => {
    const patient = {
      dadosEspecificos: [
        { tipo: 'Fabry', dados: { representativeIdentityDocument: '111.222.333-44' } }
      ]
    };

    const result = patientService.encryptSensitivePatientFields(patient);

    // Found via fabryEntry.dados, not top-level, so foundOnTop stays false:
    // the top-level plain key must never be created...
    expect(Object.prototype.hasOwnProperty.call(result, 'representativeIdentityDocument')).toBe(false);
    // ...while the encrypted sibling is set at the top level...
    expect(result.representativeIdentityDocumentEncrypted).toBeDefined();
    // ...and the nested dados value is nulled out so plaintext doesn't persist (#70).
    expect(result.dadosEspecificos[0].dados.representativeIdentityDocument).toBeNull();
  });

  it('leaves the document unchanged when a Fabry entry exists but lacks the sensitive field and there is no top-level field', () => {
    const patient = {
      dadosEspecificos: [{ tipo: 'Fabry', dados: { alphaGal: 5.0 } }]
    };

    const result = patientService.encryptSensitivePatientFields(patient);

    expect(Object.prototype.hasOwnProperty.call(result, 'representativeIdentityDocument')).toBe(false);
    expect(result.representativeIdentityDocumentEncrypted).toBeUndefined();
    expect(result.dadosEspecificos[0].dados).toEqual({ alphaGal: 5.0 });
  });
});

describe('PatientService.decryptSensitivePatientFields — extra branches', () => {
  it('uses the default parameter and returns an empty object when called with no arguments', () => {
    const result = patientService.decryptSensitivePatientFields();
    expect(result).toEqual({});
  });

  it('leaves the plain field unset when there is no encrypted payload to fall back to', () => {
    const patient = { patientID: '12345678' };
    const result = patientService.decryptSensitivePatientFields(patient);

    expect(result.representativeIdentityDocument).toBeUndefined();
  });

  it('leaves the plain field unset (no throw) when the encrypted payload references an unknown keyId', () => {
    const patient = {
      representativeIdentityDocumentEncrypted: {
        alg: 'aes-256-gcm',
        v: 1,
        keyId: 'unknown-key-id',
        iv: 'aaaa',
        tag: 'bbbb',
        data: 'cccc'
      }
    };

    const result = patientService.decryptSensitivePatientFields(patient);

    // decryptValue() itself logs+returns null for an unrecognized keyId rather than
    // throwing, so decryptSensitivePatientFields must not populate the plain field.
    expect(result.representativeIdentityDocument).toBeUndefined();
  });
});

describe('PatientService.resolveClinicalUnitSnapshot — pre-existing acronym branch', () => {
  it('uses the clinical unit record acronym as-is (by ObjectId lookup) without falling back to fillAcronym', async () => {
    const id = new ObjectId();
    const clinicalUnitsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({ _id: id, name: 'Unidade de Nefrologia', acronym: 'NEFRO' })
    });
    const db = makeFakeDb({ clinical_units: clinicalUnitsCollection });

    const result = await patientService.resolveClinicalUnitSnapshot(db, { clinicalUnitId: id.toString() });

    expect(result).toEqual({
      clinicalUnitId: id.toString(),
      clinicalUnit: 'Unidade de Nefrologia',
      unitAcronym: 'NEFRO'
    });
  });
});

describe('PatientService.getPatientsCollection', () => {
  it('resolves the patients collection and ensures its indexes are created', async () => {
    const collectionName = `patients_gpc_${Date.now()}`;
    const patientsCollection = makeFakeCollection();
    // collectionName mirrors what a real MongoDB Collection instance exposes.
    Object.defineProperty(patientsCollection, 'collectionName', { value: collectionName });
    const db = makeFakeDb({ patients: patientsCollection });

    const result = await patientService.getPatientsCollection(db);

    expect(db.collection).toHaveBeenCalledWith('patients');
    expect(result).toBe(patientsCollection);
    expect(patientsCollection.createIndex).toHaveBeenCalledTimes(4);
  });

  it('falls back to the literal "patients" name when the collection has no collectionName property', async () => {
    const patientsCollection = makeFakeCollection();
    const db = makeFakeDb({ patients: patientsCollection });

    const result = await patientService.getPatientsCollection(db);

    expect(result).toBe(patientsCollection);
    // Falling back to the 'patients' literal still lets indexes be created normally.
    expect(patientsCollection.createIndex).toHaveBeenCalledTimes(4);
  });
});
