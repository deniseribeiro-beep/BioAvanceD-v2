const {
  toCurie,
  convertHpoJsonToJsonlRecords,
} = require('../../../../src/reference-data/reference-imports/lab/convertHpoToJsonl');

describe('convertHpoToJsonl', () => {
  it('maps OBO IRIs to HP CURIEs', () => {
    expect(toCurie('http://purl.obolibrary.org/obo/HP_0001250')).toBe('HP:0001250');
    expect(toCurie('HP:0001250')).toBe('HP:0001250');
  });

  it('emits CLASS nodes with is_a from edges and skips PROPERTY', () => {
    const records = convertHpoJsonToJsonlRecords({
      graphs: [{
        nodes: [
          { id: 'http://purl.obolibrary.org/obo/HP_0000001', lbl: 'All', type: 'CLASS' },
          { id: 'http://purl.obolibrary.org/obo/HP_0001250', lbl: 'Seizure', type: 'CLASS', meta: { synonyms: [{ val: 'Seizures' }], deprecated: false } },
          { id: 'http://purl.obolibrary.org/obo/hp#foo', lbl: 'prop', type: 'PROPERTY' },
        ],
        edges: [
          { sub: 'http://purl.obolibrary.org/obo/HP_0001250', pred: 'is_a', obj: 'http://purl.obolibrary.org/obo/HP_0000001' },
        ],
      }],
    });
    expect(records).toHaveLength(2);
    expect(records.find((r) => r.id === 'HP:0001250')).toMatchObject({
      lbl: 'Seizure',
      is_a: ['HP:0000001'],
      synonyms: ['Seizures'],
      obsolete: false,
    });
  });
});
