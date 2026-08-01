import { describe, it, expect } from 'vitest';
const canonicalDictionary = require('../../../src/reference-data/canonical-dictionary');

/**
 * RF022 follow-up (#381): dict-08_MAIN_GAPS.md's Foundation Data Pipeline
 * gate is "929 elementos verificados" — before this catalog existed, that
 * count was only checkable by counting rows in dict-02_DICIONARIO.md by
 * hand. These assertions are that gate made real: the catalog the backend
 * loads must actually carry all 929 elements, each with the fields the
 * issue named as the minimum bar (entity, field, cardinality, phase).
 */
describe('canonical-dictionary catalog (dict-02_DICIONARIO.md v1.3.0)', () => {
  it('loads exactly the 929 elements the dictionary defines (423 ELM + 506 P1X)', () => {
    const catalog = canonicalDictionary.loadCanonicalDictionary();
    expect(catalog).toHaveLength(929);
    expect(catalog.filter((el) => el.elementId.startsWith('ELM-'))).toHaveLength(423);
    expect(catalog.filter((el) => el.elementId.startsWith('P1X-'))).toHaveLength(506);
  });

  it('gives every element the minimum fields the issue requires: entity, field, cardinality, phase', () => {
    const catalog = canonicalDictionary.loadCanonicalDictionary();
    for (const element of catalog) {
      expect(element.elementId).toMatch(/^(ELM|P1X)-\d{4}$/);
      expect(element.entity).toBeTruthy();
      expect(element.field).toBeTruthy();
      expect(element.cardinality).toBeTruthy();
      expect(element.phase).toBe('Fase 1');
    }
  });

  it('has no duplicate element IDs', () => {
    const catalog = canonicalDictionary.loadCanonicalDictionary();
    const ids = catalog.map((el) => el.elementId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('parses comma-separated sources into an array', () => {
    const element = canonicalDictionary.getElementById('ELM-0001');
    expect(element.sources).toEqual(['SRC_ISO20387', 'SRC_ISBER5', 'SRC_PROVO', 'SRC_FHIR_R4']);
  });

  it('returns null for getElementById on an unknown id', () => {
    expect(canonicalDictionary.getElementById('ELM-9999')).toBeNull();
  });

  it('computes a stable sha256 checksum over the catalog content', () => {
    const first = canonicalDictionary.dictionaryChecksum();
    const second = canonicalDictionary.dictionaryChecksum();
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toBe(second);
  });

  it('reports a verified completeness check against the known 929-element total', () => {
    const completeness = canonicalDictionary.checkCompleteness();
    expect(completeness).toMatchObject({
      dictionaryVersion: '1.3.0',
      expectedTotal: 929,
      loadedTotal: 929,
      uniqueTotal: 929,
      duplicateIds: [],
      missingRequiredFieldIds: [],
      verified: true,
    });
  });
});
