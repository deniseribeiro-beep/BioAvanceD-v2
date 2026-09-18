import { describe, expect, it } from 'vitest';

const BiomarkerObservationModel = require('../../src/models/BiomarkerObservation');

const base = {
  participantId: 'participant-1',
  biomarkerType: 'glucose',
  value: 90,
  unit: 'mg/dL',
  collectedAt: '2026-01-01T00:00:00.000Z',
};

describe('BiomarkerObservationModel simple branch coverage for item 8', () => {
  it('covers date/unit/event normalization branches', () => {
    expect(BiomarkerObservationModel.normalizeDate(null)).toBeNull();
    expect(BiomarkerObservationModel.normalizeDate('not-a-date')).toBeNull();
    expect(BiomarkerObservationModel.normalizeDate('2026-01-01T00:00:00.000Z')).toBeInstanceOf(Date);

    expect(BiomarkerObservationModel.normalizeUnit()).toBeNull();
    expect(BiomarkerObservationModel.normalizeUnit({ unit: '  mmol/L  ' })).toBe('mmol/L');

    expect(BiomarkerObservationModel.normalizeEventType()).toBe('manual');
    expect(BiomarkerObservationModel.normalizeEventType('Criar')).toBe('create');
    expect(BiomarkerObservationModel.normalizeEventType('ATUALIZAÇÃO')).toBe('update');
    expect(BiomarkerObservationModel.normalizeEventType('custom')).toBe('custom');
  });

  it('covers required/number/date/status/event/unit validation branches', () => {
    const invalid = BiomarkerObservationModel.validate({
      participantId: 'participant-1',
      biomarkerType: '',
      value: 'not-a-number',
      issuedAt: 'not-a-date',
      unit: '',
      status: null,
      eventType: null,
    });

    expect(invalid.isValid).toBe(false);
    expect(invalid.errors).toEqual(expect.arrayContaining([
      'biomarkerType é obrigatório',
      'value deve ser numérico',
      'collectedAt deve ser uma data válida',
      'unit é obrigatório para observação biomarcadora',
    ]));
    expect(invalid.normalized.value).toBeNull();
    expect(invalid.normalized.status).toBe('final');
    expect(invalid.normalized.eventType).toBe('manual');

    const viaFallbackDate = BiomarkerObservationModel.validate({
      ...base,
      collectedAt: undefined,
      issuedAt: '2026-02-01T00:00:00.000Z',
      status: undefined,
      eventType: 'cadastro',
    });
    expect(viaFallbackDate.isValid).toBe(true);
    expect(viaFallbackDate.normalized.collectedAt.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(viaFallbackDate.normalized.eventType).toBe('create');

    const viaEffectiveDate = BiomarkerObservationModel.validate({
      ...base,
      collectedAt: undefined,
      issuedAt: undefined,
      effectiveDateTime: '2026-03-01T00:00:00.000Z',
      eventType: 'atualizar',
    });
    expect(viaEffectiveDate.isValid).toBe(true);
    expect(viaEffectiveDate.normalized.eventType).toBe('update');
  });

  it('covers sample identifier, resource, subject/specimen and optional metadata branches', () => {
    const explicit = BiomarkerObservationModel.validate({
      ...base,
      sampleID: 'SAMPLE-A',
      resourceType: '  DiagnosticReport  ',
      subject: { reference: 'Patient/P1' },
      specimen: { reference: 'Specimen/custom' },
      effectiveDateTime: '2026-04-01T00:00:00.000Z',
      source: ' LAB ',
      notes: '  note  ',
      patientObjectId: 123,
      specimenObjectId: 456,
      linkedResourceType: ' Specimen ',
      linkedResourceId: ' LINK-1 ',
      eventType: 'manual',
    });

    expect(explicit.isValid).toBe(true);
    expect(explicit.normalized).toEqual(expect.objectContaining({
      sampleID: 'SAMPLE-A',
      sampleId: 'SAMPLE-A',
      specimenID: 'SAMPLE-A',
      specimenId: 'SAMPLE-A',
      resourceType: 'DiagnosticReport',
      subject: { reference: 'Patient/P1' },
      specimen: { reference: 'Specimen/custom' },
      source: 'lab',
      notes: 'note',
      patientObjectId: '123',
      specimenObjectId: '456',
      linkedResourceType: 'Specimen',
      linkedResourceId: 'LINK-1',
    }));
    expect(explicit.normalized.effectiveDateTime.toISOString()).toBe('2026-04-01T00:00:00.000Z');

    const sampleId = BiomarkerObservationModel.validate({ ...base, sampleId: 'SAMPLE-B' });
    expect(sampleId.normalized.sampleID).toBe('SAMPLE-B');
    expect(sampleId.normalized.specimen).toEqual({ reference: 'Specimen/SAMPLE-B' });

    const specimenID = BiomarkerObservationModel.validate({ ...base, specimenID: 'SAMPLE-C' });
    expect(specimenID.normalized.sampleID).toBe('SAMPLE-C');

    const specimenId = BiomarkerObservationModel.validate({ ...base, specimenId: 'SAMPLE-D' });
    expect(specimenId.normalized.sampleID).toBe('SAMPLE-D');

    const noSample = BiomarkerObservationModel.validate({
      ...base,
      resourceType: '   ',
      subject: undefined,
      specimen: undefined,
      notes: '',
      patientObjectId: '',
      specimenObjectId: '',
      linkedResourceType: '',
      linkedResourceId: '',
    });
    expect(noSample.normalized).toEqual(expect.objectContaining({
      sampleID: null,
      sampleId: null,
      specimenID: null,
      specimenId: null,
      resourceType: 'Observation',
      subject: null,
      specimen: null,
      notes: null,
      patientObjectId: null,
      specimenObjectId: null,
      linkedResourceType: 'Patient',
      linkedResourceId: 'participant-1',
    }));
    expect(noSample.normalized.effectiveDateTime).toEqual(noSample.normalized.collectedAt);
  });

  it('covers idempotency fallbacks and create success/failure branches', () => {
    const collectedAt = new Date('2026-01-01T00:00:00.000Z');

    expect(BiomarkerObservationModel.buildIdempotencyKey({
      participantId: 'P',
      sampleID: 'S1',
      specimenID: 'S2',
      linkedResourceId: 'L',
      biomarkerType: 'B',
      collectedAt,
      value: 1,
      eventType: 'manual',
    })).toContain('P|S1|B|2026-01-01T00:00:00.000Z|1|manual');

    expect(BiomarkerObservationModel.buildIdempotencyKey({
      participantId: 'P',
      specimenID: 'S2',
      linkedResourceId: 'L',
      biomarkerType: 'B',
      collectedAt,
      value: 1,
      eventType: 'manual',
    })).toContain('P|S2|B|');

    expect(BiomarkerObservationModel.buildIdempotencyKey({
      participantId: 'P',
      linkedResourceId: 'L',
      biomarkerType: 'B',
      value: 1,
      eventType: 'manual',
    })).toContain('P|L|B||1|manual');

    expect(BiomarkerObservationModel.buildIdempotencyKey({
      participantId: 'P',
      biomarkerType: 'B',
      value: 1,
      eventType: 'manual',
    })).toContain('P||B||1|manual');

    expect(() => BiomarkerObservationModel.create({
      ...base,
      participantId: '',
    })).toThrow('participantId é obrigatório');

    const created = BiomarkerObservationModel.create({
      ...base,
      sampleID: 'SAMPLE-1',
      eventType: 'criar',
    });
    expect(created).toEqual(expect.objectContaining({
      participantId: 'participant-1',
      sampleID: 'SAMPLE-1',
      eventType: 'create',
      idempotencyKey: expect.any(String),
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date),
    }));
  });
});
