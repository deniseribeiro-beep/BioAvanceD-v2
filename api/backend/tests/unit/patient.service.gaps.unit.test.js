import { describe, it, expect, vi } from 'vitest';

process.env.ENCRYPTION_KEY = 'dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGtleXQ=';
process.env.ENCRYPTION_KEY_ID = 'test-key-1';

const patientService = require('../../src/services/patient.service');

function makeFakeCollection(overrides = {}) {
  return {
    findOne: vi.fn().mockResolvedValue(null),
    find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
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

  it('throws when clinicalUnitId is invalid and clinicalUnit is omitted (#85)', async () => {
    const db = makeFakeDb();
    await expect(patientService.resolveClinicalUnitSnapshot(db, { clinicalUnitId: 'not-an-object-id' }))
      .rejects.toThrow('clinicalUnitId inválido');
  });

  it('throws when clinicalUnitId is invalid and clinicalUnit is explicitly empty', async () => {
    const db = makeFakeDb();
    await expect(patientService.resolveClinicalUnitSnapshot(db, { clinicalUnitId: 'not-an-object-id', clinicalUnit: '' }))
      .rejects.toThrow('clinicalUnitId inválido');
  });

  it('throws when a valid ObjectId clinicalUnitId does not resolve to a unit', async () => {
    const db = makeFakeDb({
      clinical_units: makeFakeCollection({ findOne: vi.fn().mockResolvedValue(null) })
    });
    await expect(patientService.resolveClinicalUnitSnapshot(db, { clinicalUnitId: '507f1f77bcf86cd799439011' }))
      .rejects.toThrow('Unidade clínica não encontrada');
  });

  it('resolves snapshot by clinicalUnitId, falling back to a generated acronym when none stored', async () => {
    const db = makeFakeDb({
      clinical_units: makeFakeCollection({
        findOne: vi.fn().mockResolvedValue({ _id: '507f1f77bcf86cd799439011', name: 'Unidade Terapia Intensiva', acronym: '' })
      })
    });
    const result = await patientService.resolveClinicalUnitSnapshot(db, { clinicalUnitId: '507f1f77bcf86cd799439011' });
    expect(result.clinicalUnitId).toBe('507f1f77bcf86cd799439011');
    expect(result.clinicalUnit).toBe('Unidade Terapia Intensiva');
    expect(result.unitAcronym).toBeTruthy();
  });

  it('uses stored acronym when the unit found by id already has one', async () => {
    const db = makeFakeDb({
      clinical_units: makeFakeCollection({
        findOne: vi.fn().mockResolvedValue({ _id: '507f1f77bcf86cd799439011', name: 'UTI', acronym: 'uti' })
      })
    });
    const result = await patientService.resolveClinicalUnitSnapshot(db, { clinicalUnitId: '507f1f77bcf86cd799439011' });
    expect(result.unitAcronym).toBe('uti');
  });

  it('falls through to name lookup when clinicalUnitId is invalid but a name is also given', async () => {
    const db = makeFakeDb({
      clinical_units: makeFakeCollection({ findOne: vi.fn().mockResolvedValue(null) })
    });
    const result = await patientService.resolveClinicalUnitSnapshot(db, {
      clinicalUnitId: 'not-an-object-id',
      clinicalUnit: 'Ambulatorio'
    });
    expect(result.clinicalUnitId).toBeNull();
    expect(result.clinicalUnit).toBe('AMBULATORIO');
  });

  it('resolves snapshot by clinicalUnit name when found in collection', async () => {
    const db = makeFakeDb({
      clinical_units: makeFakeCollection({
        findOne: vi.fn().mockResolvedValue({ _id: 'unit-id-2', name: 'Ambulatorio', acronym: 'AMB' })
      })
    });
    const result = await patientService.resolveClinicalUnitSnapshot(db, { clinicalUnit: 'ambulatorio' });
    expect(result).toEqual({ clinicalUnitId: 'unit-id-2', clinicalUnit: 'Ambulatorio', unitAcronym: 'AMB' });
  });

  it('falls back to a normalized clinicalUnit name when no matching unit document exists', async () => {
    const db = makeFakeDb({
      clinical_units: makeFakeCollection({ findOne: vi.fn().mockResolvedValue(null) })
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
  it('returns null when neither cpf nor recordNumber is provided', async () => {
    const db = makeFakeDb();
    const result = await patientService.checkIdentifierConflict(db, {});
    expect(result).toBeNull();
  });

  it('returns null when no existing patient matches', async () => {
    const db = makeFakeDb({ patients: makeFakeCollection({ findOne: vi.fn().mockResolvedValue(null) }) });
    const result = await patientService.checkIdentifierConflict(db, { cpf: '123.456.789-00' });
    expect(result).toBeNull();
  });

  it('reports a cpf conflict when the existing patient matches by cpf', async () => {
    const db = makeFakeDb({
      patients: makeFakeCollection({ findOne: vi.fn().mockResolvedValue({ cpf: '12345678900' }) })
    });
    const result = await patientService.checkIdentifierConflict(db, { cpf: '123.456.789-00' });
    expect(result).toEqual({ field: 'cpf', value: '12345678900', existing: { cpf: '12345678900' } });
  });

  it('reports a recordNumber conflict when the existing patient matches by recordNumber', async () => {
    const db = makeFakeDb({
      patients: makeFakeCollection({ findOne: vi.fn().mockResolvedValue({ recordNumber: 'REC-1' }) })
    });
    const result = await patientService.checkIdentifierConflict(db, { recordNumber: 'REC-1' });
    expect(result).toEqual({ field: 'recordNumber', value: 'REC-1', existing: { recordNumber: 'REC-1' } });
  });

  it('reports a generic identifier conflict when the match is by $or but neither field matches directly', async () => {
    const db = makeFakeDb({
      patients: makeFakeCollection({ findOne: vi.fn().mockResolvedValue({ cpf: '00000000000', recordNumber: 'OTHER' }) })
    });
    const result = await patientService.checkIdentifierConflict(db, { cpf: '11111111111' });
    expect(result).toEqual({ field: 'identifier', value: null, existing: { cpf: '00000000000', recordNumber: 'OTHER' } });
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

  it('parses DD/MM/YYYY birthDate strings and finds a name+date match', async () => {
    const existingPatient = { patientName: '  Joao   Silva ', birthDate: new Date(2000, 0, 1) };
    const db = makeFakeDb({
      patients: makeFakeCollection({
        find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([existingPatient]) })
      })
    });
    const result = await patientService.checkDuplicatePatient(db, { patientName: 'joao silva', birthDate: '01/01/2000' });
    expect(result).toBe(existingPatient);
  });

  it('returns null when no candidate matches the normalized name', async () => {
    const existingPatient = { patientName: 'Maria Souza', birthDate: new Date(2000, 0, 1) };
    const db = makeFakeDb({
      patients: makeFakeCollection({
        find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([existingPatient]) })
      })
    });
    const result = await patientService.checkDuplicatePatient(db, { patientName: 'joao silva', birthDate: '01/01/2000' });
    expect(result).toBeNull();
  });

  it('accepts a Date instance directly as birthDate', async () => {
    const existingPatient = { patientName: 'Joao Silva', birthDate: new Date(1999, 5, 15) };
    const db = makeFakeDb({
      patients: makeFakeCollection({
        find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([existingPatient]) })
      })
    });
    const result = await patientService.checkDuplicatePatient(db, { patientName: 'Joao Silva', birthDate: new Date(1999, 5, 15) });
    expect(result).toBe(existingPatient);
  });

  it('returns null and logs when the collection lookup throws', async () => {
    const db = makeFakeDb({
      patients: makeFakeCollection({
        find: vi.fn().mockReturnValue({ toArray: vi.fn().mockRejectedValue(new Error('db down')) })
      })
    });
    const result = await patientService.checkDuplicatePatient(db, { patientName: 'Joao', birthDate: '01/01/2000' });
    expect(result).toBeNull();
  });
});

