const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');

const {
  convertDcbXlsxFile,
  cellText,
  pickColumn,
} = require('../../../../src/reference-data/reference-imports/lab/convertDcbXlsxToJsonl');

function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
}

async function writeWorkbook(filePath, sheets) {
  const workbook = new ExcelJS.Workbook();
  for (const { name, rows } of sheets) {
    const sheet = workbook.addWorksheet(name);
    for (const row of rows) sheet.addRow(row);
  }
  await workbook.xlsx.writeFile(filePath);
}

describe('convertDcbXlsxToJsonl', () => {
  describe('cellText', () => {
    it('returns empty text for an empty cell', () => {
      expect(cellText(null)).toBe('');
      expect(cellText(undefined)).toBe('');
    });

    it('reads the text of a hyperlink cell', () => {
      expect(cellText({ text: ' Paracetamol ', hyperlink: 'https://example.org' })).toBe('Paracetamol');
    });

    it('joins rich-text runs, reading a run without text as empty', () => {
      expect(cellText({ richText: [{ text: 'Ácido ' }, { font: { bold: true } }, { text: 'acetilsalicílico ' }] }))
        .toBe('Ácido acetilsalicílico');
    });

    it('stringifies and trims plain values', () => {
      expect(cellText(1234)).toBe('1234');
      expect(cellText('  dipirona ')).toBe('dipirona');
      expect(cellText(true)).toBe('true');
    });
  });

  describe('pickColumn', () => {
    function headerRow(labels) {
      return {
        cellCount: labels.length,
        getCell: (i) => ({ value: labels[i - 1] }),
      };
    }

    it('returns the 1-based index of the first label a pattern matches', () => {
      expect(pickColumn(headerRow(['Item', 'DCB']), [/^dcb$/i])).toBe(2);
      expect(pickColumn(headerRow(['Numero da DCB', 'Nome']), [/numero.*dcb/i])).toBe(1);
    });

    it('returns -1 when no label matches', () => {
      expect(pickColumn(headerRow(['Item', 'Valor']), [/denomina/i])).toBe(-1);
      expect(pickColumn(headerRow([]), [/denomina/i])).toBe(-1);
    });
  });

  describe('convertDcbXlsxFile', () => {
    let tmpRoot;

    beforeEach(() => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dcb-convert-'));
    });

    afterEach(() => {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('finds the header below a title row and writes class parents then substances', async () => {
      const inputPath = path.join(tmpRoot, 'dcb.xlsx');
      const outputPath = path.join(tmpRoot, 'out', 'data.jsonl');
      await writeWorkbook(inputPath, [{
        name: 'DCB',
        rows: [
          ['LISTA DCB - CONSOLIDADA'],
          ['Nº DCB', 'Denominação Comum Brasileira', 'Classificação'],
          [1234, 'paracetamol', 'Analgésico'],
          ['5678', 'dipirona', 'Analgésico'],
          ['9012', 'amoxicilina', ''],
          ['', 'sem número', 'Analgésico'],
          ['3456', '', 'Analgésico'],
        ],
      }]);

      const result = await convertDcbXlsxFile({ inputPath, outputPath });

      expect(result).toEqual({ recordCount: 4, outputPath });
      expect(readJsonl(outputPath)).toEqual([
        { id: 'DCB-CLASS:Analgésico', lbl: 'Analgésico', is_a: [], synonyms: [], obsolete: false },
        { id: '1234', lbl: 'paracetamol', is_a: ['DCB-CLASS:Analgésico'], synonyms: [], obsolete: false },
        { id: '5678', lbl: 'dipirona', is_a: ['DCB-CLASS:Analgésico'], synonyms: [], obsolete: false },
        { id: '9012', lbl: 'amoxicilina', is_a: [], synonyms: [], obsolete: false },
      ]);
    });

    it('accepts a header on row 1 without a class column', async () => {
      const inputPath = path.join(tmpRoot, 'dcb.xlsx');
      const outputPath = path.join(tmpRoot, 'data.jsonl');
      await writeWorkbook(inputPath, [{
        name: 'DCB',
        rows: [
          ['DCB', 'Nome'],
          ['0001', 'abacavir'],
        ],
      }]);

      const result = await convertDcbXlsxFile({ inputPath, outputPath });

      expect(result.recordCount).toBe(1);
      expect(readJsonl(outputPath)).toEqual([
        { id: '0001', lbl: 'abacavir', is_a: [], synonyms: [], obsolete: false },
      ]);
    });

    it('refuses a sheet whose header has the DCB number but no name column', async () => {
      const inputPath = path.join(tmpRoot, 'dcb.xlsx');
      const outputPath = path.join(tmpRoot, 'data.jsonl');
      await writeWorkbook(inputPath, [{ name: 'DCB', rows: [['Nº DCB', 'Classificação'], ['1', 'x']] }]);

      await expect(convertDcbXlsxFile({ inputPath, outputPath }))
        .rejects.toThrow('DCB xlsx: colunas Nº DCB / denominação não encontradas');
      expect(fs.existsSync(outputPath)).toBe(false);
    });

    it('refuses an empty sheet', async () => {
      const inputPath = path.join(tmpRoot, 'dcb.xlsx');
      const outputPath = path.join(tmpRoot, 'data.jsonl');
      await writeWorkbook(inputPath, [{ name: 'Vazia', rows: [] }]);

      await expect(convertDcbXlsxFile({ inputPath, outputPath }))
        .rejects.toThrow('DCB xlsx: colunas Nº DCB / denominação não encontradas');
    });

    it('refuses a workbook with no worksheet', async () => {
      const inputPath = path.join(tmpRoot, 'dcb.xlsx');
      const outputPath = path.join(tmpRoot, 'data.jsonl');
      await writeWorkbook(inputPath, []);

      await expect(convertDcbXlsxFile({ inputPath, outputPath })).rejects.toThrow('DCB xlsx sem planilha');
    });
  });
});
