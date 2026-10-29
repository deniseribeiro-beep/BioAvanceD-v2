const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

/**
 * Lab converter: ANVISA DCB xlsx → RF028 JSONL
 *   { id, lbl, is_a[], synonyms[], obsolete }
 *
 * Codes are bare numeric DCB numbers (as string) matching free-text
 * allergyDraft.allergenCode when the operator types the official number.
 */

function cellText(value) {
  if (value == null) return '';
  if (typeof value === 'object' && value.text != null) return String(value.text).trim();
  if (typeof value === 'object' && Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text || '').join('').trim();
  }
  return String(value).trim();
}

function pickColumn(headerRow, patterns) {
  for (let i = 1; i <= headerRow.cellCount; i += 1) {
    const label = cellText(headerRow.getCell(i).value).toLowerCase();
    if (patterns.some((re) => re.test(label))) return i;
  }
  return -1;
}

async function convertDcbXlsxFile({ inputPath, outputPath }) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(inputPath);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('DCB xlsx sem planilha');

  // Title row(s) may precede the real header (ANVISA consolidada puts
  // "LISTA DCB - CONSOLIDADA" on row 1 and column names on row 2).
  let headerRowNumber = 1;
  let iNum = -1;
  let iName = -1;
  let iClass = -1;
  const maxHeaderScan = Math.min(10, sheet.actualRowCount || 10);
  for (let r = 1; r <= maxHeaderScan; r += 1) {
    const header = sheet.getRow(r);
    const num = pickColumn(header, [/n[ºo°0-9.\s]*dcb/i, /numero.*dcb/i, /^dcb$/i]);
    const name = pickColumn(header, [/denomina/i, /nome/i, /substance/i, /princ[ií]pio/i]);
    if (num > 0 && name > 0) {
      headerRowNumber = r;
      iNum = num;
      iName = name;
      iClass = pickColumn(header, [/classifica/i, /categoria/i, /grupo/i]);
      break;
    }
  }
  if (iNum < 0 || iName < 0) {
    throw new Error('DCB xlsx: colunas Nº DCB / denominação não encontradas');
  }

  const classes = new Map();
  const records = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowNumber) return;
    const code = cellText(row.getCell(iNum).value);
    const name = cellText(row.getCell(iName).value);
    const klass = iClass > 0 ? cellText(row.getCell(iClass).value) : '';
    if (!code || !name) return;
    if (klass && !classes.has(klass)) {
      classes.set(klass, {
        id: `DCB-CLASS:${klass}`,
        lbl: klass,
        is_a: [],
        synonyms: [],
        obsolete: false,
      });
    }
    records.push({
      id: code,
      lbl: name,
      is_a: klass ? [`DCB-CLASS:${klass}`] : [],
      synonyms: [],
      obsolete: false,
    });
  });

  const all = [...classes.values(), ...records];
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const fd = fs.openSync(outputPath, 'w');
  try {
    for (const record of all) fs.writeSync(fd, `${JSON.stringify(record)}\n`);
  } finally {
    fs.closeSync(fd);
  }
  return { recordCount: all.length, outputPath };
}

async function main(argv = process.argv.slice(2)) {
  let inputPath = null;
  let outputPath = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--in') inputPath = argv[++i];
    else if (argv[i] === '--out') outputPath = argv[++i];
  }
  if (!inputPath || !outputPath) {
    process.stderr.write('Usage: convertDcbXlsxToJsonl.js --in <dcb.xlsx> --out <data.jsonl>\n');
    process.exit(2);
  }
  const result = await convertDcbXlsxFile({ inputPath, outputPath });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`${err.message || err}\n`);
    process.exit(1);
  });
}

module.exports = { convertDcbXlsxFile, cellText, pickColumn };
