import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const { parseImportMapping } = require('../../src/utils/importMapping');

// #869: `mapping` is the sibling of `groupFields` in the same handler, and it
// is the more dangerous of the two -- `groupFields`' values are compared, but
// `mapping`'s values become *document keys* in
// ImportLGPDService#buildMappedPatientRow (`mapped[targetField] = ...`).
// #818 gave groupFields a boundary validator and #837 gave mapping's
// JSON.parse a 400 instead of a 500, but neither gave mapping a schema.
describe('parseImportMapping', () => {
  describe('empty input', () => {
    it('returns an empty object for undefined', () => {
      expect(parseImportMapping(undefined)).toEqual({ ok: true, value: {} });
    });

    it('returns an empty object for null', () => {
      expect(parseImportMapping(null)).toEqual({ ok: true, value: {} });
    });

    it('returns an empty object for an empty string', () => {
      expect(parseImportMapping('')).toEqual({ ok: true, value: {} });
    });
  });

  describe('string input (JSON.parse)', () => {
    it('parses a valid JSON string into its object value', () => {
      expect(parseImportMapping('{"Nome do Paciente":"patientName"}')).toEqual({
        ok: true,
        value: { 'Nome do Paciente': 'patientName' }
      });
    });

    it('rejects a malformed JSON string with reason "malformed" instead of throwing', () => {
      expect(() => parseImportMapping('{not json')).not.toThrow();
      expect(parseImportMapping('{not json')).toEqual({ ok: false, reason: 'malformed' });
    });
  });

  describe('shape rejection', () => {
    it('rejects an array with reason "shape"', () => {
      expect(parseImportMapping(['patientName'])).toEqual({ ok: false, reason: 'shape' });
    });

    it('rejects a number with reason "shape"', () => {
      expect(parseImportMapping(42)).toEqual({ ok: false, reason: 'shape' });
    });
  });

  // The half parseGroupFields does not have to care about: a mapping *value*
  // is the name of the field the row will be written under, so an operator
  // string there is a document key, not a compared value.
  describe('target-field (value) rejection', () => {
    it('rejects an operator-shaped target field', () => {
      expect(parseImportMapping('{"col":"$where"}')).toEqual({ ok: false, reason: 'target' });
    });

    it('rejects a dotted target field, which would write a nested path', () => {
      expect(parseImportMapping('{"col":"a.b"}')).toEqual({ ok: false, reason: 'target' });
    });

    it('rejects a prototype-polluting target field', () => {
      expect(parseImportMapping('{"col":"__proto__"}')).toEqual({ ok: false, reason: 'target' });
      expect(parseImportMapping('{"col":"constructor"}')).toEqual({ ok: false, reason: 'target' });
    });

    it('rejects a non-string target field', () => {
      expect(parseImportMapping({ col: { $ne: null } })).toEqual({ ok: false, reason: 'target' });
      expect(parseImportMapping({ col: 7 })).toEqual({ ok: false, reason: 'target' });
      expect(parseImportMapping({ col: ['patientName'] })).toEqual({ ok: false, reason: 'target' });
    });

    it('keeps an explicitly unmapped column, which buildMappedPatientRow already skips', () => {
      // `if (!targetField) return;` is the existing behaviour for a falsy
      // target. Rejecting it here would 400 a caller that says "ignore this
      // column" the way the UI's own empty select does.
      expect(parseImportMapping({ col: '', other: null })).toEqual({
        ok: true,
        value: { col: '', other: null }
      });
    });
  });

  describe('source-column (key) rejection', () => {
    it('rejects an operator-shaped source column', () => {
      expect(parseImportMapping('{"$ne":"patientName"}')).toEqual({ ok: false, reason: 'source' });
    });

    // Deliberately NOT symmetric with the target side. A source column is
    // only read off the parsed row (`rawRow[sourceColumn]`), never written,
    // so a dot is a plain miss rather than a path expression -- and
    // "Data Nasc." is an ordinary spreadsheet header. Rejecting it would
    // 400 a valid import to guard against nothing.
    it('accepts a dotted source column, because sources are read and not written', () => {
      expect(parseImportMapping('{"Data Nasc.":"birthDate"}')).toEqual({
        ok: true,
        value: { 'Data Nasc.': 'birthDate' }
      });
    });
  });

  describe('accepted payloads', () => {
    it('accepts a realistic Portuguese-header mapping', () => {
      const raw = {
        'Nome do Paciente': 'patientName',
        'E-mail': 'email',
        CPF: 'cpf',
        'Data de Nascimento': 'birthDate'
      };
      expect(parseImportMapping(raw)).toEqual({ ok: true, value: raw });
    });

    it('returns a copy rather than the caller-supplied object', () => {
      const raw = { col: 'patientName' };
      const result = parseImportMapping(raw);
      expect(result.value).not.toBe(raw);
      expect(result.value).toEqual(raw);
    });
  });
});
