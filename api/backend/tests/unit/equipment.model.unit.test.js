import { describe, it, expect } from 'vitest';
const EquipmentModel = require('../../src/models/Equipment');

describe('EquipmentModel.validate', () => {
  const validData = { equipmentDescription: 'Freezer -80°C Thermo Scientific' };

  it('returns no errors for minimal valid data', () => {
    const result = EquipmentModel.validate(validData);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('requires equipmentDescription', () => {
    const result = EquipmentModel.validate({});
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('equipmentDescription'))).toBe(true);
  });

  it('rejects non-numeric equipmentID', () => {
    const result = EquipmentModel.validate({ ...validData, equipmentID: 'abc' });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('equipmentID'))).toBe(true);
  });

  it('accepts numeric equipmentID', () => {
    const result = EquipmentModel.validate({ ...validData, equipmentID: 42 });
    expect(result.isValid).toBe(true);
  });

  it('rejects invalid type', () => {
    const result = EquipmentModel.validate({ ...validData, type: 'Robot' });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('type'))).toBe(true);
  });

  it('accepts valid type', () => {
    EquipmentModel.EQUIPMENT_TYPES.forEach(type => {
      const result = EquipmentModel.validate({ ...validData, type });
      expect(result.isValid).toBe(true);
    });
  });

  it('rejects invalid status', () => {
    const result = EquipmentModel.validate({ ...validData, status: 'Broken' });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('status'))).toBe(true);
  });

  it('accepts valid status', () => {
    EquipmentModel.EQUIPMENT_STATUS.forEach(status => {
      const result = EquipmentModel.validate({ ...validData, status });
      expect(result.isValid).toBe(true);
    });
  });

  it('rejects non-string serialNumber', () => {
    const result = EquipmentModel.validate({ ...validData, serialNumber: 12345 });
    expect(result.isValid).toBe(false);
  });

  it('rejects empty name string', () => {
    const result = EquipmentModel.validate({ ...validData, name: '' });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('name'))).toBe(true);
  });
});

describe('EquipmentModel constants', () => {
  it('EQUIPMENT_TYPES contains Freezer and Analytical', () => {
    expect(EquipmentModel.EQUIPMENT_TYPES).toContain('Freezer');
    expect(EquipmentModel.EQUIPMENT_TYPES).toContain('Analytical');
  });

  it('EQUIPMENT_STATUS contains Active', () => {
    expect(EquipmentModel.EQUIPMENT_STATUS).toContain('Active');
    expect(EquipmentModel.EQUIPMENT_STATUS).toContain('Inactive');
  });
});
