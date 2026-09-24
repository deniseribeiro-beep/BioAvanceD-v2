import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const logger = require('../../src/utils/logger');
const {
  generateUniqueParticipantId,
  validateParticipantId,
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

describe('patientAnonymization.generateUniqueParticipantId', () => {
  it('generates an 8-digit numeric ID not starting with 0 when there is no collision', async () => {
    const db = createDb(async () => null);

    const id = await generateUniqueParticipantId(db);

    expect(id).toMatch(/^[1-9]\d{7}$/);
    expect(db.collection).toHaveBeenCalledWith('participants');
  });

  it('always resolves Participant through the canonical registry', async () => {
    const db = createDb(async () => null);

    await generateUniqueParticipantId(db);

    expect(db.collection).toHaveBeenCalledWith('participants');
  });

  it('retries on collision until a unique ID is found', async () => {
    let calls = 0;
    const db = createDb(async () => {
      calls += 1;
      return calls <= 2 ? { participantId: 'existing' } : null;
    });

    const id = await generateUniqueParticipantId(db);

    expect(id).toMatch(/^[1-9]\d{7}$/);
    expect(calls).toBe(3);
  });

  it('throws after exhausting maxAttempts when every candidate collides', async () => {
    const db = createDb(async () => ({ participantId: 'always-taken' }));

    await expect(generateUniqueParticipantId(db)).rejects.toThrow(
      'Não foi possível gerar um participantId único após múltiplas tentativas.'
    );
  });
});

describe('patientAnonymization.validateParticipantId', () => {
  it('returns false for a null/undefined participantId', async () => {
    const db = createDb(async () => null);
    expect(await validateParticipantId(db, null)).toBe(false);
    expect(await validateParticipantId(db, undefined)).toBe(false);
  });

  it('returns false for a non-string participantId', async () => {
    const db = createDb(async () => null);
    expect(await validateParticipantId(db, 12345678)).toBe(false);
  });

  it('returns false when the participantId is not exactly 8 characters', async () => {
    const db = createDb(async () => null);
    expect(await validateParticipantId(db, '1234567')).toBe(false);
    expect(await validateParticipantId(db, '123456789')).toBe(false);
  });

  it('returns false when the participantId contains non-digit characters', async () => {
    const db = createDb(async () => null);
    expect(await validateParticipantId(db, '1234abcd')).toBe(false);
  });

  it('returns true when a matching patient is found', async () => {
    const db = createDb(async () => ({ participantId: '12345678' }));
    expect(await validateParticipantId(db, '12345678')).toBe(true);
  });

  it('returns false when no matching patient is found', async () => {
    const db = createDb(async () => null);
    expect(await validateParticipantId(db, '12345678')).toBe(false);
  });

  it('returns false and logs the error when the db lookup throws', async () => {
    const db = createDb(async () => {
      throw new Error('db down');
    });

    expect(await validateParticipantId(db, '12345678')).toBe(false);
    expect(logger.error).toHaveBeenCalledWith('Erro ao validar participantId:', 'db down');
  });
});

describe('patientAnonymization.sanitizePatientForLogs', () => {
  it('returns { participantId: null } when patient is falsy', () => {
    expect(sanitizePatientForLogs(null)).toEqual({ participantId: null });
    expect(sanitizePatientForLogs(undefined)).toEqual({ participantId: null });
  });

  it('strips all fields except participantId', () => {
    const patient = { participantId: '12345678', name: 'Jane Doe', cpf: '000.000.000-00' };
    expect(sanitizePatientForLogs(patient)).toEqual({ participantId: '12345678' });
  });

  it('returns { participantId: null } when patient has no participantId field', () => {
    expect(sanitizePatientForLogs({ name: 'Jane Doe' })).toEqual({ participantId: null });
  });
});
