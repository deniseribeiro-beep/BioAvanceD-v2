import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.ENCRYPTION_KEY = 'dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGtleXQ=';
process.env.ENCRYPTION_KEY_ID = 'test-key-1';

const patientService = require('../../src/services/patient.service');

describe('PatientService.getEncryptedFieldMap', () => {
  it('returns map with expected fields', () => {
    const map = patientService.getEncryptedFieldMap();
    expect(map).toHaveProperty('alphaGal', 'alphaGalEncrypted');
    expect(map).toHaveProperty('lysoGb3', 'lysoGb3Encrypted');
    expect(map).toHaveProperty('representativeCpf', 'representativeCpfEncrypted');
  });
});

describe('PatientService.encryptSensitivePatientFields', () => {
  it('returns unchanged object when no sensitive fields present', () => {
    const patient = { patientID: '12345678', name: 'João' };
    const result = patientService.encryptSensitivePatientFields(patient);
    expect(result.patientID).toBe('12345678');
    expect(result.name).toBe('João');
  });

  it('encrypts alphaGal field and sets it to null', () => {
    const patient = { patientID: '12345678', alphaGal: 3.5 };
    const result = patientService.encryptSensitivePatientFields(patient);
    expect(result.alphaGal).toBeNull();
    expect(result.alphaGalEncrypted).toBeDefined();
    expect(typeof result.alphaGalEncrypted).toBe('object');
  });

  it('encrypts lysoGb3 field and sets it to null', () => {
    const patient = { patientID: '12345678', lysoGb3: 1.2 };
    const result = patientService.encryptSensitivePatientFields(patient);
    expect(result.lysoGb3).toBeNull();
    expect(result.lysoGb3Encrypted).toBeDefined();
  });

  it('encrypts representativeCpf field', () => {
    const patient = { representativeCpf: '123.456.789-00' };
    const result = patientService.encryptSensitivePatientFields(patient);
    expect(result.representativeCpf).toBeNull();
    expect(result.representativeCpfEncrypted).toBeDefined();
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
    const patient = { representativeCpf: '529.982.247-25' };
    const encrypted = patientService.encryptSensitivePatientFields(patient);
    const decrypted = patientService.decryptSensitivePatientFields(encrypted);
    expect(decrypted.representativeCpf).toBe('529.982.247-25');
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

describe('PatientService.createBiomarkerObservationsFromPatient', () => {
  it('returns early when db is null', async () => {
    await expect(patientService.createBiomarkerObservationsFromPatient(null, {})).resolves.toBeUndefined();
  });

  it('returns early when patient is null', async () => {
    const db = {};
    await expect(patientService.createBiomarkerObservationsFromPatient(db, null)).resolves.toBeUndefined();
  });

  it('returns early when patientID is not 8 digits', async () => {
    const db = {};
    const patient = { patientID: '123', alphaGal: 2.0 };
    await expect(patientService.createBiomarkerObservationsFromPatient(db, patient)).resolves.toBeUndefined();
  });

  it('skips biomarker when value is null', async () => {
    const biomarkerObservationService = require('../../src/services/biomarker-observation.service');
    const createSpy = vi.spyOn(biomarkerObservationService, 'createObservation').mockResolvedValue({});

    const db = { collection: vi.fn() };
    const patient = { patientID: '12345678', alphaGal: null, lysoGb3: null };
    await patientService.createBiomarkerObservationsFromPatient(db, patient);
    expect(createSpy).not.toHaveBeenCalled();
    createSpy.mockRestore();
  });
});
