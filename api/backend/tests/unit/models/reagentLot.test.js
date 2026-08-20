import { describe, it, expect } from 'vitest';

const ReagentLotModel = require('../../../src/models/ReagentLot');

describe('ReagentLotModel (RF025 AC#2, dict-02 ELM-0298..0304)', () => {
  const baseReagentLot = {
    reagentName: 'Primer Mix A',
    lotNumber: 'LOT-2026-001',
  };

  describe('validate', () => {
    it('valid minimal payload -> isValid true, no errors', () => {
      const result = ReagentLotModel.validate({ ...baseReagentLot });
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('valid full payload -> isValid true', () => {
      const result = ReagentLotModel.validate({
        ...baseReagentLot,
        manufacturer: 'Thermo Fisher',
        catalogNumber: 'CAT-4485',
        expirationDate: '2027-01-01',
        storageCondition: '-20C',
      });
      expect(result.isValid).toBe(true);
    });

    it.each([
      ['reagentName', { reagentName: '' }],
      ['lotNumber', { lotNumber: '' }],
    ])('missing %s -> isValid false', (_field, override) => {
      const result = ReagentLotModel.validate({ ...baseReagentLot, ...override });
      expect(result.isValid).toBe(false);
    });

    it('manufacturer/catalogNumber/expirationDate/storageCondition omitted -> still valid (0..1 per dict-02)', () => {
      const result = ReagentLotModel.validate({ ...baseReagentLot });
      expect(result.isValid).toBe(true);
    });

    it('expirationDate not a valid date -> isValid false', () => {
      const result = ReagentLotModel.validate({ ...baseReagentLot, expirationDate: 'not-a-date' });
      expect(result.isValid).toBe(false);
    });

    it('manufacturer not a string -> isValid false', () => {
      const result = ReagentLotModel.validate({ ...baseReagentLot, manufacturer: 123 });
      expect(result.isValid).toBe(false);
    });
  });

  describe('create', () => {
    it('generates a uuid reagentId, preserves required fields, defaults optional ones to null', () => {
      const result = ReagentLotModel.create({ ...baseReagentLot });

      expect(result.reagentId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(result.reagentName).toBe('Primer Mix A');
      expect(result.lotNumber).toBe('LOT-2026-001');
      expect(result.manufacturer).toBeNull();
      expect(result.catalogNumber).toBeNull();
      expect(result.expirationDate).toBeNull();
      expect(result.storageCondition).toBeNull();
    });

    it('stores expirationDate as a real Date when provided', () => {
      const result = ReagentLotModel.create({ ...baseReagentLot, expirationDate: '2027-06-30' });
      expect(result.expirationDate).toBeInstanceOf(Date);
      expect(result.expirationDate.toISOString()).toContain('2027-06-30');
    });
  });
});
