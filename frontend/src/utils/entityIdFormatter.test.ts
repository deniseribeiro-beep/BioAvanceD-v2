import { describe, expect, it } from 'vitest';
import { formatEntityID, formatEntityIDWithType, getEntityIDType, isValidEntityID } from './entityIdFormatter';

describe('entityIdFormatter', () => {
  it('formats empty, object, number and string ids', () => {
    expect(formatEntityID(null)).toBe('N/A');
    expect(formatEntityID('   ')).toBe('N/A');
    expect(formatEntityID({ _type: 'ObjectId', _value: 'abc' })).toBe('abc');
    expect(formatEntityID({ _value: 12 })).toBe('12');
    expect(formatEntityID({ toString: () => 'oid' })).toBe('oid');
    expect(formatEntityID({ toString: () => { throw new Error('bad'); } })).toBe('{}');
    expect(formatEntityID({ toString: () => '[object Object]', extra: 1 })).toContain('extra');
    expect(formatEntityID(42)).toBe('42');
    expect(formatEntityID('  PR-1  ')).toBe('PR-1');
    expect(formatEntityID(true)).toBe('true');
  });

  it('accepts a usable id and names its shape', () => {
    expect(isValidEntityID(null)).toBe(false);
    expect(isValidEntityID('  ')).toBe(false);
    expect(isValidEntityID({})).toBe(false);
    expect(isValidEntityID('507f1f77bcf86cd799439011')).toBe(true);
    expect(getEntityIDType(null)).toBe('none');
    expect(getEntityIDType('507f1f77bcf86cd799439011')).toBe('ObjectId');
    expect(getEntityIDType('12345678')).toBe('PatientID');
    expect(getEntityIDType('99')).toBe('NumericID');
    expect(getEntityIDType('PR-1')).toBe('StringID');
    expect(formatEntityIDWithType('12345678')).toEqual({ value: '12345678', type: 'PatientID' });
  });
});
