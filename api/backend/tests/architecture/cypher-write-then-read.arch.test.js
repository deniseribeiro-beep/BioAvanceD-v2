// node:test-only by contract (README.md Test Strategy -- vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375.
//
// #1224: LineageRepository.validateBeforePersistence ran `MERGE ... SET ...`
// and went straight into `OPTIONAL MATCH`. Cypher rejects a reading clause
// after an updating clause unless a WITH separates them, so the query was a
// syntax error from 2026-07-02 (ea6c5cc9) on. Every custody lineage check
// threw; fail-open callers logged and carried on, and under production's
// fail-closed it would block every allocation. No unit test could see it:
// every one mocks the driver's session.run, so the query string never
// reaches a parser.
//
// The invariant: in every Cypher template literal under src/, a MATCH or
// OPTIONAL MATCH that follows an updating clause (CREATE, MERGE, SET,
// REMOVE, DELETE) must have a WITH, RETURN, UNION or CALL between them.
// Checked line by line on the literal's clause heads, which is how every
// Cypher literal in src/ is written today.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walk(full, out);
    } else if (/\.js$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const WRITE = /^(CREATE|MERGE|SET|REMOVE|DELETE|DETACH\s+DELETE)\b/i;
const SEPARATOR = /^(WITH|RETURN|UNION|CALL)\b/i;
const READ = /^(OPTIONAL\s+MATCH|MATCH)\b/i;

function findViolations(literal) {
  const violations = [];
  let afterWrite = false;
  for (const raw of literal.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    if (WRITE.test(line)) afterWrite = true;
    else if (SEPARATOR.test(line)) afterWrite = false;
    else if (READ.test(line) && afterWrite) {
      violations.push(line);
      afterWrite = false;
    }
  }
  return violations;
}

test('#1224: the detector flags a read after a write with no WITH, and accepts the WITH form', () => {
  // Control rows, so a detector that silently matches nothing cannot pass.
  assert.deepEqual(
    findViolations('MERGE (s:Sample {id: $id})\nSET s.updatedAt = datetime()\nOPTIONAL MATCH (s)-[:X]->(c)\nRETURN s'),
    ['OPTIONAL MATCH (s)-[:X]->(c)']
  );
  assert.deepEqual(
    findViolations('MERGE (s:Sample {id: $id})\nSET s.updatedAt = datetime()\nWITH s\nOPTIONAL MATCH (s)-[:X]->(c)\nRETURN s'),
    []
  );
  assert.deepEqual(findViolations('MATCH (a)\nMATCH (b)\nRETURN a, b'), []);
});

test('#1224: no Cypher literal in src/ reads after a write without WITH', () => {
  const offenders = [];
  let literalsChecked = 0;
  for (const file of walk(SRC)) {
    const source = fs.readFileSync(file, 'utf8');
    const literal = /`([^`]*)`/g;
    let match;
    while ((match = literal.exec(source))) {
      const body = match[1];
      if (!/\bMATCH\s*\(/i.test(body)) continue;
      literalsChecked++;
      for (const line of findViolations(body)) {
        const lineNo = source.slice(0, match.index).split('\n').length;
        offenders.push(`${path.relative(SRC, file)}:${lineNo}  ${line}`);
      }
    }
  }
  // A scan that finds no Cypher at all is a broken scan, not a clean tree.
  assert.ok(literalsChecked > 0, 'found no Cypher literals under src/ -- the scan is broken');
  assert.deepEqual(offenders, [], `read-after-write without WITH:\n${offenders.join('\n')}`);
});
