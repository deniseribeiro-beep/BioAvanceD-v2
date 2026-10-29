const {
  toDottedCode,
  parseOrderLine,
  convertOrderLines,
} = require('../../../../src/reference-data/reference-imports/lab/convertIcd10CmOrderToJsonl');
const { normalizeRecord } = require('../../../../src/reference-data/reference-imports/normalizeIcd10');

describe('convertIcd10CmOrderToJsonl', () => {
  it('dots codes after the third character (wizard CID form)', () => {
    expect(toDottedCode('A00')).toBe('A00');
    expect(toDottedCode('A000')).toBe('A00.0');
    expect(toDottedCode('E7521')).toBe('E75.21');
  });

  it('parses CMS order lines and emits a closed hierarchy normalizeIcd10 accepts', () => {
    const lines = [
      '00001 A00     0 Cholera                                                      Cholera',
      '00002 A000    1 Cholera due to Vibrio cholerae 01, biovar cholerae           Cholera due to Vibrio cholerae 01, biovar cholerae',
      '00005 A01     0 Typhoid and paratyphoid fevers                               Typhoid and paratyphoid fevers',
    ];
    const records = convertOrderLines(lines);
    expect(records.find((r) => r.id === 'A00.0')).toMatchObject({
      lbl: 'Cholera due to Vibrio cholerae 01, biovar cholerae',
      is_a: ['A00'],
    });
    expect(records.find((r) => r.id === 'A00').is_a).toEqual(['A00-B99']);

    for (const record of records) {
      const normalized = normalizeRecord(record, 1);
      expect(normalized.ok, JSON.stringify(normalized.issue || {})).toBe(true);
    }
  });

  it('rejects blank order noise', () => {
    expect(parseOrderLine('not-a-row')).toBeNull();
  });
});
