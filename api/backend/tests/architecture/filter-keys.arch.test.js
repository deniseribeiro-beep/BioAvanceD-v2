// node:test-only by contract (README.md Test Strategy — vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375. History: #138, #148, #182, #375, #393.
//
// #797 (umbrella), closing the `.find`/`.findOne` filter analogue of #771's
// `.sort()` guard (tests/architecture/sort-keys.arch.test.js). #788, #843
// and #847 are three live instances of one bug class: code queried the
// `consents` collection with `{ patientId: ... }`, but no writer of that
// collection ever emits `patientId` — every writer emits `participantId`.
// The Mongo driver serialises a missing/`undefined` filter value to BSON
// `null`, so `{ patientId: undefined }` is not "match nothing" — it matches
// every document that also lacks the key, i.e. every document, and returns
// an arbitrary one (#788/#843) or, depending on the collection's shape,
// nothing at all (#847's variant). Either way it is silent: no throw, a
// plausible-looking single document or empty result, and a large unit
// suite stayed green throughout, because a mock `findOne`/`find` returns
// its canned fixture regardless of the filter it is handed. The guard
// belongs on the product code for the same reason #771's does.
//
// The invariant this file enforces: **a `.find()`/`.findOne()` filter must
// not key on a field nothing in src/ ever writes.** A key qualifies as
// written if any object literal in src/ assigns it, any `x.field = ...`
// assignment sets it, or a mongoose schema declares it. Filter specs
// themselves are excluded from that vocabulary, for the same reason sort
// specs are in #771's file — otherwise every filter key would trivially
// justify itself.
//
// Scope, stated honestly rather than mirrored blindly: this file only
// checks `.find()`/`.findOne()` calls whose filter argument is written as
// an object literal at the call site — the same shape #788 shipped as.
// Unlike a sort spec, a Mongo filter is routinely built across several
// statements into a `query`/`filter` variable before being handed to
// `.find()`/`.findOne()` — that idiom accounts for on the order of five
// dozen call sites in src/ today (`grep -c '\.find(query)\|\.find(filter)'`-
// shaped), an order of magnitude more than the two `.sort(variable)` sites
// #771 catalogued. Auditing five dozen unrelated call sites one by one to
// paper over that with a `KNOWN` allowlist would be exactly the "big
// allowlist that reads as coverage while proving nothing" this style of
// guard exists to avoid — and unlike #771's two sites, nobody has traced
// what fields these five dozen `query`/`filter` variables can actually
// carry, so entries in that list would not be verified claims. That larger
// class is a real, separate gap; it is out of scope for this file and is
// reported as a follow-up rather than allowlisted here (see #797's tracker
// comment). What this file's `KNOWN` list (below) covers instead is the
// literal analogue of #771's own unfollowable case: a filter that *is*
// written as an object literal at the call site, but whose key is computed
// (`{ [field]: value }`) rather than static — the same shape as #771's
// `{ [sortField]: order }` sites, and, as of this writing, similarly rare
// (two sites).

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

