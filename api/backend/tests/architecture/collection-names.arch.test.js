// node:test-only by contract (README.md Test Strategy -- vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375.
//
// #1327: the result routes, the async result worker, the HL7 audit and the
// result backfill read samples from db.collection('amostras'), and the
// compliance report read consents from db.collection('patient_consents').
// Nothing writes either collection: samples and consents are written through
// getCollection(db, <key>), which resolves collections.js' names ('samples',
// 'patientConsents'). Every read came back empty on a live stack, and the
// unit tests stayed green because their collection mocks were keyed on the
// same wrong name.
//
// The invariant: **a literal db.collection('<name>') in src/ never names a
// retired collection, and never spells a collections.js or model collection
// name differently** (same letters once case and underscores are dropped,
// the 'patient_consents' / 'patientConsents' shape). Such a read goes
// through getCollection(db, <key>) instead.
//
// Known limits: it sees only a string literal passed straight to
// .collection(); a name held in a variable or built at run time is not
// checked. A literal name that is neither canonical nor a twin is not
// checked either: most of those are real collections written by the same
// literal elsewhere.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '../../src');
const { CANONICAL_COLLECTIONS } = require('../../src/config/collections');

// retired collection name -> the collections.js key that replaced it
const RETIRED = {
  amostras: 'samples',
};

const COLLECTION_LITERAL = /\.collection\(\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\1\s*\)/g;
const MODEL_COLLECTION = /collection:\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\1/g;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

const norm = (name) => name.toLowerCase().replace(/_/g, '');

function knownNames() {
  const models = walk(path.join(SRC, 'models')).flatMap((file) =>
    [...fs.readFileSync(file, 'utf8').matchAll(MODEL_COLLECTION)].map((m) => m[2])
  );
  return [...new Set([...Object.values(CANONICAL_COLLECTIONS), ...models])];
}

function findOffenders(files, known) {
  const offenders = [];
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;
      for (const m of line.matchAll(COLLECTION_LITERAL)) {
        const name = m[2];
        const where = `${path.relative(SRC, file).replace(/\\/g, '/')}:${i + 1}`;
        if (RETIRED[name]) {
          offenders.push(`${where} reads retired collection '${name}': use getCollection(db, '${RETIRED[name]}')`);
          continue;
        }
        const twin = known.find((k) => k !== name && norm(k) === norm(name));
        if (twin) offenders.push(`${where} reads '${name}', a misspelling of the collection '${twin}'`);
      }
    });
  }
  return offenders;
}

test('#1327: no literal collection read in src/ names a retired collection or misspells a canonical one', () => {
  const offenders = findOffenders(walk(SRC), knownNames());
  assert.deepEqual(
    offenders,
    [],
    'A read on a collection nothing writes returns nothing, and a mock keyed on the same name hides it. Read through getCollection(db, <key>):\n  ' +
      offenders.join('\n  ')
  );
});

test('#1327: the guard flags both shapes it exists for', () => {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'collection-names-'));
  const file = path.join(dir, 'probe.js');
  fs.writeFileSync(
    file,
    [
      "const a = db.collection('amostras');",
      "const b = this.db.collection('patient_consents');",
      "const c = db.collection('samples');",
      "// db.collection('amostras') in a comment is not a read",
    ].join('\n')
  );
  try {
    const offenders = findOffenders([file], knownNames());
    assert.equal(offenders.length, 2, offenders.join('\n'));
    assert.match(offenders[0], /retired collection 'amostras'/);
    assert.match(offenders[1], /'patient_consents', a misspelling of the collection 'patientConsents'/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
