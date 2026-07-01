import { describe, it, expect } from 'vitest';
const { sanitizePatientForLogs } = require('../../src/utils/patientAnonymization');

describe('sanitizePatientForLogs', () => {
  it('returns patientID: null for null patient', () => {
    expect(sanitizePatientForLogs(null)).toEqual({ patientID: null });
  });

  it('returns patientID: null for undefined patient', () => {
    expect(sanitizePatientForLogs(undefined)).toEqual({ patientID: null });
  });

  it('returns only patientID from patient object', () => {
    const patient = {
      patientID: '12345678',
      name: 'João Silva',
      cpf: '123.456.789-00',
      email: 'joao@example.com',
    };
    const result = sanitizePatientForLogs(patient);
    expect(result).toEqual({ patientID: '12345678' });
    expect(result.name).toBeUndefined();
    expect(result.cpf).toBeUndefined();
    expect(result.email).toBeUndefined();
  });

  it('returns patientID: null when patient has no patientID', () => {
    const result = sanitizePatientForLogs({ name: 'Test' });
    expect(result).toEqual({ patientID: null });
  });

  it('preserves the patientID value', () => {
    const result = sanitizePatientForLogs({ patientID: '87654321' });
    expect(result.patientID).toBe('87654321');
  });
});
