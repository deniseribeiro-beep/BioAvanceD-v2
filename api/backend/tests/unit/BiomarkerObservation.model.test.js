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

  it('fills the alternate date, sample and link fields and accepts an event alias', () => {
    const result = BiomarkerObservationModel.validate({
      participantId: ' p-2 ',
      biomarkerType: ' hba1c ',
      value: '12',
      unit: ' % ',
      issuedAt: 'not-a-date',
      effectiveDateTime: '2026-02-02T00:00:00.000Z',
      status: null,
      eventType: 'Atualização',
      notes: '  nota  ',
      patientObjectId: ' pat ',
      specimenObjectId: ' spec ',
      linkedResourceType: ' Specimen ',
      linkedResourceId: ' link ',
      sampleId: ' samp ',
      resourceType: '   ',
      subject: { reference: 'Patient/p-2' },
      specimen: { reference: 'Specimen/samp' },
    });

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('collectedAt deve ser uma data válida');
    expect(result.normalized.eventType).toBe('update');
    expect(result.normalized.notes).toBe('nota');
    expect(result.normalized.sampleID).toBe('samp');
    expect(result.normalized.resourceType).toBe('Observation');
    expect(result.normalized.specimen).toEqual({ reference: 'Specimen/samp' });
    expect(result.normalized.linkedResourceType).toBe('Specimen');

    const created = BiomarkerObservationModel.create({
      ...baseData,
      eventType: 'criar',
      specimenID: 'spc-1',
      source: 'lab',
    });
    expect(created.eventType).toBe('create');
    expect(created.idempotencyKey).toContain('spc-1');
    expect(created.specimen).toEqual({ reference: 'Specimen/spc-1' });

    const bare = BiomarkerObservationModel.validate({});
    expect(bare.isValid).toBe(false);
    expect(bare.normalized.value).toBeNull();
    expect(bare.normalized.unit).toBeNull();
    expect(bare.normalized.specimen).toBeNull();
    expect(bare.normalized.linkedResourceType).toBe('Patient');
    expect(BiomarkerObservationModel.buildIdempotencyKey({})).toBe('|||||');
    expect(() => BiomarkerObservationModel.create({})).toThrow('participantId é obrigatório');
  });
});
