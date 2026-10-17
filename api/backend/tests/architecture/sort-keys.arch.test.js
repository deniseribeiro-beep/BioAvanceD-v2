// node:test-only by contract (README.md Test Strategy — vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375. History: #138, #148, #182, #375, #393.
//
// #771 (follow-up to #769): MongoDB treats a sort key no document carries as
// equal across every document. Such a sort is legal, throws nothing, and
// produces plausible-looking output — combined with a `.limit(N)` it returns
// the *wrong* N rows rather than the right N misordered.
//
// #769 was exactly that: two RF008 report handlers ordered the samples
// collection on `registrationDate`, a name commit e2549bee renamed away, so
// ordering silently fell through to `createdAt` and `.limit(100)` returned
// the wrong hundred rows. No test caught it, because a mock cursor's
// `sort() { return chain; }` discards the spec it is handed — 165 such sites
// across 80 test files, which is why #771 proposed guarding the *product*
// half here instead of upgrading the mocks.
//
// The invariant this file enforces is the one that names the bug class:
// **a query must not order on a field nothing writes.** A key qualifies as
// written if any object literal in src/ assigns it, any `x.field = ...`
// assignment sets it, or a mongoose schema declares it. Sort specs
// themselves are excluded from that vocabulary — otherwise every sort key
// would trivially justify itself.
//
// Verified against the real bug: `registrationDate` and `registerDate` are
// both absent from the vocabulary this builds, so #769 would have failed
// here with no mock changes at all.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const BACKEND_SRC = path.resolve(__dirname, '../../src');
const MODELS_DIR = path.resolve(BACKEND_SRC, 'models');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'build', 'coverage'].includes(entry.name)) continue;
      walk(full, out);
    } else if (/\.js$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function relative(file) {
  return path.relative(BACKEND_SRC, file).split(path.sep).join('/');
}

// A Mongo sort spec written as an object literal: `.sort({ a: 1 })`, an
// options bag's `sort: { a: 1 }`, or an aggregation stage's `$sort: { a: 1 }`.
// Nested braces are deliberately not matched — a sort spec is a flat map of
// field to direction, and anything nested is not one.
const SORT_SPEC = /(?:\.sort\(\s*|\$?sort\s*:\s*)\{[^{}]*\}/g;

// Keys inside a spec or any other object literal. Quoted keys are how a
// dotted path is usually written (`'encounterPeriod.start': 1`).
const SPEC_KEY = /(?:^|,)\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$.]*))\s*:/g;
const OBJECT_KEY = /(?:^|[{,\s])(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*:/g;
const MEMBER_WRITE = /\b[A-Za-z_$][\w$]*\.([A-Za-z_$][\w$]*)\s*=[^=]/g;

// `.sort(someVariable)` — a real Mongo sort this file cannot follow. The
// shape keeps out `.sort()` and `.sort((a, b) => ...)`, which are
// Array.prototype.sort and none of this guard's business.
const UNFOLLOWABLE_SORT = /\.sort\(\s*([A-Za-z_$][\w$]*)\s*\)/g;

function keysIn(text, pattern) {
  const keys = [];
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    keys.push(match[1] || match[2] || match[3]);
  }
  return keys;
}

// Returns { sortSites, writtenFields } from one pass over a source text.
// The sort specs are blanked out before the write sweep runs, so a spec's
// own keys never end up vouching for themselves.
function analyze(content) {
  const sortSites = [];
  let stripped = content;

  for (const match of content.matchAll(SORT_SPEC)) {
    // Slice past the brace, not onto it: SPEC_KEY anchors each key on
    // start-of-string or a comma, so a leading `{` leaves the first key
    // unmatched — which silently yields zero keys and a vacuously green
    // guard. The synthetic-source test below is what catches that.
    const body = match[0].slice(match[0].indexOf('{') + 1);
    sortSites.push({
      line: content.slice(0, match.index).split('\n').length,
      keys: keysIn(body, SPEC_KEY),
      raw: match[0].replace(/\s+/g, ' ')
    });
    stripped = stripped.replace(match[0], ' '.repeat(match[0].length));
  }

  const writtenFields = new Set([
    ...keysIn(stripped, OBJECT_KEY),
    ...[...stripped.matchAll(MEMBER_WRITE)].map((match) => match[1])
  ]);

  return { sortSites, writtenFields };
}

// Mongoose schema paths, via require. Only 14 of the 85 files in src/models
// are mongoose schemas — the rest are validator classes that declare no field
// list at all, which is precisely why the written-field sweep above is the
// load-bearing half of the vocabulary rather than a supplement to the models.
function declaredSchemaPaths() {
  const paths = new Set();

  for (const name of fs.readdirSync(MODELS_DIR).filter((file) => /\.js$/.test(file))) {
    let mod;
    try {
      mod = require(path.join(MODELS_DIR, name));
    } catch (error) {
      continue; // a model that cannot be required contributes nothing here
    }
    const visit = (value) => {
      if (!value) return;
      if (value.paths && typeof value.paths === 'object') Object.keys(value.paths).forEach((p) => paths.add(p));
      else if (value.schema && value.schema.paths) Object.keys(value.schema.paths).forEach((p) => paths.add(p));
    };
    visit(mod);
    if (mod && typeof mod === 'object') Object.keys(mod).forEach((key) => visit(mod[key]));
  }

  return paths;
}

function sweepSource() {
  const sortSites = [];
  const writtenFields = new Set();

  for (const file of walk(BACKEND_SRC)) {
    const content = fs.readFileSync(file, 'utf8');
    const analyzed = analyze(content);
    analyzed.sortSites.forEach((site) => sortSites.push({ ...site, file: relative(file) }));
    analyzed.writtenFields.forEach((field) => writtenFields.add(field));
  }

  for (const declared of declaredSchemaPaths()) writtenFields.add(declared);

  return { sortSites, writtenFields };
}

function offendersIn({ sortSites, writtenFields }) {
  const offenders = [];

  for (const site of sortSites) {
    for (const key of site.keys) {
      // A dotted path is satisfied by its root: `encounterPeriod.start` is
      // fine if something writes `encounterPeriod`, since the sub-document's
      // own shape is beyond a static sweep.
      const root = key.split('.')[0];
      if (!writtenFields.has(key) && !writtenFields.has(root)) {
        offenders.push(`${site.file}:${site.line} sorts on '${key}' — ${site.raw}`);
      }
    }
  }

  return offenders;
}

function offendersInSynthetic(source) {
  const analyzed = analyze(source);
  return offendersIn({
    sortSites: analyzed.sortSites.map((site) => ({ ...site, file: 'synthetic.js' })),
    writtenFields: analyzed.writtenFields
  });
}

test('#771: no query orders on a field nothing in src/ ever writes', () => {
  const offenders = offendersIn(sweepSource());

  assert.deepEqual(
    offenders,
    [],
    'Mongo treats a sort key no document carries as equal across every '
      + 'document, so these sorts do nothing and any .limit() beside them '
      + 'returns the wrong rows rather than the right rows misordered '
      + '(#769). Correct the key, or write the field:\n  '
      + offenders.join('\n  ')
  );
});

test('#771: the guard actually flags a #769-shaped sort', () => {
  // The failure mode of a static sweep is under-collection, which is
  // invisible by construction — a regex that stops matching makes the guard
  // above pass more easily (#777 hit exactly this). So run the real analysis
  // over a synthetic source carrying the real bug.
  const buggy = [
    'const doc = { registeredAt: new Date(), specimenId: id };',
    'await samples.find(query).sort({ registrationDate: -1 }).limit(100).toArray();'
  ].join('\n');

  const offenders = offendersInSynthetic(buggy);

  assert.equal(offenders.length, 1, 'the sweep no longer sees a #769-shaped sort key');
  assert.match(offenders[0], /registrationDate/);

  // ...and does not flag the field the same source does write.
  assert.deepEqual(
    offendersInSynthetic(buggy.replace('registrationDate', 'registeredAt')),
    [],
    'the sweep flags a sort on a field the same source writes'
  );
});

test('#771: a sort spec does not vouch for its own keys', () => {
  // Without blanking the specs before the write sweep, `{ neverWritten: 1 }`
  // is itself an object literal with that key, so every sort key would count
  // as written and the guard above would be permanently green and useless.
  const onlySort = 'await c.find({}).sort({ neverWrittenAnywhere: 1 }).toArray();';

  assert.ok(
    !analyze(onlySort).writtenFields.has('neverWrittenAnywhere'),
    'sort specs are leaking into the written-field vocabulary, which makes '
      + 'the guard vacuous'
  );
});

test('#771: the sweep still collects the sort sites it is meant to cover', () => {
  const { sortSites } = sweepSource();
  const files = new Set(sortSites.map((site) => site.file));

  // A floor, not the exact count — new sorts land all the time, but a sudden
  // collapse means the extractor broke, not that the code stopped sorting.
  assert.ok(
    sortSites.length >= 90,
    `only ${sortSites.length} sort specs collected — the extractor has `
      + 'silently narrowed (see #777 for the same failure in the env guard)'
  );

  // Named anchors across the three shapes the extractor has to handle: a
  // chained .sort(), an options-bag sort:, and an aggregation $sort stage.
  for (const anchor of [
    'services/audit-v2.service.js',
    'controllers/audit.controller.js',
    'services/complianceReport.service.js'
  ]) {
    assert.ok(files.has(anchor), `${anchor} sorts, but the sweep did not collect it`);
  }
});

test('#771: every Mongo sort spec this guard cannot follow is a known one', () => {
  // `.sort(someVariable)` is opaque to a static sweep. One exists today and
  // is deliberate; a second should be adjudicated rather than left silently
  // unchecked.
  const KNOWN = [
    // Builds `{ [sortField]: order }`, but sortField is now allow-listed
    // against SORTABLE_LOG_FIELDS (derived from Log.js's own document
    // builder) and falls back to the date pair otherwise, so every key that
    // can reach the driver is real — #780. Still unfollowable statically,
    // because the spec is a variable at the call site.
    'services/log.service.js'
  ];

  const unfollowable = [];
  for (const file of walk(BACKEND_SRC)) {
    const content = fs.readFileSync(file, 'utf8');
    for (const match of content.matchAll(UNFOLLOWABLE_SORT)) {
      const line = content.slice(0, match.index).split('\n').length;
      unfollowable.push({ file: relative(file), line, binding: match[1] });
    }
  }

  const unexpected = unfollowable
    .filter((entry) => !KNOWN.includes(entry.file))
    .map((entry) => `${entry.file}:${entry.line} .sort(${entry.binding})`);

  assert.deepEqual(
    unexpected,
    [],
    'These pass a variable to .sort(), so their keys are unchecked by the '
      + 'guard above. Use an object literal, or add the file to KNOWN with a '
      + 'note on why its keys are safe:\n  ' + unexpected.join('\n  ')
  );
});
