import { describe, it, expect } from 'vitest';

const Sample = require('../../src/models/Sample');
const SampleModel = Sample.SampleModel;
const SampleMovementModel = require('../../src/models/SampleMovement');

describe('SampleModel', () => {
  it('valida um payload de criação MIABIS válido', () => {
    const result = SampleModel.validate({
      patientID: '12345678',
      sampleType: SampleModel.validateSampleType.name ? 'PLASMA' : 'PLASMA',
      sampleOrigin: 'VENOUS_BLOOD',
      extractionProtocol: 'TUBE_EDTA',
      registerDate: '2026-04-13T10:00:00.000Z',
      quantity: 10,
      quality: 'GOOD',
      linkedProject: 'Projeto QA',
    });

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejeita patientID inválido e campos obrigatórios ausentes', () => {
    const result = SampleModel.validate({
      patientID: 'abc',
      sampleType: 'INVALID',
      sampleOrigin: 'INVALID',
      extractionProtocol: 'INVALID',
      quantity: 0,
      quality: 'BAD',
      linkedProject: '',
    });

    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      'patientID deve ser um ID anonimizado de 8 dígitos numéricos',
      'sampleType inválido conforme MIABIS',
      'sampleOrigin inválido conforme MIABIS',
      'extractionProtocol inválido conforme MIABIS',
      'quantity deve ser um número maior que zero (µL)',
      'quality deve estar na escala MIABIS: GOOD, COMPROMISED ou UNKNOWN',
      'linkedProject é obrigatório',
    ]));
  });

  it('computeStatus e mapLifecycleToLegacy refletem o ciclo de vida esperado', () => {
    expect(SampleModel.computeStatus(10, 10, SampleModel.STATUS.AVAILABLE)).toBe(SampleModel.STATUS.AVAILABLE);
    expect(SampleModel.computeStatus(10, 4, SampleModel.STATUS.AVAILABLE)).toBe(SampleModel.STATUS.PARTIAL);
    expect(SampleModel.computeStatus(10, 0, SampleModel.STATUS.AVAILABLE)).toBe(SampleModel.STATUS.DEPLETED);
    expect(SampleModel.mapLifecycleToLegacy(SampleModel.STATUS.PARTIAL)).toBe('PartiallyWithdrawn');
    expect(SampleModel.mapLifecycleToLegacy(SampleModel.STATUS.DEPLETED)).toBe('TotallyWithdrawn');
  });

  it('create normaliza dados e aplica defaults de status e quantidade', () => {
    const sample = SampleModel.create({
      patientID: '12345678',
      sampleType: 'PLASMA',
      sampleOrigin: 'VENOUS_BLOOD',
      extractionProtocol: 'TUBE_EDTA',
      quantity: 12,
      quality: 'GOOD',
      linkedProject: 'Projeto QA',
      registerDate: '2026-04-13T12:00:00.000Z',
      sprec: { matrixType: 'fluid' },
      pharmacology_data: { treatment_status: 'NAIVE' },
    });

    expect(sample.patientID).toBe('12345678');
    expect(sample.registrationDate).toBeInstanceOf(Date);
    expect(sample.registerDate).toBeInstanceOf(Date);
    expect(sample.availableQuantity).toBe(12);
    expect(sample.originalQuantity).toBe(12);
    expect(sample.status).toBe(SampleModel.STATUS.AVAILABLE);
    expect(sample.currentStatus).toBe('Available');
    expect(sample.sprec.matrixType).toBe('fluid');
  });
});

describe('SampleMovementModel', () => {
  it('valida retirada com destino e propósito obrigatórios', () => {
    const result = SampleMovementModel.validate({
      sampleID: 'sample-001',
      type: 'withdraw',
      quantity: 2,
      responsible: 'QA User',
      destination: 'Lab A',
      purpose: 'research',
    });

    expect(result.isValid).toBe(true);
  });

  it('rejeita devolução sem observações quando condição não é íntegra', () => {
    const result = SampleMovementModel.validate({
      sampleID: 'sample-001',
      type: 'return',
      quantity: 1,
      responsible: 'QA User',
      condition: 'parcialmente comprometida',
      observations: '',
    });

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('observations é obrigatório quando a condição não é intact');
  });

  it('normaliza condição e cria ledger imutável', () => {
    const movement = SampleMovementModel.create({
      sampleID: 'sample-001',
      type: 'return',
      quantity: 1,
      responsible: 'QA User',
      condition: 'integra',
      observations: 'ok',
    });

    expect(movement.immutable).toBe(true);
    expect(movement.type).toBe('return');
    expect(movement.condition).toBe('intact');
    expect(movement.createdAt).toBeInstanceOf(Date);
  });
});
