// node:test-only by contract (README.md Test Strategy — vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375. History: #138, #148, #182, #375, #393.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const backendRoot = path.join(repoRoot, 'src');
const scriptsRoot = path.join(repoRoot, 'scripts');
const essentialManifest = path.join(repoRoot, 'src', 'reference-data', 'essential', 'manifest.js');

const { stripComments } = require('./helpers/strip-comments');

// #945: these guards ask whether a file *imports* something, or *reaches the
// network*. A comment naming either is neither, so prose is blanked before
// matching. String literals survive, so the `https://` checks below still see
// a real URL constant.
function read(file) {
  return stripComments(fs.readFileSync(file, 'utf8'));
}

test('seed essential is not imported by startup entrypoints', () => {
  for (const file of [path.join(repoRoot, 'app.js'), path.join(repoRoot, 'server.js'), path.join(backendRoot, 'workers', 'worker.js')]) {
    assert.strictEqual(read(file).includes('seed-essential-reference-data'), false);
  }
});

test('large import scaffolds stay non-operational', () => {
  const scaffold = read(path.join(scriptsRoot, 'reference-imports', 'import-large-reference-dataset.js'));
  assert.match(scaffold, /not implemented until data model is finalized/);
  assert.strictEqual(scaffold.includes('https://'), false);
  assert.strictEqual(scaffold.includes('http://'), false);
});

test('essential manifest excludes large dataset keys', () => {
  const manifest = require(essentialManifest).getManifest();
  for (const blocked of ['hpo', 'orpha', 'cid', 'omim', 'mondo']) {
    assert.strictEqual(manifest.some((entry) => String(entry.key).toLowerCase().includes(blocked)), false);
  }
});

test('seed scripts do not require network access', () => {
  const seedScript = read(path.join(scriptsRoot, 'seed-essential-reference-data.js'));
  assert.strictEqual(seedScript.includes('https://'), false);
  assert.strictEqual(seedScript.includes('http://'), false);
});

// RNF017 C4 (#1471): test seeds use only authorized synthetic data. A seed
// may name an e-mail only under a reserved test domain (RFC 2606/6761:
// example.com/.net/.org, .test, .example, .invalid, .localhost), and may hold
// no CPF whose check digits are valid: a generated CPF is computed at run
// time (tests/e2e/helpers/cpf.ts), never written as a literal.
const repoTop = path.resolve(repoRoot, '..', '..');
const e2eHelpers = path.join(repoTop, 'tests', 'e2e', 'helpers');
const E2E_HELPERS_PRESENT = fs.existsSync(e2eHelpers);

const RESERVED_DOMAINS = ['example.com', 'example.net', 'example.org'];
const RESERVED_TLDS = ['test', 'example', 'invalid', 'localhost'];
// An image or code file name such as icon@2x.png has an e-mail's shape but
// is not one; a version such as lodash@4.17.21 is refused by the letters-only
// TLD the domain must end in.
const FILE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'css', 'js', 'ts', 'json'];
const EMAIL = /[A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})(?![A-Za-z0-9-])/g;
// A CPF is matched dotted (ddd.ddd.ddd-dd), as ddddddddd-dd, or as a bare run
// of 11 digits, quoted or not; the check-digit test then drops timestamps and
// ids. A bare run touching a letter or digit is part of a hash, not a CPF.
const CPF = /(?<![0-9])(?:[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}|[0-9]{9}-[0-9]{2})(?![0-9])|(?<![0-9A-Za-z_])[0-9]{11}(?![0-9A-Za-z_])/g;

function isReservedDomain(domain) {
  const d = domain.toLowerCase();
  if (FILE_EXTENSIONS.includes(d.split('.').pop())) return true;
  if (RESERVED_TLDS.includes(d.split('.').pop())) return true;
  return RESERVED_DOMAINS.some((r) => d === r || d.endsWith(`.${r}`));
}

