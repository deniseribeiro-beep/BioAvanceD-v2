const fs = require('fs');
const path = require('path');
const readline = require('readline');

/**
 * Lab converter: fabkury/WHO ATC-DDD CSV → RF028 JSONL
 *   { id, lbl, is_a[], synonyms[], obsolete }
 *
 * Codes are bare ATC (C09AA02) matching intake pharmacologyData.atcCode.
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

function parentCode(code) {
  const c = String(code || '').trim().toUpperCase();
  if (c.length <= 1) return null;
  if (c.length === 7) return c.slice(0, 5);
  if (c.length === 5) return c.slice(0, 4);
  if (c.length === 4) return c.slice(0, 3);
  if (c.length === 3) return c.slice(0, 1);
  return null;
}

function convertAtcCsvLines(lines) {
  const byCode = new Map();
  let headerSkipped = false;
  for (const line of lines) {
    if (!line || !String(line).trim()) continue;
    if (!headerSkipped) {
      headerSkipped = true;
      if (/atc_code/i.test(line)) continue;
    }
    const cols = parseCsvLine(line);
    const code = String(cols[0] || '').trim().toUpperCase();
    const name = String(cols[1] || '').trim();
    if (!code || !name || name === 'NA') continue;
    if (!byCode.has(code)) {
      byCode.set(code, { id: code, lbl: name, is_a: [], synonyms: [], obsolete: false });
    }
  }

  const known = new Set(byCode.keys());
  for (const record of byCode.values()) {
    const parent = parentCode(record.id);
    if (parent && known.has(parent)) record.is_a = [parent];
  }
  return Array.from(byCode.values());
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

async function convertAtcCsvFile({ inputPath, outputPath }) {
  const lines = await readLines(inputPath);
  const records = convertAtcCsvLines(lines);
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
    process.stderr.write('Usage: convertAtcCsvToJsonl.js --in <atc.csv> --out <data.jsonl>\n');
    process.exit(2);
  }
  const result = await convertAtcCsvFile({ inputPath, outputPath });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`${err.message || err}\n`);
    process.exit(1);
  });
}

module.exports = {
  parentCode,
  parseCsvLine,
  convertAtcCsvLines,
  convertAtcCsvFile,
};
