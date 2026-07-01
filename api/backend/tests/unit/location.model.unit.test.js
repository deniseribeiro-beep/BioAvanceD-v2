import { describe, it, expect } from 'vitest';
const LocationModel = require('../../src/models/Location');

describe('LocationModel.getLocationString', () => {
  it('returns string with undefined parts for empty location (block/rack/drawer/box are undefined, not null)', () => {
    // The method only skips null, not undefined
    const result = LocationModel.getLocationString({});
    expect(typeof result).toBe('string');
  });

  it('returns empty string when all parts are null', () => {
    expect(LocationModel.getLocationString({ block: null, rack: null, drawer: null, box: null })).toBe('');
  });

  it('includes equipmentType', () => {
    const result = LocationModel.getLocationString({ equipmentType: 'Freezer' });
    expect(result).toContain('Equip:Freezer');
  });

  it('includes block', () => {
    const result = LocationModel.getLocationString({ block: 2 });
    expect(result).toContain('Bloco:2');
  });

  it('includes rack', () => {
    const result = LocationModel.getLocationString({ rack: 3 });
    expect(result).toContain('Rack:3');
  });

  it('includes drawer', () => {
    const result = LocationModel.getLocationString({ drawer: 1 });
    expect(result).toContain('Gaveta:1');
  });

  it('includes box', () => {
    const result = LocationModel.getLocationString({ box: 5 });
    expect(result).toContain('Caixa:5');
  });

  it('includes eppendorfWell', () => {
    const result = LocationModel.getLocationString({ eppendorfWell: ['A', '1'] });
    expect(result).toContain('Poco:A');
  });

  it('separates parts with pipe', () => {
    const result = LocationModel.getLocationString({ equipmentType: 'Freezer', block: 1 });
    expect(result).toContain(' | ');
  });

  it('builds full location string', () => {
    const location = { equipmentType: 'Freezer', block: 1, rack: 2, drawer: 3, box: 4 };
    const result = LocationModel.getLocationString(location);
    expect(result).toContain('Equip:Freezer');
    expect(result).toContain('Bloco:1');
    expect(result).toContain('Rack:2');
    expect(result).toContain('Gaveta:3');
    expect(result).toContain('Caixa:4');
  });

  it('skips null values', () => {
    const result = LocationModel.getLocationString({ equipmentType: 'Freezer', block: null, rack: 2 });
    expect(result).not.toContain('Bloco');
    expect(result).toContain('Rack:2');
  });
});

describe('LocationModel.validate', () => {
  it('does not throw for empty data', () => {
    expect(() => LocationModel.validate({})).not.toThrow();
  });
});
