import { describe, it, expect, vi, afterEach } from 'vitest';

process.env.ENCRYPTION_KEY = 'dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGtleXQ=';
process.env.ENCRYPTION_KEY_ID = 'test-key-1';

const participantIdentityService = require('../../src/services/participantIdentity.service');
const keyRegistry = require('../../src/config/keyRegistry');

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
  it('returns map for the three civil-identity fields plus the contact, the representative and the record number (RF005/RNF007, dict-07 row 1, #566, #1166, #1168, #1386)', () => {
    const map = participantIdentityService.getEncryptedFieldMap();
    expect(map).toEqual({
      patientName: 'patientNameCiphertext',
      birthDate: 'birthDateCiphertext',
      identityDocument: 'identityDocumentCiphertext',
      email: 'emailCiphertext',
      phone: 'phoneCiphertext',
      representativeName: 'representativeNameCiphertext',
      representativeEmail: 'representativeEmailCiphertext',
      representativeIdentityDocument: 'representativeIdentityDocumentCiphertext',
      representativePhone: 'representativePhoneCiphertext',
      recordNumber: 'recordNumberCiphertext'
    });
  });
});

describe('ParticipantIdentityService.getHashFieldMap', () => {
  it('returns map for the fields queried by exact/range match (RF005/RNF007, #574, #1104, #1386) plus phone uniqueness (#1166)', () => {
    expect(participantIdentityService.getHashFieldMap()).toEqual({
      patientName: 'patientNameHash',
      identityDocument: 'identityDocumentHash',
      birthDate: 'birthDateHash',
      phone: 'phoneHash',
      recordNumber: 'recordNumberHash'
    });
  });
});

