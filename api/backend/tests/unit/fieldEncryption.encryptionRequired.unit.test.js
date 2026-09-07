/**
 * #1083: with ENCRYPTION_KEY unset, `representativeIdentityDocument`
 * (Patient) and a biomarker observation's `value` were stored in PLAINTEXT
 * and the write still returned success.
 *
 * `encryptValue` returns `null` with a single `warn` when no key is
 * configured, and every caller reads that `null` as "skip this field" --
 * with the plaintext-clearing step *inside* the `if`. So the ciphertext
 * sibling was never written and the plaintext survived into Mongo, while
 * the stack booted clean and answered 201. Both shipped templates ship the
 * key blank (`.env.docker.example:42`, `.env.production.example:29`).
 *
 * This is the field-level sibling of #938 (uploads) and #734 (backups), and
 * the remedy is theirs: an assertion at the CALL SITES that must not
 * degrade, not a change to `encryptValue`'s return contract. That keeps the
 * empty-input `null` contract intact -- `''`/`null`/`undefined` still
 * return null, `0` and `false` still encrypt -- which existing tests pin.
 *
 * RNF020 AC#3 / RNF007: encryption at rest for civil-identity data is the
 * standing classification, so the opt-out has to be explicit and absent by
 * default, exactly as #938 made it for files.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const keyRegistry = require('../../src/config/keyRegistry');
const fieldEncryption = require('../../src/utils/fieldEncryption');
const patientService = require('../../src/services/patient.service');
const biomarkerObservationService = require('../../src/services/biomarker-observation.service');

const OPT_OUT = 'ALLOW_UNENCRYPTED_FIELD_STORAGE';

function withoutKey() {
  vi.spyOn(keyRegistry, 'getActiveKey').mockReturnValue(null);
}

function withKey() {
  vi.spyOn(keyRegistry, 'getActiveKey').mockReturnValue(Buffer.alloc(32, 1));
}

// Copied from patient.service.encryption-clinicalunit.gaps.unit.test.js so
// the update path's arrange block is the one its passing siblings use.
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

describe('#1083 field encryption-required gate', () => {
  const originalOptOut = process.env[OPT_OUT];

  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env[OPT_OUT];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalOptOut === undefined) delete process.env[OPT_OUT];
    else process.env[OPT_OUT] = originalOptOut;
  });

  describe('the primitive', () => {
    it('reports field encryption as unavailable when no key is configured', () => {
      withoutKey();

      expect(fieldEncryption.isFieldEncryptionAvailable()).toBe(false);
    });

    it('reports field encryption as available when a key is configured', () => {
      withKey();

      expect(fieldEncryption.isFieldEncryptionAvailable()).toBe(true);
    });

    it('THROWS for a keyless deployment rather than letting the caller store plaintext', () => {
      withoutKey();

      expect(() => fieldEncryption.assertFieldEncryptionConfigured('123.456.789-00'))
        .toThrow(/ENCRYPTION_KEY/);
    });

    it('names the opt-out in the error, so the message is actionable rather than just a refusal', () => {
      withoutKey();

      expect(() => fieldEncryption.assertFieldEncryptionConfigured('123.456.789-00'))
        .toThrow(new RegExp(OPT_OUT));
    });

    it('carries a 500 statusCode so a controller maps it without inventing one', () => {
      withoutKey();

      try {
        fieldEncryption.assertFieldEncryptionConfigured('123.456.789-00');
        throw new Error('should have thrown');
      } catch (error) {
        expect(error.statusCode).toBe(500);
      }
    });

    it('does not throw when a key is configured', () => {
      withKey();

      expect(() => fieldEncryption.assertFieldEncryptionConfigured('123.456.789-00')).not.toThrow();
    });

    // encryptValue returns null for these regardless of key state, and no
    // plaintext survives -- so there is nothing to protect and refusing
    // would break the empty-string branch its own tests already pin.
    it('does not throw for an empty value even with no key, matching encryptValue\'s empty-input contract', () => {
      withoutKey();

      for (const value of [undefined, null, '']) {
        expect(() => fieldEncryption.assertFieldEncryptionConfigured(value)).not.toThrow();
      }
    });

    // 0 and false ARE encrypted by encryptValue, so they must be gated.
    it('throws for falsy-but-encryptable values (0 and false), which encryptValue does encrypt', () => {
      withoutKey();

      expect(() => fieldEncryption.assertFieldEncryptionConfigured(0)).toThrow(/ENCRYPTION_KEY/);
      expect(() => fieldEncryption.assertFieldEncryptionConfigured(false)).toThrow(/ENCRYPTION_KEY/);
    });

    it('allows plaintext ONLY when the opt-out is set explicitly to true', () => {
      withoutKey();

      process.env[OPT_OUT] = 'true';
      expect(() => fieldEncryption.assertFieldEncryptionConfigured('123.456.789-00')).not.toThrow();
    });

    it('does not accept a merely truthy opt-out value', () => {
      withoutKey();

      for (const value of ['1', 'yes', 'TRUE ', 'false', '']) {
        process.env[OPT_OUT] = value;
        expect(() => fieldEncryption.assertFieldEncryptionConfigured('123.456.789-00')).toThrow();
      }
    });

    // encryptValue itself is deliberately unchanged: its null return is the
    // contract participantIdentity.service is written against (#574), and
    // four existing test files pin the empty-input half of it.
    it('leaves encryptValue returning null rather than throwing', () => {
      withoutKey();

      expect(fieldEncryption.encryptValue('secret')).toBeNull();
    });
  });

  describe('PatientService.encryptSensitivePatientFields (create path)', () => {
    it('THROWS instead of leaving representativeIdentityDocument in plaintext when no key is configured', () => {
      withoutKey();

      expect(() => patientService.encryptSensitivePatientFields({
        representativeIdentityDocument: '123.456.789-00'
      })).toThrow(/ENCRYPTION_KEY/);
    });

    it('THROWS for the same field found only inside a Fabry dadosEspecificos entry', () => {
      withoutKey();

      expect(() => patientService.encryptSensitivePatientFields({
        dadosEspecificos: [
          { tipo: 'Fabry', dados: { representativeIdentityDocument: '111.222.333-44' } }
        ]
      })).toThrow(/ENCRYPTION_KEY/);
    });

    // CONTROL: unchanged before and after the fix.
    it('still encrypts and nulls the plaintext when a key IS configured', () => {
      withKey();

      const result = patientService.encryptSensitivePatientFields({
        representativeIdentityDocument: '123.456.789-00'
      });

      expect(result.representativeIdentityDocumentEncrypted).toBeDefined();
      expect(result.representativeIdentityDocument).toBeNull();
    });

    // CONTROL: no sensitive field present, so nothing to protect.
    it('does not throw with no key when the document carries no sensitive field', () => {
      withoutKey();

      expect(() => patientService.encryptSensitivePatientFields({ name: 'X' })).not.toThrow();
    });

    // CONTROL: pins the empty-string branch
    // patient.service.encryption-clinicalunit.gaps.unit.test.js:37 asserts.
    it('does not throw with no key for an empty-string value, and leaves it untouched', () => {
      withoutKey();

      const result = patientService.encryptSensitivePatientFields({
        representativeIdentityDocument: ''
      });

      expect(result.representativeIdentityDocument).toBe('');
      expect(result.representativeIdentityDocumentEncrypted).toBeUndefined();
    });
  });

  describe('PatientService.updatePatient (update path)', () => {
    it('THROWS instead of writing representativeIdentityDocument in plaintext when no key is configured', async () => {
      withoutKey();
      const db = makeFakeDb();

      await expect(patientService.updatePatient(db, 'PART-1', {
        representativeIdentityDocument: '123.456.789-00'
      })).rejects.toThrow(/ENCRYPTION_KEY/);
    });

    // CONTROL: no sensitive field in the update, so the gate must stay out
    // of the way even on a keyless stack.
    it('does not throw on the encryption gate with no key when the update carries no sensitive field', async () => {
      withoutKey();
      const db = makeFakeDb();

      await expect(patientService.updatePatient(db, 'PART-1', { name: 'X' }))
        .resolves.not.toThrow();
    });
  });

  describe('BiomarkerObservationService.encryptObservationValue', () => {
    it('THROWS instead of leaving the observation value in plaintext when no key is configured', () => {
      withoutKey();

      expect(() => biomarkerObservationService.encryptObservationValue({ value: 42 }))
        .toThrow(/ENCRYPTION_KEY/);
    });

    // CONTROL: unchanged before and after the fix.
    it('still encrypts and nulls the value when a key IS configured', () => {
      withKey();

      const result = biomarkerObservationService.encryptObservationValue({ value: 42 });

      expect(result.valueEncrypted).toBeDefined();
      expect(result.value).toBeNull();
    });

    // CONTROL: no value to protect.
    it('does not throw with no key when the observation carries no value', () => {
      withoutKey();

      expect(() => biomarkerObservationService.encryptObservationValue({})).not.toThrow();
    });
  });
});
