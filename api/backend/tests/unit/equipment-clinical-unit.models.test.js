import { describe, it, expect } from 'vitest';

const EquipmentModel = require('../../src/models/Equipment');
const ClinicalUnitModel = require('../../src/models/ClinicalUnit');

describe('EquipmentModel', () => {
  it('valida equipamento com descrição obrigatória e status/tipo válidos', () => {
    const result = EquipmentModel.validate({
      equipmentDescription: 'Freezer Ultra Baixo',
      name: 'Freezer 01',
      type: 'Freezer',
      status: 'Active',
      serialNumber: 'SN-001',
    });

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejeita tipo e status inválidos', () => {
    const result = EquipmentModel.validate({
      equipmentDescription: 'Equipamento QA',
      type: 'Invalid',
      status: 'Broken',
    });

    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      'type deve ser um de: Freezer, Analytical, Storage, Processing, Other',
      'status deve ser um de: Calibrado, Maintenance, Active, Inactive, Needs Calibration',
    ]));
  });

  it('cria equipamento com defaults esperados', () => {
    const equipment = EquipmentModel.create({
      equipmentDescription: 'Equipamento QA',
      purchaseDate: '2026-04-01T00:00:00.000Z',
    });

    expect(equipment.type).toBe('Other');
    expect(equipment.status).toBe('Active');
    expect(equipment.purchaseDate).toBeInstanceOf(Date);
    expect(equipment.createdAt).toBeInstanceOf(Date);
  });
});

describe('ClinicalUnitModel', () => {
  it('normaliza nome e gera sigla sem stop words', () => {
    const unit = ClinicalUnitModel.create({
      name: '  Unidade de Terapia Intensiva  ',
      active: true,
    });

    expect(unit.name).toBe('Unidade de Terapia Intensiva');
    expect(unit.normalizedName).toBe('UNIDADE DE TERAPIA INTENSIVA');
    expect(unit.acronym).toBe('UTI');
    expect(unit.active).toBe(true);
  });

  it('valida nome curto e active inválido', () => {
    const result = ClinicalUnitModel.validate({
      name: 'UT',
      active: 'yes',
    });

    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      'name deve ter ao menos 3 caracteres',
      'active deve ser boolean',
    ]));
  });
});
