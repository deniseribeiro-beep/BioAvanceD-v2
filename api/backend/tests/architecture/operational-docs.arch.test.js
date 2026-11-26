// node:test-only by contract (README.md Test Strategy -- vitest is out of
// contract here). Do not port to vitest's import/expect.
//
// RNF006 C1-C6 and RNF013 C1-C4 (#1472): the operational, security and
// user documentation this file pins:
//   - every required document exists and names the criterion it answers;
//   - the risk register's risk table and the exception register's field
//     table carry every field RNF013 C1 and C3 name;
//   - no document holds a secret (RNF006 C6): no private key block, no
//     provider token shape, no credential inside a connection URL, no literal
//     assigned to a secret-named variable, and no value that a tracked
//     compose file or env example assigns to a secret variable;
//   - no document claims ISO/IEC 27001 certification or conformity (RNF013
//     C4): in a line naming 27001, a negation sits a few words before each
//     certification word.
//
// A failure names the document and the variable, never a secret's value.
//
// Does NOT run on CI, and skips there by design (#1190): CI runs
// test:architecture inside backend-unit-runner, whose image holds only
// api/backend. It runs natively, wherever the repo tree is present.

const { test: nodeTest } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../../..');

const IN_REPO_TREE = fs.existsSync(path.join(REPO_ROOT, 'api', 'backend', 'package.json'));
const test = IN_REPO_TREE
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: '#1190: repo tree not reachable (expected inside backend-unit-runner)' }, fn);

// Each required document and the criterion text its body must name.
const REQUIRED_DOCS = [
  ['docs/user-guides/README.md', ['RNF006 C1']],
  ['docs/operations/install-runbook.md', ['RNF006 C2']],
  ['docs/operations/configuration-runbook.md', ['RNF006 C2']],
  ['docs/operations/backup-restore-runbook.md', ['RNF006 C2']],
  ['docs/operations/outbox-runbook.md', ['RNF006 C2']],
  ['docs/operations/troubleshooting-runbook.md', ['RNF006 C2']],
  ['docs/operations/changelog-v2.0.0.md', ['RNF006 C3']],
  ['docs/operations/migration-and-rollback.md', ['RNF006 C3', 'RNF006 C4']],
  ['docs/operations/mapping-limits.md', ['RNF006 C5']],
  ['docs/security/risk-register.md', ['RNF013 C1']],
  ['docs/security/incident-and-continuity.md', ['RNF013 C2']],
  ['docs/security/security-exceptions.md', ['RNF013 C3']],
];

// The directories whose Markdown the secret and ISO checks read.
const DOC_DIRS = ['docs/operations', 'docs/runbooks', 'docs/security', 'docs/user-guides'];

const RISK_COLUMNS = ['ID', 'Asset', 'Risk', 'Likelihood', 'Impact', 'Owner', 'Treatment', 'Status', 'Tracking issue'];
const EXCEPTION_FIELDS = ['ID', 'Control relaxed', 'Scope', 'Justification', 'Approver', 'Approval date', 'Expiry date', 'Residual risk', 'Compensating controls', 'Status'];

