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
// check, and a `$gte`/`$lte` range sub-document is not one. That is a known
// under-collection risk, which is exactly why there is a floor test below.
// #854: a `$or`/`$and`/`$nor` array is the one nested shape this file does
// still follow — see FILTER_CALL_START below, a second, narrower pass over
// exactly that shape, added rather than folded in here because widening
// this regex itself to accept arbitrary nested braces would also swallow
// every other nested shape (range sub-documents, `$in`, `$regex`...) this
// comment just said stays out of scope.
const FILTER_SPEC = /\.(?:find|findOne)\(\s*\{[^{}]*\}/g;

// #854: the start of a call-site filter literal that FILTER_SPEC's `[^{}]*`
// cannot match at all, because it nests further braces — a filter combined
// with `$or`/`$and`/`$nor`, `{ $or: [{ patientId: x }, { _id: y }] }`
// among them, is #788's exact shape wrapped in the operator this codebase
// actually uses to write a multi-criteria filter. matchingBrace (below)
// finds the true, arbitrarily-deep extent from here; the body is only
// treated as a new filter site if a genuine top-level `$and`/`$or`/`$nor`
// key turns out to be present in it (checked in analyze()) — anything else
// nested stays out of scope, same as FILTER_SPEC's own comment above.
const FILTER_CALL_START = /\.(?:find|findOne)\(\s*\{/g;
const OPERATOR_KEYS = new Set(['$and', '$or', '$nor']);

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

// #1088: the fifth collector's pattern. FILTER_SPEC requires a `{`
// immediately after the paren, and FILTER_CALL_IDENTIFIER requires a bare
// identifier followed by `,` or `)` -- so this codebase's own standard
// scope-filter idiom,
//
//   .findOne(applyOrganizationScopeFilter({ sampleID: Number(id) }, scope, 'collectionSite'))
//
// satisfies NEITHER: the character after `(` is `a`, and
// `applyOrganizationScopeFilter` is followed by `(`. The call site was
// therefore absent from the population entirely -- not exempted, not
// reported -- and the retired key rode along invisibly. The floor test below
// cannot see that either: one dropped site against hundreds of slack.
//
// Keyed on the CALL-SITE SHAPE, not the helper's name, and that is the
// load-bearing choice. #1088 measured 9 such sites across 6 files in src/,
// under three different naming conventions (`resolveTemplateQuery`,
// `buildSensorLookup`, `normalizeSampleIdFilter`) -- QUERY_BUILDER's
// `build*Query` declaration pattern reaches only two of the six, and
// `applyOrganizationScopeFilter` would have been a fourth convention. A
// name-based detector loses that race by construction.
//
// This supersedes the reasoning at QUERY_BUILDER's comment below, which
// declined to widen on the grounds that the shape was "not there yet". That
// was true when written and is not any more.
//
// Only the helper's FIRST argument is read, and only when it is an object
// literal. A helper handed a pre-built variable stays Band B -- the same
// unresolvable case FILTER_CALL_IDENTIFIER already scopes out.
const HELPER_WRAPPED_FILTER = /\.(?:find|findOne)\(\s*([A-Za-z_$][\w$]*)\s*\(\s*\{/g;

// Coercions and constructors, which take a scalar rather than a filter. A
// `new X({...})` cannot match HELPER_WRAPPED_FILTER anyway (there is no
// `new` in the pattern), but these are named so the exclusion reads as a
// decision rather than an accident of the regex.
const NOT_A_FILTER_HELPER = new Set(['String', 'Number', 'parseInt', 'parseFloat', 'Boolean', 'ObjectId', 'Date']);

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
//
// #857 added four more sites to the same pattern, and they earned the
// exemption rather than being granted it: before that fix these $or filters
// resolved an identifier through _id, sampleID, sampleId and barcode with
// NO specimenId leg at all, so they could not find a sample by the field
// SampleModel.create actually writes. That is a genuine bug, and this guard
// is what surfaced it — the $or recursion added for #854 was what made the
// sites visible in the first place. They are exempt now because they carry
// the canonical tier, not because the retired legs are harmless.
//
// Still unestablished, tracked on #857: whether `{ sampleId: <id> }`
// (lowercase d) was ever a written field. #628's comment names only
// sampleID as the legacy form. If it was never written, that leg is dead
// and should be dropped, which would shrink these four exemptions.
const RETIRED_KEY_EXEMPT = new Set([
  'interface/routes/result.routes.js:177',
  // :440 -> :451 when #1082's destination scope check added 11 lines to
  // POST /upload, above POST /'s own legacy-resolution tier.
  'interface/routes/result.routes.js:451',
  // :522 -> :543 when #875's allowlist rework added ~21 lines above the
  // link-sample legacy-resolution tier (the entry itself is #628's
  // deliberate _id -> specimenId -> legacy sampleID fallback; #804 owns
  // sampleID's eventual retirement).
  // :543 -> :599 (#875 era) -> :652 when #1082 added the source scope
  // checks to PUT /:id and link-sample above this site.
  'interface/routes/result.routes.js:652',
  'services/result-specimenid-backfill.service.js:56',
  // #857: _id -> specimenId -> legacy sampleID/sampleId/barcode.
  // :619/:696/:789 -> :683/:760/:853, a uniform +64 shift, when #789 added
  // the shared NON_CANONICAL_SAMPLE_ALIASES constant, the GET query guard
  // and the applied-filter echo above all three sites. The sites themselves
  // are unchanged -- same reason the result.routes.js entry above moved
  // under #875. Line-keyed exemptions are load-bearing bookkeeping: this
  // guard went red on the shift alone, which is the intended behaviour.
  'interface/routes/sample.routes.js:683',
  'interface/routes/sample.routes.js:760',
  'interface/routes/sample.routes.js:853',
  'services/analysisValidation.service.js:29'
]);

function keysIn(text, pattern) {
  const keys = [];
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    keys.push(match[1] || match[2] || match[3]);
  }
  return keys;
}

// Index of the closer matching the opener immediately before
// `content[openIndex]` (i.e. openIndex is the position right after that
// opener), found by depth counting. Same known risk as this file's other
// regexes: an opener/closer inside a string or a regex literal would
// misdirect the count. None of the sites this file matches has one as of
// this writing.
function matchingClose(content, openIndex, openChar, closeChar) {
  let depth = 1;
  for (let i = openIndex; i < content.length; i++) {
    if (content[i] === openChar) depth++;
    else if (content[i] === closeChar) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// `matchingBrace` is `matchingClose` scoped to `{`/`}` — kept as its own
// name because every pre-#854 call site (queryBuilderReturnSites) already
// reads that way. #854's operatorArrayKeys (below) is the first caller that
// also needs `[`/`]` (an operator's array value), hence matchingClose
// underneath rather than a second, parallel depth-counting copy.
function matchingBrace(content, openIndex) {
  return matchingClose(content, openIndex, '{', '}');
}

// #854: `$and`/`$or`/`$nor` combine several filter objects into one array
// value — `{ $or: [{ patientId: x }, { _id: y }] }` is #788's exact shape,
// just wrapped in the operator this codebase actually uses to write a
// multi-criteria filter (five of the six functions the QUERY_BUILDER leg
// below matches return exactly this shape, per #854's own blast-radius
// count). offendersIn already skips the operator key itself (`$or` is not a
// field), but nothing previously descended into the array to read the keys
// nested inside it, so they were never extracted at all. This is that
// descent: each element of the array is checked as a filter object in its
// own right, via the same keyPattern the caller already reads other keys
// with (SPEC_KEY in both of this file's callers), so a nested operator
// inside an operator recurses through this same function.
//
// Only a top-level `{` within the array is treated as an element start —
// `searchFrom`/`i` are both advanced past whatever span was just consumed
// (the whole array, an element's whole brace span) before continuing the
// scan, so a nested operator inside an element is read exactly once, via
// the recursive call on that element's own body, never a second time by
// the outer scan re-matching text already handled one level down.
const OPERATOR_ARRAY = /\$(?:and|or|nor)\s*:\s*\[/g;

function operatorArrayKeys(body, keyPattern) {
  const keys = [];
  let searchFrom = 0;

  for (;;) {
    OPERATOR_ARRAY.lastIndex = searchFrom;
    const opMatch = OPERATOR_ARRAY.exec(body);
    if (!opMatch) break;

    const openBracket = opMatch.index + opMatch[0].length - 1; // the '[' itself
    const closeBracket = matchingClose(body, openBracket + 1, '[', ']');
    if (closeBracket === -1) {
      searchFrom = openBracket + 1;
      continue;
    }

    const arrayBody = body.slice(openBracket + 1, closeBracket);
    let i = 0;
    while (i < arrayBody.length) {
      const braceIndex = arrayBody.indexOf('{', i);
      if (braceIndex === -1) break;
      const elClose = matchingBrace(arrayBody, braceIndex + 1);
      if (elClose === -1) break;

      const elementBody = arrayBody.slice(braceIndex + 1, elClose);
      keys.push(...keysIn(elementBody, keyPattern));
      keys.push(...operatorArrayKeys(elementBody, keyPattern));
      i = elClose + 1;
    }

    searchFrom = closeBracket + 1; // past the whole array
  }

  return keys;
}

// Unlike FILTER_SPEC's call-site literal, a query-builder's `return`ed
// filter routinely nests a value — `{ patientId: { $in: [...] },
// status: 'ACTIVE' }` is #847's actual pre-fix shape — so this cannot stay
// a flat, single-level regex the way FILTER_SPEC does. It still only reads
// *top-level* keys: repeatedly deleting the innermost `{...}`/`[...]` group
// leaves just the outer skeleton, so a nested value's own keys (`$in`
// above) are never read as filter keys.
//
// #854: that deletion loop discards an operator array wholesale, before the
// loop ever gets a chance to look inside via its own `{...}` alternative —
// `[{ patientId: x }, { _id: y }]` has no *nested* `[`/`]`, so the loop's
// `\[[^[\]]*\]` alternative consumes the whole array, elements and all, in
// one step, on the very first pass. A retired/unwritten key nested in a
// `$and`/`$or`/`$nor` array — #788's actual shape — was silently discarded
// rather than read. Recover those from the pristine (pre-strip) body, via
// the same operatorArrayKeys descent the call-site checker uses.
function topLevelKeysOfReturnedObject(body) {
  let skeleton = body;
  let previous;
  do {
    previous = skeleton;
    skeleton = skeleton.replace(/\{[^{}]*\}|\[[^[\]]*\]/, '');
  } while (skeleton !== previous);
  return [...keysIn(skeleton, SPEC_KEY), ...operatorArrayKeys(body, SPEC_KEY)];
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

// #854: the second, narrower pass FILTER_SPEC's own comment refers to —
// finds every `.find(`/`.findOne(` call site FILTER_SPEC's flat-only regex
// cannot match at all because it nests a genuine top-level `$and`/`$or`/
// `$nor` array, and reports it in the same shape a FILTER_SPEC match is
// reported in. A site with *some* nested brace but no operator key at the
// top (a `$gte`/`$lte` range sub-document, say) is deliberately left alone
// here — that stays the "known under-collection risk" FILTER_SPEC's own
// comment already names, not a new hole this issue is closing.
function operatorFilterCallSites(content) {
  const sites = [];

  for (const match of content.matchAll(FILTER_CALL_START)) {
    const openIndex = match.index + match[0].length; // just past the '{'
    const closeIndex = matchingBrace(content, openIndex);
    if (closeIndex === -1) continue;

    const body = content.slice(openIndex, closeIndex);
    if (!body.includes('{')) continue; // flat — FILTER_SPEC above already covers it

    const topKeys = keysIn(body, SPEC_KEY);
    if (!topKeys.some((key) => OPERATOR_KEYS.has(key))) continue; // not this issue's shape

    sites.push({
      start: match.index,
      end: closeIndex + 1,
      keys: [...topKeys, ...operatorArrayKeys(body, SPEC_KEY)],
      raw: content.slice(match.index, closeIndex + 1).replace(/\s+/g, ' ')
    });
  }

  return sites;
}

// #1088: the fifth collector -- a filter literal passed through a helper
// call at the `.find(`/`.findOne(` call site. Reports in the same shape a
// FILTER_SPEC match is reported in, and reuses matchingBrace so the literal's
// true extent is found however deeply it nests, exactly as the #854 pass
// above does.
function helperWrappedFilterSites(content) {
  const sites = [];

  for (const match of content.matchAll(HELPER_WRAPPED_FILTER)) {
    if (NOT_A_FILTER_HELPER.has(match[1])) continue;

    const openIndex = match.index + match[0].length; // just past the '{'
    const closeIndex = matchingBrace(content, openIndex);
    if (closeIndex === -1) continue;

    const body = content.slice(openIndex, closeIndex);
    const topKeys = keysIn(body, SPEC_KEY);
    if (topKeys.length === 0) continue; // `helper({})` carries nothing to check

    sites.push({
      start: match.index,
      end: closeIndex + 1,
      // Blank the LITERAL, not the whole call: the helper's later arguments
      // (a scope object, a field name) are ordinary code and must keep
      // counting toward the written-field vocabulary.
      blankStart: openIndex - 1,
      blankEnd: closeIndex + 1,
      keys: [...topKeys, ...operatorArrayKeys(body, SPEC_KEY)],
      raw: content.slice(match.index, closeIndex + 1).replace(/\s+/g, ' ')
    });
  }

  return sites;
}

// #849: Band A of the bare-identifier gap this file's own header names but
// scopes out — `.find(query)`/`.findOne(filter)` where the argument is a
// pre-built variable rather than a literal. A read-only survey (issue
// #849) found ~67 such call sites in src/ and split them: ~41 are
// statically resolvable within the *same function body* the call sits in,
// in four shapes; the rest need cross-function tracing (a helper mutates
// the object by computed key, a helper's return is passed straight in, or
// a spread of a caller-supplied object) and stay out of scope, same as
// this file's header already declines for the class as a whole. This is
// the resolver for the 41 — deliberately narrow: it never leaves the
// innermost enclosing function, and a variable whose origin isn't one of
// the four shapes is silently Band B, not guessed at and not allowlisted.
//
// The four shapes, and why they collapse to two primitives:
//   1. a plain object literal assigned to the variable (`const q = {...}`);
//   2. that literal (often `{}`) later grown via `q.key = value` member
//      writes;
//   3. a ternary between two object literals, or a `let` + later bare
//      reassignment — mechanically the same "variable = {...}" surface as
//      shape 1, just found via a second branch (ternary) or a second,
//      later match (reassignment) of the identical search;
//   4. an array accumulator `.push()`-ed into, then wrapped as
//      `{ $and: accumulator }` (or `$or`/`$nor`) — reports.routes.js's
//      handleSamplesByPatient (`patientQueryParts`) is this shape in the
//      wild, itself inside a ternary (shape 3), confirming shapes compose
//      rather than needing separate code paths.
// Primitive one: find every real `variable = ...` assignment (shapes 1/3)
// via literalAssignmentsOf. Primitive two: find every `variable.key = ...`
// member write (shape 2) via memberWritesOf. Shape 4 is primitive one
// applied recursively — an operator key whose value is a bare identifier
// (not an inline array, which operatorArrayKeys already reads) is resolved
// one level further, into that identifier's own `.push({...})` sites, via
// pushedObjectsOf.

// A JS identifier can contain `$` (valid, if unusual — jQuery-style names),
// which is a regex metacharacter. Every helper below builds a `RegExp` from
// a variable name pulled out of source text, so it must be escaped first or
// a `$`-containing name would silently corrupt the pattern it's spliced
// into.
function escapeForRegex(name) {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Matches at the point `.find`/`.findOne` is called with a bare identifier
// argument — `.find(query)`, `.findOne(filter)` — rather than an object
// literal at the call site (FILTER_SPEC) or nested in one (FILTER_CALL_START).
const FILTER_CALL_IDENTIFIER = /\.(?:find|findOne)\(\s*([A-Za-z_$][\w$]*)\s*[,)]/g;

// The opening brace of a function-like construct: a `function` declaration
// or expression (named or anonymous, sync or async), an arrow function, or
// a method/class-method shorthand (`name(...) {}`, `get name() {}`) —
// excluding the control-flow keywords (`if`/`for`/`while`/`switch`/`catch`/
// `with`) that share the exact same `keyword (...) {` surface but are not a
// function boundary. Known risk shared with this file's other brace-depth
// regexes: a string/template literal/regex-literal containing one of these
// shapes would misdirect it; none of the sites this file matches has one as
// of this writing.
const FUNCTION_OPEN = new RegExp(
  [
    String.raw`(?:async\s+)?function\b\s*(?:[A-Za-z_$][\w$]*\s*)?\([^)]*\)\s*\{`,
    String.raw`(?:async\s*)?(?:\([^()]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{`,
    String.raw`(?:async\s+)?(?:get\s+|set\s+|static\s+)?(?!if\b|for\b|while\b|switch\b|catch\b|with\b|function\b)\b[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{`
  ].join('|'),
  'g'
);

// Every function-like body in `content`, as `{ bodyStart, bodyEnd }` — the
// indices just inside its braces. Spans nest and overlap freely; picking
// the *innermost* one that contains a given index (enclosingFunctionBody,
// below) is what turns this into a scope lookup.
function functionSpans(content) {
  const spans = [];
  for (const match of content.matchAll(FUNCTION_OPEN)) {
    const bodyStart = match.index + match[0].length;
    const bodyEnd = matchingBrace(content, bodyStart);
    if (bodyEnd === -1) continue;
    spans.push({ bodyStart, bodyEnd });
  }
  return spans;
}

// The innermost function span containing `index` — deliberately spans-only,
// not a real scope tree: an ordinary block (`if`/`for`/`while`/`try`) is not
// a function boundary and is walked straight through, which is exactly what
// lets shape 3's ternary/reassignment branches and shape 2's member writes
// reach across one, the same as real JS scoping would.
function enclosingFunctionBody(spans, index) {
  let best = null;
  for (const span of spans) {
    if (span.bodyStart <= index && index <= span.bodyEnd) {
      if (!best || span.bodyEnd - span.bodyStart < best.bodyEnd - best.bodyStart) best = span;
    }
  }
  return best;
}

// Shapes 1 and 3: every real assignment `name = {...}` in `text` — a plain
// object literal (shape 1), or a ternary between two object literals or a
// bare reassignment (shape 3; a `const`/`let` prefix before `name` is not
// part of the match, so an initial declaration and a later reassignment are
// found the same way). `(?<![.=!<>])` keeps a member write (`obj.name =`)
// from being misread as a declaration of `name`, and keeps `==`/`===`/`<=`/
// `>=`/`!=` from being misread as an assignment. Returns one entry per
// object literal found (two for a matched ternary), each spanning the
// literal itself — including its braces, so blanking it removes it from the
// written-field sweep entirely, the same "can't vouch for its own keys"
// rule this file's other extractors already follow.
function literalAssignmentsOf(name, text) {
  const assignments = [];
  const pattern = new RegExp(`(?<![.=!<>])\\b${escapeForRegex(name)}\\s*=(?!=)\\s*`, 'g');

  for (const match of text.matchAll(pattern)) {
    const i = match.index + match[0].length;
    if (text[i] !== '{') {
      // Shape 3's ternary: `cond ? { ... } : { ... }`. A ternary between
      // anything other than two object literals isn't this shape and is
      // left alone (Band B) — same as any other RHS that isn't `{`.
      // Known risk: a condition itself containing `?` (e.g. optional
      // chaining, `patient?.id ? {...} : {...}`) stops the `[^;{}?]*` scan
      // early and this fails to match at all — under-collection, not a
      // false read.
      const ternary = /^[^;{}?]*\?\s*\{/.exec(text.slice(i));
      if (!ternary) continue;

      const firstOpen = i + ternary[0].length - 1; // the '{' itself
      const firstClose = matchingBrace(text, firstOpen + 1);
      if (firstClose === -1) continue;
      assignments.push({ start: firstOpen, end: firstClose + 1, body: text.slice(firstOpen + 1, firstClose) });

      const afterFirst = /^\s*:\s*\{/.exec(text.slice(firstClose + 1));
      if (!afterFirst) continue;
      const secondOpen = firstClose + 1 + afterFirst[0].length - 1;
      const secondClose = matchingBrace(text, secondOpen + 1);
      if (secondClose === -1) continue;
      assignments.push({ start: secondOpen, end: secondClose + 1, body: text.slice(secondOpen + 1, secondClose) });
      continue;
    }

    const close = matchingBrace(text, i + 1);
    if (close === -1) continue;
    assignments.push({ start: i, end: close + 1, body: text.slice(i + 1, close) });
  }

  return assignments;
}

// Shape 2: `name.key = value` member writes onto the filter variable
// itself (typically after `const name = {}`). Scoped to `name` rather than
// MEMBER_WRITE's blanket sweep, because MEMBER_WRITE exists to build the
// generic *written-field* vocabulary (any `x.field = ...`, anywhere) —
// here the question is narrower: which keys land on *this* filter variable
// specifically. Only the key name is read; the value is not inspected, so
// an operator member write (`query.$or = [...]`) reports the key `$or`
// (filtered out downstream — an operator, not a field) without descending
// into the array value, an accepted under-collection rather than a fifth
// shape this issue didn't authorise.
function memberWritesOf(name, text) {
  const writes = [];
  const pattern = new RegExp(`\\b${escapeForRegex(name)}\\.([A-Za-z_$][\\w$]*)\\s*=[^=]`, 'g');
  for (const match of text.matchAll(pattern)) {
    writes.push({ start: match.index, end: match.index + match[0].length, key: match[1] });
  }
  return writes;
}

// Shape 4's second half: every `accumulator.push({...})` call in `text` —
// see resolveBareIdentifier for how the accumulator name itself is found.
function pushedObjectsOf(name, text) {
  const pushes = [];
  const pattern = new RegExp(`\\b${escapeForRegex(name)}\\.push\\(\\s*\\{`, 'g');
  for (const match of text.matchAll(pattern)) {
    const open = match.index + match[0].length - 1; // the '{' itself
    const close = matchingBrace(text, open + 1);
    if (close === -1) continue;
    pushes.push({ start: match.index, end: close + 1, body: text.slice(open + 1, close) });
  }
  return pushes;
}

// Resolves one bare-identifier `.find`/`.findOne` argument (`name`) using
// `bodyText` — its innermost enclosing function's text, from the start of
// that function up to the call site ("look backwards ... within the same
// function body", #849). Returns `{ keys, blankSpans }`, or `null` if
// `name` has no assignment and no member write anywhere in `bodyText` —
// the caller treats `null` as Band B and skips the call site silently, per
// #849's own scope: no cross-function tracing, no guessing.
function resolveBareIdentifier(name, bodyText) {
  const literals = literalAssignmentsOf(name, bodyText);
  const writes = memberWritesOf(name, bodyText);
  if (literals.length === 0 && writes.length === 0) return null; // Band B

  const keys = [];
  const blankSpans = [];

  for (const literal of literals) {
    blankSpans.push([literal.start, literal.end]);
    keys.push(...keysIn(literal.body, SPEC_KEY));
    keys.push(...operatorArrayKeys(literal.body, SPEC_KEY));

    // Shape 4: an operator key whose value is a bare identifier (not an
    // inline array — operatorArrayKeys just above already covers that
    // case) is the array-accumulator idiom. Resolve it one level further.
    for (const opMatch of literal.body.matchAll(/\$(?:and|or|nor)\s*:\s*([A-Za-z_$][\w$]*)\s*(?:,|$)/g)) {
      for (const pushed of pushedObjectsOf(opMatch[1], bodyText)) {
        blankSpans.push([pushed.start, pushed.end]);
        keys.push(...keysIn(pushed.body, SPEC_KEY));
        keys.push(...operatorArrayKeys(pushed.body, SPEC_KEY));
      }
    }
  }

  for (const write of writes) {
    blankSpans.push([write.start, write.end]);
    keys.push(write.key);
  }

  return { keys, blankSpans };
}

// #849: the call-site pass for Band A of the bare-identifier gap — see the
// block comment above escapeForRegex. Unlike this file's other three site
// producers, this one can legitimately find nothing to report for a given
// call: that is not an error, it is exactly the Band B boundary #849 draws
// (no cross-function tracing), so such a call is simply left out of the
// returned list rather than added with zero keys.
function bareIdentifierFilterSites(content) {
  const spans = functionSpans(content);
  const sites = [];

  for (const match of content.matchAll(FILTER_CALL_IDENTIFIER)) {
    const callStart = match.index;
    const enclosing = enclosingFunctionBody(spans, callStart);
    if (!enclosing) continue; // no enclosing function to search within — Band B

    const bodyText = content.slice(enclosing.bodyStart, callStart);
    const resolved = resolveBareIdentifier(match[1], bodyText);
    if (!resolved) continue; // not one of the four shapes — Band B, skip silently

    const blankSpans = resolved.blankSpans.map(([s, e]) => [enclosing.bodyStart + s, enclosing.bodyStart + e]);
    const sourceSnippets = blankSpans.map(([s, e]) => content.slice(s, e).replace(/\s+/g, ' ')).join('; ');

    sites.push({
      start: callStart,
      end: callStart + match[0].length,
      keys: resolved.keys,
      raw: `${content.slice(callStart, callStart + match[0].length).replace(/\s+/g, ' ')} <- ${sourceSnippets}`,
      blankSpans
    });
  }

  return sites;
}

// #849: comments are not code, and the written-field vocabulary must not
// read them.
//
// OBJECT_KEY sweeps raw source for `key:`, and a `//` or block comment is
// raw source. So any comment containing that shape silently vouches for the
// key — and the comment most likely to contain it is the one *explaining a
// filter key that was removed for never being written*. #917 is the
// measured instance: its own explanatory comments quote
// `` `{ sensorID: { $in: variants } }` `` verbatim in four files, which put
// `sensorID` back into the vocabulary, so re-introducing that exact filter
// branch passed this guard 9/9 green. Confirmed by injecting it and running
// the suite, 2026-09-01. Documenting a bad key immunised it.
//
// **[ran it]** Sweeping src/ both ways: 2944 keys from raw source, 2748
// with comments blanked — **196 keys (6.7%) were vouched for by a comment
// alone**, among them plausible filter names like `targetBoxId`,
// `targetPosition`, `movedAt` and `container`, alongside prose fragments
// (`Regras`, `above`, `way`) that were never field names at all.
//
// Blanking is length-preserving (every character becomes a space, newlines
// kept) because analyze() addresses `stripped` by indices taken from
// `content` — a real deletion would silently misalign every later blank
// span and every reported line number. Strings are handled only enough to
// avoid mistaking a `//` or `/*` inside one for a comment opener; their
// *contents* are still swept, which stays a known under-collection risk of
// the same shape this file's other regexes carry.
function blankComments(source) {
  const out = source.split('');
  let i = 0;
  let quote = null; // "'", '"', '`' while inside a string

  const blank = (from, to) => {
    for (let j = from; j < to && j < out.length; j++) {
      if (out[j] !== '\n') out[j] = ' ';
    }
  };

  while (i < source.length) {
    const ch = source[i];

    if (quote) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; i += 1; continue; }

    if (ch === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? source.length : end;
      blank(i, stop);
      i = stop;
      continue;
    }

    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }

    i += 1;
  }

  return out.join('');
}

// Returns { filterSites, writtenFields } from one pass over a source text.
// The filter specs are blanked out before the write sweep runs, so a
// filter's own keys never end up vouching for themselves.
//
// #849: comments are blanked first, for the same reason and by the same
// rule — see blankComments above. Site detection reads the blanked text
// too, so a commented-out `.findOne({ patientID: x })` is no longer
// reported as a live offender.
function analyze(rawContent) {
  const content = blankComments(rawContent);
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

  // #854: the call-site analogue of the #847 query-builder loop below — a
  // filter combined via $and/$or/$nor is invisible to FILTER_SPEC (it
  // requires zero nested braces), so this is a second pass scoped to
  // exactly that shape. Same "blank it so it can't vouch for its own keys"
  // rule as the other two loops here.
  for (const site of operatorFilterCallSites(content)) {
    filterSites.push({
      line: content.slice(0, site.start).split('\n').length,
      keys: site.keys,
      raw: site.raw
    });
    stripped = stripped.slice(0, site.start) + ' '.repeat(site.end - site.start) + stripped.slice(site.end);
  }

  // #1088: the helper-wrapped call-site pass. Same "blank it so it can't
  // vouch for its own keys" rule as the other loops, aimed at the literal
  // inside the helper call rather than at the whole call.
  for (const site of helperWrappedFilterSites(content)) {
    filterSites.push({
      line: content.slice(0, site.start).split('\n').length,
      keys: site.keys,
      raw: site.raw
    });
    stripped = stripped.slice(0, site.blankStart) + ' '.repeat(site.blankEnd - site.blankStart) + stripped.slice(site.blankEnd);
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

  // #849: Band A of the bare-identifier gap — `.find(query)`/
  // `.findOne(filter)` where the variable's origin is statically
  // resolvable within its own function body (see the block comment above
  // escapeForRegex). The span blanked here is not the call site itself (a
  // bare identifier carries no keys of its own) but the *source*
  // assignment(s)/member write(s) the keys were read from — the same
  // "can't vouch for its own keys" rule, aimed at the actual literal.
  for (const site of bareIdentifierFilterSites(content)) {
    filterSites.push({
      line: content.slice(0, site.start).split('\n').length,
      keys: site.keys,
      raw: site.raw
    });
    for (const [s, e] of site.blankSpans) {
      stripped = stripped.slice(0, s) + ' '.repeat(e - s) + stripped.slice(e);
    }
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

// Keys that are genuinely written nowhere in src/ and are therefore real
// defects -- NOT accepted patterns. Each entry names the open issue that
// carries it, and exists only so this guard can stay green while the
// remedy is decided. Delete the entry when the issue closes; do not add
// one without filing first.
//
// #861 CLOSED, entry removed: ResultWorker now threads its jobID down to
//   processResultRow and writes `importJobID` onto the inserted document,
//   so the key has a real writer and the sweep passes on its own. The
//   remedy chosen was option 1 (write the field) rather than deleting the
//   filter branch, because ResultsPage.tsx builds ?importJobID= from a
//   live "Ver" button -- deleting it would have turned "returns nothing"
//   into #789's silent-ignore for a caller that actually exists.
//
// The set is empty on purpose. An empty set here means every filter key
// in src/ is backed by a writer, which is the state this guard wants; it
// is not a sign the exemption mechanism is unused.
const UNWRITTEN_KEY_EXEMPT = new Set([]);

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
        if (UNWRITTEN_KEY_EXEMPT.has(`${site.file}:${site.line}:${key}`)) continue;
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

test('#854: a key nested inside a $or/$and array is checked, not just the operator itself', () => {
  // #854: the exact shape #788's whole bug class is named after, just
  // wrapped in the operator this codebase actually uses to combine
  // multi-criteria filters — confirmed empirically before this fix by
  // injecting this literal shape into src/services/miabisValidator.service.js
  // at a real .findOne call site: 7/7 green, not flagged, while the same
  // key unnested at the same line already was.

  // Shape 1 (call site): a retired key nested inside $or IS flagged.
  const orNestedRetired = [
    'const doc = { patientId: id, _id: id, biomarkerType: "x" };', // legitimately written, elsewhere
    'const record = await consentsCollection.findOne({ $or: [{ patientId: sample.patientID }, { _id: sample.patientID }] });'
  ].join('\n');

  const offendersA = offendersInSynthetic(orNestedRetired);
  assert.equal(offendersA.length, 1, 'the sweep no longer flags a retired key nested inside a call-site $or array');
  assert.match(offendersA[0], /retired key 'patientId'/);

  // ...and a legitimate key nested the same way is NOT flagged.
  const orNestedLegit = [
    'const doc = { participantId: id, _id: id, biomarkerType: "x" };', // legitimately written, elsewhere
    'const record = await consentsCollection.findOne({ $or: [{ participantId: sample.participantId }, { _id: sample.patientID }] });'
  ].join('\n');

  assert.deepEqual(
    offendersInSynthetic(orNestedLegit),
    [],
    'the sweep flags a legitimate key nested inside a call-site $or array'
  );

  // Shape 2 (query-builder return): the identical hole in
  // topLevelKeysOfReturnedObject — its skeleton-stripping loop deletes an
  // operator array wholesale (no *nested* `[`/`]` inside it, so its own
  // `\[[^[\]]*\]` alternative consumes the whole thing, elements included,
  // in one step) before ever reading what was inside it.
  const returnedOrNestedRetired = [
    'const doc = { patientId: id, _id: id };', // legitimately written, elsewhere
    'function buildIdQuery(rawId) {',
    '  return {',
    '    $or: [',
    '      { _id: rawId },',
    '      { patientId: rawId }',
    '    ]',
    '  };',
    '}',
    'const record = await x.findOne(buildIdQuery(rawId));'
  ].join('\n');

  const offendersC = offendersInSynthetic(returnedOrNestedRetired);
  assert.equal(offendersC.length, 1, 'the sweep no longer flags a retired key nested inside a query-builder-returned $or array');
  assert.match(offendersC[0], /retired key 'patientId'/);

  // ...and the same shape keyed legitimately stays clean.
  const returnedOrNestedLegit = [
    'const doc = { organizationId: id, _id: id };', // legitimately written, elsewhere
    'function buildIdQuery(rawId) {',
    '  return {',
    '    $or: [',
    '      { _id: rawId },',
    '      { organizationId: rawId }',
    '    ]',
    '  };',
    '}',
    'const record = await x.findOne(buildIdQuery(rawId));'
  ].join('\n');

  assert.deepEqual(
    offendersInSynthetic(returnedOrNestedLegit),
    [],
    'the sweep flags a legitimate key nested inside a query-builder-returned $or array'
  );

  // A nested operator inside another operator recurses through the same
  // path rather than stopping one level down.
  const nestedOperators = [
    'const doc = { patientId: id, _id: id, status: "x" };', // legitimately written, elsewhere
    'const record = await x.findOne({ $and: [{ status: "x" }, { $or: [{ patientId: sample.patientID }, { _id: sample.patientID }] }] });'
  ].join('\n');

  const offendersD = offendersInSynthetic(nestedOperators);
  assert.equal(offendersD.length, 1, 'the sweep does not recurse into an operator nested inside another operator');
  assert.match(offendersD[0], /retired key 'patientId'/);
});

test('#849: a .find()/.findOne() filter passed as a pre-built variable is resolved, Band A only', () => {
  // #849: the shape this file's own header names but scopes out — a filter
  // built into a `query`/`filter` variable before being handed to `.find`/
  // `.findOne`, rather than written as (or nested in) an object literal at
  // the call site. A read-only survey found ~41 such sites resolvable
  // within a single function body, in four shapes; each is proven both
  // ways below (a retired key through that shape IS flagged, a legitimate
  // key through the same shape is NOT), plus one proof that a site outside
  // all four shapes is left alone rather than guessed at.

  // Shape 1: `const query = { ... };` — a plain object literal.
  const shape1Retired = [
    'const doc = { patientId: id, biomarkerType: "x" };', // legitimately written, elsewhere
    'async function lookupConsent(id) {',
    '  const query = { patientId: id };',
    '  return consentsCollection.findOne(query);',
    '}'
  ].join('\n');

  const offendersShape1 = offendersInSynthetic(shape1Retired);
  assert.equal(offendersShape1.length, 1, 'the sweep no longer flags a retired key reaching the filter via a plain object-literal variable (shape 1)');
  assert.match(offendersShape1[0], /retired key 'patientId'/);

  const shape1Legit = [
    'const doc = { participantId: id, biomarkerType: "x" };', // legitimately written, elsewhere
    'async function lookupConsent(id) {',
    '  const query = { participantId: id };',
    '  return consentsCollection.findOne(query);',
    '}'
  ].join('\n');

  assert.deepEqual(
    offendersInSynthetic(shape1Legit),
    [],
    'the sweep flags a legitimate key reaching the filter via a plain object-literal variable (shape 1)'
  );

  // Shape 2: `const filter = {};` followed by `filter.key = value;` member
  // writes.
  const shape2Retired = [
    'const doc = { organizationId: id };', // legitimately written, elsewhere
    'async function lookupSensor(id) {',
    '  const filter = {};',
    '  filter.patientId = id;',
    '  return sensorsCollection.findOne(filter);',
    '}'
  ].join('\n');

  const offendersShape2 = offendersInSynthetic(shape2Retired);
  assert.equal(offendersShape2.length, 1, 'the sweep no longer flags a retired key reaching the filter via a member write onto an empty object literal (shape 2)');
  assert.match(offendersShape2[0], /retired key 'patientId'/);

  const shape2Legit = [
    'const doc = { organizationId: id };', // legitimately written, elsewhere
    'async function lookupSensor(id) {',
    '  const filter = {};',
    '  filter.organizationId = id;',
    '  return sensorsCollection.findOne(filter);',
    '}'
  ].join('\n');

  assert.deepEqual(
    offendersInSynthetic(shape2Legit),
    [],
    'the sweep flags a legitimate key reaching the filter via a member write onto an empty object literal (shape 2)'
  );

  // Shape 3, form a: a ternary between two object literals.
  const shape3TernaryRetired = [
    'const doc = { patientId: id, status: "x" };', // legitimately written, elsewhere
    'async function lookupByScope(scoped, id) {',
    '  const query = scoped ? { patientId: id } : {};',
    '  return collection.findOne(query);',
    '}'
  ].join('\n');

  const offendersShape3a = offendersInSynthetic(shape3TernaryRetired);
  assert.equal(offendersShape3a.length, 1, 'the sweep no longer flags a retired key reaching the filter via a ternary between two object literals (shape 3)');
  assert.match(offendersShape3a[0], /retired key 'patientId'/);

  const shape3TernaryLegit = [
    'const doc = { participantId: id, status: "x" };', // legitimately written, elsewhere
    'async function lookupByScope(scoped, id) {',
    '  const query = scoped ? { participantId: id } : {};',
    '  return collection.findOne(query);',
    '}'
  ].join('\n');

  assert.deepEqual(
    offendersInSynthetic(shape3TernaryLegit),
    [],
    'the sweep flags a legitimate key reaching the filter via a ternary between two object literals (shape 3)'
  );

  // Shape 3, form b: `let query = {};` then a later bare reassignment —
  // mechanically the same "variable = {...}" search as shape 1, just
  // matched a second time, which is exactly what this proves.
  const shape3ReassignRetired = [
    'const doc = { patientId: id, status: "x" };', // legitimately written, elsewhere
    'async function lookupReassigned(id) {',
    '  let query = {};',
    '  query = { patientId: id };',
    '  return collection.findOne(query);',
    '}'
  ].join('\n');

  const offendersShape3b = offendersInSynthetic(shape3ReassignRetired);
  assert.equal(offendersShape3b.length, 1, 'the sweep no longer flags a retired key reaching the filter via a let + later reassignment (shape 3)');
  assert.match(offendersShape3b[0], /retired key 'patientId'/);

  const shape3ReassignLegit = [
    'const doc = { participantId: id, status: "x" };', // legitimately written, elsewhere
    'async function lookupReassigned(id) {',
    '  let query = {};',
    '  query = { participantId: id };',
    '  return collection.findOne(query);',
    '}'
  ].join('\n');

  assert.deepEqual(
    offendersInSynthetic(shape3ReassignLegit),
    [],
    'the sweep flags a legitimate key reaching the filter via a let + later reassignment (shape 3)'
  );

  // Shape 4: an array accumulator `.push()`-ed into, then wrapped as
  // `{ $and: accumulator }`. reports.routes.js's handleSamplesByPatient
  // (`patientQueryParts`) is this exact shape in the wild, itself inside a
  // ternary (shape 3) — shapes compose rather than needing separate code
  // paths, which this also exercises indirectly via literalAssignmentsOf.
  const shape4Retired = [
    'const doc = { patientId: id, status: "x" };', // legitimately written, elsewhere
    'async function buildAndFind(id) {',
    '  const parts = [];',
    '  parts.push({ patientId: id });',
    '  parts.push({ status: "ACTIVE" });',
    '  const query = { $and: parts };',
    '  return collection.findOne(query);',
    '}'
  ].join('\n');

  const offendersShape4 = offendersInSynthetic(shape4Retired);
  assert.equal(offendersShape4.length, 1, 'the sweep no longer flags a retired key reaching the filter via a push()-ed array accumulator wrapped in $and (shape 4)');
  assert.match(offendersShape4[0], /retired key 'patientId'/);

  const shape4Legit = [
    'const doc = { participantId: id, status: "x" };', // legitimately written, elsewhere
    'async function buildAndFind(id) {',
    '  const parts = [];',
    '  parts.push({ participantId: id });',
    '  parts.push({ status: "ACTIVE" });',
    '  const query = { $and: parts };',
    '  return collection.findOne(query);',
    '}'
  ].join('\n');

  assert.deepEqual(
    offendersInSynthetic(shape4Legit),
    [],
    'the sweep flags a legitimate key reaching the filter via a push()-ed array accumulator wrapped in $and (shape 4)'
  );

  // Band B, confirmed rather than assumed: a variable whose origin is a
  // helper's return value — cross-function, none of the four shapes — must
  // stay invisible to the whole guard, retired key and all. `fetchFilterFor`
  // is deliberately not named `build...Query`, so #847's QUERY_BUILDER
  // mechanism doesn't also catch it; this isolates #849's own resolver.
  const bandBSkipped = [
    'function fetchFilterFor(id) { return { patientId: id }; }', // retired key inside a helper — cross-function, Band B
    'async function lookupViaHelper(id) {',
    '  const query = fetchFilterFor(id);',
    '  return collection.findOne(query);',
    '}'
  ].join('\n');

  assert.deepEqual(
    offendersInSynthetic(bandBSkipped),
    [],
    'a cross-function origin (Band B) is being resolved (or guessed at) rather than silently skipped'
  );
});

test('#849: a comment does not vouch for a filter key, and a commented-out filter is not an offender', () => {
  // The measured instance (#917): a comment written to explain why a bad
  // filter key was REMOVED quotes that key verbatim, which put it straight
  // back into the written-field vocabulary. So the act of documenting the
  // defect immunised the defect. Sweeping src/ both ways found 196 keys
  // (2944 -> 2748) vouched for by a comment alone.

  // A line comment carrying the key, and nothing else writing it.
  const lineComment = [
    '// #917: was `$or: [{ sensorId }, { neverWrittenByCode: sensorId }]` — removed.',
    'const doc = { sensorId: id };',
    'const found = await sensors.findOne({ neverWrittenByCode: id });'
  ].join('\n');

  const offendersLine = offendersInSynthetic(lineComment);
  assert.equal(offendersLine.length, 1, 'a line comment is still vouching for a filter key');
  assert.match(offendersLine[0], /neverWrittenByCode/);

  // Same for a block comment, including the JSDoc response-example shape
  // this codebase writes a lot of (storage.routes.js et al).
  const blockComment = [
    '/**',
    ' * Response 200:',
    ' * { "neverWrittenByCode": "abc", "ok": true }',
    ' */',
    'const doc = { sensorId: id };',
    'const found = await sensors.findOne({ neverWrittenByCode: id });'
  ].join('\n');

  const offendersBlock = offendersInSynthetic(blockComment);
  assert.equal(offendersBlock.length, 1, 'a block/JSDoc comment is still vouching for a filter key');
  assert.match(offendersBlock[0], /neverWrittenByCode/);

  // A `//` inside a string is not a comment opener — blanking from there
  // would swallow real code to the end of the line, which would silently
  // shrink the vocabulary and make the guard pass more easily. This is the
  // under-collection direction, so it is asserted explicitly.
  const urlInString = [
    'const base = "https://example.test/api"; const doc = { writtenAfterAUrl: 1 };',
    'const found = await things.findOne({ writtenAfterAUrl: 1 });'
  ].join('\n');

  assert.deepEqual(
    offendersInSynthetic(urlInString),
    [],
    'a "//" inside a string literal is being treated as a comment opener, blanking real code after it'
  );

  // The converse: a filter written inside a comment is not live code and
  // must not be reported as an offender.
  const commentedOutFilter = [
    'const doc = { participantId: id };',
    '// const old = await consents.findOne({ patientId: id });',
    'const found = await consents.findOne({ participantId: id });'
  ].join('\n');

  assert.deepEqual(
    offendersInSynthetic(commentedOutFilter),
    [],
    'a commented-out filter is being reported as a live offender'
  );

  // And blanking must be length-preserving: analyze() addresses `stripped`
  // by indices taken from the blanked content, and reports line numbers the
  // same way, so a real deletion would misalign both. Pin the line number.
  const lineNumbering = [
    'const doc = { participantId: id };',
    '/* a block comment',
    '   spanning several lines',
    '   with a { key: value } in it */',
    'const found = await consents.findOne({ neverWrittenByCode: id });'
  ].join('\n');

  const offendersLines = offendersInSynthetic(lineNumbering);
  assert.equal(offendersLines.length, 1);
  assert.match(offendersLines[0], /synthetic\.js:5 /, 'blanking shifted the reported line number');
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

// #1088: the helper-wrapped call site. Two halves, because the shape splits
// in two and only one half is parseable.
//
// HALF ONE -- the helper is handed an object LITERAL. That is this codebase's
// standard scope-filter idiom, and helperWrappedFilterSites reads the keys
// straight out of it. Pinned here on synthetic sources, because as of this
// writing src/ contains ZERO instances: the idiom is what #1053/#1081/#1082
// are actively adding, and the guard is meant to be ready before it lands
// rather than after. A real-source assertion would be vacuous today and would
// silently stay vacuous if the collector broke.
test('#1088: a filter literal wrapped in a helper call is collected, not skipped', () => {
  // The exact shape from #1088's body. Before the fifth collector this was
  // absent from the population entirely -- not exempted, not reported.
  const wrapped = [
    'const doc = { participantId: id };',
    'const found = await samples.findOne(applyOrganizationScopeFilter({ neverWrittenByCode: id }, scope, "collectionSite"));'
  ].join('\n');

  const offenders = offendersInSynthetic(wrapped);
  assert.equal(offenders.length, 1, 'a helper-wrapped filter literal is invisible to the sweep again');
  assert.match(offenders[0], /neverWrittenByCode/);

  // The retired-key tier rides along too -- that is the leg #1082 would have
  // dropped had it implemented its destination check as a scope-filtered
  // query instead of a post-fetch check.
  const retired = [
    'const doc = { participantId: id };',
    'const found = await samples.findOne(applyOrganizationScopeFilter({ patientId: id }, scope, "collectionSite"));'
  ].join('\n');

  const retiredOffenders = offendersInSynthetic(retired);
  assert.equal(retiredOffenders.length, 1, 'a retired key rides invisibly through a helper wrapper');
  assert.match(retiredOffenders[0], /patientId/);

  // And the helper's LATER arguments stay ordinary code: only the literal is
  // blanked, so a field written in a sibling argument still counts as written.
  const onlyLiteralBlanked = [
    'const doc = { collectionSite: site };',
    'const found = await samples.findOne(applyOrganizationScopeFilter({ collectionSite: site }, scope, "collectionSite"));'
  ].join('\n');

  assert.deepEqual(
    offendersInSynthetic(onlyLiteralBlanked),
    [],
    'blanking the whole helper call, rather than just its literal, would strip legitimate written fields'
  );
});

// HALF TWO -- the helper is handed something that is NOT a literal
// (buildParentIdQuery(parentIdField, rawId)). The keys live inside the
// helper's own body, so there is nothing at the call site to parse: this is
// the same Band B unresolvable case FILTER_CALL_IDENTIFIER already scopes
// out, and #1088's direction 2 rather than direction 1.
//
// The point of this test is VISIBILITY, not parsing. #1088's finding was that
// these sites are absent from the population with no "N sites skipped"
// signal anywhere -- the floor test cannot see one dropped site against
// hundreds of slack, and none of its three named anchor files is affected.
// Enumerating them makes a new one a deliberate decision instead of a silent
// absence.
//
// Keyed on file + helper NAME, deliberately not on line numbers: this file's
// line-keyed RETIRED_KEY_EXEMPT entries have needed renumbering twice in a
// single sitting (#875, #1082, #1087), and a churn-prone key trains readers
// to update the entry without re-reading what it asserts.
//
// QUERY_BUILDER reaches two of these helpers by DECLARATION (build*Query), so
// their keys are checked even though the call site is not: buildParentIdQuery
// and buildWorkflowRunQuery. The other three are in no collector's population
// at all, which is what makes this list worth having.
const HELPER_WRAPPED_ANY = /\.(?:find|findOne)\(\s*([A-Za-z_$][\w$]*)\s*\(/g;

test('#1088: every helper-wrapped filter whose argument is unresolvable is enumerated', () => {
  const KNOWN = {
    'controllers/createLinkedFileController.js:buildParentIdQuery': 'keys checked via QUERY_BUILDER',
    'interface/routes/reportTemplates.routes.js:resolveTemplateQuery': 'UNCHECKED -- name does not match build*Query',
    'interface/routes/workflow-run-file-link.routes.js:buildWorkflowRunQuery': 'keys checked via QUERY_BUILDER',
    'services/SampleGraphValidator.js:normalizeSampleIdFilter': 'UNCHECKED -- name does not match build*Query',
    'services/equipment-sensor-quarantine.service.js:buildSensorLookup': 'UNCHECKED -- name does not match build*Query'
  };

  const found = new Set();
  for (const file of walk(BACKEND_SRC)) {
    const content = blankComments(fs.readFileSync(file, 'utf8'));
    for (const match of content.matchAll(HELPER_WRAPPED_ANY)) {
      if (NOT_A_FILTER_HELPER.has(match[1])) continue;
      // A literal first argument is HALF ONE's job, and is already collected.
      const after = content.slice(match.index + match[0].length);
      if (/^\s*\{/.test(after)) continue;
      found.add(relative(file) + ':' + match[1]);
    }
  }

  const unexpected = [...found].filter((key) => !(key in KNOWN)).sort();

  assert.deepEqual(
    unexpected,
    [],
    'A .find()/.findOne() whose filter is built by a helper call is invisible '
      + 'to every collector in this file unless the helper is declared as '
      + 'build<Something>Query. Pass the literal at the call site, rename the '
      + 'helper to build<Something>Query, or add it to KNOWN with a note '
      + 'saying why its keys are safe:\n  ' + unexpected.join('\n  ')
  );

  // And the mirror, which is the half that actually decays: an entry that
  // stops being found is either a helper that moved or a detector that broke,
  // and deleting it would make this guard pass by seeing less. Same discipline
  // request-body-boundary.arch.test.js applies to its own exemptions.
  const missing = Object.keys(KNOWN).filter((key) => !found.has(key)).sort();

  assert.deepEqual(
    missing,
    [],
    'These are enumerated but the sweep no longer finds them. Either the call '
      + 'site moved (update KNOWN) or HELPER_WRAPPED_ANY stopped matching its '
      + 'shape (fix the detector) -- do not just delete the entry:\n  ' + missing.join('\n  ')
  );
});
