import { describe, it, expect, vi } from 'vitest';

process.env.ENCRYPTION_KEY = 'dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGtleXQ=';
process.env.ENCRYPTION_KEY_ID = 'test-key-1';

const participantIdentityService = require('../../src/services/participantIdentity.service');

function makeFakeCollection(overrides = {}) {
  return {
    findOne: vi.fn().mockResolvedValue(null),
    ...overrides
  };
}

function makeFakeDb(collectionsByName = {}) {
  return {
    collection: vi.fn((name) => collectionsByName[name] || makeFakeCollection())
  };
}

describe('ParticipantIdentityService.getEncryptedFieldMap', () => {
  it('returns map for the three civil-identity fields (RF005/RNF007, dict-07 row 1, #566)', () => {
    const map = participantIdentityService.getEncryptedFieldMap();
    expect(map).toEqual({
      patientName: 'patientNameEncrypted',
      birthDate: 'birthDateEncrypted',
      identityDocument: 'identityDocumentEncrypted'
    });
  });
});

describe('ParticipantIdentityService.getHashFieldMap', () => {
  it('returns map for the two fields queried by exact/range match (RF005/RNF007, #574)', () => {
    expect(participantIdentityService.getHashFieldMap()).toEqual({
      identityDocument: 'identityDocumentHash',
      birthDate: 'birthDateHash'
    });
  });
});

describe('ParticipantIdentityService.computeBlindIndex', () => {
  it('is deterministic for the same identityDocument regardless of surrounding whitespace', () => {
    const a = participantIdentityService.computeBlindIndex('identityDocument', '11144477735');
    const b = participantIdentityService.computeBlindIndex('identityDocument', '  11144477735  ');
    expect(a).toBe(b);
  });

  it('is deterministic for the same birthDate calendar day regardless of time-of-day', () => {
    const a = participantIdentityService.computeBlindIndex('birthDate', new Date(1990, 0, 20, 3, 15));
    const b = participantIdentityService.computeBlindIndex('birthDate', new Date(1990, 0, 20, 23, 59));
    expect(a).toBe(b);
  });

  it('differs across different calendar days', () => {
    const a = participantIdentityService.computeBlindIndex('birthDate', new Date(1990, 0, 20));
    const b = participantIdentityService.computeBlindIndex('birthDate', new Date(1990, 0, 21));
    expect(a).not.toBe(b);
  });

  it('returns null for null/undefined/empty', () => {
    expect(participantIdentityService.computeBlindIndex('identityDocument', null)).toBeNull();
    expect(participantIdentityService.computeBlindIndex('identityDocument', undefined)).toBeNull();
    expect(participantIdentityService.computeBlindIndex('identityDocument', '')).toBeNull();
  });
});

describe('ParticipantIdentityService.encryptIdentityFields', () => {
  it('encrypts patientName/birthDate/identityDocument at rest without dropping the plaintext (dual-write, #566 is additive-only)', () => {
    const fields = {
      participantId: '12345678',
      patientName: 'Paciente QA Teste',
      birthDate: new Date('1990-01-20'),
      identityDocument: '11144477735'
    };

    const result = participantIdentityService.encryptIdentityFields(fields);

    // Ciphertext must not contain the plaintext value anywhere in its encoding.
    expect(JSON.stringify(result.patientNameEncrypted)).not.toContain('Paciente QA Teste');
    expect(JSON.stringify(result.identityDocumentEncrypted)).not.toContain('11144477735');
    expect(result.patientNameEncrypted).toMatchObject({ alg: 'aes-256-gcm', keyId: 'test-key-1' });
    expect(result.birthDateEncrypted).toMatchObject({ alg: 'aes-256-gcm', keyId: 'test-key-1' });
    expect(result.identityDocumentEncrypted).toMatchObject({ alg: 'aes-256-gcm', keyId: 'test-key-1' });

    // Existing consumers (#561-#564) still read these directly off the
    // document — dropping them now would regress every one of them.
    expect(result.patientName).toBe('Paciente QA Teste');
    expect(result.identityDocument).toBe('11144477735');

    // dict-02 P1X-0362: encryptionKeyVersion records the key used, for
    // auditable rotation.
    expect(result.encryptionKeyVersion).toBe('test-key-1');

    // RF005/RNF007 (#574): blind-index siblings for the two queried fields.
    expect(result.identityDocumentHash).toBe(participantIdentityService.computeBlindIndex('identityDocument', '11144477735'));
    expect(result.birthDateHash).toBe(participantIdentityService.computeBlindIndex('birthDate', new Date('1990-01-20')));
  });

  it('does not mutate the input object', () => {
    const fields = { participantId: '1', patientName: 'Ana' };
    participantIdentityService.encryptIdentityFields(fields);
    expect(Object.keys(fields)).not.toContain('patientNameEncrypted');
  });

  it('skips fields that are null/undefined/absent', () => {
    const result = participantIdentityService.encryptIdentityFields({ participantId: '1', patientName: null });
    expect(result.patientNameEncrypted).toBeUndefined();
    expect(result.encryptionKeyVersion).toBeUndefined();
  });
});

