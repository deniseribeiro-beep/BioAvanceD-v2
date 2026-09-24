import { describe, it, expect, vi } from 'vitest';

process.env.ENCRYPTION_KEY = 'dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGtleXQ=';
process.env.ENCRYPTION_KEY_ID = 'test-key-1';

const patientService = require('../../src/services/patient.service');

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

function validPatientData(overrides = {}) {
  return {
    participantId: '12345678',
    patientName: 'Maria Silva',
    birthDate: '01/01/1990',
    sex: 'F',
    email: 'maria@example.com',
    consentTemplateId: '507f1f77bcf86cd799439011',
    ...overrides
  };
}

describe('PatientService.normalizerepresentativeIdentityDocument', () => {
  it('returns null for undefined/null', () => {
    expect(patientService.normalizerepresentativeIdentityDocument(undefined)).toBeNull();
    expect(patientService.normalizerepresentativeIdentityDocument(null)).toBeNull();
  });

  it('strips non-digit characters', () => {
    expect(patientService.normalizerepresentativeIdentityDocument('529.982-247/25')).toBe('52998224725');
  });

  it('returns null when the result is empty after stripping', () => {
    expect(patientService.normalizerepresentativeIdentityDocument('abc-...')).toBeNull();
  });
});

describe('PatientService.normalizeRepresentativePhone', () => {
  it('delegates to normalizePhone (strips non-digits)', () => {
    expect(patientService.normalizeRepresentativePhone('(11) 98888-7777')).toBe('11988887777');
  });

  it('returns null for undefined', () => {
    expect(patientService.normalizeRepresentativePhone(undefined)).toBeNull();
  });
});

describe('PatientService.applyDeceasedRepresentativeRules', () => {
  it('nulls out all representative fields when isDeceased is not true', () => {
    const payload = {
      isDeceased: false,
      representativeName: 'Someone',
      representativeEmail: 'someone@example.com',
      representativeIdentityDocument: '52998224725',
      representativePhone: '11988887777'
    };

    patientService.applyDeceasedRepresentativeRules(payload);

    expect(payload.isDeceased).toBe(false);
    expect(payload.representativeName).toBeNull();
    expect(payload.representativeEmail).toBeNull();
    expect(payload.representativeIdentityDocument).toBeNull();
    expect(payload.representativePhone).toBeNull();
  });

  it('coerces a non-boolean-true isDeceased value to false and clears fields', () => {
    const payload = { isDeceased: 'yes', representativeName: 'Someone' };

    patientService.applyDeceasedRepresentativeRules(payload);

    expect(payload.isDeceased).toBe(false);
    expect(payload.representativeName).toBeNull();
  });

  it('throws when isDeceased is true and required representative fields are missing', () => {
    const payload = { isDeceased: true, representativeName: '', representativeEmail: '', representativeIdentityDocument: '', representativePhone: '' };

    expect(() => patientService.applyDeceasedRepresentativeRules(payload)).toThrow(
      'Para paciente falecido, nome, e-mail, identityDocument e telefone do representante legal são obrigatórios'
    );
  });

  it('throws when the representative email is invalid', () => {
    const payload = {
      isDeceased: true,
      representativeName: 'Someone',
      representativeEmail: 'not-an-email',
      representativeIdentityDocument: '52998224725',
      representativePhone: '11988887777'
    };

    expect(() => patientService.applyDeceasedRepresentativeRules(payload)).toThrow('Email do representante legal inválido');
  });

  it('throws when the representative identityDocument does not have 11 digits', () => {
    const payload = {
      isDeceased: true,
      representativeName: 'Someone',
      representativeEmail: 'someone@example.com',
      representativeIdentityDocument: '123',
      representativePhone: '11988887777'
    };

    expect(() => patientService.applyDeceasedRepresentativeRules(payload)).toThrow(
      'identityDocument do representante legal inválido. Informe 11 dígitos'
    );
  });

  it('throws when the representative phone has too few digits', () => {
    const payload = {
      isDeceased: true,
      representativeName: 'Someone',
      representativeEmail: 'someone@example.com',
      representativeIdentityDocument: '52998224725',
      representativePhone: '123'
    };

    expect(() => patientService.applyDeceasedRepresentativeRules(payload)).toThrow(
      'Telefone do representante legal inválido. Informe de 10 a 15 dígitos'
    );
  });

  it('throws when the representative phone has too many digits', () => {
    const payload = {
      isDeceased: true,
      representativeName: 'Someone',
      representativeEmail: 'someone@example.com',
      representativeIdentityDocument: '52998224725',
      representativePhone: '1198888777712345'
    };

    expect(() => patientService.applyDeceasedRepresentativeRules(payload)).toThrow(
      'Telefone do representante legal inválido. Informe de 10 a 15 dígitos'
    );
  });

  it('normalizes and keeps valid representative fields when isDeceased is true', () => {
    const payload = {
      isDeceased: true,
      representativeName: '  João Representante  ',
      representativeEmail: '  JOAO@Example.com ',
      representativeIdentityDocument: '529.982.247-25',
      representativePhone: '(11) 98888-7777'
    };

    patientService.applyDeceasedRepresentativeRules(payload);

    expect(payload.representativeName).toBe('João Representante');
    expect(payload.representativeEmail).toBe('joao@example.com');
    expect(payload.representativeIdentityDocument).toBe('52998224725');
    expect(payload.representativePhone).toBe('11988887777');
  });
});

