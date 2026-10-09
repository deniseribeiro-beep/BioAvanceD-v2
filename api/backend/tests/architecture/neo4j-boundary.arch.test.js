// node:test-only by contract (README.md Test Strategy — vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375. History: #138, #148, #182, #375, #393.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const { stripComments } = require('./helpers/strip-comments');

// #945: this guard forbids the literals `patientID`, `sampleID` and
// `mongoSampleId` — which are exactly the legacy aliases the #795/#803/#804/
// #940 family exists to retire. Matching raw text made it impossible to write,
// in the guarded file, the sentence explaining why the alias is not used
// there. Prose is blanked before matching; real identifiers still count.
function read(file) {
    return stripComments(fs.readFileSync(file, 'utf8'));
}

// #1312 (RF023 AC8, RNF019 C8): Neo4j is written only by the projector that
// applies outbox events. A source file that runs Cypher (`.run(`,
// `executeWrite`, `writeTransaction`) and holds a write clause is a direct
// domain write unless listed here with the reason it may stay.
const CYPHER_RUN = /\.run\(|executeWrite|writeTransaction/;
const CYPHER_WRITE = /\b(MERGE|CREATE)\s*\(|\bDETACH\s+DELETE\b|\bDELETE\s+[a-z]|\bSET\s+[a-z]\w*\.\w+\s*=|\bREMOVE\s+[a-z]\w*\./;
const GRAPH_WRITERS = new Map([
    ['src/services/neo4jCanonicalProjection.service.js', 'the projector: applies outbox events, the one sanctioned writer'],
    ['src/infrastructure/database/neo4j/LineageRepository.js', 'known: lineage, allocate and move still MERGE directly, #1312\'s remaining item'],
]);

function sourceFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(full);
        return entry.name.endsWith('.js') ? [full] : [];
    });
}

test('#1312: no source file outside the projector writes Neo4j directly', () => {
    const backendRoot = path.resolve(__dirname, '../..');
    const offenders = sourceFiles(path.join(backendRoot, 'src'))
        .map((file) => path.relative(backendRoot, file).split(path.sep).join('/'))
        .filter((rel) => !GRAPH_WRITERS.has(rel))
        .filter((rel) => {
            const content = read(path.join(backendRoot, rel));
            return CYPHER_RUN.test(content) && CYPHER_WRITE.test(content);
        });
    assert.deepStrictEqual(offenders, [], `direct Neo4j writes outside the projector: ${offenders.join(', ')}`);
});

test('#1312: every listed graph writer still exists and still writes', () => {
    const backendRoot = path.resolve(__dirname, '../..');
    for (const rel of GRAPH_WRITERS.keys()) {
        const content = read(path.join(backendRoot, rel));
        assert.ok(CYPHER_RUN.test(content) && CYPHER_WRITE.test(content), `${rel} no longer writes Neo4j: drop it from GRAPH_WRITERS`);
    }
});

test('avoids direct driver session writes in patient service', () => {
    const file = path.resolve(__dirname, '../../src/services/patient.service.js');
    assert.strictEqual(read(file).includes('neo4jDriver.session'), false);
});

test('uses canonical payload names in neo4j projection', () => {
    const file = path.resolve(__dirname, '../../src/services/neo4jCanonicalProjection.service.js');
    const content = read(file);
    assert.strictEqual(content.includes('patientID'), false);
    assert.strictEqual(content.includes('sampleID'), false);
    assert.strictEqual(content.includes('mongoSampleId'), false);
});
