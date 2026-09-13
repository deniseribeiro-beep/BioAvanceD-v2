// node:test-only by contract (README.md Test Strategy — vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375. History: #1039, #941, #1027.
//
// Guards the class of defect behind #1039: a Mongoose schema that declares
// the same key BOTH field-level (`index: true`) and again through
// `schema.index({ key: 1 }, { unique: true })`. Mongoose does not dedupe
// those — it emits both specs, unnamed, so both receive the SAME
// auto-generated name (`<field>_<direction>`) with DIFFERENT options. That
// is exactly the IndexKeySpecsConflict (86) shape #1027 measured against
// mongo:7, where it aborted create-db.js on its first collection.
//
// It is latent today only because connection.js connects with
// autoIndex:false and nothing calls createIndexes/syncIndexes. It becomes
// live the moment #941's direction is taken — and mongoose only *warns*
// about it at model-compile time, which nothing in this suite reads.
//
// #1039 measured this over all 86 files in src/models: 14 export a Mongoose
// model, and exactly one (SensorMetadata) carried the double declaration.
// The other 72 are native-driver collections with no schema to check.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');

const backendRoot = path.resolve(__dirname, '..', '..');
const modelsDir = path.join(backendRoot, 'src', 'models');

/**
 * Mongoose's own default index name: each key joined as `<field>_<direction>`.
 * An explicit `name` in the options wins, which is the sanctioned way to
 * declare two indexes over one key.
 */
function indexName(keys, options) {
  if (options && typeof options.name === 'string' && options.name.length > 0) {
    return options.name;
  }
  return Object.entries(keys)
    .map(([field, direction]) => `${field}_${direction}`)
    .join('_');
}

/** Every src/models file that actually exports a compiled Mongoose model. */
function mongooseModels() {
  const found = [];

  for (const file of fs.readdirSync(modelsDir).sort()) {
    if (!file.endsWith('.js')) continue;

    let exported;
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      exported = require(path.join(modelsDir, file));
    } catch {
      // A model that cannot be required standalone is out of scope here;
      // other suites cover loadability.
      continue;
    }

    if (exported && exported.schema && typeof exported.schema.indexes === 'function') {
      found.push({ file, schema: exported.schema });
    }
  }

  return found;
}

test('src/models exposes Mongoose models to check', () => {
  const models = mongooseModels();

  // Guards the vacuous-green case: if the require loop silently stopped
  // finding models, every assertion below would pass over an empty list.
  assert.ok(
    models.length >= 10,
    `expected at least 10 Mongoose models under src/models, found ${models.length}`,
  );
});

test('no Mongoose schema declares one index name twice (#1039)', () => {
  const offenders = [];

  for (const { file, schema } of mongooseModels()) {
    const names = schema.indexes().map(([keys, options]) => indexName(keys, options));
    const duplicated = [...new Set(names.filter((name, i) => names.indexOf(name) !== i))];

    if (duplicated.length > 0) {
      offenders.push(`${file}: ${duplicated.join(', ')} (all specs: ${names.join(', ')})`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'A key declared both field-level (index: true) and via schema.index() '
      + 'produces two specs sharing one auto-generated name with different '
      + 'options — Model.createIndexes() then throws IndexKeySpecsConflict. '
      + 'Remove the field-level `index: true`, or give one spec an explicit '
      + `name. Offenders:\n  ${offenders.join('\n  ')}`,
  );
});
