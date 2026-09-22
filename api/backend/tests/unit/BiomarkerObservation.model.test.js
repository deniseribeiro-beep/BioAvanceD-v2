import { describe, it, expect } from 'vitest';
import BiomarkerObservationModel from '../../src/models/BiomarkerObservation.js';

describe('BiomarkerObservationModel.validate', () => {
  const baseData = {
    participantId: 'p-1',
    specimenId: 'SPEC-1',
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


describe('BiomarkerObservationModel item 8 branch coverage', () => {
  const baseData = {
    participantId: 'p-1',
    biomarkerType: 'glucose',
    value: 90,
    unit: 'mg/dL',
    collectedAt: '2026-01-01T00:00:00.000Z',
  };

  it('rejects non-numeric values, invalid dates and missing units', () => {
    expect(BiomarkerObservationModel.validate({ ...baseData, value: 'not-number' }).errors)
      .toContain('value deve ser numérico');
    expect(BiomarkerObservationModel.validate({ ...baseData, collectedAt: 'not-a-date' }).errors)
      .toContain('collectedAt deve ser uma data válida');
    expect(BiomarkerObservationModel.validate({ ...baseData, unit: '   ' }).errors)
      .toContain('unit é obrigatório para observação biomarcadora');
  });

  it('accepts explicit null status/eventType and defaults their normalized values', () => {
    const result = BiomarkerObservationModel.validate({
      ...baseData,
      status: null,
      eventType: null,
    });
    expect(result.isValid).toBe(true);
    expect(result.normalized.status).toBe('final');
    expect(result.normalized.eventType).toBe('manual');
  });

  it('normalizes canonical specimenId, explicit FHIR linkage and optional metadata', () => {
    const result = BiomarkerObservationModel.validate({
      ...baseData,
      specimenId: ' SAMPLE-1 ',
      resourceType: '   ',
      subject: { reference: 'Patient/p-1' },
      specimen: { reference: 'Specimen/explicit' },
      effectiveDateTime: '2026-01-02T00:00:00.000Z',
      notes: ' note ',
      patientObjectId: ' patient-object ',
      specimenObjectId: ' specimen-object ',
      linkedResourceType: ' Specimen ',
      linkedResourceId: ' LINK-1 ',
      source: ' LAB ',
      eventType: 'atualização',
    });

    expect(result.isValid).toBe(true);
    expect(result.normalized.specimenId).toBe('SAMPLE-1');
    expect(result.normalized.resourceType).toBe('Observation');
    expect(result.normalized.subject).toEqual({ reference: 'Patient/p-1' });
    expect(result.normalized.specimen).toEqual({ reference: 'Specimen/explicit' });
    expect(result.normalized.notes).toBe('note');
    expect(result.normalized.patientObjectId).toBe('patient-object');
    expect(result.normalized.specimenObjectId).toBe('specimen-object');
    expect(result.normalized.linkedResourceType).toBe('Specimen');
    expect(result.normalized.linkedResourceId).toBe('LINK-1');
    expect(result.normalized.eventType).toBe('update');
  });

  it('derives a specimen reference from canonical specimenId and rejects its absence', () => {
    const withSpecimen = BiomarkerObservationModel.validate({
      ...baseData,
      specimenId: 'SPEC-2',
    }).normalized;
    expect(withSpecimen.specimen).toEqual({ reference: 'Specimen/SPEC-2' });

    const withoutSpecimen = BiomarkerObservationModel.validate({ ...baseData, specimenId: '' });
    expect(withoutSpecimen.isValid).toBe(false);
    expect(withoutSpecimen.errors).toContain('specimenId é obrigatório');
  });

  it('builds idempotency keys through each identifier/date fallback and rejects create() defaults', () => {
    const collectedAt = new Date('2026-01-01T00:00:00.000Z');
    expect(BiomarkerObservationModel.buildIdempotencyKey({
      participantId: 'p1',
      specimenId: 'SPEC-3',
      biomarkerType: 'x',
      collectedAt,
      value: 1,
      eventType: 'manual',
    })).toContain('SPEC-3');

    expect(BiomarkerObservationModel.buildIdempotencyKey({
      participantId: 'p1',
      biomarkerType: 'x',
      collectedAt: null,
      value: 1,
      eventType: 'manual',
    })).toContain('p1||x||1|manual');

    expect(BiomarkerObservationModel.buildIdempotencyKey()).toBe('|||||');
    expect(() => BiomarkerObservationModel.create()).toThrow();
  });

  it('creates a valid normalized observation', () => {
    const created = BiomarkerObservationModel.create({
      ...baseData,
      specimenId: 'SPEC-4',
      eventType: 'cadastro',
    });
    expect(created.eventType).toBe('create');
    expect(created.specimenId).toBe('SPEC-4');
    expect(created.idempotencyKey).toContain('SPEC-4');
    expect(created.createdAt).toBeInstanceOf(Date);
  });
});