describe('PatientService.normalizeEmail', () => {
  it('returns null for undefined/null', () => {
    expect(patientService.normalizeEmail(undefined)).toBeNull();
    expect(patientService.normalizeEmail(null)).toBeNull();
  });

  it('trims and lowercases', () => {
    expect(patientService.normalizeEmail('  Maria@EXAMPLE.com  ')).toBe('maria@example.com');
  });

  it('returns null when trimming produces an empty string', () => {
    expect(patientService.normalizeEmail('   ')).toBeNull();
  });
});

describe('PatientService.normalizePhone', () => {
  it('returns null for undefined/null', () => {
    expect(patientService.normalizePhone(undefined)).toBeNull();
    expect(patientService.normalizePhone(null)).toBeNull();
  });

  it('returns null when there are no digits at all', () => {
    expect(patientService.normalizePhone('abc-def')).toBeNull();
  });

  it('strips non-digit characters, keeping only digits', () => {
    expect(patientService.normalizePhone('+55 (11) 98888-7777')).toBe('5511988887777');
  });
});

describe('PatientService.normalizeidentityDocument', () => {
  it('returns null for undefined/null', () => {
    expect(patientService.normalizeidentityDocument(undefined)).toBeNull();
    expect(patientService.normalizeidentityDocument(null)).toBeNull();
  });

  it('strips non-digit characters', () => {
    expect(patientService.normalizeidentityDocument('529.982.247-25')).toBe('52998224725');
  });

  it('returns null when the result is empty after stripping', () => {
    expect(patientService.normalizeidentityDocument('---')).toBeNull();
  });
});

describe('PatientService.normalizeRecordNumber', () => {
  it('returns null for undefined/null', () => {
    expect(patientService.normalizeRecordNumber(undefined)).toBeNull();
    expect(patientService.normalizeRecordNumber(null)).toBeNull();
  });

  it('trims surrounding whitespace', () => {
    expect(patientService.normalizeRecordNumber('  REC-001  ')).toBe('REC-001');
  });

  it('returns null when the value is only whitespace', () => {
    expect(patientService.normalizeRecordNumber('   ')).toBeNull();
  });
});

