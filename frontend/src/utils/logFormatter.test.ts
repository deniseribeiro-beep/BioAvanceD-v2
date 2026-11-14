import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  formatLogValue,
  formatLogJSON,
  formatPayload,
  formatMetadata,
  extractPayloadSummary,
} from './logFormatter';

// 2026-01-15T15:30:45Z is 12:30:45 in America/Sao_Paulo (UTC-3, no DST).
const SAMPLE_DATE = new Date('2026-01-15T15:30:45.000Z');

// A proxy whose `_type` read throws, so every formatter's first type check fails.
function throwingTypeProxy(extraThrowKeys: (string | symbol)[] = []) {
  return new Proxy({}, {
    get(target, key) {
      if (key === '_type' || extraThrowKeys.includes(key)) throw new Error(`read ${String(key)}`);
      return Reflect.get(target, key);
    },
  });
}

// formatLogJSON's last resort String(value) throws on the first conversion
// only, and JSON.stringify throws on toJSON, so a caller's own fallback chain
// has to reach its final String(...) arm.
function failsFirstStringConversion() {
  let conversions = 0;
  return new Proxy({}, {
    get(target, key) {
      if (key === '_type' || key === 'toJSON') throw new Error(`read ${String(key)}`);
      if (key === Symbol.toPrimitive && conversions++ === 0) throw new Error('first conversion');
      return Reflect.get(target, key);
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('formatLogValue', () => {
  it('prints null and undefined as words', () => {
    expect(formatLogValue(null)).toBe('null');
    expect(formatLogValue(undefined)).toBe('undefined');
  });

  it('prints the backend serialized special types', () => {
    expect(formatLogValue({ _type: 'ObjectId', _value: 'abc123' })).toBe('ObjectId("abc123")');
    expect(formatLogValue({ _type: 'Date', _value: '2026-01-15T15:30:45.000Z', _formatted: '15/01/2026' }))
      .toBe('Date("2026-01-15T15:30:45.000Z") // 15/01/2026');
    expect(formatLogValue({ _type: 'Date', _value: '2026-01-15T15:30:45.000Z' }))
      .toBe('Date("2026-01-15T15:30:45.000Z")');
    expect(formatLogValue({ _type: 'Buffer', _size: 42 })).toBe('Buffer(42 bytes)');
    expect(formatLogValue({ _type: 'Decimal128', _value: '1.5' }))
      .toBe(JSON.stringify({ _type: 'Decimal128', _value: '1.5' }, null, 2));
  });

  it('prints a Date with its ISO value and the Sao Paulo local time', () => {
    // RNF025 C2: the stored UTC instant is shown in the institution's zone, America/Sao_Paulo.
    expect(formatLogValue(SAMPLE_DATE)).toBe('Date("2026-01-15T15:30:45.000Z") // 15/01/2026, 12:30:45');
  });

  it('indents arrays and objects by nesting level, with commas between items', () => {
    expect(formatLogValue([])).toBe('[]');
    expect(formatLogValue({})).toBe('{}');
    expect(formatLogValue([1, 'a'])).toBe('[\n  1,\n  "a"\n]');
    expect(formatLogValue({ a: 1, b: [true] })).toBe('{\n  "a": 1,\n  "b": [\n    true\n  ]\n}');
  });

  it('quotes strings with escapes and prints other primitives plainly', () => {
    expect(formatLogValue('say "hi"\n')).toBe('"say \\"hi\\"\\n"');
    expect(formatLogValue(7)).toBe('7');
    expect(formatLogValue(false)).toBe('false');
    expect(formatLogValue(BigInt(9))).toBe('9');
  });
});

describe('formatLogJSON', () => {
  it('pretty-prints an object, converting special types and dates', () => {
    const out = formatLogJSON({
      id: { _type: 'ObjectId', _value: 'abc' },
      at: { _type: 'Date', _value: '2026-01-15', _formatted: '15/01/2026' },
      bare: { _type: 'Date', _value: '2026-01-15' },
      blob: { _type: 'Buffer', _size: 3 },
      other: { _type: 'Custom', x: 1 },
      when: SAMPLE_DATE,
      list: [1, { k: 'v' }],
    });
    expect(JSON.parse(out)).toEqual({
      id: 'ObjectId("abc")',
      at: 'Date(2026-01-15) // 15/01/2026',
      bare: 'Date(2026-01-15)',
      blob: 'Buffer(3 bytes)',
      other: { _type: 'Custom', x: 1 },
      when: { _type: 'Date', _value: '2026-01-15T15:30:45.000Z', _formatted: '15/01/2026, 12:30:45' },
      list: [1, { k: 'v' }],
    });
  });

  it('drops $-prefixed, inherited and own __proto__ keys', () => {
    const value = Object.create({ inherited: 1 });
    value.kept = 1;
    value.$set = 2;
    Object.defineProperty(value, '__proto__', { value: 3, enumerable: true });
    expect(JSON.parse(formatLogJSON(value))).toEqual({ kept: 1 });
  });

  it('marks circular references and nesting past ten levels', () => {
    const circular: any = { name: 'root' };
    circular.self = circular;
    expect(JSON.parse(formatLogJSON(circular))).toEqual({ name: 'root', self: '[Referência circular]' });

    let deep: any = { leaf: true };
    for (let i = 0; i < 11; i += 1) deep = { child: deep };
    let node = JSON.parse(formatLogJSON(deep));
    for (let i = 0; i < 10; i += 1) node = node.child;
    expect(node.child).toBe('[Profundidade máxima atingida]');
  });

  it('marks a property, an array or an object it cannot read', () => {
    const badGetter = { ok: 1, get broken() { throw new Error('no'); } };
    expect(JSON.parse(formatLogJSON(badGetter))).toEqual({ ok: 1, broken: '[Erro ao processar propriedade]' });

    expect(JSON.parse(formatLogJSON({ list: [throwingTypeProxy()] })))
      .toEqual({ list: '[Erro ao processar array]' });

    const noKeys = new Proxy({}, { ownKeys() { throw new Error('no keys'); } });
    expect(JSON.parse(formatLogJSON({ inner: noKeys }))).toEqual({ inner: '[Erro ao processar objeto]' });
  });

  it('falls back to formatLogValue when JSON.stringify yields nothing', () => {
    expect(formatLogJSON(undefined)).toBe('undefined');
    expect(formatLogJSON(null)).toBe('null');
  });

  it('falls back to formatLogValue, then String, when serializing throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(formatLogJSON({ big: BigInt(5) })).toBe('{\n  "big": 5\n}');
    expect(warn).toHaveBeenCalledWith('Erro ao formatar JSON, tentando método alternativo:', expect.any(TypeError));

    expect(formatLogJSON(throwingTypeProxy())).toBe('[object Object]');
  });
});

describe.each([
  ['formatPayload', formatPayload, 'Erro ao formatar payload:'],
  ['formatMetadata', formatMetadata, 'Erro ao formatar metadata:'],
] as const)('%s', (_name, format, errorLabel) => {
  it('returns N/A for an empty value', () => {
    expect(format(null)).toBe('N/A');
    expect(format(undefined)).toBe('N/A');
    expect(format('')).toBe('N/A');
  });

  it('pretty-prints a value through formatLogJSON', () => {
    expect(format({ a: { _type: 'ObjectId', _value: 'x' } })).toBe('{\n  "a": "ObjectId(\\"x\\")"\n}');
  });

  it('falls back to JSON.stringify when formatLogJSON throws', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(format(throwingTypeProxy([Symbol.toPrimitive]))).toBe('{}');
    expect(error).toHaveBeenCalledWith(errorLabel, expect.any(Error));
  });

  it('falls back to String when JSON.stringify throws too', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(format(failsFirstStringConversion())).toBe('[object Object]');
  });
});

describe('extractPayloadSummary', () => {
  it('summarizes empty, string, primitive and array payloads', () => {
    expect(extractPayloadSummary(undefined)).toBe('N/A');
    expect(extractPayloadSummary('short')).toBe('short');
    expect(extractPayloadSummary('x'.repeat(101))).toBe(`${'x'.repeat(100)}...`);
    expect(extractPayloadSummary(12)).toBe('12');
    expect(extractPayloadSummary([1, 2, 3])).toBe('[3 item(s)]');
    expect(extractPayloadSummary({})).toBe('{}');
  });

  it('lists up to five keys with a short form of each value', () => {
    expect(extractPayloadSummary({ a: null, b: undefined, c: 'hi', d: 'y'.repeat(31), e: 3 }))
      .toBe(`{ a: null, b: undefined, c: "hi", d: "${'y'.repeat(30)}...", e: 3 }`);
    expect(extractPayloadSummary({
      f: true,
      g: { _type: 'ObjectId', _value: 'abc' },
      h: { _type: 'Buffer', _size: 8 },
      i: { _type: 'Empty' },
      j: [1, 2],
    })).toBe('{ f: true, g: ObjectId(abc), h: Buffer(8), i: Empty(), j: [2 item(s)] }');
    expect(extractPayloadSummary({ k: { nested: 1 }, l: BigInt(4) })).toBe('{ k: {...}, l: 4 }');
  });

  it('marks a key whose value it cannot read', () => {
    const payload = { ok: 1, get broken() { throw new Error('no'); } };
    expect(extractPayloadSummary(payload)).toBe('{ ok: 1, broken: [erro] }');
  });

  it('counts the keys of a payload with more than five', () => {
    expect(extractPayloadSummary({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 })).toBe('{ 6 propriedades... }');
  });

  it('returns an error marker when the payload cannot be read', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const unreadable = new Proxy({}, { ownKeys() { throw new Error('no keys'); } });
    expect(extractPayloadSummary(unreadable)).toBe('[Erro ao processar payload]');
    expect(error).toHaveBeenCalledWith('Erro ao extrair resumo do payload:', expect.any(Error));
  });
});
