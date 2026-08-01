const fs = require('fs');
const path = require('path');

/**
 * RF022 follow-up (#381): parses dict-02_DICIONARIO.md v1.3.0's 929-row
 * table (423 ELM-* baseline + 506 P1X-* extension elements) into the
 * structured JSON catalog `canonical-dictionary/catalog.1.3.0.json` that
 * `src/reference-data/canonical-dictionary` loads at runtime. Re-run this
 * script whenever dict-02_DICIONARIO.md is regenerated from a new
 * dict-02_DICIONARIO.xlsx export.
 *
 * Table cells escape literal pipes as `\|` (e.g. an enum-valued
 * Sistema/Vocabulário column); a naive split on every `|` misparses those
 * rows, so the row splitter must treat `\|` as a literal and only unescaped
 * `|` as a column separator.
 */
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SOURCE_MD = path.join(REPO_ROOT, 'docs', 'docs-7-27-2026', 'extracted', 'dict-02_DICIONARIO.md');
const OUTPUT_JSON = path.join(__dirname, '..', 'src', 'reference-data', 'canonical-dictionary', 'catalog.1.3.0.json');

const COLUMNS = [
  'elementId',
  'domain',
  'entity',
  'field',
  'labelPt',
  'description',
  'type',
  'cardinality',
  'requirement',
  'systemVocabulary',
  'sources',
  'example',
  'temporal',
  'provenanceRequired',
  'sensitivity',
  'fhirMapping',
  'destination',
  'indexed',
  'phase',
  'notes',
];

function splitRow(line) {
  const inner = line.replace(/^\|/, '').replace(/\|$/, '');
  return inner.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

function toNullable(value) {
  return value === '' ? null : value;
}

function parseRow(line) {
  const cells = splitRow(line);
  if (cells.length !== COLUMNS.length) {
    throw new Error(`Expected ${COLUMNS.length} columns, got ${cells.length}: ${line.slice(0, 120)}`);
  }
  const record = Object.fromEntries(COLUMNS.map((column, index) => [column, cells[index]]));
  return {
    ...record,
    systemVocabulary: toNullable(record.systemVocabulary),
    sources: record.sources ? record.sources.split(',').map((source) => source.trim()).filter(Boolean) : [],
    example: toNullable(record.example),
    fhirMapping: toNullable(record.fhirMapping),
    notes: toNullable(record.notes),
  };
}

function parseDictionary(markdown) {
  const lines = markdown.split(/\r?\n/);
  const rowLines = lines.filter((line) => /^\| (ELM|P1X)-/.test(line));
  return rowLines.map(parseRow);
}

function main() {
  const markdown = fs.readFileSync(SOURCE_MD, 'utf8');
  const catalog = parseDictionary(markdown);
  fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${catalog.length} elements to ${path.relative(REPO_ROOT, OUTPUT_JSON)}`);
}

if (require.main === module) {
  main();
}

module.exports = { parseDictionary, parseRow, splitRow, COLUMNS };
