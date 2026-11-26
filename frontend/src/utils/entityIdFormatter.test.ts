import { describe, expect, it } from 'vitest';
import { formatEntityID } from './entityIdFormatter';

const OBJECT_ID = '507f1f77bcf86cd799439011';

describe('formatEntityID: empty input', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an empty string', ''],
    ['zero', 0],
    ['false', false],
  ])('returns N/A for %s', (_label, input) => {
    expect(formatEntityID(input)).toBe('N/A');
  });

  it('returns N/A for a whitespace-only string', () => {
    expect(formatEntityID('   \t ')).toBe('N/A');
  });
});

describe('formatEntityID: serialized objects', () => {
  it('returns the _value of a serialized ObjectId as-is', () => {
    expect(formatEntityID({ _type: 'ObjectId', _value: OBJECT_ID })).toBe(OBJECT_ID);
  });

  it('returns a non-string ObjectId _value unconverted', () => {
    expect(formatEntityID({ _type: 'ObjectId', _value: 42 })).toBe(42);
  });

  it('stringifies the _value of an object of another _type', () => {
    expect(formatEntityID({ _type: 'Long', _value: 42 })).toBe('42');
  });

  it('falls back to JSON for an ObjectId with an empty _value', () => {
    expect(formatEntityID({ _type: 'ObjectId', _value: '' })).toBe('{"_type":"ObjectId","_value":""}');
  });

  it('uses a custom toString when it gives a meaningful string', () => {
    const id = { toString: () => 'PAT-0001' };
    expect(formatEntityID(id)).toBe('PAT-0001');
  });

  it('joins an array through its toString', () => {
    expect(formatEntityID([1, 2])).toBe('1,2');
  });

  it('falls back to JSON for a plain object whose toString is [object Object]', () => {
    expect(formatEntityID({ patientID: 7 })).toBe('{"patientID":7}');
  });

  it('falls back to JSON when toString returns an empty string', () => {
    const id = { code: 'x', toString: () => '' };
    expect(formatEntityID(id)).toBe('{"code":"x"}');
  });

  it('falls back to JSON when toString throws', () => {
    const id = {
      code: 'y',
      toString: () => {
        throw new Error('boom');
      },
    };
    expect(formatEntityID(id)).toBe('{"code":"y"}');
  });

  it('falls back to JSON for an object with no toString', () => {
    const id = Object.assign(Object.create(null), { code: 'z' });
    expect(formatEntityID(id)).toBe('{"code":"z"}');
  });
});

describe('formatEntityID: primitives', () => {
  it('stringifies a number', () => {
    expect(formatEntityID(12345678)).toBe('12345678');
  });

  it('trims a string', () => {
    expect(formatEntityID('  abc-1  ')).toBe('abc-1');
  });

  it('stringifies any other truthy value', () => {
    expect(formatEntityID(true)).toBe('true');
  });
});
