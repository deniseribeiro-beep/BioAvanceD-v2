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

/**
 * RF022 AC1 (Requisitos v4.0.0): the approved Canonical Data Model v2.0.0
 * dictionary, `docs/extracted-v2.0.0/dict-DICIONARIO.md`, has 1644 rows: the
 * 929 historical ELM-/P1X- elements plus 715 V2E- elements, in a 25-column
 * table whose columns differ from v1.3.0's. It is written to its own
 * `catalog.2.0.0.json` beside the v1.3.0 one, which its consumers still load
 * until they migrate. Column names keep v1.3.0's where the meaning is the
 * same (description, type, example); the rest follow the v2.0.0 header.
 * Cells are kept as written, with an empty cell as null: the origin column
 * mixes `,` and `;` separators, so it is not split.
 */
const SOURCE_MD_V2 = path.join(REPO_ROOT, 'docs', 'extracted-v2.0.0', 'dict-DICIONARIO.md');
const OUTPUT_JSON_V2 = path.join(__dirname, '..', 'src', 'reference-data', 'canonical-dictionary', 'catalog.2.0.0.json');

const COLUMNS_V2 = [
  'elementId',
  'domain',
  'entity',
  'field',
  'labelPt',
  'description',
  'type',
  'cardinality',
  'requirement',
  'applicabilityCondition',
  'vocabulary',
  'example',
  'sensitivity',
  'criticality',
  'normativeOrigin',
  'fhirMiabisMapping',
  'authoritativePersistence',
  'permittedProjection',
  'uniquenessRule',
  'preparationPhase',
  'populationPhase',
  'changeStatus',
  'previousElementId',
  'justification',
  'migrationNotes',
];

function parseRowV2(line) {
  const cells = splitRow(line);
  if (cells.length !== COLUMNS_V2.length) {
    throw new Error(`Expected ${COLUMNS_V2.length} columns, got ${cells.length}: ${line.slice(0, 120)}`);
  }
  return Object.fromEntries(COLUMNS_V2.map((column, index) => [column, toNullable(cells[index])]));
}

function parseDictionaryV2(markdown) {
  const lines = markdown.split(/\r?\n/);
  const rowLines = lines.filter((line) => /^\| (ELM|P1X|V2E)-/.test(line));
  return rowLines.map(parseRowV2);
}

function writeCatalog(catalog, outputJson) {
  fs.writeFileSync(outputJson, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${catalog.length} elements to ${path.relative(REPO_ROOT, outputJson)}`);
}

/**
 * #1304 (GOV-001/GOV-002): the CanonicalModelRelease the Foundation job
 * registers names the approved release's artifacts and their checksums.
 * Their record is docs/RELEASE_MANIFEST.json, which the backend image
 * cannot see (its build context is api/backend), so it is carried beside
 * the catalog the same way: parsed, re-serialised, and checked for
 * staleness by `dictionary:validate`.
 */
const SOURCE_RELEASE_MANIFEST = path.join(REPO_ROOT, 'docs', 'RELEASE_MANIFEST.json');
const OUTPUT_RELEASE_MANIFEST = path.join(__dirname, '..', 'src', 'reference-data', 'canonical-dictionary', 'release-manifest.2.0.0.json');

function readReleaseManifest(text) {
  return JSON.parse(text);
}

function main() {
  writeCatalog(parseDictionary(fs.readFileSync(SOURCE_MD, 'utf8')), OUTPUT_JSON);
  writeCatalog(parseDictionaryV2(fs.readFileSync(SOURCE_MD_V2, 'utf8')), OUTPUT_JSON_V2);
  const manifest = readReleaseManifest(fs.readFileSync(SOURCE_RELEASE_MANIFEST, 'utf8'));
  fs.writeFileSync(OUTPUT_RELEASE_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${manifest.artifacts.length} release artifacts to ${path.relative(REPO_ROOT, OUTPUT_RELEASE_MANIFEST)}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  parseDictionary,
  parseRow,
  splitRow,
  COLUMNS,
  SOURCE_MD,
  OUTPUT_JSON,
  parseDictionaryV2,
  parseRowV2,
  COLUMNS_V2,
  SOURCE_MD_V2,
  OUTPUT_JSON_V2,
  readReleaseManifest,
  SOURCE_RELEASE_MANIFEST,
  OUTPUT_RELEASE_MANIFEST,
};
