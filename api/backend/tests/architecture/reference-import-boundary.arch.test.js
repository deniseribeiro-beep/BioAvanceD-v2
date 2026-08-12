// node:test-only by contract (README.md Test Strategy — vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375. History: #138, #148, #182, #375, #393.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const importDir = path.join(repoRoot, 'src', 'reference-data', 'reference-imports');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

test('HPO importer is not imported by startup entrypoints', () => {
  for (const file of [path.join(repoRoot, 'app.js'), path.join(repoRoot, 'server.js'), path.join(repoRoot, 'src', 'workers', 'worker.js')]) {
    assert.strictEqual(read(file).includes('reference-imports'), false);
  }
});

test('HPO importer reads a bundled fixture, not a live network source (#367 first slice)', () => {
  // systemUri/relationSystem are canonical URI *values* the dictionary
  // requires (dict-02_DICIONARIO.md P1X-0418/P1X-0497) — checking for those
  // would false-positive. What must stay absent is an actual network call.
  const networkCallPatterns = [/\bfetch\(/, /require\(['"]https?['"]\)/, /require\(['"]axios['"]\)/, /\baxios\./, /XMLHttpRequest/];
  for (const file of ['pipeline.js', 'sources/hpo.js', 'parseJsonLines.js']) {
    const contents = read(path.join(importDir, file));
    for (const pattern of networkCallPatterns) {
      assert.doesNotMatch(contents, pattern);
    }
  }
});

test('HPO source config only ever points at the bundled fixture file', () => {
  const hpoSource = require(path.join(importDir, 'sources', 'hpo.js'));
  assert.strictEqual(hpoSource.retrievalUri.startsWith('file://'), true);
  assert.strictEqual(fs.existsSync(hpoSource.fixturePath), true);
});

test('large import scaffold still excludes HPO from its allowed-datasets set (RF028 keeps it a separate, operational script)', () => {
  const scaffold = read(path.join(repoRoot, 'scripts', 'reference-imports', 'import-large-reference-dataset.js'));
  assert.match(scaffold, /not implemented until data model is finalized/);
  // Looks for the Set entry specifically (quoted lowercase), not any mention
  // of HPO in prose/comments explaining why it was removed.
  assert.doesNotMatch(scaffold, /['"]hpo['"]/);
});

test('MONDO importer reads a bundled fixture, not a live network source (#548 second slice)', () => {
  const networkCallPatterns = [/\bfetch\(/, /require\(['"]https?['"]\)/, /require\(['"]axios['"]\)/, /\baxios\./, /XMLHttpRequest/];
  for (const file of ['sources/mondo.js', 'normalizeMondo.js']) {
    const contents = read(path.join(importDir, file));
    for (const pattern of networkCallPatterns) {
      assert.doesNotMatch(contents, pattern);
    }
  }
});

test('MONDO source config only ever points at the bundled fixture file', () => {
  const mondoSource = require(path.join(importDir, 'sources', 'mondo.js'));
  assert.strictEqual(mondoSource.retrievalUri.startsWith('file://'), true);
  assert.strictEqual(fs.existsSync(mondoSource.fixturePath), true);
});

test('large import scaffold still excludes MONDO from its allowed-datasets set (RF028 keeps it a separate, operational script)', () => {
  const scaffold = read(path.join(repoRoot, 'scripts', 'reference-imports', 'import-large-reference-dataset.js'));
  assert.match(scaffold, /not implemented until data model is finalized/);
  // Looks for the Set entry specifically (quoted lowercase), not any mention
  // of MONDO in prose/comments explaining why it was removed.
  assert.doesNotMatch(scaffold, /['"]mondo['"]/);
});

test('ORPHA importer reads a bundled fixture, not a live network source (#549 third slice)', () => {
  const networkCallPatterns = [/\bfetch\(/, /require\(['"]https?['"]\)/, /require\(['"]axios['"]\)/, /\baxios\./, /XMLHttpRequest/];
  for (const file of ['sources/orpha.js', 'normalizeOrpha.js']) {
    const contents = read(path.join(importDir, file));
    for (const pattern of networkCallPatterns) {
      assert.doesNotMatch(contents, pattern);
    }
  }
});

test('ORPHA source config only ever points at the bundled fixture file', () => {
  const orphaSource = require(path.join(importDir, 'sources', 'orpha.js'));
  assert.strictEqual(orphaSource.retrievalUri.startsWith('file://'), true);
  assert.strictEqual(fs.existsSync(orphaSource.fixturePath), true);
});

test('large import scaffold still excludes ORPHA from its allowed-datasets set (RF028 keeps it a separate, operational script)', () => {
  const scaffold = read(path.join(repoRoot, 'scripts', 'reference-imports', 'import-large-reference-dataset.js'));
  assert.match(scaffold, /not implemented until data model is finalized/);
  // Looks for the Set entry specifically (quoted lowercase), not any mention
  // of ORPHA in prose/comments explaining why it was removed.
  assert.doesNotMatch(scaffold, /['"]orpha['"]/);
});

test('ICD-11 importer reads a bundled fixture, not a live network source (#549 fourth slice)', () => {
  const networkCallPatterns = [/\bfetch\(/, /require\(['"]https?['"]\)/, /require\(['"]axios['"]\)/, /\baxios\./, /XMLHttpRequest/];
  for (const file of ['sources/icd11.js', 'normalizeIcd11.js']) {
    const contents = read(path.join(importDir, file));
    for (const pattern of networkCallPatterns) {
      assert.doesNotMatch(contents, pattern);
    }
  }
});

test('ICD-11 source config only ever points at the bundled fixture file', () => {
  const icd11Source = require(path.join(importDir, 'sources', 'icd11.js'));
  assert.strictEqual(icd11Source.retrievalUri.startsWith('file://'), true);
  assert.strictEqual(fs.existsSync(icd11Source.fixturePath), true);
});

// Unlike HPO/MONDO/ORPHA, 'cid' deliberately stayed in the placeholder
// scaffold's allowed-datasets set through the ICD-11 slice — it was a
// shared token for both CID-11 (graduated that slice) and CID-10 (not yet
// built at the time). See import-large-reference-dataset.js's own comment
// for the rationale.
test('large import scaffold still marks itself unimplemented and does not list icd11 as its own token (RF028 keeps ICD-11 a separate, operational script)', () => {
  const scaffold = read(path.join(repoRoot, 'scripts', 'reference-imports', 'import-large-reference-dataset.js'));
  assert.match(scaffold, /not implemented until data model is finalized/);
  assert.doesNotMatch(scaffold, /['"]icd11['"]/);
});

test('ICD-10 importer reads a bundled fixture, not a live network source (#549 fifth slice)', () => {
  const networkCallPatterns = [/\bfetch\(/, /require\(['"]https?['"]\)/, /require\(['"]axios['"]\)/, /\baxios\./, /XMLHttpRequest/];
  for (const file of ['sources/icd10.js', 'normalizeIcd10.js']) {
    const contents = read(path.join(importDir, file));
    for (const pattern of networkCallPatterns) {
      assert.doesNotMatch(contents, pattern);
    }
  }
});

test('ICD-10 source config only ever points at the bundled fixture file', () => {
  const icd10Source = require(path.join(importDir, 'sources', 'icd10.js'));
  assert.strictEqual(icd10Source.retrievalUri.startsWith('file://'), true);
  assert.strictEqual(fs.existsSync(icd10Source.fixturePath), true);
});

// 'cid' was the shared CID-11/CID-10 placeholder token; now that CID-10
// has its own operational script too, it's dropped from the scaffold
// entirely, mirroring HPO/MONDO/ORPHA/ICD-11's own removals.
test('large import scaffold no longer lists cid or icd10 as its own tokens (RF028 keeps ICD-10 a separate, operational script)', () => {
  const scaffold = read(path.join(repoRoot, 'scripts', 'reference-imports', 'import-large-reference-dataset.js'));
  assert.match(scaffold, /not implemented until data model is finalized/);
  assert.doesNotMatch(scaffold, /['"]cid['"]/);
  assert.doesNotMatch(scaffold, /['"]icd10['"]/);
});

test('OMIM importer reads a bundled fixture, not a live network source (#549 sixth slice)', () => {
  const networkCallPatterns = [/\bfetch\(/, /require\(['"]https?['"]\)/, /require\(['"]axios['"]\)/, /\baxios\./, /XMLHttpRequest/];
  for (const file of ['sources/omim.js', 'normalizeOmim.js']) {
    const contents = read(path.join(importDir, file));
    for (const pattern of networkCallPatterns) {
      assert.doesNotMatch(contents, pattern);
    }
  }
});

test('OMIM source config only ever points at the bundled fixture file', () => {
  const omimSource = require(path.join(importDir, 'sources', 'omim.js'));
  assert.strictEqual(omimSource.retrievalUri.startsWith('file://'), true);
  assert.strictEqual(fs.existsSync(omimSource.fixturePath), true);
});

// omim was the last token remaining in the scaffold's allowed-datasets set
// (closing out the §7.4 step 4 group); now that it too has its own
// operational script, the set is empty entirely, mirroring HPO/MONDO/
// ORPHA/ICD-11/ICD-10's own removals.
test('large import scaffold no longer lists omim as its own token (RF028 keeps OMIM a separate, operational script)', () => {
  const scaffold = read(path.join(repoRoot, 'scripts', 'reference-imports', 'import-large-reference-dataset.js'));
  assert.match(scaffold, /not implemented until data model is finalized/);
  assert.doesNotMatch(scaffold, /['"]omim['"]/);
});

test('HGNC importer reads a bundled fixture, not a live network source (#549 seventh slice)', () => {
  const networkCallPatterns = [/\bfetch\(/, /require\(['"]https?['"]\)/, /require\(['"]axios['"]\)/, /\baxios\./, /XMLHttpRequest/];
  for (const file of ['sources/hgnc.js', 'normalizeHgnc.js']) {
    const contents = read(path.join(importDir, file));
    for (const pattern of networkCallPatterns) {
      assert.doesNotMatch(contents, pattern);
    }
  }
});

test('HGNC source config only ever points at the bundled fixture file', () => {
  const hgncSource = require(path.join(importDir, 'sources', 'hgnc.js'));
  assert.strictEqual(hgncSource.retrievalUri.startsWith('file://'), true);
  assert.strictEqual(fs.existsSync(hgncSource.fixturePath), true);
});

test('LOINC importer reads a bundled fixture, not a live network source (#549 eighth slice)', () => {
  const networkCallPatterns = [/\bfetch\(/, /require\(['"]https?['"]\)/, /require\(['"]axios['"]\)/, /\baxios\./, /XMLHttpRequest/];
  for (const file of ['sources/loinc.js', 'normalizeLoinc.js']) {
    const contents = read(path.join(importDir, file));
    for (const pattern of networkCallPatterns) {
      assert.doesNotMatch(contents, pattern);
    }
  }
});

test('LOINC source config only ever points at the bundled fixture file', () => {
  const loincSource = require(path.join(importDir, 'sources', 'loinc.js'));
  assert.strictEqual(loincSource.retrievalUri.startsWith('file://'), true);
  assert.strictEqual(fs.existsSync(loincSource.fixturePath), true);
});

test('UCUM importer reads a bundled fixture, not a live network source (#549 ninth slice)', () => {
  const networkCallPatterns = [/\bfetch\(/, /require\(['"]https?['"]\)/, /require\(['"]axios['"]\)/, /\baxios\./, /XMLHttpRequest/];
  for (const file of ['sources/ucum.js', 'normalizeUcum.js']) {
    const contents = read(path.join(importDir, file));
    for (const pattern of networkCallPatterns) {
      assert.doesNotMatch(contents, pattern);
    }
  }
});

test('UCUM source config only ever points at the bundled fixture file', () => {
  const ucumSource = require(path.join(importDir, 'sources', 'ucum.js'));
  assert.strictEqual(ucumSource.retrievalUri.startsWith('file://'), true);
  assert.strictEqual(fs.existsSync(ucumSource.fixturePath), true);
});

test('DCB importer reads a bundled fixture, not a live network source (#549 tenth slice)', () => {
  const networkCallPatterns = [/\bfetch\(/, /require\(['"]https?['"]\)/, /require\(['"]axios['"]\)/, /\baxios\./, /XMLHttpRequest/];
  for (const file of ['sources/dcb.js', 'normalizeDcb.js']) {
    const contents = read(path.join(importDir, file));
    for (const pattern of networkCallPatterns) {
      assert.doesNotMatch(contents, pattern);
    }
  }
});

test('DCB source config only ever points at the bundled fixture file', () => {
  const dcbSource = require(path.join(importDir, 'sources', 'dcb.js'));
  assert.strictEqual(dcbSource.retrievalUri.startsWith('file://'), true);
  assert.strictEqual(fs.existsSync(dcbSource.fixturePath), true);
});

test('ATC importer reads a bundled fixture, not a live network source (#549 eleventh slice)', () => {
  const networkCallPatterns = [/\bfetch\(/, /require\(['"]https?['"]\)/, /require\(['"]axios['"]\)/, /\baxios\./, /XMLHttpRequest/];
  for (const file of ['sources/atc.js', 'normalizeAtc.js']) {
    const contents = read(path.join(importDir, file));
    for (const pattern of networkCallPatterns) {
      assert.doesNotMatch(contents, pattern);
    }
  }
});

test('ATC source config only ever points at the bundled fixture file', () => {
  const atcSource = require(path.join(importDir, 'sources', 'atc.js'));
  assert.strictEqual(atcSource.retrievalUri.startsWith('file://'), true);
  assert.strictEqual(fs.existsSync(atcSource.fixturePath), true);
});

test('DUO importer reads a bundled fixture, not a live network source (#549 twelfth slice)', () => {
  const networkCallPatterns = [/\bfetch\(/, /require\(['"]https?['"]\)/, /require\(['"]axios['"]\)/, /\baxios\./, /XMLHttpRequest/];
  for (const file of ['sources/duo.js', 'normalizeDuo.js']) {
    const contents = read(path.join(importDir, file));
    for (const pattern of networkCallPatterns) {
      assert.doesNotMatch(contents, pattern);
    }
  }
});

test('DUO source config only ever points at the bundled fixture file', () => {
  const duoSource = require(path.join(importDir, 'sources', 'duo.js'));
  assert.strictEqual(duoSource.retrievalUri.startsWith('file://'), true);
  assert.strictEqual(fs.existsSync(duoSource.fixturePath), true);
});

test('Uberon importer reads a bundled fixture, not a live network source (#549 thirteenth slice)', () => {
  const networkCallPatterns = [/\bfetch\(/, /require\(['"]https?['"]\)/, /require\(['"]axios['"]\)/, /\baxios\./, /XMLHttpRequest/];
  for (const file of ['sources/uberon.js', 'normalizeUberon.js']) {
    const contents = read(path.join(importDir, file));
    for (const pattern of networkCallPatterns) {
      assert.doesNotMatch(contents, pattern);
    }
  }
});

test('Uberon source config only ever points at the bundled fixture file', () => {
  const uberonSource = require(path.join(importDir, 'sources', 'uberon.js'));
  assert.strictEqual(uberonSource.retrievalUri.startsWith('file://'), true);
  assert.strictEqual(fs.existsSync(uberonSource.fixturePath), true);
});

test('NCBI Taxonomy importer reads a bundled fixture, not a live network source (#549 fourteenth slice)', () => {
  const networkCallPatterns = [/\bfetch\(/, /require\(['"]https?['"]\)/, /require\(['"]axios['"]\)/, /\baxios\./, /XMLHttpRequest/];
  for (const file of ['sources/ncbitax.js', 'normalizeNcbitax.js']) {
    const contents = read(path.join(importDir, file));
    for (const pattern of networkCallPatterns) {
      assert.doesNotMatch(contents, pattern);
    }
  }
});

test('NCBI Taxonomy source config only ever points at the bundled fixture file', () => {
  const ncbitaxSource = require(path.join(importDir, 'sources', 'ncbitax.js'));
  assert.strictEqual(ncbitaxSource.retrievalUri.startsWith('file://'), true);
  assert.strictEqual(fs.existsSync(ncbitaxSource.fixturePath), true);
});

test('Cell Ontology importer reads a bundled fixture, not a live network source (#549 fifteenth slice)', () => {
  const networkCallPatterns = [/\bfetch\(/, /require\(['"]https?['"]\)/, /require\(['"]axios['"]\)/, /\baxios\./, /XMLHttpRequest/];
  for (const file of ['sources/cl.js', 'normalizeCl.js']) {
    const contents = read(path.join(importDir, file));
    for (const pattern of networkCallPatterns) {
      assert.doesNotMatch(contents, pattern);
    }
  }
});

test('Cell Ontology source config only ever points at the bundled fixture file', () => {
  const clSource = require(path.join(importDir, 'sources', 'cl.js'));
  assert.strictEqual(clSource.retrievalUri.startsWith('file://'), true);
  assert.strictEqual(fs.existsSync(clSource.fixturePath), true);
});

test('EDAM importer reads a bundled fixture, not a live network source (#549 sixteenth and final slice)', () => {
  const networkCallPatterns = [/\bfetch\(/, /require\(['"]https?['"]\)/, /require\(['"]axios['"]\)/, /\baxios\./, /XMLHttpRequest/];
  for (const file of ['sources/edam.js', 'normalizeEdam.js']) {
    const contents = read(path.join(importDir, file));
    for (const pattern of networkCallPatterns) {
      assert.doesNotMatch(contents, pattern);
    }
  }
});

test('EDAM source config only ever points at the bundled fixture file', () => {
  const edamSource = require(path.join(importDir, 'sources', 'edam.js'));
  assert.strictEqual(edamSource.retrievalUri.startsWith('file://'), true);
  assert.strictEqual(fs.existsSync(edamSource.fixturePath), true);
});
