import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const MeasurementUnitModel = require('../../src/models/MeasurementUnit.js');

describe('MeasurementUnitModel.validate', () => {
  it('returns isValid true and no errors for a fully valid payload', () => {
    const result = MeasurementUnitModel.validate({
      unitID: 'U1',
      description: 'Milliliters'
    });

    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('accepts unitID of 0 (falsy but explicitly allowed by the !data.unitID && data.unitID !== 0 check)', () => {
    const result = MeasurementUnitModel.validate({
      unitID: 0,
      description: 'Milliliters'
    });

    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects a missing unitID (undefined)', () => {
    const result = MeasurementUnitModel.validate({
      description: 'Milliliters'
    });

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('unitID é obrigatório');
  });

  it('rejects a null unitID', () => {
    const result = MeasurementUnitModel.validate({
      unitID: null,
      description: 'Milliliters'
    });

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('unitID é obrigatório');
  });

  it('rejects an empty-string unitID', () => {
    const result = MeasurementUnitModel.validate({
      unitID: '',
      description: 'Milliliters'
    });

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('unitID é obrigatório');
  });

  it('rejects a missing description', () => {
    const result = MeasurementUnitModel.validate({
      unitID: 'U1'
    });

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('description é obrigatório e deve ser string');
  });

  it('rejects a non-string description (e.g. a number)', () => {
    const result = MeasurementUnitModel.validate({
      unitID: 'U1',
      description: 123
    });

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('description é obrigatório e deve ser string');
  });

  it('rejects an empty-string description (falsy, fails the !data.description branch)', () => {
    const result = MeasurementUnitModel.validate({
      unitID: 'U1',
      description: ''
    });

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('description é obrigatório e deve ser string');
  });

  it('accumulates both errors when both unitID and description are invalid', () => {
    const result = MeasurementUnitModel.validate({});

    expect(result.isValid).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.errors).toContain('unitID é obrigatório');
    expect(result.errors).toContain('description é obrigatório e deve ser string');
  });
});

describe('MeasurementUnitModel.create', () => {
  it('builds an object with the given unitID, description and abbreviation', () => {
    const result = MeasurementUnitModel.create({
      unitID: 'U1',
      description: 'Milliliters',
      abbreviation: 'mL'
    });

    expect(result.unitID).toBe('U1');
    expect(result.description).toBe('Milliliters');
    expect(result.abbreviation).toBe('mL');
    expect(result.createdAt).toBeInstanceOf(Date);
    expect(result.updatedAt).toBeInstanceOf(Date);
  });

  it('defaults abbreviation to null when omitted (falsy fallback branch)', () => {
    const result = MeasurementUnitModel.create({
      unitID: 'U1',
      description: 'Milliliters'
    });

    expect(result.abbreviation).toBeNull();
  });

  it('defaults abbreviation to null when explicitly given an empty string (falsy fallback branch)', () => {
    const result = MeasurementUnitModel.create({
      unitID: 'U1',
      description: 'Milliliters',
      abbreviation: ''
    });

    expect(result.abbreviation).toBeNull();
  });
});
