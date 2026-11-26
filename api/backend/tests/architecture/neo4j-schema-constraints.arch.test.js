// node:test-only by contract (README.md Test Strategy — vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const { stripComments } = require('./helpers/strip-comments');

// RNF016 C7 (#1555): the Neo4j schema declares a uniqueness constraint per
// canonical label and the indexes its reads filter on. The projector MERGEs
// each node by a key; a MERGE whose label and key no constraint covers would
// let two writers create the same node twice. This reads the declared schema
// file, not a running database.
const BACKEND_ROOT = path.resolve(__dirname, '..', '..');
const SCHEMA_DIR = path.join(BACKEND_ROOT, 'src', 'infrastructure', 'database', 'neo4j', 'schema');
const CONSTRAINTS_FILE = path.join(SCHEMA_DIR, '001_iso20387_constraints_indexes.cypher');
const PROJECTION_FILE = path.join(SCHEMA_DIR, '002_canonical_projection.cypher');
const SRC_DIR = path.join(BACKEND_ROOT, 'src');

const CONSTRAINT = /CREATE CONSTRAINT (\w+) IF NOT EXISTS\s+FOR \((\w+):(\w+)\)\s+REQUIRE (\(([^)]*)\)|\w+\.\w+) IS UNIQUE;/g;
const INDEX = /CREATE INDEX (\w+) IF NOT EXISTS\s+FOR \((\w+):(\w+)\)\s+ON \((\w+)\.(\w+)\);/g;
const MERGE_NODE = /MERGE \((\w*):(\w+)\s*\{([^}]*)\}/g;

function keyList(variable, text) {
    return text.split(',').map((part) => {
        const [v, prop] = part.trim().split('.');
        assert.equal(v, variable, `"${text}" names a variable other than ${variable}`);
        return prop;
    }).sort();
}

function readSchema() {
    const text = fs.readFileSync(CONSTRAINTS_FILE, 'utf8');
    const constraints = [...text.matchAll(CONSTRAINT)].map((m) => ({
        name: m[1],
        label: m[3],
        keys: keyList(m[2], m[5] !== undefined ? m[5] : m[4]),
    }));
    const indexes = [...text.matchAll(INDEX)].map((m) => {
        assert.equal(m[4], m[2], `index ${m[1]} names a variable other than ${m[2]}`);
        return { name: m[1], label: m[3], property: m[5] };
    });
    return { text, constraints, indexes };
}

function sourceFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(full);
        return entry.name.endsWith('.js') ? [full] : [];
    });
}

function mergedNodes() {
    const found = [];
    for (const file of sourceFiles(SRC_DIR)) {
        const text = stripComments(fs.readFileSync(file, 'utf8'));
        for (const m of text.matchAll(MERGE_NODE)) {
            const keys = m[3].split(',').map((pair) => pair.split(':')[0].trim()).filter(Boolean).sort();
            found.push({ file: path.relative(BACKEND_ROOT, file).split(path.sep).join('/'), label: m[2], keys });
        }
    }
    return found;
}

test('RNF016 C7: the Neo4j schema file parses whole: every CREATE CONSTRAINT and CREATE INDEX statement is read, each name once', () => {
    const { text, constraints, indexes } = readSchema();
    assert.equal(constraints.length, (text.match(/CREATE CONSTRAINT/g) || []).length, 'a CREATE CONSTRAINT statement does not parse');
    assert.equal(indexes.length, (text.match(/CREATE INDEX/g) || []).length, 'a CREATE INDEX statement does not parse');
    assert.ok(constraints.length > 0, 'the schema declares no constraint');
    const names = [...constraints, ...indexes].map((s) => s.name);
    assert.deepEqual(names.filter((n, i) => names.indexOf(n) !== i), [], 'a constraint or index name is declared twice');
});

test('RNF016 C7: every label and key the projector MERGEs a node on has a uniqueness constraint declared on that label and key', () => {
    const { constraints } = readSchema();
    const declared = new Set(constraints.map((c) => `${c.label}(${c.keys.join(',')})`));
    const merges = mergedNodes();
    assert.ok(merges.length > 0, 'no MERGE of a node was found under src/');
    const missing = [...new Set(merges
        .map((m) => `${m.label}(${m.keys.join(',')})`)
        .filter((k) => !declared.has(k)))];
    assert.deepEqual(missing, [], `MERGE keys with no uniqueness constraint in ${path.basename(CONSTRAINTS_FILE)}`);
});

test('RNF016 C7: every constraint and index is on a label the canonical projection lists', () => {
    const { constraints, indexes } = readSchema();
    const listed = fs.readFileSync(PROJECTION_FILE, 'utf8');
    const head = /\/\/ Canonical labels used by stage 1:\s*\n((?:\/\/ .*\n)+?)\s*\n/.exec(listed.replace(/\r\n/g, '\n'));
    assert.ok(head, `${path.basename(PROJECTION_FILE)} has no "Canonical labels used by stage 1:" list`);
    const labels = new Set(head[1].replace(/\/\/ /g, '').split(/[,\s]+/).filter(Boolean));
    const strays = [...new Set([...constraints, ...indexes].map((s) => s.label).filter((l) => !labels.has(l)))];
    assert.deepEqual(strays, [], 'labels with a constraint or index that the canonical projection does not list');
});
