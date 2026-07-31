import { test, expect } from 'vitest';

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const importDir = path.join(repoRoot, 'src', 'reference-data', 'reference-imports');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

test('HPO importer is not imported by startup entrypoints', () => {
  for (const file of [path.join(repoRoot, 'app.js'), path.join(repoRoot, 'server.js'), path.join(repoRoot, 'src', 'workers', 'worker.js')]) {
    expect(read(file).includes('reference-imports')).toBe(false);
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
      expect(contents).not.toMatch(pattern);
    }
  }
});

test('HPO source config only ever points at the bundled fixture file', () => {
  const hpoSource = require(path.join(importDir, 'sources', 'hpo.js'));
  expect(hpoSource.retrievalUri.startsWith('file://')).toBe(true);
  expect(fs.existsSync(hpoSource.fixturePath)).toBe(true);
});

test('large import scaffold still excludes HPO from its allowed-datasets set (RF028 keeps it a separate, operational script)', () => {
  const scaffold = read(path.join(repoRoot, 'scripts', 'reference-imports', 'import-large-reference-dataset.js'));
  expect(scaffold).toMatch(/not implemented until data model is finalized/);
  // Looks for the Set entry specifically (quoted lowercase), not any mention
  // of HPO in prose/comments explaining why it was removed.
  expect(scaffold).not.toMatch(/['"]hpo['"]/);
});
