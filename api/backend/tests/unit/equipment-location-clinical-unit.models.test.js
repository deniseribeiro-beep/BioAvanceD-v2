import { describe, it, expect } from 'vitest';

const EquipmentModel = require('../../src/models/Equipment');
const LocationModel = require('../../src/models/Location');
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

describe('LocationModel', () => {
  it('valida localização com equipmentType obrigatório', () => {
    const result = LocationModel.validate({
      equipmentType: 1,
      block: 2,
      rack: 3,
      drawer: 4,
      box: 5,
      wellPosition: 'A1',
    });

    expect(result.isValid).toBe(true);
  });

  it('rejeita tipos inválidos para posição física', () => {
    const result = LocationModel.validate({
      equipmentType: '1',
      block: '2',
      rack: '3',
      drawer: '4',
      box: '5',
      wellPosition: 1,
      eppendorfWell: 123,
    });

    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      'equipmentType deve ser number',
      'block deve ser number',
      'rack deve ser number',
      'drawer deve ser number',
      'box deve ser number',
      'wellPosition deve ser string',
      'eppendorfWell deve ser array [M, N] ou string',
    ]));
  });

  it('cria localização e gera string hierárquica', () => {
    const location = LocationModel.create({
      locationID: '101',
      equipmentType: 1,
      block: 2,
      rack: 3,
      drawer: 4,
      box: 5,
      eppendorfWell: ['M', 'N'],
    });

    expect(location.locationID).toBe(101);
    expect(location.equipmentType).toBe(1);
    expect(location.wellPosition).toBe('MxN');
    expect(LocationModel.getLocationString(location)).toContain('Equip:1');
    expect(LocationModel.getLocationString(location)).toContain('Caixa:5');
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
