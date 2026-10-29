const fs = require('fs');
const path = require('path');
const readline = require('readline');

/**
 * Lab converter: LOINC Loinc.csv → RF028 JSONL
 *   { id, lbl, is_a[], synonyms[], obsolete }
 *
 * Codes are bare LOINC_NUM matching intake observationRecords[].loincCode.
 * CLASS becomes a synthetic parent so the hierarchy stays closed.
 */

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function convertLoincCsvLines(lines) {
  if (!lines.length) return [];
  const header = parseCsvLine(lines[0]).map((h) => h.replace(/^"|"$/g, '').trim());
  const idx = (name) => header.findIndex((h) => h.toUpperCase() === name.toUpperCase());
  const iNum = idx('LOINC_NUM');
  const iComp = idx('COMPONENT');
  const iClass = idx('CLASS');
  const iStatus = idx('STATUS');
  const iLong = idx('LONG_COMMON_NAME');
  if (iNum < 0 || iComp < 0) {
    throw new Error('Loinc.csv sem colunas LOINC_NUM/COMPONENT');
  }

  const classes = new Map();
  const records = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    if (!cols.length) continue;
    const code = String(cols[iNum] || '').trim();
    const component = String(cols[iComp] || '').trim();
    const longName = iLong >= 0 ? String(cols[iLong] || '').trim() : '';
    const klass = iClass >= 0 ? String(cols[iClass] || '').trim() : '';
    const status = iStatus >= 0 ? String(cols[iStatus] || '').trim().toUpperCase() : 'ACTIVE';
    if (!code || !component) continue;
    if (klass && !classes.has(klass)) {
      classes.set(klass, {
        id: `LOINC-CLASS:${klass}`,
        lbl: klass,
        is_a: [],
        synonyms: [],
        obsolete: false,
      });
    }
    records.push({
      id: code,
      lbl: longName || component,
      is_a: klass ? [`LOINC-CLASS:${klass}`] : [],
      synonyms: longName && longName !== component ? [component] : [],
      obsolete: status === 'DEPRECATED' || status === 'DISCOURAGED',
    });
  }
  return [...classes.values(), ...records];
}

function writeJsonl(filePath, records) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const fd = fs.openSync(filePath, 'w');
  try {
    for (const record of records) {
      fs.writeSync(fd, `${JSON.stringify(record)}\n`);
    }
  } finally {
    fs.closeSync(fd);
  }
}

async function readLines(filePath) {
  const lines = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) lines.push(line);
  return lines;
}

async function convertLoincCsvFile({ inputPath, outputPath }) {
  const lines = await readLines(inputPath);
  const records = convertLoincCsvLines(lines);
  writeJsonl(outputPath, records);
  return { recordCount: records.length, outputPath };
}

async function main(argv = process.argv.slice(2)) {
  let inputPath = null;
  let outputPath = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--in') inputPath = argv[++i];
    else if (argv[i] === '--out') outputPath = argv[++i];
  }
  if (!inputPath || !outputPath) {
    process.stderr.write('Usage: convertLoincCsvToJsonl.js --in <Loinc.csv> --out <data.jsonl>\n');
    process.exit(2);
  }
  const result = await convertLoincCsvFile({ inputPath, outputPath });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`${err.message || err}\n`);
    process.exit(1);
  });
}

module.exports = {
  parseCsvLine,
  convertLoincCsvLines,
  convertLoincCsvFile,
};
