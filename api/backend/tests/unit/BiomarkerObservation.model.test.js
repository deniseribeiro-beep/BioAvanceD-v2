import { describe, it, expect } from 'vitest';
import BiomarkerObservationModel from '../../src/models/BiomarkerObservation.js';

describe('BiomarkerObservationModel.validate', () => {
  const baseData = {
    participantId: 'p-1',
    biomarkerType: 'glucose',
    value: 90,
    unit: 'mg/dL',
    collectedAt: '2026-01-01T00:00:00.000Z',
  };

  it('rejects when participantId is missing', () => {
    const { isValid, errors } = BiomarkerObservationModel.validate({ ...baseData, participantId: '' });

    expect(isValid).toBe(false);
    expect(errors).toContain('participantId é obrigatório');
  });

  it('rejects a negative value', () => {
    const { isValid, errors } = BiomarkerObservationModel.validate({ ...baseData, value: -5 });

    expect(isValid).toBe(false);
    expect(errors).toContain('value não pode ser negativo');
  });

  it('accepts a valid known status', () => {
    const { isValid, errors, normalized } = BiomarkerObservationModel.validate({ ...baseData, status: 'preliminary' });

    expect(isValid).toBe(true);
    expect(errors).toEqual([]);
    expect(normalized.status).toBe('preliminary');
  });

  it('rejects an unknown status', () => {
    const { isValid, errors } = BiomarkerObservationModel.validate({ ...baseData, status: 'bogus' });

    expect(isValid).toBe(false);
    expect(errors.some((e) => e.startsWith('status inválido'))).toBe(true);
  });

  it('rejects an unknown eventType', () => {
    const { isValid, errors } = BiomarkerObservationModel.validate({ ...baseData, eventType: 'bogus' });

    expect(isValid).toBe(false);
    expect(errors.some((e) => e.startsWith('eventType inválido'))).toBe(true);
  });
});
