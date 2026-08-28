import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const { parseGroupFields } = require('../../src/utils/importGroupFields');

describe('parseGroupFields', () => {
  describe('empty input', () => {
    it('returns an empty object for undefined', () => {
      expect(parseGroupFields(undefined)).toEqual({ ok: true, value: {} });
    });

    it('returns an empty object for null', () => {
      expect(parseGroupFields(null)).toEqual({ ok: true, value: {} });
    });

    it('returns an empty object for an empty string', () => {
      expect(parseGroupFields('')).toEqual({ ok: true, value: {} });
    });
  });

  describe('string input (JSON.parse)', () => {
    it('parses a valid JSON string into its object value', () => {
      expect(parseGroupFields('{"clinicalUnit":"HUSF"}')).toEqual({
        ok: true,
        value: { clinicalUnit: 'HUSF' }
      });
    });

    it('rejects a malformed JSON string with reason "malformed" instead of throwing', () => {
      expect(() => parseGroupFields('{not json')).not.toThrow();
      expect(parseGroupFields('{not json')).toEqual({ ok: false, reason: 'malformed' });
    });
  });

  describe('shape rejection', () => {
    it('rejects an array value with reason "shape"', () => {
      expect(parseGroupFields([1, 2, 3])).toEqual({ ok: false, reason: 'shape' });
    });

    it('rejects an array-shaped JSON string with reason "shape"', () => {
      expect(parseGroupFields('[1,2,3]')).toEqual({ ok: false, reason: 'shape' });
    });

    it('rejects a string primitive value with reason "shape"', () => {
      expect(parseGroupFields('"just a string"')).toEqual({ ok: false, reason: 'shape' });
    });

    it('rejects a number primitive value with reason "shape"', () => {
      // a bare JSON number is valid JSON but not an object
      expect(parseGroupFields('42')).toEqual({ ok: false, reason: 'shape' });
    });

    it('rejects a boolean primitive value with reason "shape"', () => {
      expect(parseGroupFields('true')).toEqual({ ok: false, reason: 'shape' });
    });

    it('rejects a bare JSON null literal with reason "shape"', () => {
      // 'null' parses successfully via JSON.parse but is not a plain object,
      // and must not be confused with the undefined/null/'' short-circuit above
      // (which only applies to the raw *input*, not the parsed result).
      expect(parseGroupFields('null')).toEqual({ ok: false, reason: 'shape' });
    });
  });

  describe('key/value rejection', () => {
    it('rejects a key starting with "$" (operator injection) with reason "value"', () => {
      expect(parseGroupFields({ $ne: null })).toEqual({ ok: false, reason: 'value' });
    });

    it('rejects a "$ne" key even when it arrives as a JSON string', () => {
      expect(parseGroupFields('{"$ne": null}')).toEqual({ ok: false, reason: 'value' });
    });

    it('rejects a dotted key with reason "value"', () => {
      expect(parseGroupFields({ 'a.b': 1 })).toEqual({ ok: false, reason: 'value' });
    });

    it('rejects a nested object value with reason "value"', () => {
      expect(parseGroupFields({ clinicalUnit: { $gt: 1 } })).toEqual({ ok: false, reason: 'value' });
    });

    it('rejects a null value with reason "value"', () => {
      // sanitizeImportOptions silently drops null-valued entries; this util
      // rejects the whole payload instead -- null is not string/number/boolean.
      expect(parseGroupFields({ clinicalUnit: null })).toEqual({ ok: false, reason: 'value' });
    });

    it('rejects an array-valued field with reason "value"', () => {
      expect(parseGroupFields({ tags: ['a', 'b'] })).toEqual({ ok: false, reason: 'value' });
    });
  });

  describe('accepted payloads', () => {
    it('accepts a valid flat payload of mixed scalars and returns it intact', () => {
      const input = { clinicalUnit: 'HUSF', priority: 3, urgent: true };
      expect(parseGroupFields(input)).toEqual({
        ok: true,
        value: { clinicalUnit: 'HUSF', priority: 3, urgent: true }
      });
    });

    it('accepts an already-parsed object (not a string) without re-parsing it', () => {
      const input = { origin: 'lab-3' };
      const result = parseGroupFields(input);
      expect(result).toEqual({ ok: true, value: { origin: 'lab-3' } });
      // must be a distinct plain object, not the same reference re-used
      expect(result.value).not.toBe(input);
    });

    it('accepts an empty object payload', () => {
      expect(parseGroupFields({})).toEqual({ ok: true, value: {} });
    });
  });
});
