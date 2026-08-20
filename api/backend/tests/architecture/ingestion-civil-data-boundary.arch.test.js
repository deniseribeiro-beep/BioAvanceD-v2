// node:test-only by contract, same reason as fhir-boundary.arch.test.js —
// see that file's own header before porting to vitest.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const { schemas } = require('../../src/contracts/canonical/v1');

const SRC_ROOT = path.resolve(__dirname, '../../src');

// RF029 AC 9 ("Não persistir dados civis em projeções Neo4j", #669):
// generalizes graphProjection.service.js's existing per-call-site discipline
// (each appendXEvent method is hand-written to omit civil fields) into an
// automated check any future outbox call site is caught by. The forbidden
// list is derived from contracts/canonical/v1's own participantSchema
// (minus participantId, which IS allowed — every appendXEvent payload
// legitimately carries it as the aggregate/correlation id), not a
// hand-maintained duplicate — so it can't silently drift from the canonical
// contract the way two independently-maintained lists could.
const FORBIDDEN_CIVIL_FIELDS = Object.keys(schemas.participantSchema.properties)
  .filter((field) => field !== 'participantId');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'build', 'coverage'].includes(entry.name)) continue;
      walk(full, out);
    } else if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

test('no outbox appendEvent call site writes a civil/identity field into its payload', () => {
  const hits = [];

  for (const file of walk(SRC_ROOT)) {
    const content = fs.readFileSync(file, 'utf8');
    // Scope to files that actually construct an outbox event — scanning
    // every source file for these field names would false-positive on
    // legitimate civil-data code (PatientIdentityService, sample.service.js
    // reads, etc.) that has nothing to do with Neo4j projection.
    if (!content.includes('.appendEvent(')) continue;

    for (const field of FORBIDDEN_CIVIL_FIELDS) {
      // Object-literal key form only (`field: value`) — a shorthand
      // property (`{ field }`) inside a payload block would slip past this,
      // same "textual, not AST-based" limitation fhir-boundary.arch.test.js
      // already accepts for its own forbidden-term scan. No appendXEvent
      // method uses shorthand properties today (see
      // services/graphProjection.service.js); revisit with a real parse if
      // that ever changes.
      const keyPattern = new RegExp(`\\b${field}\\s*:`);
      if (keyPattern.test(content)) {
        hits.push({ file, field });
      }
    }
  }

  assert.deepStrictEqual(hits, []);
});
