import { describe, it, expect } from 'vitest';
const fs = require('fs');
const crypto = require('crypto');
const { parseDictionaryV2, SOURCE_MD_V2 } = require('../../../scripts/generate-dictionary-catalog');
const v2 = require('../../../src/reference-data/canonical-dictionary/v2');
const v1 = require('../../../src/reference-data/canonical-dictionary');

/**
 * RF022 AC1 (Requisitos v4.0.0): "a release final v2.0.0 contém 1644
 * elementos, incluindo os 929 históricos". These pin that count against the
 * generated catalog, and the catalog against its source dictionary.
 */
describe('canonical-dictionary catalog v2.0.0 (docs/extracted-v2.0.0/dict-DICIONARIO.md)', () => {
  it('loads the 1644 elements: 423 ELM + 506 P1X historical, 715 V2E', () => {
    const catalog = v2.loadCanonicalDictionary();
    expect(catalog).toHaveLength(1644);
    expect(catalog.filter((el) => el.elementId.startsWith('ELM-'))).toHaveLength(423);
    expect(catalog.filter((el) => el.elementId.startsWith('P1X-'))).toHaveLength(506);
    expect(catalog.filter((el) => el.elementId.startsWith('V2E-'))).toHaveLength(715);
  });

  it('verifies completeness, with every v1.3.0 element id still present', () => {
    const result = v2.checkCompleteness();
    expect(result).toMatchObject({
      dictionaryVersion: '2.0.0',
      loadedTotal: 1644,
      uniqueTotal: 1644,
      historicalTotal: 929,
      expectedEntityTotal: 146,
      entityTotal: 146,
      duplicateIds: [],
      missingRequiredFieldIds: [],
      unknownChangeStatusIds: [],
      missingHistoricalIds: [],
      reassignedHistoricalIds: [],
      verified: true,
    });
    for (const element of v1.loadCanonicalDictionary()) {
      expect(v2.getElementById(element.elementId)).not.toBeNull();
    }
  });

  it('fails completeness when the 1644 elements fall in fewer than 146 entities (RNF031 AC1)', () => {
    const catalog = v2.loadCanonicalDictionary();
    const [first, second] = [...new Set(catalog.map((el) => el.entity))];
    const merged = catalog.map((el) => (el.entity === first ? { ...el, entity: second } : el));
    const result = v2.checkCompleteness(merged);
    expect(result.entityTotal).toBe(145);
    expect(result.missingHistoricalIds).toEqual([]);
    expect(result.verified).toBe(false);
  });

  it('reports a dropped historical id, a duplicate and an unknown changeStatus (control rows)', () => {
    const catalog = v2.loadCanonicalDictionary();
    const dropped = catalog.filter((el) => el.elementId !== 'ELM-0357');
    const tampered = [...dropped, { ...catalog[0], changeStatus: 'rewritten' }];
    const result = v2.checkCompleteness(tampered);
    expect(result.missingHistoricalIds).toEqual(['ELM-0357']);
    expect(result.duplicateIds).toEqual([catalog[0].elementId]);
    expect(result.unknownChangeStatusIds).toEqual([catalog[0].elementId]);
    expect(result.verified).toBe(false);
  });

  it('reports a historical id given a new meaning, and passes a rename (RNF023 C3)', () => {
    const catalog = v2.loadCanonicalDictionary();
    const reused = catalog.map((el) => (el.elementId === 'ELM-0357' ? { ...el, field: 'otherField' } : el));
    const result = v2.checkCompleteness(reused);
    expect(result.reassignedHistoricalIds).toEqual(['ELM-0357']);
    expect(result.verified).toBe(false);

    const renamed = catalog.map((el) => (
      el.elementId === 'ELM-0357' ? { ...el, field: 'otherField', changeStatus: 'renamed' } : el
    ));
    const renamedResult = v2.checkCompleteness(renamed);
    expect(renamedResult.reassignedHistoricalIds).toEqual([]);
    expect(renamedResult.verified).toBe(true);
  });

  it('keeps the v2.0.0 columns: an element reads as the dictionary row it came from', () => {
    expect(v2.getElementById('V2E-0563')).toMatchObject({
      domain: 'Telemetria',
      entity: 'TelemetryDatastream',
      field: 'sensorId',
      cardinality: '1..1',
      requirement: 'Core',
      authoritativePersistence: 'MongoDB',
      uniquenessRule: 'Globally unique',
      preparationPhase: 'Phase 1',
      populationPhase: 'Phase 3',
      changeStatus: 'added',
      previousElementId: null,
    });
  });

  it('matches a fresh parse of its source dictionary (source-vs-artifact drift)', () => {
    const fresh = parseDictionaryV2(fs.readFileSync(SOURCE_MD_V2, 'utf8'));
    const freshChecksum = crypto.createHash('sha256').update(JSON.stringify(fresh)).digest('hex');
    expect(freshChecksum).toBe(v2.dictionaryChecksum());
  });
});
