// node:test-only by contract (README.md Test Strategy — vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375.
//
// #839: the general form of #818. That issue fixed one handler where
// `req.body.groupFields` was `JSON.parse`d with no schema and fed into
// data-layer keys. #869 then found the *identical* hazard twelve lines
// below it, on `req.body.mapping`, untouched — the fix had not
// generalised, and nothing caught that.
//
// #839's own bar, quoted, is what this file is written against:
//
//   "a rule that does not flag this line is too narrow to be worth having"
//
// So the first test below encodes exactly the shape both fixes converged
// on. #818 and #869 were remedied the same way — the inline
// `JSON.parse(req.body.X)` was replaced by a *named boundary validator*
// in `src/utils/` returning `{ ok, value } | { ok, reason }`
// (`parseGroupFields`, `parseImportMapping`). That is a real, stated
// convention now, and "no handler parses a request-body field inline"
// is the mechanical form of it.
//
// ---------------------------------------------------------------------
// WHAT THIS GUARD DELIBERATELY CANNOT SEE — read before trusting a green
// ---------------------------------------------------------------------
// The lesson this suite keeps re-learning is that a guard's COLLECTION
// step is what to audit, not its assertions (#863 — a guard sat green
// over 41 live defects because its collector never saw the files;
// #882 — the same collector matched prose in comments). So:
//
//  - **Cross-function flow is out of reach**, exactly as
//    `filter-keys.arch.test.js` documents for its own resolver. Where a
//    controller hands `req.body` wholesale to a service
//    (`sensorService.updateSensor(db, id, req.body)`) and the *service*
//    spreads its parameter into `$set`, the two halves are in different
//    files and neither half looks dangerous alone. `#875` carries that
//    population; it is not reachable from here without real module
//    resolution, and pretending otherwise would be the confident zero
//    this suite exists to prevent.
//  - It reads text, not an AST. A `JSON.parse` spread across a variable
//    (`const raw = req.body.x; JSON.parse(raw)`) is invisible.
//  - Comments are stripped first (#882), so prose cannot trip it and,
//    equally, cannot vouch for anything.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const BACKEND_SRC = path.resolve(__dirname, '../../src');

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
  return path.relative(BACKEND_SRC, file).replace(/\\/g, '/');
}

// #882's stripper, now shared (#945). This file used to carry its own
// "minimal form" copy that did not understand regex literals — given
// `/^https?:\/\//` it read the escaped slash plus the closing delimiter as a
// `//` comment opener and blanked the rest of the line, hiding any real
// violation that followed. The shared helper is the string- and regex-aware
// implementation, so adopting it makes this guard strictly stronger.
const { stripComments } = require('./helpers/strip-comments');

function sources() {
  return walk(BACKEND_SRC).map((file) => ({
    file,
    content: stripComments(fs.readFileSync(file, 'utf8')),
  }));
}

function lineOf(content, index) {
  return content.slice(0, index).split('\n').length;
}

// ---------------------------------------------------------------------
// Test 1 — #818/#869's own shape.
// ---------------------------------------------------------------------