describe('PatientService.checkIdentifierConflict', () => {
  it('returns null when neither identityDocument nor recordNumber normalizes to a value', () => {
    const db = makeFakeDb();
    return expect(
      patientService.checkIdentifierConflict(db, { identityDocument: '   ', recordNumber: null })
    ).resolves.toBeNull();
  });

  it('returns null when no existing identity/patient matches', async () => {
    const patientsCollection = makeFakeCollection({ findOne: vi.fn().mockResolvedValue(null) });
    const participantIdentitiesCollection = makeFakeCollection({ findOne: vi.fn().mockResolvedValue(null) });
    const db = makeFakeDb({ participants: patientsCollection, participantIdentities: participantIdentitiesCollection });

    const result = await patientService.checkIdentifierConflict(db, { identityDocument: '52998224725' });

    expect(result).toBeNull();
  });

  it('reports an identityDocument conflict when the existing record matches on identityDocument (#561: resolved via ParticipantIdentity)', async () => {
    const participantIdentitiesCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({ identityDocument: '529.982.247-25' })
    });
    const db = makeFakeDb({ participantIdentities: participantIdentitiesCollection });

    const result = await patientService.checkIdentifierConflict(db, {
      identityDocument: '52998224725',
      recordNumber: 'REC-1'
    });

    expect(result).toEqual({ field: 'identityDocument', value: '52998224725', existing: expect.any(Object) });
  });

  it('reports a recordNumber conflict when the existing record matches on recordNumber only', async () => {
    const participantIdentitiesCollection = makeFakeCollection({ findOne: vi.fn().mockResolvedValue(null) });
    const patientsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({ identityDocument: 'DIFFERENT', recordNumber: 'REC-1' })
    });
    const db = makeFakeDb({ participants: patientsCollection, participantIdentities: participantIdentitiesCollection });

    const result = await patientService.checkIdentifierConflict(db, {
      identityDocument: '52998224725',
      recordNumber: 'REC-1'
    });

    expect(result).toEqual({ field: 'recordNumber', value: 'REC-1', existing: expect.any(Object) });
  });
});

describe('PatientService.checkDuplicatePatient', () => {
  it('returns null when patientName is missing', async () => {
    const db = makeFakeDb();
    const result = await patientService.checkDuplicatePatient(db, { birthDate: '01/01/1990' });
    expect(result).toBeNull();
  });

  it('returns null when birthDate is missing', async () => {
    const db = makeFakeDb();
    const result = await patientService.checkDuplicatePatient(db, { patientName: 'Maria Silva' });
    expect(result).toBeNull();
  });

  it('matches an existing identity when birthDate is already a Date instance (#561: resolved via ParticipantIdentity)', async () => {
    const participantIdentitiesCollection = makeFakeCollection({
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ patientName: 'Maria Silva', birthDate: new Date(1990, 0, 1) }])
      })
    });
    const db = makeFakeDb({ participantIdentities: participantIdentitiesCollection });

    const result = await patientService.checkDuplicatePatient(db, {
      patientName: '  MARIA   SILVA ',
      birthDate: new Date(1990, 0, 1)
    });

    expect(result).toEqual({ patientName: 'Maria Silva', birthDate: new Date(1990, 0, 1) });
  });

  it('matches an existing identity when birthDate is a DD/MM/YYYY string', async () => {
    const participantIdentitiesCollection = makeFakeCollection({
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ patientName: 'Maria Silva', birthDate: new Date(1990, 0, 1) }])
      })
    });
    const db = makeFakeDb({ participantIdentities: participantIdentitiesCollection });

    const result = await patientService.checkDuplicatePatient(db, {
      patientName: 'Maria Silva',
      birthDate: '01/01/1990'
    });

    expect(result).toEqual({ patientName: 'Maria Silva', birthDate: new Date(1990, 0, 1) });
  });

  it('parses a non-DD/MM/YYYY string birthDate via the generic Date constructor', async () => {
    const participantIdentitiesCollection = makeFakeCollection({
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ patientName: 'Maria Silva', birthDate: new Date(1990, 0, 1) }])
      })
    });
    const db = makeFakeDb({ participantIdentities: participantIdentitiesCollection });

    const result = await patientService.checkDuplicatePatient(db, {
      patientName: 'Maria Silva',
      birthDate: new Date(1990, 0, 1).toISOString()
    });

    expect(result).toEqual({ patientName: 'Maria Silva', birthDate: new Date(1990, 0, 1) });
  });

  it('returns null when birthDate parses to an invalid date', async () => {
    const db = makeFakeDb();
    const result = await patientService.checkDuplicatePatient(db, {
      patientName: 'Maria Silva',
      birthDate: 'not-a-date'
    });
    expect(result).toBeNull();
  });

  it('returns null when no candidate matches the normalized name', async () => {
    const participantIdentitiesCollection = makeFakeCollection({
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ patientName: 'Ana Souza', birthDate: new Date(1990, 0, 1) }])
      })
    });
    const db = makeFakeDb({ participantIdentities: participantIdentitiesCollection });

    const result = await patientService.checkDuplicatePatient(db, {
      patientName: 'Maria Silva',
      birthDate: '01/01/1990'
    });

    expect(result).toBeNull();
  });
});

