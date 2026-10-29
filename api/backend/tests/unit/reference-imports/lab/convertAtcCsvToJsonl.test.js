const {
  parentCode,
  convertAtcCsvLines,
} = require('../../../../src/reference-data/reference-imports/lab/convertAtcCsvToJsonl');
const { normalizeRecord } = require('../../../../src/reference-data/reference-imports/normalizeAtc');

describe('convertAtcCsvToJsonl', () => {
  it('derives ATC parents by code length', () => {
    expect(parentCode('A01AA02')).toBe('A01AA');
    expect(parentCode('A01AA')).toBe('A01A');
    expect(parentCode('A01A')).toBe('A01');
    expect(parentCode('A01')).toBe('A');
    expect(parentCode('A')).toBeNull();
  });

  it('dedupes CSV rows and feeds normalizeAtc', () => {
    const lines = [
      'atc_code,atc_name,ddd,uom,adm_r,note',
      'A,ALIMENTARY TRACT AND METABOLISM,NA,NA,NA,NA',
      'A01,STOMATOLOGICAL PREPARATIONS,NA,NA,NA,NA',
      'A01A,STOMATOLOGICAL PREPARATIONS,NA,NA,NA,NA',
      'A01AA,Caries prophylactic agents,NA,NA,NA,NA',
      'A01AA02,sodium fluoride,1.1,mg,O,NA',
      'A01AA02,sodium fluoride,0.5,mg,O,different ddd row',
    ];
    const records = convertAtcCsvLines(lines);
    expect(records).toHaveLength(5);
    expect(records.find((r) => r.id === 'A01AA02')).toMatchObject({
      lbl: 'sodium fluoride',
      is_a: ['A01AA'],
    });
    for (const record of records) {
      const normalized = normalizeRecord(record, 1);
      expect(normalized.ok, JSON.stringify(normalized.issue || {})).toBe(true);
    }
  });
});
