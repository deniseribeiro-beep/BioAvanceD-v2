import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const logger = require('../../src/utils/logger');
const {
  generateUniquePatientID,
  validatePatientID,
  getPatientByIDOnly,
  sanitizePatientForLogs
} = require('../../src/utils/patientAnonymization');

function createDb(findOneImpl) {
  const findOne = vi.fn(findOneImpl);
  const collection = vi.fn(() => ({ findOne }));
  return { collection, __findOne: findOne };
}

beforeEach(() => {
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('patientAnonymization.generateUniquePatientID', () => {
  it('generates an 8-digit numeric ID not starting with 0 when there is no collision', async () => {
    const db = createDb(async () => null);

    const id = await generateUniquePatientID(db);

    expect(id).toMatch(/^[1-9]\d{7}$/);
    expect(db.collection).toHaveBeenCalledWith('patients');
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(id));
  });

  it('uses the provided collectionName override', async () => {
    const db = createDb(async () => null);

    await generateUniquePatientID(db, 'pacientes');

    expect(db.collection).toHaveBeenCalledWith('pacientes');
  });

  it('retries on collision until a unique ID is found', async () => {
    let calls = 0;
    const db = createDb(async () => {
      calls += 1;
      return calls <= 2 ? { patientID: 'existing' } : null;
    });

    const id = await generateUniquePatientID(db);

    expect(id).toMatch(/^[1-9]\d{7}$/);
    expect(calls).toBe(3);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting maxAttempts when every candidate collides', async () => {
    const db = createDb(async () => ({ patientID: 'always-taken' }));

    await expect(generateUniquePatientID(db)).rejects.toThrow(
      'Não foi possível gerar um ID único após múltiplas tentativas. Tente novamente.'
    );
    expect(logger.warn).toHaveBeenCalledTimes(100);
  });
});

describe('patientAnonymization.validatePatientID', () => {
  it('returns false for a null/undefined patientID', async () => {
    const db = createDb(async () => null);
    expect(await validatePatientID(db, null)).toBe(false);
    expect(await validatePatientID(db, undefined)).toBe(false);
  });

  it('returns false for a non-string patientID', async () => {
    const db = createDb(async () => null);
    expect(await validatePatientID(db, 12345678)).toBe(false);
  });

  it('returns false when the patientID is not exactly 8 characters', async () => {
    const db = createDb(async () => null);
    expect(await validatePatientID(db, '1234567')).toBe(false);
    expect(await validatePatientID(db, '123456789')).toBe(false);
  });

  it('returns false when the patientID contains non-digit characters', async () => {
    const db = createDb(async () => null);
    expect(await validatePatientID(db, '1234abcd')).toBe(false);
  });

  it('returns true when a matching patient is found', async () => {
    const db = createDb(async () => ({ patientID: '12345678' }));
    expect(await validatePatientID(db, '12345678')).toBe(true);
  });

  it('returns false when no matching patient is found', async () => {
    const db = createDb(async () => null);
    expect(await validatePatientID(db, '12345678')).toBe(false);
  });

  it('returns false and logs the error when the db lookup throws', async () => {
    const db = createDb(async () => {
      throw new Error('db down');
    });

    expect(await validatePatientID(db, '12345678')).toBe(false);
    expect(logger.error).toHaveBeenCalledWith('Erro ao validar ID de paciente:', 'db down');
  });
});

describe('patientAnonymization.getPatientByIDOnly', () => {
  it('returns only the patientID and exists flag when found', async () => {
    const db = createDb(async () => ({ patientID: '12345678' }));

    const result = await getPatientByIDOnly(db, '12345678');

    expect(result).toEqual({ patientID: '12345678', exists: true });
  });

  it('returns null when not found', async () => {
    const db = createDb(async () => null);

    expect(await getPatientByIDOnly(db, '12345678')).toBeNull();
  });

  it('returns null and logs the error when the db lookup throws', async () => {
    const db = createDb(async () => {
      throw new Error('db down');
    });

    expect(await getPatientByIDOnly(db, '12345678')).toBeNull();
    expect(logger.error).toHaveBeenCalledWith('Erro ao buscar paciente por ID:', 'db down');
  });
});

describe('patientAnonymization.sanitizePatientForLogs', () => {
  it('returns { patientID: null } when patient is falsy', () => {
    expect(sanitizePatientForLogs(null)).toEqual({ patientID: null });
    expect(sanitizePatientForLogs(undefined)).toEqual({ patientID: null });
  });

  it('strips all fields except patientID', () => {
    const patient = { patientID: '12345678', name: 'Jane Doe', cpf: '000.000.000-00' };
    expect(sanitizePatientForLogs(patient)).toEqual({ patientID: '12345678' });
  });

  it('returns { patientID: null } when patient has no patientID field', () => {
    expect(sanitizePatientForLogs({ name: 'Jane Doe' })).toEqual({ patientID: null });
  });
});
