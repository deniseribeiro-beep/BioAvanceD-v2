import { describe, it, expect } from 'vitest';

const Sample = require('../../src/models/Sample');
const SampleModel = Sample.SampleModel;
const SampleMovementModel = require('../../src/models/SampleMovement');
const { SAMPLE_ORIGIN_IDS, EXTRACTION_PROTOCOL_IDS, SPECIMEN_TYPE_IDS } = require('../../src/config/constants/specimen.constants');

describe('SampleModel', () => {
  it('valida um payload de criação MIABIS válido', () => {
    const result = SampleModel.validate({
      specimenId: 'SPEC-001',
      participantId: '12345678',
      sampleType: SPECIMEN_TYPE_IDS[0],
      sampleOrigin: SAMPLE_ORIGIN_IDS[0],
      extractionProtocol: EXTRACTION_PROTOCOL_IDS[0],
      registeredAt: '2026-04-13T10:00:00.000Z',
      quantity: 10,
      quality: 'GOOD',
      linkedProject: 'Projeto QA',
    });

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejeita campos MIABIS inválidos e obrigatórios ausentes', () => {
    const result = SampleModel.validate({
      sampleType: 'INVALID',
      sampleOrigin: 'INVALID',
      extractionProtocol: 'INVALID',
      quantity: 0,
      quality: 'BAD',
    });

    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      'specimenId é obrigatório',
      'participantId é obrigatório',
      'sampleType inválido conforme MIABIS',
      'sampleOrigin inválido conforme MIABIS',
      'extractionProtocol inválido conforme MIABIS',
      'quantity deve ser maior que zero',
      'quality deve estar na escala MIABIS: GOOD, COMPROMISED ou UNKNOWN',
      'registeredAt é obrigatório',
    ]));
  });

  // RF006 AC3: the quantity drives quantityStatus, never specimenStatus.
  it('computeQuantityStatus deriva full/partial/depleted das quantidades', () => {
    expect(SampleModel.computeQuantityStatus(10, 10)).toBe('full');
    expect(SampleModel.computeQuantityStatus(10, 4)).toBe('partial');
    expect(SampleModel.computeQuantityStatus(10, 0)).toBe('depleted');
  });

  it('create normaliza dados e aplica defaults de status e quantidade', () => {
    const sample = SampleModel.create({
      specimenId: 'SPEC-001',
      participantId: '12345678',
      sampleType: SPECIMEN_TYPE_IDS[0],
      sampleOrigin: SAMPLE_ORIGIN_IDS[0],
      extractionProtocol: EXTRACTION_PROTOCOL_IDS[0],
      quantity: 12,
      quality: 'GOOD',
      linkedProject: 'Projeto QA',
      registeredAt: '2026-04-13T12:00:00.000Z',
      sprec: { matrixType: 'fluid' },
      pharmacologyData: { treatment_status: 'NAIVE' },
    });

    expect(sample.participantId).toBe('12345678');
    expect(sample.registeredAt).toBeInstanceOf(Date);
    expect(sample.currentQuantity).toBe(12);
    expect(sample.initialQuantity).toBe(12);
    // REGISTERED folds into `available` at creation (#405); the legacy
    // lifecycleStatus/availabilityStatus dual-write was removed in #408.
    expect(sample.specimenStatus).toBe('available');
    expect(sample.sprec.matrixType).toBe('fluid');
    expect(sample.pharmacologyData.treatment_status).toBe('NAIVE');
  });
});

describe('SampleMovementModel', () => {
  it('valida retirada com destino e propósito', () => {
    const result = SampleMovementModel.validate({
      specimenId: 'SPEC-001',
      type: 'withdraw',
      quantity: 2,
      responsible: 'QA User',
      destination: 'Lab A',
      purpose: 'research',
    });

    expect(result.isValid).toBe(true);
  });

  it('rejeita campos obrigatórios ausentes', () => {
    const result = SampleMovementModel.validate({
      type: 'bogus',
      quantity: 0,
    });

    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      'specimenId é obrigatório',
      'type inválido',
      'quantity deve ser um número maior que zero',
      'responsible é obrigatório',
    ]));
  });

  it('normaliza condição de devolução e cria o registro de movimentação', () => {
    const movement = SampleMovementModel.create({
      specimenId: 'SPEC-001',
      type: 'return',
      quantity: 1,
      responsible: 'QA User',
      condition: 'integra',
      observations: 'ok',
    });

    expect(movement.type).toBe('return');
    expect(movement.condition).toBe('intact');
    expect(movement.observations).toBe('ok');
    expect(movement.createdAt).toBeInstanceOf(Date);
  });

  it('normaliza variações de acentuação da condição íntegra', () => {
    expect(SampleMovementModel.normalizeReturnCondition('íntegra')).toBe('intact');
    expect(SampleMovementModel.normalizeReturnCondition('inutilizada')).toBe('unusable');
    expect(SampleMovementModel.normalizeReturnCondition('partially compromised')).toBe('partially_compromised');
  });
});
