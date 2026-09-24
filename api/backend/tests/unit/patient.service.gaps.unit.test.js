import { describe, it, expect, vi } from 'vitest';

process.env.ENCRYPTION_KEY = 'dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGtleXQ=';
process.env.ENCRYPTION_KEY_ID = 'test-key-1';

const patientService = require('../../src/services/patient.service');

function makeFakeCollection(overrides = {}) {
  return {
    findOne: vi.fn().mockResolvedValue(null),
    find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
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
  it('returns null when neither clinicalUnitId nor clinicalUnit is present', async () => {
    const db = makeFakeDb();
    const result = await patientService.resolveClinicalUnitSnapshot(db, {});
    expect(result).toBeNull();
  });

  it('returns nulls when clinicalUnitId and clinicalUnit are both blank', async () => {
    const db = makeFakeDb();
    const result = await patientService.resolveClinicalUnitSnapshot(db, { clinicalUnitId: '', clinicalUnit: null });
    expect(result).toEqual({ clinicalUnitId: null, clinicalUnit: null, unitAcronym: null });
  });

  it('throws when clinicalUnitId does not resolve to an organization and clinicalUnit is omitted (#85)', async () => {
    const db = makeFakeDb({
      organizations: makeFakeCollection({ findOne: vi.fn().mockResolvedValue(null) })
    });
    await expect(patientService.resolveClinicalUnitSnapshot(db, { clinicalUnitId: 'not-an-organization-id' }))
      .rejects.toThrow('Unidade clínica não encontrada');
  });

  it('throws when clinicalUnitId does not resolve and clinicalUnit is explicitly empty', async () => {
    const db = makeFakeDb({
      organizations: makeFakeCollection({ findOne: vi.fn().mockResolvedValue(null) })
    });
    await expect(patientService.resolveClinicalUnitSnapshot(db, { clinicalUnitId: 'not-an-organization-id', clinicalUnit: '' }))
      .rejects.toThrow('Unidade clínica não encontrada');
  });

  it('throws when a clinicalUnitId does not resolve to an organization', async () => {
    const db = makeFakeDb({
      organizations: makeFakeCollection({ findOne: vi.fn().mockResolvedValue(null) })
    });
    await expect(patientService.resolveClinicalUnitSnapshot(db, { clinicalUnitId: '507f1f77bcf86cd799439011' }))
      .rejects.toThrow('Unidade clínica não encontrada');
  });

  it('resolves snapshot by clinicalUnitId, falling back to a generated acronym when none stored', async () => {
    const db = makeFakeDb({
      organizations: makeFakeCollection({
        findOne: vi.fn().mockResolvedValue({ organizationId: 'org-uti', officialName: 'Unidade Terapia Intensiva', acronym: '' })
      })
    });
    const result = await patientService.resolveClinicalUnitSnapshot(db, { clinicalUnitId: 'org-uti' });
    expect(result.clinicalUnitId).toBe('org-uti');
    expect(result.clinicalUnit).toBe('Unidade Terapia Intensiva');
    expect(result.unitAcronym).toBeTruthy();
  });

  it('uses stored acronym when the organization found by id already has one', async () => {
    const db = makeFakeDb({
      organizations: makeFakeCollection({
        findOne: vi.fn().mockResolvedValue({ organizationId: 'org-uti', officialName: 'UTI', acronym: 'uti' })
      })
    });
    const result = await patientService.resolveClinicalUnitSnapshot(db, { clinicalUnitId: 'org-uti' });
    expect(result.unitAcronym).toBe('uti');
  });

  it('falls through to name lookup when clinicalUnitId does not resolve but a name is also given', async () => {
    const db = makeFakeDb({
      organizations: makeFakeCollection({ findOne: vi.fn().mockResolvedValue(null) })
    });
    const result = await patientService.resolveClinicalUnitSnapshot(db, {
      clinicalUnitId: 'not-an-organization-id',
      clinicalUnit: 'Ambulatorio'
    });
    expect(result.clinicalUnitId).toBeNull();
    expect(result.clinicalUnit).toBe('AMBULATORIO');
  });

  it('resolves snapshot by clinicalUnit name when a matching organization exists', async () => {
    const db = makeFakeDb({
      organizations: makeFakeCollection({
        findOne: vi.fn().mockResolvedValue({ organizationId: 'org-amb', officialName: 'Ambulatorio', acronym: 'AMB' })
      })
    });
    const result = await patientService.resolveClinicalUnitSnapshot(db, { clinicalUnit: 'ambulatorio' });
    expect(result).toEqual({ clinicalUnitId: 'org-amb', clinicalUnit: 'Ambulatorio', unitAcronym: 'AMB' });
  });

  it('falls back to a normalized clinicalUnit name when no matching organization exists', async () => {
    const db = makeFakeDb({
      organizations: makeFakeCollection({ findOne: vi.fn().mockResolvedValue(null) })
    });
    const result = await patientService.resolveClinicalUnitSnapshot(db, { clinicalUnit: '  new unit  ' });
    expect(result.clinicalUnitId).toBeNull();
    expect(result.clinicalUnit).toBe('NEW UNIT');
    expect(result.unitAcronym).toBeTruthy();
  });

  it('returns nulls when clinicalUnitId resolves to nothing usable and no name was given', async () => {
    const db = makeFakeDb();
    const result = await patientService.resolveClinicalUnitSnapshot(db, { clinicalUnitId: null, clinicalUnit: '' });
    expect(result).toEqual({ clinicalUnitId: null, clinicalUnit: null, unitAcronym: null });
  });
});

