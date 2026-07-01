import { describe, it, expect } from 'vitest';
const { serializeLogs, serializeLogSimple } = require('../../src/utils/logSerializer');

describe('serializeLogs', () => {
  it('returns null for null log', () => {
    const result = serializeLogs([null]);
    expect(result[0]).toBeNull();
  });

  it('serializes array of plain logs', () => {
    const logs = [{ action: 'CREATE', entity: 'Sample' }, { action: 'DELETE', entity: 'Patient' }];
    const result = serializeLogs(logs);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
  });

  it('serializes Date fields to _type: Date format', () => {
    const log = { action: 'UPDATE', timestamp: new Date('2026-01-15T10:00:00Z') };
    const result = serializeLogs([log]);
    expect(result[0].timestamp._type).toBe('Date');
    expect(result[0].timestamp._value).toContain('2026-01-15');
  });

  it('serializes Buffer fields to _type: Buffer format', () => {
    const log = { data: Buffer.from('hello') };
    const result = serializeLogs([log]);
    expect(result[0].data._type).toBe('Buffer');
    expect(typeof result[0].data._value).toBe('string'); // base64
  });

  it('serializes nested objects', () => {
    const log = { metadata: { ip: '127.0.0.1', nested: { date: new Date() } } };
    const result = serializeLogs([log]);
    expect(result[0].metadata.nested.date._type).toBe('Date');
  });

  it('serializes arrays within logs', () => {
    const log = { items: [1, 2, 3] };
    const result = serializeLogs([log]);
    expect(result[0].items).toEqual([1, 2, 3]);
  });

  it('handles circular reference guard', () => {
    // Deep nesting beyond 10 levels triggers depth guard
    let nested = { leaf: true };
    for (let i = 0; i < 12; i++) {
      nested = { child: nested };
    }
    const log = { deep: nested };
    expect(() => serializeLogs([log])).not.toThrow();
  });

  it('passes single non-array through', () => {
    const log = { action: 'READ' };
    const result = serializeLogs(log); // not an array
    expect(result.action).toBe('READ');
  });
});

describe('serializeLogSimple', () => {
  it('returns null for null input', () => {
    expect(serializeLogSimple(null)).toBeNull();
  });

  it('returns already-typed objects unchanged', () => {
    const typed = { _type: 'Date', _value: '2026-01-01T00:00:00Z' };
    expect(serializeLogSimple(typed)).toEqual(typed);
  });

  it('converts Date timestamp to ISO string', () => {
    const date = new Date('2026-03-15T08:00:00Z');
    const log = { action: 'READ', timestamp: date };
    const result = serializeLogSimple(log);
    expect(typeof result.timestamp).toBe('string');
    expect(result.timestamp).toContain('2026-03-15');
  });

  it('converts dateTime Date to ISO string', () => {
    const log = { dateTime: new Date('2026-06-30T12:00:00Z') };
    const result = serializeLogSimple(log);
    expect(typeof result.dateTime).toBe('string');
  });

  it('converts createdAt Date to ISO string', () => {
    const log = { createdAt: new Date('2026-01-01T00:00:00Z') };
    const result = serializeLogSimple(log);
    expect(typeof result.createdAt).toBe('string');
  });

  it('converts updatedAt Date to ISO string', () => {
    const log = { updatedAt: new Date('2026-01-01T00:00:00Z') };
    const result = serializeLogSimple(log);
    expect(typeof result.updatedAt).toBe('string');
  });

  it('preserves string timestamp unchanged', () => {
    const log = { timestamp: '2026-01-01T00:00:00.000Z' };
    const result = serializeLogSimple(log);
    expect(result.timestamp).toBe('2026-01-01T00:00:00.000Z');
  });

  it('preserves plain fields', () => {
    const log = { action: 'EXPORT', entity: 'Report', count: 42 };
    const result = serializeLogSimple(log);
    expect(result.action).toBe('EXPORT');
    expect(result.entity).toBe('Report');
    expect(result.count).toBe(42);
  });
});