function cpfCheckDigit(digits) {
  const weightStart = digits.length + 1;
  const sum = digits.reduce((acc, digit, i) => acc + digit * (weightStart - i), 0);
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

function isValidCpf(text) {
  const d = text.replace(/[^0-9]/g, '').split('').map(Number);
  if (d.length !== 11 || d.every((x) => x === d[0])) return false;
  return cpfCheckDigit(d.slice(0, 9)) === d[9] && cpfCheckDigit(d.slice(0, 10)) === d[10];
}

function findNonSyntheticData(text) {
  const found = [];
  for (const m of text.matchAll(EMAIL)) if (!isReservedDomain(m[1])) found.push(`e-mail ${m[0]}`);
  for (const m of text.matchAll(CPF)) if (isValidCpf(m[0])) found.push(`CPF ${m[0]}`);
  return found;
}

function listFiles(dir, keep) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(full, keep);
    return keep(entry.name) ? [full] : [];
  });
}

function backendSeedFiles() {
  return [
    path.join(scriptsRoot, 'seed-essential-reference-data.js'),
    path.join(scriptsRoot, 'identifier-lookup-explain.js'),
    path.join(scriptsRoot, 'create-active-tcle.js'),
    ...listFiles(path.join(backendRoot, 'scripts'), (name) => /^seed.*\.js$/.test(name)),
    ...listFiles(path.join(backendRoot, 'services'), (name) => /-seed\.service\.js$/.test(name)),
    ...listFiles(path.join(repoRoot, 'tests', 'fixtures'), () => true),
    ...listFiles(path.join(repoRoot, 'tests', 'factories'), (name) => name.endsWith('.js')),
  ];
}

function e2eSeedFiles() {
  return [
    ...listFiles(e2eHelpers, (name) => /^seed.*\.ts$/.test(name)),
    path.join(repoTop, 'tests', 'e2e', 'global-setup.ts'),
    path.join(repoTop, 'tests', 'e2e-showcase', 'showcaseFixtures.ts'),
  ];
}

function assertSynthetic(files) {
  const offences = files.flatMap((file) =>
    findNonSyntheticData(fs.readFileSync(file, 'utf8')).map((what) => `${path.relative(repoTop, file)}: ${what}`));
  assert.deepStrictEqual(offences, []);
}

test('the non-synthetic data scan flags a real-shaped e-mail and CPF and passes synthetic ones', () => {
  assert.deepStrictEqual(findNonSyntheticData("email: 'maria.silva@gmail.com'"), ['e-mail maria.silva@gmail.com']);
  assert.deepStrictEqual(findNonSyntheticData("cpf: '529.982.247-25'"), ['CPF 529.982.247-25']);
  assert.deepStrictEqual(findNonSyntheticData("cpf: '52998224725'"), ['CPF 52998224725']);
  assert.deepStrictEqual(findNonSyntheticData('{ "cpf": 52998224725 }'), ['CPF 52998224725']);
  assert.deepStrictEqual(findNonSyntheticData("cpf: '529982247-25'"), ['CPF 529982247-25']);
  assert.deepStrictEqual(findNonSyntheticData("'a@b.com'"), ['e-mail a@b.com']);
  assert.deepStrictEqual(findNonSyntheticData(
    "'qa@example.com' 'a@lab.test' 'b@mail.example.org' '123.456.789-00' '11111111111' '@playwright/test' 1731500000000"), []);
  assert.deepStrictEqual(findNonSyntheticData("'lodash@4.17.21' 'icon@2x.png' 'abc52998224725' '52998224725f0'"), []);
});

test('backend test seeds hold only synthetic e-mails and CPFs (RNF017 C4)', () => {
  const files = backendSeedFiles();
  assert.ok(files.length >= 16, `expected the backend seed set, got ${files.length} files`);
  assertSynthetic(files);
});

test('e2e seed helpers hold only synthetic e-mails and CPFs (RNF017 C4)',
  E2E_HELPERS_PRESENT ? {} : { skip: 'repo-root tests/e2e/ is not in this image (#1059)' }, () => {
    const files = e2eSeedFiles();
    assert.ok(files.length >= 7, `expected the e2e seed helpers, got ${files.length} files`);
    assertSynthetic(files);
  });
