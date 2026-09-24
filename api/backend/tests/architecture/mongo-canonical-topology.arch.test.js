'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { stripComments } = require('./helpers/strip-comments');
const { LEGACY_RENAMES } = require('../../src/foundation/mongoTopologyV2');
const {
  getCanonicalCollectionName,
} = require('../../src/config/canonicalEntityCollections.v2');

const SRC_ROOT = path.resolve(__dirname, '../../src');

// Topology migration modules must discover and rename legacy sources.
const ALLOWED_LEGACY_ACCESS = new Set([
  path.join('foundation', 'mongoTopologyV2.js'),
  path.join('foundation', 'userAccountIdentityMigrationV2.js'),
  path.join('foundation', 'mongoIndexLifecycleV2.js'),
]);

const CANONICAL_CORE = Object.freeze({
  UserAccount: getCanonicalCollectionName('UserAccount'),
  Participant: getCanonicalCollectionName('Participant'),
  Specimen: getCanonicalCollectionName('Specimen'),
  Actor: getCanonicalCollectionName('Actor'),
});

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && /\.(?:js|cjs|mjs)$/.test(entry.name) ? [full] : [];
  });
}

function rel(file) {
  return path.relative(SRC_ROOT, file).split(path.sep).join('/');
}

test('Stage 2E forbids runtime db.collection access to legacy topology sources', () => {
  const legacySources = [...new Set(LEGACY_RENAMES.map(({ source }) => source))];
  assert.ok(legacySources.includes('users'));
  assert.ok(legacySources.includes('patients'));

  const violations = [];
  for (const file of walk(SRC_ROOT)) {
    const relative = path.relative(SRC_ROOT, file);
    if (ALLOWED_LEGACY_ACCESS.has(relative)) continue;
    const content = stripComments(fs.readFileSync(file, 'utf8'));
    for (const source of legacySources) {
      const pattern = new RegExp(`\\.collection\\(\\s*['"]${source}['"]\\s*\\)`);
      if (pattern.test(content)) {
        violations.push(`${rel(file)}: db.collection('${source}')`);
      }
    }
  }

  assert.deepEqual(violations, [], `legacy topology residuals:\n${violations.join('\n')}`);
});

test('Stage 2E registry resolves the core Mongo collection names', () => {
  assert.equal(CANONICAL_CORE.UserAccount, 'userAccounts');
  assert.equal(CANONICAL_CORE.Participant, 'participants');
  assert.equal(CANONICAL_CORE.Specimen, 'specimens');
  assert.equal(CANONICAL_CORE.Actor, 'actors');
});

test('Stage 2E auth and bootstrap resolve UserAccount through the registry', () => {
  const critical = [
    'services/auth.service.js',
    'scripts/createFirstAdmin.js',
    'infrastructure/middleware/auth.js',
  ];
  for (const relative of critical) {
    const content = stripComments(fs.readFileSync(path.join(SRC_ROOT, relative), 'utf8'));
    assert.match(
      content,
      /getCanonicalCollectionName\(\s*['"]UserAccount['"]\s*\)/,
      `${relative} must resolve UserAccount via getCanonicalCollectionName`
    );
  }
});