describe('ParticipantIdentityService.decryptIdentity', () => {
  it('roundtrip: encrypt then decrypt restores the original plaintext values', () => {
    const fields = {
      participantId: '12345678',
      patientName: 'Paciente QA Teste',
      birthDate: new Date('1990-01-20'),
      identityDocument: '11144477735'
    };
    const encrypted = participantIdentityService.encryptIdentityFields(fields);

    // Simulate a record where only ciphertext survived (the shape #565's
    // eventual cutover leaves behind).
    const ciphertextOnly = {
      ...encrypted,
      patientName: null,
      birthDate: null,
      identityDocument: null
    };

    const decrypted = participantIdentityService.decryptIdentity(ciphertextOnly);
    expect(decrypted.patientName).toBe('Paciente QA Teste');
    expect(decrypted.identityDocument).toBe('11144477735');
    expect(decrypted.birthDate).toBeInstanceOf(Date);
    expect(decrypted.birthDate.toISOString()).toBe(new Date('1990-01-20').toISOString());
  });

  it('falls back to the existing plaintext for legacy records with no ciphertext (pre-#566)', () => {
    const legacyIdentity = {
      participantId: '99999999',
      patientName: 'Registro Legado',
      birthDate: new Date('1980-05-05'),
      identityDocument: '22233344455'
    };

    const decrypted = participantIdentityService.decryptIdentity(legacyIdentity);
    expect(decrypted.patientName).toBe('Registro Legado');
    expect(decrypted.identityDocument).toBe('22233344455');
  });

  it('returns non-object input unchanged', () => {
    expect(participantIdentityService.decryptIdentity(null)).toBeNull();
    expect(participantIdentityService.decryptIdentity('x')).toBe('x');
  });
});

describe('ParticipantIdentityService.getIdentityByParticipantId', () => {
  it('resolves and decrypts the identity via the single #560 access path', async () => {
    const fields = {
      participantId: '12345678',
      patientName: 'Paciente QA Teste',
      birthDate: new Date('1990-01-20'),
      identityDocument: '11144477735'
    };
    const encrypted = participantIdentityService.encryptIdentityFields(fields);
    const stored = { ...encrypted, patientName: null, birthDate: null, identityDocument: null };

    const identitiesCollection = makeFakeCollection({ findOne: vi.fn().mockResolvedValue(stored) });
    const db = makeFakeDb({ participantIdentities: identitiesCollection });

    const identity = await participantIdentityService.getIdentityByParticipantId(db, '12345678');

    expect(identitiesCollection.findOne).toHaveBeenCalledWith({ participantId: '12345678' });
    expect(identity.patientName).toBe('Paciente QA Teste');
    expect(identity.identityDocument).toBe('11144477735');
  });

  it('returns null when no identity record exists', async () => {
    const db = makeFakeDb({ participantIdentities: makeFakeCollection() });
    const identity = await participantIdentityService.getIdentityByParticipantId(db, 'missing');
    expect(identity).toBeNull();
  });
});