describe('PatientService.checkIdentifierConflict', () => {
  it('returns null when neither identityDocument nor recordNumber is provided', async () => {
    const db = makeFakeDb();
    const result = await patientService.checkIdentifierConflict(db, {});
    expect(result).toBeNull();
  });

  it('returns null when no existing patient matches', async () => {
    const db = makeFakeDb({ participants: makeFakeCollection({ findOne: vi.fn().mockResolvedValue(null) }) });
    const result = await patientService.checkIdentifierConflict(db, { identityDocument: '123.456.789-00' });
    expect(result).toBeNull();
  });

  it('reports an identityDocument conflict when the existing identity matches by identityDocument (#561: resolved via ParticipantIdentity)', async () => {
    const db = makeFakeDb({
      participantIdentities: makeFakeCollection({ findOne: vi.fn().mockResolvedValue({ identityDocument: '12345678900' }) })
    });
    const result = await patientService.checkIdentifierConflict(db, { identityDocument: '123.456.789-00' });
    expect(result).toEqual({ field: 'identityDocument', value: '12345678900', existing: { identityDocument: '12345678900' } });
  });

  it('reports a recordNumber conflict when the existing patient matches by recordNumber', async () => {
    const db = makeFakeDb({
      participants: makeFakeCollection({ findOne: vi.fn().mockResolvedValue({ recordNumber: 'REC-1' }) })
    });
    const result = await patientService.checkIdentifierConflict(db, { recordNumber: 'REC-1' });
    expect(result).toEqual({ field: 'recordNumber', value: 'REC-1', existing: { recordNumber: 'REC-1' } });
  });

  it('checks identityDocument (ParticipantIdentity) before recordNumber (Patient), matching the original priority', async () => {
    const db = makeFakeDb({
      participantIdentities: makeFakeCollection({ findOne: vi.fn().mockResolvedValue({ identityDocument: '11111111111' }) }),
      participants: makeFakeCollection({ findOne: vi.fn().mockResolvedValue({ recordNumber: 'REC-1' }) })
    });
    const result = await patientService.checkIdentifierConflict(db, { identityDocument: '11111111111', recordNumber: 'REC-1' });
    expect(result).toEqual({ field: 'identityDocument', value: '11111111111', existing: { identityDocument: '11111111111' } });
  });
});

