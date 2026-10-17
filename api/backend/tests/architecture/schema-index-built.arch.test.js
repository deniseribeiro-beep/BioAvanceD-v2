// node:test-only by contract (README.md Test Strategy — vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375. History: #941, #1039, #1163.
//
// Guards #941's class of defect: an index a Mongoose schema declares that
// nothing ever builds. connection.js connects with autoIndex:false and
// nothing calls createIndexes()/syncIndexes(), so a `schema.index(...)`, a
// field-level `index: true` or a field-level `unique: true` reaches Mongo
// only through a native helper under src/utils/*Indexes.js that issues the
// same key set with createIndex() or buildLookupIndex(). Every declaration
// that exists today has one; this test keeps a new declaration from landing
// without one, and keeps a declared unique constraint from being built as a
// plain lookup index.
//
// It matches the KEY SET and its order, not the index name: the helpers
// version their names (`..._v3`) and the declarations carry none.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');

const backendRoot = path.resolve(__dirname, '..', '..');
const srcDir = path.join(backendRoot, 'src');
const modelsDir = path.join(srcDir, 'models');
const utilsDir = path.join(srcDir, 'utils');

/** Every src/models file that exports a compiled Mongoose model. */
function mongooseModels() {
  const found = [];
  for (const file of fs.readdirSync(modelsDir).sort()) {
    if (!file.endsWith('.js')) continue;
    let exported;
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      exported = require(path.join(modelsDir, file));
    } catch {
      continue;
    }
    if (exported && exported.schema && typeof exported.schema.indexes === 'function') {
      found.push({ file, schema: exported.schema });
    }
  }
  return found;
}

function keySignature(keys) {
  return Object.entries(keys).map(([field, dir]) => `${field}:${dir}`).join(',');
}

/**
 * Every native build in src/utils/*Indexes.js: the key literal handed to
 * createIndex() or buildLookupIndex(), and whether the call's own options
 * say `unique: true`. A key literal holds no nested braces, so `{[^}]*}`
 * captures it whole.
 */
function nativeBuilds() {
  const builds = [];
  const call = /\b(createIndex|buildLookupIndex)\(\s*(?:[A-Za-z_$][\w$]*\s*,\s*)?(\{[^}]*\})([^;]*)/g;
  for (const file of fs.readdirSync(utilsDir).sort()) {
    if (!/Indexes\.js$/.test(file)) continue;
    const source = fs.readFileSync(path.join(utilsDir, file), 'utf8');
    for (const match of source.matchAll(call)) {
      const keys = {};
      for (const pair of match[2].slice(1, -1).split(',')) {
        const kv = pair.match(/^\s*['"]?([\w.$]+)['"]?\s*:\s*(-?1)\s*$/);
        if (kv) keys[kv[1]] = Number(kv[2]);
      }
      if (Object.keys(keys).length === 0) continue;
      builds.push({
        file,
        signature: keySignature(keys),
        unique: match[1] === 'createIndex' && /\bunique\s*:\s*true\b/.test(match[3]),
      });
    }
  }
  return builds;
}

/** Declared indexes with no native build of the same keys (and uniqueness). */
function unbuilt(models, builds) {
  const missing = [];
  for (const { file, schema } of models) {
    for (const [keys, options] of schema.indexes()) {
      const signature = keySignature(keys);
      const wantUnique = Boolean(options && options.unique);
      const match = builds.find((b) => b.signature === signature && (!wantUnique || b.unique));
      if (!match) {
        missing.push(`${file}: {${signature}}${wantUnique ? ' unique' : ''}`);
      }
    }
  }
  return missing;
}

test('the native-build scan finds the helpers it guards', () => {
  const builds = nativeBuilds();
  // Guards the vacuous-green case: a regex that stopped matching would make
  // every declaration below read as missing, and one that matched nothing
  // AND a model scan that found nothing would read as green.
  assert.ok(builds.length >= 11, `expected at least 11 native index builds, found ${builds.length}`);
  assert.ok(
    builds.some((b) => b.signature === 'containerID:1' && b.unique),
    'expected storageIndexes.js to build the unique containerID index',
  );
});

test('a declaration with no native build is reported (control row)', () => {
  const fake = { indexes: () => [[{ notBuiltAnywhere: 1 }, {}], [{ organizationId: 1 }, { unique: true }]] };
  const missing = unbuilt([{ file: 'Fake.js', schema: fake }], nativeBuilds());
  // {organizationId:1} IS built (physicalChainIndexes.js) but only as a
  // non-unique index, so declaring it unique must still be reported.
  assert.deepEqual(missing, ['Fake.js: {notBuiltAnywhere:1}', 'Fake.js: {organizationId:1} unique']);
});

test('every index a Mongoose schema declares is built natively (#941)', () => {
  const models = mongooseModels();
  assert.ok(models.length >= 10, `expected at least 10 Mongoose models, found ${models.length}`);

  const missing = unbuilt(models, nativeBuilds());
  assert.deepEqual(
    missing,
    [],
    'mongoose runs with autoIndex:false, so these declarations are never '
      + 'built. Add the same key set to a src/utils/*Indexes.js helper (unique '
      + 'where declared unique) and wire it where the collection is read or '
      + `written, or remove the declaration. Unbuilt:\n  ${missing.join('\n  ')}`,
  );
});
