const fs = require('fs');
const path = require('path');
const {
  normalizeConditionLabel,
  extractOrphaFromText,
  buildConditionLookupIndex,
  buildMondoToOrphaMap,
  matchProvisionalLabel,
  mergeConditionCodings,
  crosswalkAssociationRecords,
  ORPHA_URI,
  MONDO_URI,
  MARKERDB_CONDITION_URI,
} = require('../../../../src/reference-data/reference-imports/lab/markerDbConditionCrosswalkLib');

const FIXTURE_ORPHA = path.join(__dirname, '../../../../src/reference-data/reference-imports/fixtures/orpha-sample.jsonl');
const FIXTURE_MONDO = path.join(__dirname, '../../../../src/reference-data/reference-imports/fixtures/mondo-sample.jsonl');

function loadFixtureRecords(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

describe('markerDbConditionCrosswalkLib', () => {
  const orphaRecords = loadFixtureRecords(FIXTURE_ORPHA);
  const mondoRecords = loadFixtureRecords(FIXTURE_MONDO);
  const orphaIndex = buildConditionLookupIndex(orphaRecords, ORPHA_URI);
  const mondoIndex = buildConditionLookupIndex(mondoRecords, MONDO_URI);
  const mondoToOrpha = buildMondoToOrphaMap(orphaIndex, mondoRecords);
  const indices = { orpha: orphaIndex, mondo: mondoIndex };

  it('normalizes condition labels for exact matching', () => {
    expect(normalizeConditionLabel('Diabetes Mellitus, Type 2')).toBe('diabetes mellitus type 2');
    expect(normalizeConditionLabel('Hepatolenticular  degeneration')).toBe('hepatolenticular degeneration');
  });

  it('extracts embedded ORPHA codes from free text', () => {
    expect(extractOrphaFromText('Fabry disease ORPHA:324')).toBe('ORPHA:324');
    expect(extractOrphaFromText('no code here')).toBeNull();
  });

  it('matches ORPHA by primary label and synonym without dropping provisional', () => {
    const { matches } = matchProvisionalLabel('Wilson disease', indices, mondoToOrpha);
    expect(matches[0]).toMatchObject({ coding: { systemUri: ORPHA_URI, code: 'ORPHA:586' }, method: 'exact_label_orpha' });

    const alias = matchProvisionalLabel('Hepatolenticular degeneration', indices, mondoToOrpha);
    expect(alias.matches[0].method).toBe('alias_orpha');
  });

  it('matches MONDO when ORPHA is absent and never invents codes', () => {
    const { matches } = matchProvisionalLabel('type 2 diabetes mellitus', indices, mondoToOrpha);
    expect(matches).toHaveLength(1);
    expect(matches[0].coding).toMatchObject({ systemUri: MONDO_URI, code: 'MONDO:0005148' });
    expect(matches.some((m) => m.coding.systemUri === ORPHA_URI)).toBe(false);
  });

  it('enriches associations in place and queues unmatched', () => {
    const input = [{
      biomarkerId: 'ba-test-1',
      associatedCondition: [{
        systemUri: MARKERDB_CONDITION_URI,
        code: 'wilson-disease',
        display: 'Wilson disease',
      }],
      evidenceReferences: [{ system: 'PMID', value: '12345678' }],
    }, {
      biomarkerId: 'ba-test-2',
      associatedCondition: [{
        systemUri: MARKERDB_CONDITION_URI,
        code: 'unknown-zzz',
        display: 'Completely Unknown ZZZ Syndrome',
      }],
      evidenceReferences: [{ system: 'PMID', value: '87654321' }],
    }];

    const { enriched, unmatched, summary } = crosswalkAssociationRecords(input, indices, mondoToOrpha);
    expect(summary.mappedRows).toBe(1);
    expect(summary.unmatchedRows).toBe(1);
    expect(enriched[0].associatedCondition).toHaveLength(2);
    expect(enriched[0].associatedCondition[0].systemUri).toBe(MARKERDB_CONDITION_URI);
    expect(enriched[0].associatedCondition.some((c) => c.code === 'ORPHA:586')).toBe(true);
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0].biomarkerId).toBe('ba-test-2');
  });

  it('mergeConditionCodings deduplicates governed codes', () => {
    const merged = mergeConditionCodings(
      [{ systemUri: ORPHA_URI, code: 'ORPHA:586', display: 'Wilson disease' }],
      [{ systemUri: ORPHA_URI, code: 'ORPHA:586', display: 'Wilson disease' }],
    );
    expect(merged).toHaveLength(1);
  });

  it('builds MONDO→ORPHA bridge from explicit xrefs', () => {
    const mondoWithXref = [{
      id: 'MONDO:0009999',
      lbl: 'demo disease',
      synonyms: [],
      obsolete: false,
      xrefs: { orpha: 'ORPHA:558' },
    }];
    const map = buildMondoToOrphaMap(orphaIndex, mondoWithXref);
    expect(map.get('MONDO:0009999')).toMatchObject({ orphaCode: 'ORPHA:558', method: 'mondo_xref' });
  });
});