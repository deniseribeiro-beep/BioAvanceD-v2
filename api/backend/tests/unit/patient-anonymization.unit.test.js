import { describe, it, expect } from 'vitest';
const { sanitizePatientForLogs } = require('../../src/utils/patientAnonymization');

describe('sanitizePatientForLogs', () => {
  it('returns participantId: null for null patient', () => {
    expect(sanitizePatientForLogs(null)).toEqual({ participantId: null });
  });

  it('returns participantId: null for undefined patient', () => {
    expect(sanitizePatientForLogs(undefined)).toEqual({ participantId: null });
  });

  it('returns only participantId from patient object', () => {
    const patient = {
      participantId: '12345678',
      name: 'João Silva',
      cpf: '123.456.789-00',
      email: 'joao@example.com',
    };
    const result = sanitizePatientForLogs(patient);
    expect(result).toEqual({ participantId: '12345678' });
    expect(result.name).toBeUndefined();
    expect(result.cpf).toBeUndefined();
    expect(result.email).toBeUndefined();
  });

  it('returns participantId: null when patient has no participantId', () => {
    const result = sanitizePatientForLogs({ name: 'Test' });
    expect(result).toEqual({ participantId: null });
  });

  it('preserves the participantId value', () => {
    const result = sanitizePatientForLogs({ participantId: '87654321' });
    expect(result.participantId).toBe('87654321');
  });
});
