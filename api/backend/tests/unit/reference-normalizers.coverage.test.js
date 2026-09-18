import { describe, expect, it } from 'vitest';

const normalizers = [
  ['Atc', require('../../src/reference-data/reference-imports/normalizeAtc').normalizeRecord],
  ['Cl', require('../../src/reference-data/reference-imports/normalizeCl').normalizeRecord],
  ['Dcb', require('../../src/reference-data/reference-imports/normalizeDcb').normalizeRecord],
  ['Duo', require('../../src/reference-data/reference-imports/normalizeDuo').normalizeRecord],
  ['Edam', require('../../src/reference-data/reference-imports/normalizeEdam').normalizeRecord],
  ['Hgnc', require('../../src/reference-data/reference-imports/normalizeHgnc').normalizeRecord],
  ['Hpo', require('../../src/reference-data/reference-imports/normalizeHpo').normalizeRecord],
  ['Icd10', require('../../src/reference-data/reference-imports/normalizeIcd10').normalizeRecord],
  ['Icd11', require('../../src/reference-data/reference-imports/normalizeIcd11').normalizeRecord],
  ['Loinc', require('../../src/reference-data/reference-imports/normalizeLoinc').normalizeRecord],
  ['Mondo', require('../../src/reference-data/reference-imports/normalizeMondo').normalizeRecord],
  ['Ncbitax', require('../../src/reference-data/reference-imports/normalizeNcbitax').normalizeRecord],
  ['Omim', require('../../src/reference-data/reference-imports/normalizeOmim').normalizeRecord],
  ['Orpha', require('../../src/reference-data/reference-imports/normalizeOrpha').normalizeRecord],
  ['Uberon', require('../../src/reference-data/reference-imports/normalizeUberon').normalizeRecord],
  ['Ucum', require('../../src/reference-data/reference-imports/normalizeUcum').normalizeRecord],
];

describe('item 8 reference normalizer edge branches', () => {
  it.each(normalizers)('%s handles non-array parents/synonyms and obsolete concepts', (_name, normalizeRecord) => {
    const result = normalizeRecord({
      id: ' CODE-1 ',
      lbl: ' Label 1 ',
      is_a: 'not-an-array',
      synonyms: 'not-an-array',
      obsolete: true,
    }, 7);

    expect(result.ok).toBe(true);
    expect(result.parents).toEqual([]);
    expect(result.concept.code).toBe('CODE-1');
    expect(result.concept.display).toBe('Label 1');
    expect(result.concept.synonyms).toEqual([]);
    expect(result.concept.conceptStatus).toBe('obsolete');
  });
});