describe('PatientService.createPatient consentTemplateId branches', () => {
  it('rejects when consentTemplateId is missing outside of the test environment', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const db = makeFakeDb();
      await expect(
        patientService.createPatient(db, validPatientData({ consentTemplateId: undefined }), {
          skipConsentNotification: true,
          skipBiomarkerArtifacts: true
        })
      ).rejects.toThrow('Template de consentimento (consentTemplateId) é obrigatório');
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('rejects when consentTemplateId is missing in the test environment too (no env carve-out)', async () => {
    // consentTemplateId is required unconditionally -- there is no NODE_ENV
    // carve-out (issue #240: a prior test-env carve-out here was neutralized
    // by PatientModel.validate() enforcing the field regardless of env, so it
    // was removed rather than propagated).
    const db = makeFakeDb();

    await expect(
      patientService.createPatient(db, validPatientData({ consentTemplateId: undefined }), {
        skipConsentNotification: true,
        skipBiomarkerArtifacts: true
      })
    ).rejects.toThrow('Template de consentimento (consentTemplateId) é obrigatório');
  });
});

describe('PatientService.createPatient identifier-conflict handling', () => {
  it('rejects with a 409 and identityDocument-specific message on an identityDocument conflict (#561: resolved via ParticipantIdentity)', async () => {
    const consentTemplatesCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({ _id: '507f1f77bcf86cd799439011' })
    });
    const participantIdentitiesCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({ identityDocument: '52998224725' })
    });
    const db = makeFakeDb({ participantIdentities: participantIdentitiesCollection, consentTemplates: consentTemplatesCollection });

    await expect(
      patientService.createPatient(db, validPatientData({ identityDocument: '52998224725' }), {
        skipConsentNotification: true,
        skipBiomarkerArtifacts: true
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'identityDocument 52998224725 já cadastrado no sistema.'
    });
  });

  it('rejects with a 409 and recordNumber-specific message on a recordNumber-only conflict', async () => {
    const consentTemplatesCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({ _id: '507f1f77bcf86cd799439011' })
    });
    const patientsCollection = makeFakeCollection({
      findOne: vi.fn().mockResolvedValue({ identityDocument: 'DIFFERENT', recordNumber: 'REC-1' })
    });
    const db = makeFakeDb({ participants: patientsCollection, consentTemplates: consentTemplatesCollection });

    await expect(
      patientService.createPatient(db, validPatientData({ recordNumber: 'REC-1' }), {
        skipConsentNotification: true,
        skipBiomarkerArtifacts: true
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'Prontuário REC-1 já cadastrado no sistema.'
    });
  });

  // #561: checkIdentifierConflict no longer builds a combined $or across
  // both fields on one collection — identityDocument (ParticipantIdentity)
  // and recordNumber (Patient) are each queried by their own exact field,
  // so a match is always specifically one or the other. The generic
  // "identifier" fallback this used to cover is no longer a reachable
  // code path.
});
