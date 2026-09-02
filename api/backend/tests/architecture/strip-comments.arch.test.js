// node:test-only by contract (README.md Test Strategy — vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375. History: #138, #148, #182, #375, #393.

// Regression coverage for #945. The guards in this directory decide whether a
// file "contains" a forbidden token; this pins the two ways that decision was
// wrong before the shared helper existed:
//
//   1. A token named in a COMMENT counted as a violation (false positive) —
//      the defect #945 was filed for, hit live on #902.
//   2. Code following a regex literal that contains an escaped slash was
//      blanked and stopped counting at all (false NEGATIVE) — a divergence in
//      the "minimal form" copy that `request-body-boundary.arch.test.js`
//      carried, found while resolving #945.
//
// (2) is the one worth keeping tests on: a guard that silently sees less is
// worse than one that is noisy, because nothing goes red to tell you.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { stripComments } = require('./helpers/strip-comments');

test('a forbidden token inside a line comment does not count as a hit (#945)', () => {
  const source = [
    '// The seed lives in seed-essential-reference-data and is deliberately',
    '// NOT imported here; see #902.',
    'const app = express();',
  ].join('\n');

  assert.strictEqual(stripComments(source).includes('seed-essential-reference-data'), false);
  assert.strictEqual(stripComments(source).includes('express()'), true);
});

test('a forbidden token inside a block comment does not count as a hit (#945)', () => {
  const source = [
    '/*',
    ' * patientID and sampleID are the legacy aliases this projection avoids.',
    ' */',
    'const id = participant.canonicalId;',
  ].join('\n');

  const stripped = stripComments(source);
  assert.strictEqual(stripped.includes('patientID'), false);
  assert.strictEqual(stripped.includes('sampleID'), false);
  assert.strictEqual(stripped.includes('participant.canonicalId'), true);
});

test('a token inside a STRING literal still counts as a hit — comments are the exception, not string data (#945)', () => {
  // `seed-boundary` asserts seed scripts contain no `https://`. That check has
  // to keep working on real URL literals; only prose becomes invisible.
  const source = "const uri = 'https://example.org/hpo.json';";

  assert.strictEqual(stripComments(source).includes('https://'), true);
});

test('code AFTER a regex literal containing an escaped slash is still visible (#945 false-negative half)', () => {
  // The "minimal form" stripper read the escaped slash plus the closing
  // delimiter as a `//` comment opener and blanked the rest of the line, so a
  // real violation on that line became invisible to the guard.
  const source = 'const rx = /^https?:\\/\\//; const bad = neo4jDriver.session;';

  assert.strictEqual(stripComments(source).includes('neo4jDriver.session'), true);
});

test('a regex literal spanning a character class with a slash does not swallow the line (#945)', () => {
  const source = 'const rx = /[/]/; const bad = mongoSampleId;';

  assert.strictEqual(stripComments(source).includes('mongoSampleId'), true);
});

test('blanking preserves line structure so reported line numbers stay true (#945)', () => {
  // `request-body-boundary` computes line numbers from the stripped content.
  const source = ['const a = 1;', '// a comment', '/* two', '   lines */', 'const b = 2;'].join('\n');

  assert.strictEqual(stripComments(source).split('\n').length, source.split('\n').length);
  assert.strictEqual(stripComments(source).length, source.length);
});
