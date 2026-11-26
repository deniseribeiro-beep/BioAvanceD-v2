// node:test-only by contract (README.md Test Strategy — vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375. History: #138, #148, #182, #375, #393.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const { stripComments } = require('./helpers/strip-comments');

const FILES = [path.resolve(__dirname, '../../src')];

const FORBIDDEN = ['patients_fhir', 'samples_fhir', 'consents_fhir', 'FromLegacy', 'FhirFirst', 'syncAllLegacyData', 'models/fhir', 'models/Observation', 'fhir-sync.service'];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'build', 'coverage', 'docs'].includes(entry.name)) continue;
      walk(full, out);
    } else if (/\.(js|jsx|ts|tsx)$/.test(entry.name) && !full.includes('fhir-boundary.arch.test.js')) {
      out.push(full);
    }
  }
  return out;
}

// The retired FHIR-first stores and sync paths (#138, #375) stay gone.
test('does not contain legacy FHIR persistence references', () => {
  const hits = [];
  for (const root of FILES) {
    for (const file of walk(root)) {
      // #945: prose naming a retired FHIR path is not a reference to it.
      const content = stripComments(fs.readFileSync(file, 'utf8'));
      for (const term of FORBIDDEN) {
        if (content.includes(term)) hits.push({ file, term });
      }
    }
  }
  assert.deepStrictEqual(hits, []);
});

// A regression guard over the store names source code writes as literals,
// not a proof against every way a name could be built. It reads:
// - every key and resolved name of CANONICAL_COLLECTIONS in
//   src/config/collections.js, the registry getCollection(db, key) resolves,
//   and each literal that file gives after `||` or `??` (the source default,
//   read even where an env var overrides it);
// - in each source file, the name argument of model(...) (and its collection
//   argument), discriminator(...), db.collection(...), collection(db, ...),
//   getCollection(db, ...) and createCollection(...); the value of a
//   `collection` or `collectionName` key or assignment (`collection:`,
//   `'collection':`, a default parameter `collectionName = ...`,
//   `this.collectionName = ...`); and the value of a *COLLECTION* constant.
// A name argument or value is a string literal, `<expr> || <literal>` or
// `<expr> ?? <literal>` (its literal is read), or an identifier the same file
// binds to one of those with const, let or var (every literal it is bound to
// anywhere in the file is read). A name built at run time any other way, or
// reached through another file's identifier, is not read.
const COLLECTIONS_REGISTRY = path.resolve(__dirname, '../../src/config/collections.js');
// Named groups, since a numbered back-reference would point at whichever
// group comes first in the pattern it is joined into.
const QUOTED = String.raw`(?<quote>['"\x60])(?<literal>[^'"\x60]+)\k<quote>`;
const FALLBACK = String.raw`(?:[\w$.?]+\s*(?:\|\||\?\?)\s*)?`;
const NAME_ARG = String.raw`${FALLBACK}(?:${QUOTED}|(?<identifier>[A-Za-z_$][\w$]*)\b(?!\s*[.(\[]))`;
const STORE_NAME_PATTERNS = [
  String.raw`\bmodel\(\s*`,
  String.raw`\bmodel\(\s*[^,()]+,\s*[\w.]+\s*,\s*`,
  String.raw`\bdiscriminator\(\s*`,
  String.raw`\.collection\(\s*`,
  String.raw`\b(?:get[Cc]ollection|collection)\(\s*[\w.]+\s*,\s*`,
  String.raw`\bcreateCollection\(\s*`,
  String.raw`(?:\bcollection(?:Name)?|(?<keyQuote>['"])collection(?:Name)?\k<keyQuote>)\s*(?::|=(?![=>]))\s*`,
  String.raw`\b[A-Z_]*COLLECTION[A-Z_]*\s*=(?![=>])\s*`,
].map((prefix) => new RegExp(`(?:${prefix})${NAME_ARG}`, 'g'));
const STRING_BINDING = new RegExp(String.raw`\b(?:const|let|var)\s+(?<bound>[A-Za-z_$][\w$]*)\s*=\s*${FALLBACK}` + QUOTED, 'g');
const REGISTRY_DEFAULT = new RegExp(String.raw`(?:\|\||\?\?)\s*` + QUOTED, 'g');

// The store names one source file declares, as read above.
function storeNamesIn(content) {
  const bound = new Map();
  for (const match of content.matchAll(STRING_BINDING)) {
    const { bound: identifier, literal } = match.groups;
    if (!bound.has(identifier)) bound.set(identifier, new Set());
    bound.get(identifier).add(literal);
  }
  const names = [];
  for (const pattern of STORE_NAME_PATTERNS) {
    for (const match of content.matchAll(pattern)) {
      const { literal, identifier } = match.groups;
      if (literal !== undefined) names.push(literal);
      else if (bound.has(identifier)) names.push(...bound.get(identifier));
    }
  }
  return names;
}

// A FHIR-named store that is not operational data, with its reason.
const FHIR_STORE_ALLOWED = {
  // FHIRProfileRegistry (V2E-0253..0260, RF011 AC2): configuration naming the
  // FHIR profiles an export is validated against, not a FHIR copy of a record.
  fhirProfileRegistries: 'FHIRProfileRegistry configuration rows',
};

// RNF016 C6: FHIR R4 is a serialization boundary; no FHIR collection or sync path persists operational data.
test('names no FHIR model or collection as a store, beyond the profile registry', () => {
  const hits = [];
  const check = (file, name) => {
    if (/fhir/i.test(name) && !Object.hasOwn(FHIR_STORE_ALLOWED, name)) hits.push({ file, name });
  };
  const { CANONICAL_COLLECTIONS } = require(COLLECTIONS_REGISTRY);
  for (const [key, name] of Object.entries(CANONICAL_COLLECTIONS)) {
    check(COLLECTIONS_REGISTRY, key);
    check(COLLECTIONS_REGISTRY, name);
  }
  const registrySource = stripComments(fs.readFileSync(COLLECTIONS_REGISTRY, 'utf8'));
  for (const match of registrySource.matchAll(REGISTRY_DEFAULT)) check(COLLECTIONS_REGISTRY, match.groups.literal);
  for (const root of FILES) {
    for (const file of walk(root)) {
      const content = stripComments(fs.readFileSync(file, 'utf8'));
      for (const name of storeNamesIn(content)) check(file, name);
    }
  }
  assert.deepStrictEqual(hits, []);
});
