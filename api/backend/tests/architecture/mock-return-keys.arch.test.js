// node:test-only by contract (README.md Test Strategy -- vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375.
//
// #1334 (split from #803): the output-side twin of filter-keys.arch.test.js.
// A test mocks a function and gives the mock a return shape the real
// function never produces, usually by carrying a retired field name. The
// code under test reads that field, the mock supplies it, and the test
// passes while the same request in production sees `undefined`. #795, #788,
// #843 and #844 were hidden this way, and #1334's cleanup found two more
// underneath: printed labels read `sampleID`, and the async batch importer
// read `patient.patientID`.
//
// The invariant: **an object or array literal handed to
// mockResolvedValue/mockReturnValue (or their Once forms) under tests/ does
// not carry a retired key in key position.** Each key below has a canonical
// successor that every writer in src/ now emits, so no document the real
// function returns can carry it.
//
// Not guarded, on purpose: `sampleID`/`sampleId` (live keys on
// biomarkerObservations, sampleFiles, withdrawals and StorageBox, per
// #803's survey) and `locationID` (Sample.create still writes it, and the
// sensor reads take it as an alias). A guard on those would be an exemption
// list longer than its findings.
//
// Known limits, the same as #803's survey stated: it misses a non-literal
// return (`mockResolvedValue(fixture)`, a shared factory), a fixture passed
// as an argument rather than returned, and a missing required key. It flags
// a mock, not a wrong assertion.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const TESTS_ROOT = path.resolve(__dirname, '..');
const SCANNED_DIRS = ['unit', 'integration', 'compliance'].map((d) => path.join(TESTS_ROOT, d));

// retired key -> its canonical successor
const RETIRED = {
  patientID: 'participantId',
  patientId: 'participantId',
  registerDate: 'registeredAt',
  lifecycleStatus: 'specimenStatus',
};

// `relative/path.test.js` -> { key: reason }. A literal here mocks a function
// whose real return does carry the key; the reason says which.
const EXEMPT = {
  'integration/compliance.verify-biomarker.api.test.js': {
    patientId: 'verifyBiomarkerById returns the biomarker integrity document\'s patientId, the key biomarker-integrity.service writes and hashes',
  },
  'unit/import-lgpd.service.importPatients.unit.test.js': {
    patientID: 'readFile returns an uploaded file\'s raw rows, and the test pins that a patientID column in the file is ignored',
  },
};

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(test|spec)\.(js|ts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

// Index of the bracket closing the one at `start`, skipping string, template
// and comment contents so a brace inside them does not count.
function matchBracket(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '/' && text[i + 1] === '/') {
      i = text.indexOf('\n', i);
      if (i === -1) return -1;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2) + 1;
      if (i === 0) return -1;
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') {
      for (i += 1; i < text.length && text[i] !== ch; i += 1) {
        if (text[i] === '\\') i += 1;
      }
      continue;
    }
    if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function scan() {
  const keyRe = new RegExp(`(?:^|[{,\\s])(${Object.keys(RETIRED).join('|')})\\s*:`, 'g');
  const callRe = /mock(?:Resolved|Return)Value(?:Once)?\(\s*([{[])/g;
  const hits = [];
  let calls = 0;
  for (const file of SCANNED_DIRS.flatMap((d) => walk(d))) {
    const rel = path.relative(TESTS_ROOT, file).split(path.sep).join('/');
    const text = fs.readFileSync(file, 'utf8');
    let m;
    callRe.lastIndex = 0;
    while ((m = callRe.exec(text))) {
      calls += 1;
      const start = m.index + m[0].length - 1;
      const end = matchBracket(text, start);
      if (end === -1) continue;
      const literal = text.slice(start, end + 1);
      let k;
      keyRe.lastIndex = 0;
      while ((k = keyRe.exec(literal))) {
        const key = k[1];
        if (EXEMPT[rel] && EXEMPT[rel][key]) continue;
        const line = text.slice(0, start + k.index).split('\n').length;
        hits.push(`${rel}:${line} ${key} (use ${RETIRED[key]})`);
      }
    }
  }
  return { hits, calls };
}

test('the scan reaches the mock calls it is meant to read', () => {
  // A guard that finds no calls would pass by reading nothing.
  const missing = SCANNED_DIRS.filter((d) => !fs.existsSync(d)).map((d) => path.relative(TESTS_ROOT, d));
  assert.deepEqual(missing, [], `scanned test directories missing: ${missing.join(', ')}`);
  const { calls } = scan();
  assert.ok(calls > 1000, `only ${calls} mock calls with a literal argument found`);
});

test('no mock-return literal under tests/ carries a retired key (#1334)', () => {
  const { hits } = scan();
  assert.deepEqual(hits, [], `retired keys in mock returns:\n${hits.join('\n')}`);
});

test('every exemption still matches a literal that needs it', () => {
  const saved = JSON.parse(JSON.stringify(EXEMPT));
  const stale = [];
  for (const [file, keys] of Object.entries(saved)) {
    for (const key of Object.keys(keys)) {
      delete EXEMPT[file][key];
      const { hits } = scan();
      if (!hits.some((h) => h.startsWith(`${file}:`) && h.includes(` ${key} `))) stale.push(`${file} ${key}`);
      EXEMPT[file][key] = saved[file][key];
    }
  }
  assert.deepEqual(stale, [], `exemptions that no longer match anything:\n${stale.join('\n')}`);
});