describe('PatientService.syncPatientPhoneToGraph', () => {
  it('does nothing when neo4jDriver is missing', async () => {
    await expect(patientService.syncPatientPhoneToGraph(null, '12345678', '1199999999')).resolves.toBeUndefined();
  });

  it('does nothing when neo4jDriver lacks a session() function', async () => {
    await expect(patientService.syncPatientPhoneToGraph({}, '12345678', '1199999999')).resolves.toBeUndefined();
  });

  it('does nothing when patientID normalizes to an empty string', async () => {
    const session = { run: vi.fn(), close: vi.fn() };
    const driver = { session: vi.fn(() => session) };
    await patientService.syncPatientPhoneToGraph(driver, '   ', '1199999999');
    expect(driver.session).not.toHaveBeenCalled();
  });

  it('runs the sync query and closes the session on success', async () => {
    const session = { run: vi.fn().mockResolvedValue({}), close: vi.fn().mockResolvedValue(undefined) };
    const driver = { session: vi.fn(() => session) };
    await patientService.syncPatientPhoneToGraph(driver, '12345678', '1199999999');
    expect(session.run).toHaveBeenCalledWith(expect.any(String), { patientId: '12345678', phone: '1199999999' });
    expect(session.close).toHaveBeenCalled();
  });

  it('defaults phone to null when not provided', async () => {
    const session = { run: vi.fn().mockResolvedValue({}), close: vi.fn().mockResolvedValue(undefined) };
    const driver = { session: vi.fn(() => session) };
    await patientService.syncPatientPhoneToGraph(driver, '12345678', undefined);
    expect(session.run).toHaveBeenCalledWith(expect.any(String), { patientId: '12345678', phone: null });
  });

  it('still closes the session when run() rejects', async () => {
    const session = { run: vi.fn().mockRejectedValue(new Error('neo4j down')), close: vi.fn().mockResolvedValue(undefined) };
    const driver = { session: vi.fn(() => session) };
    await expect(patientService.syncPatientPhoneToGraph(driver, '12345678', '1199999999')).resolves.toBeUndefined();
    expect(session.close).toHaveBeenCalled();
  });
});

