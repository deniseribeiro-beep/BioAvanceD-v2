const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  parseCsvLine,
  convertLoincCsvLines,
  convertLoincCsvFile,
} = require('../../../../src/reference-data/reference-imports/lab/convertLoincCsvToJsonl');

describe('convertLoincCsvToJsonl', () => {
  describe('parseCsvLine', () => {
    it('splits on commas outside quotes and unescapes doubled quotes', () => {
      expect(parseCsvLine('a,"b,c","say ""hi""",')).toEqual(['a', 'b,c', 'say "hi"', '']);
    });

    it('returns one empty field for an empty line', () => {
      expect(parseCsvLine('')).toEqual(['']);
    });
  });

  describe('convertLoincCsvLines', () => {
    it('returns no records for no lines', () => {
      expect(convertLoincCsvLines([])).toEqual([]);
    });

    it('refuses a header without LOINC_NUM', () => {
      expect(() => convertLoincCsvLines(['COMPONENT,CLASS'])).toThrow('Loinc.csv sem colunas LOINC_NUM/COMPONENT');
    });

    it('refuses a header without COMPONENT', () => {
      expect(() => convertLoincCsvLines(['LOINC_NUM,CLASS'])).toThrow('Loinc.csv sem colunas LOINC_NUM/COMPONENT');
    });

    it('builds class parents, labels, synonyms and obsolete flags from a full header', () => {
      const records = convertLoincCsvLines([
        '"loinc_num","COMPONENT","CLASS","STATUS","LONG_COMMON_NAME"',
        '"2345-7","Glucose","CHEM","ACTIVE","Glucose [Mass/volume] in Serum or Plasma"',
        '"2093-3","Cholesterol","CHEM","DEPRECATED","Cholesterol"',
        '"1234-5","Old thing","","discouraged",""',
        '"9999-9","","CHEM","ACTIVE","No component"',
        '"","Orphan","CHEM","ACTIVE",""',
        '"5555-5","Short row"',
      ]);
      expect(records).toEqual([
        { id: 'LOINC-CLASS:CHEM', lbl: 'CHEM', is_a: [], synonyms: [], obsolete: false },
        {
          id: '2345-7',
          lbl: 'Glucose [Mass/volume] in Serum or Plasma',
          is_a: ['LOINC-CLASS:CHEM'],
          synonyms: ['Glucose'],
          obsolete: false,
        },
        { id: '2093-3', lbl: 'Cholesterol', is_a: ['LOINC-CLASS:CHEM'], synonyms: [], obsolete: true },
        { id: '1234-5', lbl: 'Old thing', is_a: [], synonyms: [], obsolete: true },
        { id: '5555-5', lbl: 'Short row', is_a: [], synonyms: [], obsolete: false },
      ]);
    });

    it('treats every row as active and unclassed when CLASS, STATUS and LONG_COMMON_NAME are absent', () => {
      const records = convertLoincCsvLines([
        'LOINC_NUM,COMPONENT',
        '718-7,Hemoglobin',
      ]);
      expect(records).toEqual([
        { id: '718-7', lbl: 'Hemoglobin', is_a: [], synonyms: [], obsolete: false },
      ]);
    });
  });

  describe('convertLoincCsvFile', () => {
    let tmpRoot;

    beforeEach(() => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'loinc-convert-'));
    });

    afterEach(() => {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('reads a CRLF csv and writes one JSON line per record, creating the output directory', async () => {
      const inputPath = path.join(tmpRoot, 'Loinc.csv');
      const outputPath = path.join(tmpRoot, 'out', 'nested', 'data.jsonl');
      fs.writeFileSync(inputPath, 'LOINC_NUM,COMPONENT,CLASS\r\n718-7,Hemoglobin,HEM/BC\r\n');

      const result = await convertLoincCsvFile({ inputPath, outputPath });

      expect(result).toEqual({ recordCount: 2, outputPath });
      const rows = fs.readFileSync(outputPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
      expect(rows).toEqual([
        { id: 'LOINC-CLASS:HEM/BC', lbl: 'HEM/BC', is_a: [], synonyms: [], obsolete: false },
        { id: '718-7', lbl: 'Hemoglobin', is_a: ['LOINC-CLASS:HEM/BC'], synonyms: [], obsolete: false },
      ]);
    });

    it('rejects a header that lacks the required columns and writes no output', async () => {
      const inputPath = path.join(tmpRoot, 'Loinc.csv');
      const outputPath = path.join(tmpRoot, 'data.jsonl');
      fs.writeFileSync(inputPath, 'CODE,NAME\n1,x\n');

      await expect(convertLoincCsvFile({ inputPath, outputPath })).rejects.toThrow('Loinc.csv sem colunas LOINC_NUM/COMPONENT');
      expect(fs.existsSync(outputPath)).toBe(false);
    });
  });
});