// A KEY name is a secret when it ends in KEY or KEY_PREVIOUS (ENCRYPTION_KEY
// and its rotation slot), never a *_KEY_ID or a PUBLIC_KEY.
const SECRET_NAME = /PASSWORD|PASSWD|SECRET|TOKEN|CREDENTIAL|PRIVATE|API_KEY|_PASS$|(?:^|(?<!PUBLIC)_)KEY(?:_PREVIOUS)?$/i;
const SECRET_SHAPES = [
  ['a private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['an AWS access key id', /\bAKIA[0-9A-Z]{16}\b/],
  ['a GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['a Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['a Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['a JSON web token', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  // The user may be empty (redis://:pass@host); a password that is an
  // interpolation (${...}) or a placeholder (<...>) is no credential.
  ['a credential inside a URL', /\b(?:mongodb(?:\+srv)?|redis|rediss|neo4j(?:\+s)?|bolt|amqps?|https?):\/\/[^\s:@/`'"]*:(?!\$\{|<)[^\s@/`'"]+@/],
];
// An env-style assignment in a document: an upper-case variable name, = or :,
// then a literal of 8 or more characters. Interpolations (${...} or $VAR),
// placeholders (<...>) and paths (/...) are no credential.
const ASSIGNMENT = /\b([A-Z][A-Z0-9_]*)\s*[:=]\s*['"`]?([^\s'"`]{8,})/g;
const ISO_27001 = /27001/;
const CLAIM_WORD = /certif|complian|conformidade|conforme/gi;
const NEGATION = /\b(?:not|no|never|without|sem|nunca|n[ãa]o)\b/i;
// How many words before a claim word its negation may sit.
const NEGATION_WINDOW = 4;

function read(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
}

function markdownUnder(dir) {
  const out = [];
  const abs = path.join(REPO_ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...markdownUnder(rel));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(rel);
  }
  return out;
}

function docs() {
  return DOC_DIRS.flatMap(markdownUnder).sort();
}

// Cells of a Markdown table row, or null for a line that is not one.
function cells(line) {
  const t = line.trim();
  if (!t.startsWith('|') || !t.endsWith('|')) return null;
  return t.slice(1, -1).split('|').map((c) => c.trim());
}

// Every value a tracked compose file or env example assigns to a variable
// whose name reads as a secret: value -> where. Interpolations (${...}),
// placeholders (<...>), file paths and values under 8 characters are not
// credentials and are left out. The real .env files are never read.
function credentialValues() {
  const sources = fs.readdirSync(REPO_ROOT).filter((f) => /^compose[^/]*\.ya?ml$/.test(f) || /^\.env[^/]*\.example$/.test(f));
  const values = new Map();
  for (const file of sources) {
    for (const line of read(file).split('\n')) {
      const m = line.match(/^\s*(?:-\s*)?([A-Za-z0-9_]+)\s*[:=]\s*(.*?)\s*$/);
      if (!m || !SECRET_NAME.test(m[1])) continue;
      const value = m[2].replace(/\s+#.*$/, '').replace(/^['"]|['"]$/g, '');
      if (value.length < 8 || value.includes('${') || value.startsWith('<') || value.startsWith('/')) continue;
      if (!values.has(value)) values.set(value, `${file}:${m[1]}`);
    }
  }
  return { sources, values };
}

// What in a document's text reads as a secret, by kind or variable name,
// never by value.
function secretHits(text, values) {
  const hits = [];
  for (const [what, re] of SECRET_SHAPES) if (re.test(text)) hits.push(what);
  // A ${NAME:?message} or ${NAME:-default} interpolation is no assignment:
  // each ${...} span reads as a placeholder before the scan.
  for (const m of text.replace(/\$\{[^}]*\}/g, '<interpolation>').matchAll(ASSIGNMENT)) {
    if (!SECRET_NAME.test(m[1])) continue;
    if (/^(?:\$|<|\/)/.test(m[2])) continue;
    hits.push(`an assignment to ${m[1]}`);
  }
  for (const [value, where] of values) if (text.includes(value)) hits.push(`the value of ${where}`);
  return hits;
}

// Whether a line names ISO/IEC 27001 with a claim word that no negation
// within NEGATION_WINDOW words before it denies.
function claimsIso27001(line) {
  if (!ISO_27001.test(line)) return false;
  for (const m of line.matchAll(CLAIM_WORD)) {
    // One more token than the window: the last is the claim word's own prefix.
    const before = line.slice(0, m.index).split(/\s+/).slice(-(NEGATION_WINDOW + 1)).join(' ');
    if (!NEGATION.test(before)) return true;
  }
  return false;
}

test('every required document exists and names the criterion it answers', () => {
  const misses = [];
  for (const [rel, criteria] of REQUIRED_DOCS) {
    if (!fs.existsSync(path.join(REPO_ROOT, rel))) { misses.push(`${rel}: missing`); continue; }
    const text = read(rel);
    for (const c of criteria) if (!text.includes(c)) misses.push(`${rel}: does not name ${c}`);
  }
  assert.deepEqual(misses, []);
});

test('the risk register has a risk table with every RNF013 C1 column, and every risk row fills each one', () => {
  const lines = read('docs/security/risk-register.md').split('\n');
  const head = lines.findIndex((l) => { const c = cells(l); return c && c[0] === 'ID' && c.includes('Owner'); });
  assert.ok(head >= 0, 'no risk table whose header starts with ID and names Owner');
  assert.deepEqual(cells(lines[head]), RISK_COLUMNS);
  const rows = [];
  for (let i = head + 2; i < lines.length && cells(lines[i]); i++) rows.push(cells(lines[i]));
  assert.ok(rows.length > 0, 'the risk table has no row');
  for (const row of rows) {
    assert.match(row[0], /^R-\d{3}$/, `risk row id: ${row[0]}`);
    assert.equal(row.length, RISK_COLUMNS.length, `${row[0]}: ${row.length} cells`);
    row.forEach((c, k) => assert.ok(c.length > 0, `${row[0]}: empty ${RISK_COLUMNS[k]}`));
  }
});

test('the exception register defines every RNF013 C3 field, and every listed exception fills each one', () => {
  const lines = read('docs/security/security-exceptions.md').split('\n');
  const fieldHead = lines.findIndex((l) => { const c = cells(l); return c && c[0] === 'Field' && c[1] === 'Content'; });
  assert.ok(fieldHead >= 0, 'no Field | Content table');
  const fields = [];
  for (let i = fieldHead + 2; i < lines.length && cells(lines[i]); i++) fields.push(cells(lines[i])[0]);
  assert.deepEqual(fields, EXCEPTION_FIELDS);
  const start = lines.findIndex((l) => /^## Current register\s*$/.test(l));
  assert.ok(start >= 0, 'no "## Current register" section');
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  const section = lines.slice(start + 1, end);
  const table = section.findIndex((l) => { const c = cells(l); return c && c[0] === 'ID'; });
  if (table < 0) {
    assert.ok(section.some((l) => l.includes('No approved exceptions')), 'the current register has neither a table nor "No approved exceptions"');
    return;
  }
  assert.deepEqual(cells(section[table]), EXCEPTION_FIELDS);
  for (let i = table + 2; i < section.length && cells(section[i]); i++) {
    const row = cells(section[i]);
    assert.match(row[0], /^EX-\d{3}$/, `exception row id: ${row[0]}`);
    assert.equal(row.length, EXCEPTION_FIELDS.length, `${row[0]}: ${row.length} cells`);
    row.forEach((c, k) => assert.ok(c.length > 0, `${row[0]}: empty ${EXCEPTION_FIELDS[k]}`));
  }
});

test('no document holds a secret (RNF006 C6)', () => {
  const { sources, values } = credentialValues();
  assert.ok(sources.includes('compose.test.yml'), 'compose.test.yml not read');
  assert.ok(values.size > 0, 'no credential value read from the compose files and env examples');
  const files = docs();
  assert.ok(files.length >= REQUIRED_DOCS.length, `only ${files.length} documents read`);
  const hits = [];
  for (const rel of files) {
    for (const what of secretHits(read(rel), values)) hits.push(`${rel}: ${what}`);
  }
  assert.deepEqual(hits, []);
});

test('no document claims ISO/IEC 27001 certification (RNF013 C4)', () => {
  const hits = [];
  for (const rel of docs()) {
    read(rel).split('\n').forEach((line, i) => {
      if (claimsIso27001(line)) hits.push(`${rel}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, []);
});

test('the secret and ISO checks tell a credential or a claim from a variable, a placeholder or a denial', () => {
  const none = new Map();
  assert.deepEqual(secretHits('Set `JWT_SECRET=abcdefgh12345678` in .env.docker.', none), ['an assignment to JWT_SECRET']);
  assert.deepEqual(secretHits('MONGO_ROOT_PASSWORD: Pr0dS3cure!Pass2026', none), ['an assignment to MONGO_ROOT_PASSWORD']);
  assert.deepEqual(secretHits('redis://:realpass123@redis:6379', none), ['a credential inside a URL']);
  assert.deepEqual(secretHits('mongodb://${U}:${P}@mongo/x', none), []);
  assert.deepEqual(secretHits('`mongodb://user:<password>@mongodb:27017/bioavanced`', none), []);
  assert.deepEqual(secretHits('(`${NEO4J_PASSWORD:?...}` and the like)', none), []);
  assert.deepEqual(secretHits('"--password", "${MONGO_ROOT_PASSWORD:?MONGO_ROOT_PASSWORD is required}",', none), []);
  assert.deepEqual(secretHits('mongodb://${MONGO_USER}:${MONGO_PASSWORD:-x}@mongo', none), []);
  assert.deepEqual(secretHits('ENCRYPTION_KEY=0123456789abcdef', none), ['an assignment to ENCRYPTION_KEY']);
  assert.deepEqual(secretHits('ENCRYPTION_KEY_PREVIOUS=0123456789abcdef', none), ['an assignment to ENCRYPTION_KEY_PREVIOUS']);
  assert.deepEqual(secretHits('ENCRYPTION_KEY_ID=prod-key-0001 AUDIT_EXTERNAL_WITNESS_PUBLIC_KEY=abcdefghijklmnop', none), []);
  assert.deepEqual(secretHits('MONGO_ROOT_PASSWORD=<a strong value>; JWT_SECRET=$JWT_SECRET_FILE', none), []);
  assert.deepEqual(secretHits('- `setUserPassword`: Definir senha de usuário; UPDATE', none), []);
  assert.equal(claimsIso27001('The platform is ISO/IEC 27001 certified, with no exceptions.'), true);
  assert.equal(claimsIso27001('The platform is ISO/IEC 27001-certified and not affiliated with any vendor.'), true);
  assert.equal(claimsIso27001('A plataforma é certificada ISO/IEC 27001.'), true);
  assert.equal(claimsIso27001('The system does not claim ISO/IEC 27001 certification.'), false);
  assert.equal(claimsIso27001('A plataforma não é certificada ISO/IEC 27001.'), false);
});
