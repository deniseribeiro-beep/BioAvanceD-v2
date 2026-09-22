import { describe, expect, it } from 'vitest';

const normalizers = [
  ['ATC', require('../../src/reference-data/reference-imports/normalizeAtc')],
  ['CL', require('../../src/reference-data/reference-imports/normalizeCl')],
  ['DUO', require('../../src/reference-data/reference-imports/normalizeDuo')],
  ['DCB', require('../../src/reference-data/reference-imports/normalizeDcb')],
  ['HGNC', require('../../src/reference-data/reference-imports/normalizeHgnc')],
  ['HPO', require('../../src/reference-data/reference-imports/normalizeHpo')],
  ['ICD10', require('../../src/reference-data/reference-imports/normalizeIcd10')],
  ['EDAM', require('../../src/reference-data/reference-imports/normalizeEdam')],
  ['ICD11', require('../../src/reference-data/reference-imports/normalizeIcd11')],
  ['LOINC', require('../../src/reference-data/reference-imports/normalizeLoinc')],
  ['NCBITAX', require('../../src/reference-data/reference-imports/normalizeNcbitax')],
  ['MONDO', require('../../src/reference-data/reference-imports/normalizeMondo')],
  ['OMIM', require('../../src/reference-data/reference-imports/normalizeOmim')],
  ['ORPHA', require('../../src/reference-data/reference-imports/normalizeOrpha')],
  ['UBERON', require('../../src/reference-data/reference-imports/normalizeUberon')],
  ['UCUM', require('../../src/reference-data/reference-imports/normalizeUcum')],
];

describe('item 8 branch-95 reference normalizer type guards', () => {
  it.each(normalizers)('%s rejects non-string code/label input without coercing source records', (_name, module) => {
    const result = module.normalizeRecord({ id: 123, lbl: 456 }, 7);

    expect(result.ok).toBe(false);
    expect(result.issue).toMatchObject({
      rowNumber: 7,
      fieldPath: 'id',
      errorCode: 'MISSING_CODE',
      rawValue: { id: 123, lbl: 456 },
    });
  });
});