describe('PatientService.checkDuplicatePatient', () => {
  it('returns null when patientName or birthDate is missing', async () => {
    const db = makeFakeDb();
    expect(await patientService.checkDuplicatePatient(db, { patientName: 'Joao' })).toBeNull();
    expect(await patientService.checkDuplicatePatient(db, { birthDate: '01/01/2000' })).toBeNull();
  });

  it('returns null when birthDate cannot be parsed into a valid Date', async () => {
    const db = makeFakeDb();
    const result = await patientService.checkDuplicatePatient(db, { patientName: 'Joao', birthDate: 'not-a-date' });
    expect(result).toBeNull();
  });

  it('parses DD/MM/YYYY birthDate strings and finds a name+date match (#561: resolved via ParticipantIdentity)', async () => {
    const existingIdentity = { patientName: '  Joao   Silva ', birthDate: new Date(2000, 0, 1) };
    const db = makeFakeDb({
      participantIdentities: makeFakeCollection({
        find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([existingIdentity]) })
      })
    });
    const result = await patientService.checkDuplicatePatient(db, { patientName: 'joao silva', birthDate: '01/01/2000' });
    expect(result).toBe(existingIdentity);
  });

  it('returns null when no candidate matches the normalized name', async () => {
    const existingIdentity = { patientName: 'Maria Souza', birthDate: new Date(2000, 0, 1) };
    const db = makeFakeDb({
      participantIdentities: makeFakeCollection({
        find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([existingIdentity]) })
      })
    });
    const result = await patientService.checkDuplicatePatient(db, { patientName: 'joao silva', birthDate: '01/01/2000' });
    expect(result).toBeNull();
  });

  it('accepts a Date instance directly as birthDate', async () => {
    const existingIdentity = { patientName: 'Joao Silva', birthDate: new Date(1999, 5, 15) };
    const db = makeFakeDb({
      participantIdentities: makeFakeCollection({
        find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([existingIdentity]) })
      })
    });
    const result = await patientService.checkDuplicatePatient(db, { patientName: 'Joao Silva', birthDate: new Date(1999, 5, 15) });
    expect(result).toBe(existingIdentity);
  });

  it('returns null and logs when the collection lookup throws', async () => {
    const db = makeFakeDb({
      participantIdentities: makeFakeCollection({
        find: vi.fn().mockReturnValue({ toArray: vi.fn().mockRejectedValue(new Error('db down')) })
      })
    });
    const result = await patientService.checkDuplicatePatient(db, { patientName: 'Joao', birthDate: '01/01/2000' });
    expect(result).toBeNull();
  });
});

describe('PatientService.applyDeceasedRepresentativeRules', () => {
  it('clears representative fields when isDeceased is not true', () => {
    const payload = {
      isDeceased: false,
      representativeName: 'Someone',
      representativeEmail: 'a@b.com',
      representativeIdentityDocument: '12345678900',
      representativePhone: '11999999999'
    };
    patientService.applyDeceasedRepresentativeRules(payload);
    expect(payload).toEqual({
      isDeceased: false,
      representativeName: null,
      representativeEmail: null,
      representativeIdentityDocument: null,
      representativePhone: null
    });
  });

  it('throws when required representative fields are missing', () => {
    const payload = { isDeceased: true, representativeName: '', representativeEmail: '', representativeIdentityDocument: '', representativePhone: '' };
    expect(() => patientService.applyDeceasedRepresentativeRules(payload))
      .toThrow('Para paciente falecido, nome, e-mail, identityDocument e telefone do representante legal são obrigatórios');
  });

  it('throws when representative email is invalid', () => {
    const payload = {
      isDeceased: true,
      representativeName: 'Rep Name',
      representativeEmail: 'not-an-email',
      representativeIdentityDocument: '12345678900',
      representativePhone: '11999999999'
    };
    expect(() => patientService.applyDeceasedRepresentativeRules(payload)).toThrow('Email do representante legal inválido');
  });

  it('throws when representative identityDocument does not have 11 digits', () => {
    const payload = {
      isDeceased: true,
      representativeName: 'Rep Name',
      representativeEmail: 'rep@example.com',
      representativeIdentityDocument: '123',
      representativePhone: '11999999999'
    };
    expect(() => patientService.applyDeceasedRepresentativeRules(payload)).toThrow('identityDocument do representante legal inválido. Informe 11 dígitos');
  });

  it('throws when representative phone length is out of range', () => {
    const payload = {
      isDeceased: true,
      representativeName: 'Rep Name',
      representativeEmail: 'rep@example.com',
      representativeIdentityDocument: '12345678900',
      representativePhone: '123'
    };
    expect(() => patientService.applyDeceasedRepresentativeRules(payload)).toThrow('Telefone do representante legal inválido. Informe de 10 a 15 dígitos');
  });

  it('normalizes and accepts a fully valid deceased representative payload', () => {
    const payload = {
      isDeceased: true,
      representativeName: '  Rep Name  ',
      representativeEmail: 'REP@Example.com',
      representativeIdentityDocument: '123.456.789-00',
      representativePhone: '(11) 99999-9999'
    };
    patientService.applyDeceasedRepresentativeRules(payload);
    expect(payload.representativeName).toBe('Rep Name');
    expect(payload.representativeEmail).toBe('rep@example.com');
    expect(payload.representativeIdentityDocument).toBe('12345678900');
    expect(payload.representativePhone).toBe('11999999999');
  });
});
