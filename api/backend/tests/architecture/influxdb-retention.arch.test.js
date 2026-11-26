// node:test-only by contract (README.md Test Strategy — vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375.

const { test: nodeTest } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

// RNF016 C7 (#1555): InfluxDB's bucket retention is set where the stack
// creates the bucket, the influxdb image's setup mode in the compose files
// (DOCKER_INFLUXDB_INIT_RETENTION; unset keeps the data forever). The model
// document states the retention the stack applies; this reads both and
// fails when they disagree.
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const BACKEND_ROOT = path.resolve(__dirname, '..', '..');
const MODEL_DOC = path.join(BACKEND_ROOT, 'src', 'infrastructure', 'database', 'influxdb', 'schema', 'telemetry_model_and_retention.md');
const SETUP_COMPOSE_FILES = ['compose.yml', 'compose.prod.yml', 'compose.test.yml'];

const IN_REPO_TREE = fs.existsSync(path.join(REPO_ROOT, 'api', 'backend', 'package.json'));
const test = IN_REPO_TREE
    ? nodeTest
    : (name, fn) => nodeTest(name, { skip: '#1190: repo tree not reachable (expected inside backend-unit-runner)' }, fn);

const DOC_RETENTION = /^- Retenção aplicada pela stack \(`DOCKER_INFLUXDB_INIT_RETENTION`\): `([^`]+)`/m;
const INFINITE = 'infinita';

function envValue(block, name) {
    const m = new RegExp(`^\\s+-?\\s*${name}\\s*[:=]\\s*(.*?)\\s*$`, 'm').exec(block);
    return m ? m[1].replace(/^["']|["']$/g, '') : null;
}

// The block of the InfluxDB service: its key line under services: and every
// line indented deeper than it.
function influxServiceBlocks(text) {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const blocks = [];
    lines.forEach((line, i) => {
        const m = /^( +)(influxdb[\w-]*):\s*$/.exec(line);
        if (!m) return;
        const indent = m[1].length;
        let end = i + 1;
        while (end < lines.length && (lines[end].trim() === '' || /^ */.exec(lines[end])[0].length > indent)) end += 1;
        blocks.push({ name: m[2], text: lines.slice(i + 1, end).join('\n') });
    });
    return blocks;
}

function docRetention() {
    const m = DOC_RETENTION.exec(fs.readFileSync(MODEL_DOC, 'utf8'));
    assert.ok(m, `${path.basename(MODEL_DOC)} states no "Retenção aplicada pela stack" line`);
    return m[1];
}

test('RNF016 C7: each compose file that sets up InfluxDB creates its bucket with the retention the telemetry model document states', () => {
    const stated = docRetention();
    for (const file of SETUP_COMPOSE_FILES) {
        const setups = influxServiceBlocks(fs.readFileSync(path.join(REPO_ROOT, file), 'utf8'))
            .filter((b) => envValue(b.text, 'DOCKER_INFLUXDB_INIT_MODE') === 'setup');
        assert.equal(setups.length, 1, `${file}: expected one InfluxDB service in setup mode, found ${setups.length}`);
        const [setup] = setups;
        assert.ok(envValue(setup.text, 'DOCKER_INFLUXDB_INIT_BUCKET'), `${file}: ${setup.name} creates no bucket`);
        const retention = envValue(setup.text, 'DOCKER_INFLUXDB_INIT_RETENTION');
        assert.equal(retention === null ? INFINITE : retention, stated, `${file}: ${setup.name}'s bucket retention differs from the telemetry model document`);
    }
});

test('RNF016 C7: no compose file sets an InfluxDB retention other than the one the telemetry model document states', () => {
    const stated = docRetention();
    const composeFiles = fs.readdirSync(REPO_ROOT).filter((f) => /^compose(\.[\w-]+)?\.ya?ml$/.test(f));
    assert.ok(composeFiles.length >= SETUP_COMPOSE_FILES.length, 'the compose files were not found at the repo root');
    for (const file of composeFiles) {
        const text = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
        for (const m of text.matchAll(/DOCKER_INFLUXDB_INIT_RETENTION\s*[:=]\s*(.*?)\s*$/gm)) {
            assert.equal(m[1].replace(/^["']|["']$/g, ''), stated, `${file} sets DOCKER_INFLUXDB_INIT_RETENTION to ${m[1]}`);
        }
    }
});
