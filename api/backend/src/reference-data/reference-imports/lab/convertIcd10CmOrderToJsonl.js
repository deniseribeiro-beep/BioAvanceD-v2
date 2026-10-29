const fs = require('fs');
const path = require('path');
const readline = require('readline');

/**
 * Lab converter: CMS ICD-10-CM order file → RF028 JSONL
 *   { id, lbl, is_a[], synonyms[], obsolete }
 *
 * Codes are emitted in dotted WHO/wizard form (E75.21) so intake
 * diagnosisCidCode matches TerminologyConcept.code under
 * http://hl7.org/fhir/sid/icd-10 (lab proxy; CM subdivisions differ from WHO).
 */

const CHAPTERS = [
  { id: 'A00-B99', lbl: 'Certain infectious and parasitic diseases', start: 'A00', end: 'B99' },
  { id: 'C00-D49', lbl: 'Neoplasms', start: 'C00', end: 'D49' },
  { id: 'D50-D89', lbl: 'Diseases of the blood and blood-forming organs and certain disorders involving the immune mechanism', start: 'D50', end: 'D89' },
  { id: 'E00-E89', lbl: 'Endocrine, nutritional and metabolic diseases', start: 'E00', end: 'E89' },
  { id: 'F01-F99', lbl: 'Mental, Behavioral and Neurodevelopmental disorders', start: 'F01', end: 'F99' },
  { id: 'G00-G99', lbl: 'Diseases of the nervous system', start: 'G00', end: 'G99' },
  { id: 'H00-H59', lbl: 'Diseases of the eye and adnexa', start: 'H00', end: 'H59' },
  { id: 'H60-H95', lbl: 'Diseases of the ear and mastoid process', start: 'H60', end: 'H95' },
  { id: 'I00-I99', lbl: 'Diseases of the circulatory system', start: 'I00', end: 'I99' },
  { id: 'J00-J99', lbl: 'Diseases of the respiratory system', start: 'J00', end: 'J99' },
  { id: 'K00-K95', lbl: 'Diseases of the digestive system', start: 'K00', end: 'K95' },
  { id: 'L00-L99', lbl: 'Diseases of the skin and subcutaneous tissue', start: 'L00', end: 'L99' },
  { id: 'M00-M99', lbl: 'Diseases of the musculoskeletal system and connective tissue', start: 'M00', end: 'M99' },
  { id: 'N00-N99', lbl: 'Diseases of the genitourinary system', start: 'N00', end: 'N99' },
  { id: 'O00-O9A', lbl: 'Pregnancy, childbirth and the puerperium', start: 'O00', end: 'O9A' },
  { id: 'P00-P96', lbl: 'Certain conditions originating in the perinatal period', start: 'P00', end: 'P96' },
  { id: 'Q00-Q99', lbl: 'Congenital malformations, deformations and chromosomal abnormalities', start: 'Q00', end: 'Q99' },
  { id: 'R00-R99', lbl: 'Symptoms, signs and abnormal clinical and laboratory findings, not elsewhere classified', start: 'R00', end: 'R99' },
  { id: 'S00-T88', lbl: 'Injury, poisoning and certain other consequences of external causes', start: 'S00', end: 'T88' },
  { id: 'V00-Y99', lbl: 'External causes of morbidity', start: 'V00', end: 'Y99' },
  { id: 'Z00-Z99', lbl: 'Factors influencing health status and contact with health services', start: 'Z00', end: 'Z99' },
  { id: 'U00-U85', lbl: 'Codes for special purposes', start: 'U00', end: 'U85' },
];

function toDottedCode(raw) {
  const code = String(raw || '').trim().toUpperCase();
  if (!code) return '';
  if (code.includes('.')) return code;
  if (code.length <= 3) return code;
  return `${code.slice(0, 3)}.${code.slice(3)}`;
}

function undotted(code) {
  return String(code || '').replace(/\./g, '').toUpperCase();
}

function chapterFor(code) {
  const key = undotted(code).slice(0, 3);
  for (const chapter of CHAPTERS) {
    if (key >= chapter.start.slice(0, 3) && key <= chapter.end.slice(0, 3)) return chapter.id;
  }
  return null;
}

function parentOf(dotted, known) {
  const raw = undotted(dotted);
  for (let len = raw.length - 1; len >= 3; len -= 1) {
    const candidate = toDottedCode(raw.slice(0, len));
    if (known.has(candidate)) return candidate;
  }
  return chapterFor(dotted);
}

function parseOrderLine(line) {
  const m = String(line || '').match(/^(\d{5})\s+(\S+)\s+([01])\s+(.*)$/);
  if (!m) return null;
  const rest = m[4];
  const shortDesc = rest.slice(0, 60).trim();
  const longDesc = rest.slice(60).trim();
  return {
    order: m[1],
    rawCode: m[2].toUpperCase(),
    billable: m[3] === '1',
    lbl: longDesc || shortDesc,
    shortDesc,
  };
}

function convertOrderLines(lines) {
  const root = { id: 'R69', lbl: 'Illness, unspecified', is_a: [], synonyms: [], obsolete: false };
  const chapters = CHAPTERS.map((c) => ({
    id: c.id,
    lbl: c.lbl,
    is_a: [root.id],
    synonyms: [],
    obsolete: false,
  }));

  const parsed = [];
  for (const line of lines) {
    const row = parseOrderLine(line);
    if (!row || !row.rawCode || !row.lbl) continue;
    parsed.push({
      id: toDottedCode(row.rawCode),
      lbl: row.lbl,
      synonyms: row.shortDesc && row.shortDesc !== row.lbl ? [row.shortDesc] : [],
      obsolete: false,
      _raw: row.rawCode,
    });
  }

  const known = new Set([root.id, ...chapters.map((c) => c.id), ...parsed.map((r) => r.id)]);
  const records = [root, ...chapters];
  for (const row of parsed) {
    const parent = parentOf(row.id, known);
    records.push({
      id: row.id,
      lbl: row.lbl,
      is_a: parent ? [parent] : [root.id],
      synonyms: row.synonyms,
      obsolete: false,
    });
  }
  return records;
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

async function convertIcd10CmOrderFile({ inputPath, outputPath }) {
  const lines = await readLines(inputPath);
  const records = convertOrderLines(lines);
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
    process.stderr.write('Usage: convertIcd10CmOrderToJsonl.js --in <order.txt> --out <data.jsonl>\n');
    process.exit(2);
  }
  const result = await convertIcd10CmOrderFile({ inputPath, outputPath });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`${err.message || err}\n`);
    process.exit(1);
  });
}

module.exports = {
  toDottedCode,
  parseOrderLine,
  convertOrderLines,
  convertIcd10CmOrderFile,
  CHAPTERS,
};
