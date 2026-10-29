// node:test-only by contract (README.md Test Strategy — vitest is out of
// contract here). History: #1299, split from #975.
//
// RNF018 answers a validation failure with 422 (#884, #1300). Clients read
// the failures from the body, and before #1299 the 422 sites disagreed on
// where: some returned `details: <array>`, most returned only
// `message: <errors joined into one string>`, so a client could not read
// the list the same way twice. The frontend reads `.message` at about 76
// sites, so the fix is additive: every 422 body carries `details`, a list,
// and `message` stays where it was.
//
// This test parses every `.status(422).json({ ... })` and every
// `.status(... === 422 ? 422 : ...).json({ ... })` in src/ and asserts the
// object literal names a `details` key. It reads source text, so a body
// built elsewhere and passed by variable is out of its reach; none exists
// today (the census below fails loudly on a `.json(<identifier>)`).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');

const srcRoot = path.resolve(__dirname, '..', '..', 'src');

function listJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJsFiles(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

// A literal 422, or the `x === 422 ? 422 : y` ternary #1300 introduced.
const STATUS_422 = /\.status\(\s*(?:422|[^()]*===\s*422\s*\?\s*422\s*:[^()]*)\)\s*\.json\(/g;

// Returns the text of the argument passed to .json(, balancing braces and
// skipping string and template literals, or null when it is not an object
// literal.
function jsonArgument(source, openParenIndex) {
  let i = openParenIndex + 1;
  while (/\s/.test(source[i])) i += 1;
  if (source[i] !== '{') return null;
  let depth = 0;
  for (let j = i; j < source.length; j += 1) {
    const ch = source[j];
    if (ch === '\'' || ch === '"' || ch === '`') {
      const quote = ch;
      j += 1;
      while (j < source.length && source[j] !== quote) {
        if (source[j] === '\\') j += 1;
        j += 1;
      }
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(i, j + 1);
    }
  }
  return null;
}

function census() {
  const sites = [];
  for (const file of listJsFiles(srcRoot)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(STATUS_422)) {
      const openParen = match.index + match[0].length - 1;
      const line = source.slice(0, match.index).split('\n').length;
      sites.push({
        where: `${path.relative(srcRoot, file).replace(/\\/g, '/')}:${line}`,
        body: jsonArgument(source, openParen),
      });
    }
  }
  return sites;
}

test('the census finds the 422 sites (control: a population this small means the pattern broke)', () => {
  const sites = census();
  assert.ok(sites.length >= 40, `expected at least 40 status-422 sites, found ${sites.length}`);
});

test('every 422 response body is an object literal', () => {
  const notLiteral = census().filter((site) => site.body === null).map((site) => site.where);
  assert.deepEqual(notLiteral, []);
});

// Exactly one: a second `details:` in an object literal silently wins, so a
// duplicated key is as wrong as a missing one.
test('every 422 response body names a details key exactly once (#1299)', () => {
  const wrong = census()
    .filter((site) => site.body !== null)
    .map((site) => ({ where: site.where, count: (site.body.match(/(^|[\s{,])details\s*[:,}]/g) || []).length }))
    .filter((site) => site.count !== 1)
    .map((site) => `${site.where} (${site.count})`);
  assert.deepEqual(wrong, []);
});