// `JSON.parse(req.body.x)` / `JSON.parse(req.body[...])`, in any handler.
// This is the literal line #818 fixed and the literal line #869 found
// unfixed beside it.
const INLINE_BODY_PARSE = /JSON\s*\.\s*parse\s*\(\s*req\s*\.\s*body\b/g;

test('#839: no handler JSON.parses a request-body field inline', () => {
  const offenders = [];

  for (const { file, content } of sources()) {
    for (const match of content.matchAll(INLINE_BODY_PARSE)) {
      offenders.push(`${relative(file)}:${lineOf(content, match.index)}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'A request-body field parsed inline has no schema, no key filter and '
      + 'no type check -- #818 and #869 were both exactly this. Give it a '
      + 'named boundary validator in src/utils/ returning '
      + '{ ok, value } | { ok, reason }, the way parseGroupFields and '
      + 'parseImportMapping do, and reject the whole payload at the '
      + 'boundary:\n  ' + offenders.join('\n  ')
  );
});

// ---------------------------------------------------------------------
// Test 2 — the update-document form of the same class.
// ---------------------------------------------------------------------

// A local that carries the request body wholesale: `= req.body`,
// `= { ...req.body }`, or the rest half of a destructure
// (`const { a, ...rest } = req.body`) -- the last being the denylist
// shape, which is the one that reads safest and is not.
const BODY_ALIASES = [
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*req\s*\.\s*body\b/g,
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\{\s*\.\.\.\s*req\s*\.\s*body\b/g,
  /(?:const|let|var)\s*\{[^}]*\.\.\.\s*([A-Za-z_$][\w$]*)\s*\}\s*=\s*req\s*\.\s*body\b/g,
];

// `$set: { ...alias }` or `$set: alias`.
const SET_SITES = [
  /\$set\s*:\s*\{[^{}]*\.\.\.\s*([A-Za-z_$][\w$]*)/g,
  /\$set\s*:\s*([A-Za-z_$][\w$]*)\s*[,}]/g,
];

function updateDocumentSites() {
  const sites = [];
  for (const { file, content } of sources()) {
    const aliases = new Set();
    for (const pattern of BODY_ALIASES) {
      for (const match of content.matchAll(pattern)) aliases.add(match[1]);
    }
    if (aliases.size === 0) continue;

    const seen = new Set();
    for (const pattern of SET_SITES) {
      for (const match of content.matchAll(pattern)) {
        if (!aliases.has(match[1])) continue;
        const site = `${relative(file)}:${lineOf(content, match.index)}:${match[1]}`;
        if (seen.has(site)) continue;
        seen.add(site);
        sites.push(site);
      }
    }
  }
  return sites.sort();
}

// Sites that spread a request body into an update document. Two are real
// defects carried by an open issue; two are a deliberate pattern. Each
// entry says which, because the difference is invisible from the shape --
// that is this whole class's problem, not an accident of this guard.
//
// Delete an entry when its issue closes; do not add one without filing.
const UPDATE_SPREAD_EXEMPT = new Map([
  // The two #875 entries that stood here (master-data.routes.js:117:update,
  // result.routes.js:457:updateFields) were removed when #875 CLOSED those
  // defects: both PUTs now build $set from model-derived allowlists, so
  // the spread shapes this sweep detects no longer exist at those sites --
  // the sweep not finding them is the fix landing, not the detector
  // regressing (this is the sanctioned reason to remove an entry).

  // Equipment PUT -- NOT a defect, and the reason is worth stating so a
  // later reader does not "fix" it. It validates the MERGED document and
  // rejects only the errors the patch introduces
  // (equipment.routes.js:358-372, #868), which is stricter than a plain
  // validate: it cannot punish a request for a pre-existing defect it did
  // not cause. Two entries because the write happens twice, once inside a
  // transaction and once in the non-transactional fallback.
  // Both moved down one line by #951, which added an `isTransactionCapable`
  // require at the top of the file. The code and the reasoning are unchanged;
  // only the line numbers moved, which is the "update the entry" case the
  // companion test below names -- not the "delete the exemption" one.
  ['interface/routes/equipment.routes.js:388:updateData', 'validated (#868)'],
  ['interface/routes/equipment.routes.js:417:updateData', 'validated (#868)'],
]);

test('#839: no NEW update document is built by spreading a request body', () => {
  const offenders = updateDocumentSites().filter((site) => !UPDATE_SPREAD_EXEMPT.has(site));

  assert.deepEqual(
    offenders,
    [],
    'These build a MongoDB update document by spreading the request body, '
      + 'so every field the caller sends is persisted -- including ones no '
      + 'schema knows about. Enumerate the permitted fields at the call '
      + 'site (an allowlist, not a denylist: `const { bad, ...rest } = '
      + 'req.body` and `const { good } = req.body` look identical, and only '
      + 'where `...rest` goes distinguishes them), or add a filed exemption '
      + 'to UPDATE_SPREAD_EXEMPT above:\n  ' + offenders.join('\n  ')
  );
});

// ---------------------------------------------------------------------
// Test 3 — the collection step, which is the part that actually rots.
// ---------------------------------------------------------------------

test('#839: the sweep still sees the sites it is supposed to judge', () => {
  // #863's lesson, applied before it can happen here: a guard that stops
  // COLLECTING passes more easily, and silently. Both assertions below
  // fail loudly if the collector narrows -- the first if the walk shrinks,
  // the second if the update-document detector stops matching shapes it
  // demonstrably matched when this landed.
  const scanned = sources();

  assert.ok(
    scanned.length >= 200,
    `Expected the src/ walk to reach at least 200 files, found ${scanned.length} `
      + '-- the collector has narrowed and every assertion above is passing '
      + 'over a smaller population than it was written for.'
  );

  const sites = updateDocumentSites();
  for (const known of UPDATE_SPREAD_EXEMPT.keys()) {
    assert.ok(
      sites.includes(known),
      `${known} is exempted but the sweep no longer finds it. Either the code `
        + 'moved (update the entry) or the detector stopped matching its shape '
        + '(fix the detector) -- do not just delete the exemption, which would '
        + 'make this guard pass by seeing less.'
    );
  }
});

test('#839: the exemption set has not grown', () => {
  // Same convention as filter-keys.arch.test.js's UNWRITTEN_KEY_EXEMPT and
  // env-declarations' READ_EXEMPT: growing this is a review event, not a
  // fix. #875's two open-defect entries were removed when that issue
  // closed both sites with model-derived allowlists (4 -> 2); the two
  // that remain are the deliberate #868 merge-validate pattern.
  assert.equal(UPDATE_SPREAD_EXEMPT.size, 2);
});