// A Mongo filter written as an object literal directly on a `.find()`/
// `.findOne()` call: `.find({ a: 1 })`, `.findOne({ a: 1 }, { projection })`.
// Nested braces are deliberately not matched, for the same reason #771's
// SORT_SPEC excludes them — a flat key/value map is what this guard can
// check, and `$or`/`$and`/range sub-documents are not one. That is a known
// under-collection risk, which is exactly why there is a floor test below.
const FILTER_SPEC = /\.(?:find|findOne)\(\s*\{[^{}]*\}/g;

// Keys inside a filter or any other object literal. Quoted keys are how a
// dotted path is usually written (`'encounterPeriod.start': 1`).
//
// #851: also reads an ES6 shorthand property (`{ patientId }` ->
// `patientId`). Before this, the shorthand form was invisible to this
// guard's retired/unwritten-key checks entirely — confirmed by injecting
// #847's actual pre-fix bug back into src/ written as
// `.findOne({ patientId }, ...)` (shorthand, same retired key the longhand
// form is already caught on) and observing the suite pass 6/6 green. That
// gap mattered because it is the direction this codebase is migrating
// toward, not away from: sample.routes.js's own post-#847 fix reads
// `return { participantId, status: 'ACTIVE' };` — shorthand.
//
// A quoted key still requires its own colon (`{'a'}` isn't valid shorthand
// syntax, so there's nothing to add there); only the bare-identifier
// alternative gained the option. The lookahead `(?=[,}]|$)` is what keeps a
// shorthand key from misreading a value as a key: it only has a chance to
// fire immediately after the `(?:^|,)` anchor, so `status: ACTIVE_CONST`
// never yields `ACTIVE_CONST` — that identifier is preceded by `: `, not a
// comma or the start of the object, so the anchor never lands there. `$`
// (not just `,`/`}`) is in the lookahead because the query-builder-return
// checker's body slice (topLevelKeysOfReturnedObject) does not keep the
// object's own closing brace, so a trailing shorthand key there ends at
// end-of-string rather than at a `}` character.
const SPEC_KEY = /(?:^|,)\s*(?:'([^']+)'\s*:|"([^"]+)"\s*:|([A-Za-z_$][\w$.]*)\s*(?::|(?=[,}]|$)))/g;
const OBJECT_KEY = /(?:^|[{,\s])(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*:/g;
const MEMBER_WRITE = /\b[A-Za-z_$][\w$]*\.([A-Za-z_$][\w$]*)\s*=[^=]/g;

// `.find({ [field]: value })` / `.findOne({ [field]: value })` — a filter
// that *is* an object literal at the call site, but whose key is computed
// rather than static, so SPEC_KEY cannot read it off. Direct analogue of
// #771's `{ [sortField]: order }` sites.
const UNFOLLOWABLE_FILTER = /\.(?:find|findOne)\(\s*\{\s*\[/g;

// #847: FILTER_SPEC only sees a filter object literal written directly at
// the `.find(`/`.findOne(` call site — it misses one built inside a helper
// and `return`ed, which is exactly the shape #847 shipped as
// (buildActiveConsentQuery, sample.routes.js). This matches a query-builder
// function declaration by name only: `build<Something>Query`. Deliberately
// narrow — function declarations only (no arrow/const-assigned form, and no
// class-method shorthand, e.g. batch-validation-engine.service.js's
// `buildPatientLinkageQuery(...) {}`, were found returning a filter object
// literal in src/ as of this writing; widening to cover a shape that isn't
// there yet would be exactly the speculative broadening this file's header
// already declined to do for `query`/`filter` variables).
const QUERY_BUILDER = /function\s+(build[A-Za-z0-9_$]*Query)\s*\([^)]*\)\s*\{/g;

// Copied, not imported, from canonical-fields.arch.test.js's
// ASPIRATIONAL_FORBIDDEN (that file exports nothing, and is not this
// file's to edit). Those are names the FHIR-canonical migration retired —
// `patientID`/`patientId` chief among them, the exact #788 field. Because
// the generic written-field vocabulary below is collection-agnostic (a key
// counts as written if *any* collection's writer emits it — the same
// design #771 uses for sort keys), a retired identity key that some other,
// unrelated collection legitimately still writes would otherwise slip past
// the generic check if it were reintroduced as a consents filter. This
// list closes exactly that gap: these keys may never appear as a `.find`/
// `.findOne` filter key, full stop, regardless of whether something writes
// them elsewhere.
const RETIRED_FILTER_KEYS = [
  'patientID',
  'patientId',
  'sampleID',
  'sampleId',
  'registerDate',
  'registrationDate',
  'currentStatus',
  'tcle_id',
  'selected_tcle',
  'merkle_root',
  'legacy_compat',
  'quality_score',
  'quality_category',
  'penalty_log',
  'medication_name',
  'drug_name',
  'clinical_data',
];

// #628: Result.specimenId replaced the legacy numeric Sample.sampleID.
// These four sites are the documented three-tier resolution (_id, then
// specimenId, then legacy sampleID) that both the live write paths and
// the one-time backfill use to resolve a caller-supplied identifier
// against Sample documents that predate #628 and may still carry the
// retired field. That is the opposite of #788's bug — it is the read half
// of migrating *away* from the retired key, not a fresh write that
// invented it — so it is exempted from the retired-key check by site
// rather than by loosening RETIRED_FILTER_KEYS itself.
const RETIRED_KEY_EXEMPT = new Set([
  'interface/routes/result.routes.js:137',
  'interface/routes/result.routes.js:384',
  'interface/routes/result.routes.js:522',
  'services/result-specimenid-backfill.service.js:56'
]);

function keysIn(text, pattern) {
  const keys = [];
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    keys.push(match[1] || match[2] || match[3]);
  }
  return keys;
}

// Index of the `}` matching the `{` immediately before `content[openIndex]`
// (i.e. openIndex is the position right after that opening brace), found by
// depth counting. Same known risk as this file's other regexes: a `{`/`}`
// inside a string or a regex literal would misdirect the count. None of the
// query-builder functions this rule targets has one as of this writing.
function matchingBrace(content, openIndex) {
  let depth = 1;
  for (let i = openIndex; i < content.length; i++) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Unlike FILTER_SPEC's call-site literal, a query-builder's `return`ed
// filter routinely nests a value — `{ patientId: { $in: [...] },
// status: 'ACTIVE' }` is #847's actual pre-fix shape — so this cannot stay
// a flat, single-level regex the way FILTER_SPEC does. It still only reads
// *top-level* keys: repeatedly deleting the innermost `{...}`/`[...]` group
// leaves just the outer skeleton, so a nested value's own keys (`$in`
// above) are never read as filter keys, the same way FILTER_SPEC never
// looks inside a call-site `$or`/`$and`.
function topLevelKeysOfReturnedObject(body) {
  let skeleton = body;
  let previous;
  do {
    previous = skeleton;
    skeleton = skeleton.replace(/\{[^{}]*\}|\[[^[\]]*\]/, '');
  } while (skeleton !== previous);
  return keysIn(skeleton, SPEC_KEY);
}

// Finds every `return { ... };` written directly inside a QUERY_BUILDER
// function's own body (not a nested inner function's — matchingBrace scopes
// the search to this function's braces only), and reports it in the same
// shape a FILTER_SPEC call-site match is reported in.
function queryBuilderReturnSites(content) {
  const sites = [];

  for (const fnMatch of content.matchAll(QUERY_BUILDER)) {
    const bodyStart = fnMatch.index + fnMatch[0].length;
    const bodyEnd = matchingBrace(content, bodyStart);
    if (bodyEnd === -1) continue;
    const fnBody = content.slice(bodyStart, bodyEnd);

    for (const retMatch of fnBody.matchAll(/return\s*\{/g)) {
      const openIndex = retMatch.index + retMatch[0].length;
      const closeIndex = matchingBrace(fnBody, openIndex);
      if (closeIndex === -1) continue;

      const start = bodyStart + retMatch.index;
      const end = bodyStart + closeIndex + 1;
      sites.push({
        start,
        end,
        keys: topLevelKeysOfReturnedObject(fnBody.slice(openIndex, closeIndex)),
        raw: content.slice(start, end).replace(/\s+/g, ' ')
      });
    }
  }

  return sites;
}

// Returns { filterSites, writtenFields } from one pass over a source text.
// The filter specs are blanked out before the write sweep runs, so a
// filter's own keys never end up vouching for themselves.
function analyze(content) {
  const filterSites = [];
  let stripped = content;

  for (const match of content.matchAll(FILTER_SPEC)) {
    // Slice past the brace, not onto it: SPEC_KEY anchors each key on
    // start-of-string or a comma, so a leading `{` leaves the first key
    // unmatched — which silently yields zero keys and a vacuously green
    // guard. The synthetic-source test below is what catches that.
    const body = match[0].slice(match[0].indexOf('{') + 1);
    filterSites.push({
      line: content.slice(0, match.index).split('\n').length,
      keys: keysIn(body, SPEC_KEY),
      raw: match[0].replace(/\s+/g, ' ')
    });
    stripped = stripped.replace(match[0], ' '.repeat(match[0].length));
  }

  // #847: the query-builder analogue of the loop above — same "blank it so
  // it can't vouch for its own keys" rule, applied to a `return`ed filter
  // instead of a call-site one.
  for (const site of queryBuilderReturnSites(content)) {
    filterSites.push({
      line: content.slice(0, site.start).split('\n').length,
      keys: site.keys,
      raw: site.raw
    });
    stripped = stripped.slice(0, site.start) + ' '.repeat(site.end - site.start) + stripped.slice(site.end);
  }

  const writtenFields = new Set([
    ...keysIn(stripped, OBJECT_KEY),
    ...[...stripped.matchAll(MEMBER_WRITE)].map((match) => match[1])
  ]);

  return { filterSites, writtenFields };
}

// Mongoose schema paths, via require. Same rationale as #771's file: most
// of src/models are validator classes with no field list at all, which is
// why the written-field sweep above is load-bearing rather than a
// supplement to the models.
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
  const filterSites = [];
  const writtenFields = new Set();

  for (const file of walk(BACKEND_SRC)) {
    const content = fs.readFileSync(file, 'utf8');
    const analyzed = analyze(content);
    analyzed.filterSites.forEach((site) => filterSites.push({ ...site, file: relative(file) }));
    analyzed.writtenFields.forEach((field) => writtenFields.add(field));
  }

  for (const declared of declaredSchemaPaths()) writtenFields.add(declared);

  return { filterSites, writtenFields };
}

function offendersIn({ filterSites, writtenFields }) {
  const offenders = [];
  const retired = new Set(RETIRED_FILTER_KEYS);

  for (const site of filterSites) {
    for (const key of site.keys) {
      if (key.startsWith('$')) continue; // an operator, not a field

      if (retired.has(key)) {
        if (RETIRED_KEY_EXEMPT.has(`${site.file}:${site.line}`)) continue;
        offenders.push(`${site.file}:${site.line} filters on retired key '${key}' — ${site.raw}`);
        continue;
      }

      // A dotted path is satisfied by its root: `encounterPeriod.start` is
      // fine if something writes `encounterPeriod`, since the
      // sub-document's own shape is beyond a static sweep.
      const root = key.split('.')[0];
      if (!writtenFields.has(key) && !writtenFields.has(root)) {
        offenders.push(`${site.file}:${site.line} filters on '${key}' — ${site.raw}`);
      }
    }
  }

  return offenders;
}

function offendersInSynthetic(source) {
  const analyzed = analyze(source);
  return offendersIn({
    filterSites: analyzed.filterSites.map((site) => ({ ...site, file: 'synthetic.js' })),
    writtenFields: analyzed.writtenFields
  });
}

test('#788: no .find()/.findOne() filters on a field nothing in src/ ever writes, or a retired one', () => {
  const offenders = offendersIn(sweepSource());

  assert.deepEqual(
    offenders,
    [],
    'Mongo serialises an absent filter value to BSON null, so a filter on '
      + "a field nothing writes doesn't match nothing — it matches every "
      + 'document that also lacks the key and returns an arbitrary one '
      + '(#788/#843/#847). Correct the key, or write the field:\n  '
      + offenders.join('\n  ')
  );
});

test('#788: the guard actually flags a #788-shaped filter', () => {
  // The failure mode of a static sweep is under-collection, which is
  // invisible by construction — a regex that stops matching makes the
  // guard above pass more easily (#771 hit this as #777). So run the real
  // analysis over synthetic sources carrying the real bug shapes.

  // Shape 1: a filter key nothing in src/ writes at all.
  const neverWritten = [
    'const doc = { participantId: id, status: "active" };',
    'const record = await consents.findOne({ neverWrittenFilterKey: id });'
  ].join('\n');

  const offendersA = offendersInSynthetic(neverWritten);
  assert.equal(offendersA.length, 1, 'the sweep no longer sees an unwritten filter key');
  assert.match(offendersA[0], /neverWrittenFilterKey/);

  // ...and does not flag the field the same source does write.
  assert.deepEqual(
    offendersInSynthetic(neverWritten.replace('neverWrittenFilterKey', 'participantId')),
    [],
    'the sweep flags a filter on a field the same source writes'
  );

  // Shape 2: the literal #788 field. patientId is, as of this writing,
  // genuinely written elsewhere in src/ (biomarker-integrity.service.js's
  // own collection), so the generic written-field vocabulary alone would
  // wave this through — exactly the collection-crossing mistake #788 was.
  // RETIRED_FILTER_KEYS is what still catches it.
  const retiredKeyBug = [
    'const doc = { patientId: id, biomarkerType: "x" };', // legitimately written, elsewhere
    'const consent = await consents.findOne({ patientId: id });' // #788's actual bug
  ].join('\n');

  const offendersB = offendersInSynthetic(retiredKeyBug);
  assert.equal(offendersB.length, 1, 'the sweep no longer flags a retired identity key used as a filter');
  assert.match(offendersB[0], /retired key 'patientId'/);
});

test('#847: the guard also flags a filter object returned from a query-builder function', () => {
  // #847's actual pre-fix shape (sample.routes.js, before 32a1538d): a
  // query-builder function whose filter is `return`ed rather than written
  // at the `.find`/`.findOne` call site, keyed on the same retired
  // `patientId` #788 already forbids — FILTER_SPEC alone cannot see it,
  // because it never looks past the call site.
  const buggyBuilder = [
    'const sample = { status: "REGISTERED" };', // status legitimately written, elsewhere
    'function buildActiveConsentQuery(patient) {',
    '  const patientIds = [patient?.patientID, patient?._id?.toString()]',
    '    .filter((value) => value !== undefined && value !== null && value !== "")',
    '    .map(String);',
    '',
    '  return {',
    '    patientId: { $in: [...new Set(patientIds)] },',
    '    status: "ACTIVE"',
    '  };',
    '}',
    'const consent = await patientConsentsCollection.findOne(buildActiveConsentQuery(patient));'
  ].join('\n');

  const offendersBuilder = offendersInSynthetic(buggyBuilder);
  assert.equal(offendersBuilder.length, 1, 'the sweep no longer flags a query-builder function returning a retired filter key');
  assert.match(offendersBuilder[0], /retired key 'patientId'/);

  // ...and the actual fix (32a1538d) is not flagged: keying on
  // `participantId` instead, written shorthand (`return { participantId,
  // status: ... };`, sample.routes.js's real post-#847 text verbatim).
  // #851: SPEC_KEY now reads a shorthand property as a key too — so this
  // only stays clean because `participantId` is (like `status` above)
  // genuinely written elsewhere in this synthetic source, the same
  // "legitimately written, elsewhere" shape Shape 2 above already uses for
  // `patientId`/`biomarkerType`, not because the key goes unread.
  const fixedBuilder = [
    'const sample = { status: "REGISTERED" };',
    'const consentRecord = { participantId: id };', // legitimately written, elsewhere (PatientConsent.js:63 et al.)
    'function buildActiveConsentQuery(patient) {',
    '  const participantId = String(patient?.participantId ?? "").trim();',
    '  if (!participantId) return null;',
    '',
    '  return {',
    '    participantId,',
    "    status: 'ACTIVE'",
    '  };',
    '}',
    'const consent = await patientConsentsCollection.findOne(buildActiveConsentQuery(patient));'
  ].join('\n');

  assert.deepEqual(
    offendersInSynthetic(fixedBuilder),
    [],
    'the sweep flags the fixed, participantId-keyed query-builder filter'
  );
});

test('#851: SPEC_KEY also recognises an ES6 shorthand filter key', () => {
  // #851: confirmed empirically before this fix — injecting #847's real
  // retired-key bug back into src/ written as shorthand
  // (`.findOne({ patientId }, ...)`) passed the whole suite 6/6 green,
  // while the identical longhand (`.findOne({ patientId: id })`) was
  // already caught. The verdict depended on syntax that is semantically
  // identical, and it was weakest against the shorthand style this
  // codebase is migrating toward (sample.routes.js:202's own post-#847
  // text is shorthand). This is the call-site analogue of the
  // query-builder-return proof in the #847 test above, which SPEC_KEY
  // feeds too.

  // Shape 1: a shorthand filter on a retired key IS flagged.
  const shorthandRetired = [
    'const consentRecord = { participantId: id };', // legitimately written, elsewhere
    'const consent = await consents.findOne({ patientId });'
  ].join('\n');

  const offendersA = offendersInSynthetic(shorthandRetired);
  assert.equal(offendersA.length, 1, 'the sweep no longer flags a shorthand filter on a retired key');
  assert.match(offendersA[0], /retired key 'patientId'/);

  // Shape 2: the real post-#847 shape — a shorthand filter on a legitimate
  // key, alongside an explicit one — stays clean, and must stay clean.
  const shorthandLegit = [
    'const consentRecord = { participantId: id, status: "ACTIVE" };', // both legitimately written, elsewhere
    'const consent = await consents.findOne({ participantId, status: "ACTIVE" });'
  ].join('\n');

  assert.deepEqual(
    offendersInSynthetic(shorthandLegit),
    [],
    'the sweep flags a shorthand filter on a field the same source writes'
  );

  // The care this rule needs: an explicit `key: value` must never have its
  // *value* misread as a second, shorthand key. The lookahead only has a
  // chance to match right after `(?:^|,)`, and `ACTIVE_CONST` here is
  // preceded by `: `, not a comma or the start of the object — so it can
  // never be mistaken for a shorthand key sitting next to `status`.
  const valueIsNotAKey = 'await consents.findOne({ status: ACTIVE_CONST });';
  assert.deepEqual(
    analyze(valueIsNotAKey).filterSites[0].keys,
    ['status'],
    'an explicit value is being misread as a shorthand key'
  );
});

test('#788: a filter spec does not vouch for its own keys', () => {
  // Without blanking the specs before the write sweep, `{ neverWritten: 1 }`
  // is itself an object literal with that key, so every filter key would
  // count as written and the guard above would be permanently green and
  // useless.
  const onlyFilter = 'await c.findOne({ neverWrittenAnywhere: 1 });';

  assert.ok(
    !analyze(onlyFilter).writtenFields.has('neverWrittenAnywhere'),
    'filter specs are leaking into the written-field vocabulary, which '
      + 'makes the guard vacuous'
  );
});

test('#788: the sweep still collects the filter sites it is meant to cover', () => {
  const { filterSites } = sweepSource();
  const files = new Set(filterSites.map((site) => site.file));

  // A floor, not the exact count — new filters land all the time, but a
  // sudden collapse means the extractor broke, not that the code stopped
  // filtering.
  assert.ok(
    filterSites.length >= 350,
    `only ${filterSites.length} filter specs collected — the extractor has `
      + 'silently narrowed (see #777 for the same failure in the env guard)'
  );

  // Named anchors across real call sites, including the collection at the
  // centre of #788/#843/#847 itself.
  for (const anchor of [
    'infrastructure/persistence/mongo/MongoStorageRepository.js',
    'services/sample.service.js',
    'services/consent.service.js'
  ]) {
    assert.ok(files.has(anchor), `${anchor} filters, but the sweep did not collect it`);
  }
});

test('#788: every literal filter this guard cannot follow is a known one', () => {
  // `.find({ [field]: value })` / `.findOne({ [field]: value })` are
  // literal object filters whose key is computed, so SPEC_KEY cannot read
  // them off — the direct analogue of #771's `{ [sortField]: order }`
  // sites. This deliberately does NOT cover `.find(query)`/`.findOne(filter)`
  // with a bare variable argument: that is a distinct, much larger
  // (five-dozen-plus) category driven by an ordinary query-builder idiom
  // this file's header explains and scopes out rather than allowlists.
  const KNOWN = [
    // `parentIdField` is a literal string ('datasetId'/'assayId') fixed at
    // route-registration time by dataset-file.routes.js/assay-file.routes.js
    // — never request- or payload-derived — so the key that reaches the
    // driver is always one of those two real fields.
    'controllers/createLinkedFileController.js',
    // `field` is a literal string hardcoded at each assertReferencesExist(
    // db, [{ collection, field, value }]) call site (e.g.
    // clinical-observation.service.js's 'specimenId'/'deviceId') — not
    // derived from request/payload data at any call site found in src/.
    'ingestion/canonicalGateway.js'
  ];

  const unfollowable = [];
  for (const file of walk(BACKEND_SRC)) {
    const content = fs.readFileSync(file, 'utf8');
    for (const match of content.matchAll(UNFOLLOWABLE_FILTER)) {
      const line = content.slice(0, match.index).split('\n').length;
      unfollowable.push({ file: relative(file), line });
    }
  }

  const unexpected = unfollowable
    .filter((entry) => !KNOWN.includes(entry.file))
    .map((entry) => `${entry.file}:${entry.line} .find/.findOne({ [computed key] })`);

  assert.deepEqual(
    unexpected,
    [],
    'These pass a computed key inside an otherwise-literal filter, so the '
      + 'key is unchecked by the guard above. Use a static key, or add the '
      + 'file to KNOWN with a note on why its keys are safe:\n  ' + unexpected.join('\n  ')
  );
});