describe('ParticipantIdentityService.computeBlindIndex', () => {
  it('is deterministic for the same identityDocument regardless of surrounding whitespace', () => {
    const a = participantIdentityService.computeBlindIndex('identityDocument', '11144477735');
    const b = participantIdentityService.computeBlindIndex('identityDocument', '  11144477735  ');
    expect(a).toBe(b);
  });

  // #1109: the write side stored the document verbatim while
  // patient.service.js#checkIdentifierConflict searched for the digits-only
  // form, so a CPF typed as 111.444.777-35 hashed differently at write time
  // and at query time and the uniqueness check missed it entirely.
  it('#1109: is deterministic for the same identityDocument regardless of punctuation', () => {
    const a = participantIdentityService.computeBlindIndex('identityDocument', '11144477735');
    const b = participantIdentityService.computeBlindIndex('identityDocument', '111.444.777-35');
    expect(a).toBe(b);
  });

  it('#1109: still differs across genuinely different documents', () => {
    const a = participantIdentityService.computeBlindIndex('identityDocument', '111.444.777-35');
    const b = participantIdentityService.computeBlindIndex('identityDocument', '529.982.247-25');
    expect(a).not.toBe(b);
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

  // #1104: listPatients' name filter is an exact match on this hash, so it
  // has to agree with the in-memory comparison PatientIdentityService and
  // intakeWizard's /patient-match already make.
  it('#1104: is the same patientName hash regardless of accents, case and spacing', () => {
    const a = participantIdentityService.computeBlindIndex('patientName', 'José  da Silva');
    const b = participantIdentityService.computeBlindIndex('patientName', ' jose DA silva ');
    expect(a).toBeTruthy();
    expect(a).toBe(b);
  });

  it('#1104: still differs across genuinely different names', () => {
    const a = participantIdentityService.computeBlindIndex('patientName', 'José da Silva');
    const b = participantIdentityService.computeBlindIndex('patientName', 'José da Silveira');
    expect(a).not.toBe(b);
  });

  it('#1104: returns null for a whitespace-only patientName', () => {
    expect(participantIdentityService.computeBlindIndex('patientName', '   ')).toBeNull();
  });

  it('returns null for null/undefined/empty', () => {
    expect(participantIdentityService.computeBlindIndex('identityDocument', null)).toBeNull();
    expect(participantIdentityService.computeBlindIndex('identityDocument', undefined)).toBeNull();
    expect(participantIdentityService.computeBlindIndex('identityDocument', '')).toBeNull();
  });
});

describe('ParticipantIdentityService.computeBlindIndexCandidates', () => {
  // #1099: the query-side counterpart of computeBlindIndex. It fans out over
  // every registered key so a value indexed before an ENCRYPTION_KEY rotation
  // stays matchable; the rotation behaviour itself is pinned in
  // fieldEncryption.test.js, which can bust the keyRegistry module cache.
  // Here the contract that matters is that it agrees with computeBlindIndex
  // on normalization -- if the two ever normalize differently, a write and
  // its own query stop matching.
  it('contains the computeBlindIndex hash for the same value (#1099)', () => {
    const candidates = participantIdentityService.computeBlindIndexCandidates('identityDocument', '11144477735');
    expect(candidates).toContain(participantIdentityService.computeBlindIndex('identityDocument', '11144477735'));
  });

  it('applies the SAME normalization as computeBlindIndex -- whitespace (#1099)', () => {
    const candidates = participantIdentityService.computeBlindIndexCandidates('identityDocument', '  11144477735  ');
    expect(candidates).toContain(participantIdentityService.computeBlindIndex('identityDocument', '11144477735'));
  });

  // #1109: import.service.js#importPatients passes patientData.identityDocument
  // through UNNORMALIZED, so the query-side fan-out has to strip punctuation
  // itself -- normalizing only at the write site would leave that dedup blind.
  it('#1109: applies the SAME normalization as computeBlindIndex -- punctuation', () => {
    const candidates = participantIdentityService.computeBlindIndexCandidates('identityDocument', '111.444.777-35');
    expect(candidates).toContain(participantIdentityService.computeBlindIndex('identityDocument', '11144477735'));
  });

  it('applies the SAME normalization as computeBlindIndex -- birthDate calendar day (#1099)', () => {
    const a = participantIdentityService.computeBlindIndexCandidates('birthDate', new Date(1990, 0, 20, 3, 15));
    const b = participantIdentityService.computeBlindIndexCandidates('birthDate', new Date(1990, 0, 20, 23, 59));
    expect(a).toEqual(b);
    expect(a).toContain(participantIdentityService.computeBlindIndex('birthDate', new Date(1990, 0, 20)));
  });

  it('returns an EMPTY LIST for null/undefined/empty, so callers keep the plaintext arm (#1099)', () => {
    expect(participantIdentityService.computeBlindIndexCandidates('identityDocument', null)).toEqual([]);
    expect(participantIdentityService.computeBlindIndexCandidates('identityDocument', undefined)).toEqual([]);
    expect(participantIdentityService.computeBlindIndexCandidates('identityDocument', '')).toEqual([]);
    expect(participantIdentityService.computeBlindIndexCandidates('birthDate', null)).toEqual([]);
  });
});

describe('ParticipantIdentityService.encryptIdentityFields', () => {
  it('encrypts patientName/birthDate/identityDocument at rest, ciphertext-only (#566, #1104)', () => {
    const fields = {
      participantId: '12345678',
      patientName: 'Paciente QA Teste',
      birthDate: new Date('1990-01-20'),
      identityDocument: '11144477735'
    };

    const result = participantIdentityService.encryptIdentityFields(fields);

    // Ciphertext must not contain the plaintext value anywhere in its encoding.
    expect(JSON.stringify(result.patientNameCiphertext)).not.toContain('Paciente QA Teste');
    expect(JSON.stringify(result.identityDocumentCiphertext)).not.toContain('11144477735');
    expect(result.patientNameCiphertext).toMatchObject({ alg: 'aes-256-gcm', keyId: 'test-key-1' });
    expect(result.birthDateCiphertext).toMatchObject({ alg: 'aes-256-gcm', keyId: 'test-key-1' });
    expect(result.identityDocumentCiphertext).toMatchObject({ alg: 'aes-256-gcm', keyId: 'test-key-1' });

    // #1104: dict-07 row 1 ("cifrar") -- a field encrypted beside its own
    // plaintext copy is not encrypted at rest, and decryptIdentity prefers
    // the plaintext whenever it is present.
    expect(result.patientName).toBeNull();
    expect(result.birthDate).toBeNull();
    expect(result.identityDocument).toBeNull();

    // dict-02 P1X-0362: encryptionKeyVersion records the key used, for
    // auditable rotation.
    expect(result.encryptionKeyVersion).toBe('test-key-1');

    // RF005/RNF007 (#574, #1104): blind-index siblings for the three
    // queried fields.
    expect(result.patientNameHash).toBe(participantIdentityService.computeBlindIndex('patientName', 'Paciente QA Teste'));
    expect(result.identityDocumentHash).toBe(participantIdentityService.computeBlindIndex('identityDocument', '11144477735'));
    expect(result.birthDateHash).toBe(participantIdentityService.computeBlindIndex('birthDate', new Date('1990-01-20')));
  });

  // #1109: every writer other than createPatient handed this function the
  // raw value, so the stored plaintext, its ciphertext and its blind index
  // all carried punctuation the query side had already stripped.
  it('#1109: canonicalizes a punctuated identityDocument across plaintext, ciphertext and hash', () => {
    const result = participantIdentityService.encryptIdentityFields({
      participantId: '12345678',
      identityDocument: '111.444.777-35',
    });

    // #1104: the plaintext is dropped, so the canonical form is read back
    // through the ciphertext.
    expect(participantIdentityService.decryptIdentity(result).identityDocument).toBe('11144477735');
    expect(result.identityDocumentHash).toBe(participantIdentityService.computeBlindIndex('identityDocument', '11144477735'));
    expect(JSON.stringify(result.identityDocumentCiphertext)).not.toContain('111.444.777-35');
  });

  // #1109 control: a document with no punctuation is untouched, so a red
  // here means the fixture is wrong rather than the bug reproduced.
  it('#1109 control: leaves an already-canonical identityDocument unchanged', () => {
    const result = participantIdentityService.encryptIdentityFields({
      participantId: '12345678',
      identityDocument: '11144477735',
    });

    expect(participantIdentityService.decryptIdentity(result).identityDocument).toBe('11144477735');
  });

  it('does not mutate the input object', () => {
    const fields = { participantId: '1', patientName: 'Ana' };
    participantIdentityService.encryptIdentityFields(fields);
    expect(Object.keys(fields)).not.toContain('patientNameCiphertext');
  });

  it('skips fields that are null/undefined/absent', () => {
    const result = participantIdentityService.encryptIdentityFields({ participantId: '1', patientName: null });
    expect(result.patientNameCiphertext).toBeUndefined();
    expect(result.encryptionKeyVersion).toBeUndefined();
  });
});

describe('ParticipantIdentityService.encryptIdentityFields -- birthDate ciphertext-only (#1104)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // #574 is TITLED for this cutover and closed on its precondition only.
  // dict-07 row 1 requires birthDate encrypted at rest, and a field
  // encrypted BESIDE its own plaintext copy does not satisfy that --
  // decryptIdentity prefers the plaintext whenever it is present, so the
  // ciphertext branch was never taken for a current row.
  it('#1104: writes NO plaintext birthDate once the ciphertext exists', () => {
    const result = participantIdentityService.encryptIdentityFields({
      participantId: '12345678',
      birthDate: new Date(1990, 0, 20),
    });

    expect(result.birthDate).toBeNull();
    expect(result.birthDateCiphertext).toMatchObject({ alg: 'aes-256-gcm', keyId: 'test-key-1' });
    expect(result.birthDateHash).toBe(
      participantIdentityService.computeBlindIndex('birthDate', new Date(1990, 0, 20))
    );
  });

  // The value must still be recoverable -- the cutover moves birthDate from
  // plaintext to ciphertext, it does not drop it.
  it('#1104: the dropped plaintext birthDate round-trips back through decryptIdentity', () => {
    const encrypted = participantIdentityService.encryptIdentityFields({
      participantId: '12345678',
      birthDate: new Date(1990, 0, 20),
    });

    const decrypted = participantIdentityService.decryptIdentity(encrypted);

    expect(decrypted.birthDate).toBeInstanceOf(Date);
    expect(decrypted.birthDate.getFullYear()).toBe(1990);
    expect(decrypted.birthDate.getMonth()).toBe(0);
    expect(decrypted.birthDate.getDate()).toBe(20);
  });

  // #1083 PRECONDITION, and the reason the drop is conditional rather than
  // unconditional. That issue deliberately left THIS service degrading to
  // plaintext when no key is configured -- its own comment says so, "that is
  // right for participantIdentity.service, whose map is deliberately additive
  // pending #574". Dropping the plaintext unconditionally inverts that: a
  // keyless stack would write no plaintext, no ciphertext and no hash, and
  // still answer 201.
  it('#1104/#1083: KEEPS the plaintext birthDate when no ciphertext could be produced', () => {
    vi.spyOn(keyRegistry, 'getActiveKey').mockReturnValue(null);

    const result = participantIdentityService.encryptIdentityFields({
      participantId: '12345678',
      birthDate: new Date(1990, 0, 20),
    });

    expect(result.birthDateCiphertext).toBeUndefined();
    expect(result.birthDate).toBeInstanceOf(Date);
    expect(result.birthDate.getFullYear()).toBe(1990);
  });

  // The second half of the cutover: patientName's one plaintext query became
  // an exact match on patientNameHash, and identityDocument's $or plaintext
  // arms became hash-only, so neither needs its plaintext at rest.
  it('#1104: writes NO plaintext patientName or identityDocument once the ciphertext exists, and both round-trip', () => {
    const result = participantIdentityService.encryptIdentityFields({
      participantId: '12345678',
      patientName: 'Paciente QA Teste',
      identityDocument: '11144477735',
    });

    expect(result.patientName).toBeNull();
    expect(result.identityDocument).toBeNull();
    expect(result.patientNameCiphertext).toMatchObject({ alg: 'aes-256-gcm', keyId: 'test-key-1' });
    expect(result.identityDocumentCiphertext).toMatchObject({ alg: 'aes-256-gcm', keyId: 'test-key-1' });

    const decrypted = participantIdentityService.decryptIdentity(result);
    expect(decrypted.patientName).toBe('Paciente QA Teste');
    expect(decrypted.identityDocument).toBe('11144477735');
  });

  // #1083, as for birthDate above: a keyless stack must keep the value.
  it('#1104/#1083: KEEPS the plaintext patientName and identityDocument when no ciphertext could be produced', () => {
    vi.spyOn(keyRegistry, 'getActiveKey').mockReturnValue(null);

    const result = participantIdentityService.encryptIdentityFields({
      participantId: '12345678',
      patientName: 'Paciente QA Teste',
      identityDocument: '111.444.777-35',
    });

    expect(result.patientNameCiphertext).toBeUndefined();
    expect(result.patientName).toBe('Paciente QA Teste');
    expect(result.identityDocument).toBe('11144477735');
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

// dict-02 P1X-0352/P1X-0353 (#1166): participant email and phone are
// ParticipantIdentity fields, "MongoDB protegido". Since slice 4 they are
// ciphertext-only: every reader decrypts, and no query reads the plaintext.
describe('ParticipantIdentityService -- contact fields encrypted at rest (#1166)', () => {
  it('#1166: encrypts email and phone and drops the plaintext (slice 4)', () => {
    const result = participantIdentityService.encryptIdentityFields({
      participantId: '12345678',
      email: 'maria@example.com',
      phone: '11987654321',
    });

    expect(result.emailCiphertext).toBeTruthy();
    expect(result.phoneCiphertext).toBeTruthy();
    expect(JSON.stringify(result.emailCiphertext)).not.toContain('maria@example.com');
    expect(result.email).toBeNull();
    expect(result.phone).toBeNull();
  });

  // #1168: the representative's four fields (dict-02 P1X-0357..0360) are
  // enciphered and ciphertext-only too. Nothing queries them, so no hash.
  it('#1168: encrypts the representative fields ciphertext-only, and they round-trip', () => {
    const result = participantIdentityService.encryptIdentityFields({ participantId: '12345678', ...{ representativeName: 'Rep Legal', representativeEmail: 'rep@example.com', representativeIdentityDocument: '98765432100', representativePhone: '11955554444' } });

    for (const field of ['representativeName', 'representativeEmail', 'representativeIdentityDocument', 'representativePhone']) {
      expect(result[`${field}Ciphertext`]).toBeTruthy();
      expect(result[field]).toBeNull();
    }
    const decrypted = participantIdentityService.decryptIdentity(result);
    expect(decrypted.representativeIdentityDocument).toBe('98765432100');
    expect(decrypted.representativeEmail).toBe('rep@example.com');
  });

  // #1166 slice 4: the Patient copy is no longer written, so it is no longer
  // a fallback either. A stale one left on an un-migrated row must not win.
  it('#1166: withIdentityContact takes the contact from the identity record only', () => {
    const resolved = participantIdentityService.withIdentityContact(
      { participantId: '12345678', email: 'stale@example.com', phone: '11900000000' },
      { participantId: '12345678', email: null, phone: null }
    );

    expect(resolved.email ?? null).toBeNull();
    expect(resolved.phone ?? null).toBeNull();
  });

  it('#1166: withIdentityContact overlays the identity contact (control)', () => {
    const resolved = participantIdentityService.withIdentityContact(
      { participantId: '12345678', status: 'PENDING_CONSENT' },
      { email: 'maria@example.com', phone: '11987654321' }
    );

    expect(resolved).toMatchObject({ status: 'PENDING_CONSENT', email: 'maria@example.com', phone: '11987654321' });
  });

  it('#1166: email and phone round-trip through decryptIdentity from ciphertext alone', () => {
    const encrypted = participantIdentityService.encryptIdentityFields({
      participantId: '12345678',
      email: 'maria@example.com',
      phone: '11987654321',
    });

    const decrypted = participantIdentityService.decryptIdentity({ ...encrypted, email: null, phone: null });

    expect(decrypted.email).toBe('maria@example.com');
    expect(decrypted.phone).toBe('11987654321');
  });

  it('#1166: writes a phoneHash, and a punctuated phone hashes like its digits', () => {
    const result = participantIdentityService.encryptIdentityFields({ participantId: '12345678', phone: '11987654321' });

    expect(result.phoneHash).toBeTruthy();
    expect(participantIdentityService.computeBlindIndex('phone', '(11) 98765-4321')).toBe(result.phoneHash);
    expect(participantIdentityService.computeBlindIndex('phone', '11912345678')).not.toBe(result.phoneHash);
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