describe('PatientService.applyDeceasedRepresentativeRules', () => {
  it('clears representative fields when isDeceased is not true', () => {
    const payload = {
      isDeceased: false,
      representativeName: 'Someone',
      representativeEmail: 'a@b.com',
      representativeCpf: '12345678900',
      representativePhone: '11999999999'
    };
    patientService.applyDeceasedRepresentativeRules(payload);
    expect(payload).toEqual({
      isDeceased: false,
      representativeName: null,
      representativeEmail: null,
      representativeCpf: null,
      representativePhone: null
    });
  });

  it('throws when required representative fields are missing', () => {
    const payload = { isDeceased: true, representativeName: '', representativeEmail: '', representativeCpf: '', representativePhone: '' };
    expect(() => patientService.applyDeceasedRepresentativeRules(payload))
      .toThrow('Para paciente falecido, nome, e-mail, CPF e telefone do representante legal são obrigatórios');
  });

  it('throws when representative email is invalid', () => {
    const payload = {
      isDeceased: true,
      representativeName: 'Rep Name',
      representativeEmail: 'not-an-email',
      representativeCpf: '12345678900',
      representativePhone: '11999999999'
    };
    expect(() => patientService.applyDeceasedRepresentativeRules(payload)).toThrow('Email do representante legal inválido');
  });

  it('throws when representative cpf does not have 11 digits', () => {
    const payload = {
      isDeceased: true,
      representativeName: 'Rep Name',
      representativeEmail: 'rep@example.com',
      representativeCpf: '123',
      representativePhone: '11999999999'
    };
    expect(() => patientService.applyDeceasedRepresentativeRules(payload)).toThrow('CPF do representante legal inválido. Informe 11 dígitos');
  });

  it('throws when representative phone length is out of range', () => {
    const payload = {
      isDeceased: true,
      representativeName: 'Rep Name',
      representativeEmail: 'rep@example.com',
      representativeCpf: '12345678900',
      representativePhone: '123'
    };
    expect(() => patientService.applyDeceasedRepresentativeRules(payload)).toThrow('Telefone do representante legal inválido. Informe de 10 a 15 dígitos');
  });

  it('normalizes and accepts a fully valid deceased representative payload', () => {
    const payload = {
      isDeceased: true,
      representativeName: '  Rep Name  ',
      representativeEmail: 'REP@Example.com',
      representativeCpf: '123.456.789-00',
      representativePhone: '(11) 99999-9999'
    };
    patientService.applyDeceasedRepresentativeRules(payload);
    expect(payload.representativeName).toBe('Rep Name');
    expect(payload.representativeEmail).toBe('rep@example.com');
    expect(payload.representativeCpf).toBe('12345678900');
    expect(payload.representativePhone).toBe('11999999999');
  });
});
