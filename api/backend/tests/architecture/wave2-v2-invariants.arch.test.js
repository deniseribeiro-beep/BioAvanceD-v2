'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const SRC_ROOT = path.resolve(__dirname, '../../src');

function walk(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(full));
    else if (/\.(?:js|cjs|mjs)$/.test(entry.name)) result.push(full);
  }
  return result;
}

function rel(file) {
  return path.relative(SRC_ROOT, file).split(path.sep).join('/');
}

function sourceFiles() {
  return walk(SRC_ROOT).map((file) => ({ file, relative: rel(file), source: fs.readFileSync(file, 'utf8') }));
}

function violationsFor(pattern, predicate = () => true) {
  return sourceFiles()
    .filter(({ relative, source }) => predicate(relative, source) && pattern.test(source))
    .map(({ relative }) => relative);
}

test('Wave 2 forbids canonical/v1 consumers', () => {
  const offenders = violationsFor(/contracts\/canonical\/v1|canonical\.v1\./);
  assert.deepEqual(offenders, [], `canonical/v1 residual consumers: ${offenders.join(', ')}`);
});

test('Wave 2 forbids legacy physical StorageAssignment persistence', () => {
  const offenders = violationsFor(/collection\(['"]storageAssignments['"]\)|StorageAssignmentModel|MongoStorageRepositoryLegacy/);
  assert.deepEqual(offenders, [], `legacy storage residuals: ${offenders.join(', ')}`);
});

test('Wave 2 forbids embedded Sample.storageLocation writes', () => {
  const offenders = sourceFiles()
    .filter(({ source }) => (
      /\$set\s*:\s*\{[^}]*storageLocation\s*:/s.test(source)
      || /['"]storageLocation\.[^'"]+['"]\s*:/s.test(source)
    ))
    .map(({ relative }) => relative);
  assert.deepEqual(offenders, [], `embedded storageLocation writers: ${offenders.join(', ')}`);
});

test('Wave 2 uses parentSpecimenIds as the lineage authority', () => {
  const offenders = violationsFor(/parentSampleId/);
  assert.deepEqual(offenders, [], `legacy parentSampleId residuals: ${offenders.join(', ')}`);
});

test('Wave 2 never uses COMPROMISED as a specimenStatus value', () => {
  const offenders = sourceFiles()
    .filter(({ source }) => /specimenStatus[\s\S]{0,80}['"]COMPROMISED['"]|['"]COMPROMISED['"][\s\S]{0,80}specimenStatus/.test(source))
    .map(({ relative }) => relative);
  assert.deepEqual(offenders, [], `COMPROMISED specimenStatus residuals: ${offenders.join(', ')}`);
});

test('Wave 2 has no legacy Neo4j lineage compatibility adapter', () => {
  const legacyAdapterPath = path.join(SRC_ROOT, 'infrastructure/database/neo4j/LineageRepository.js');
  assert.equal(fs.existsSync(legacyAdapterPath), false, 'legacy LineageRepository.js must be physically removed');
  const executablePattern = /(?:const|let|var)\s+LineageRepository\s*=\s*require\s*\(\s*['"][^'"]*database\/neo4j\/LineageRepository['"]\s*\)|new\s+LineageRepository\s*\(/;
  const offenders = sourceFiles()
    .filter(({ source }) => {
      const withoutComments = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      return executablePattern.test(withoutComments);
    })
    .map(({ relative }) => relative);
  assert.deepEqual(offenders, [], `legacy lineage adapter consumers: ${offenders.join(', ')}`);
});

test('RF023 domain Neo4j writes are confined to projection/rebuild boundary', () => {
  const allow = [
    /^services\/neo4jCanonicalProjection(?:V2)?\.service\.js$/,
    /^services\/neo4jCanonicalProjection\.service\.js$/,
    /^infrastructure\/database\/neo4j\/connection\.js$/,
    /^workers\/neo4jProjection\.worker\.js$/,
    /^scripts\/testEnvironment\.js$/, // administrative test reset only
    /rebuild/i,
    /migration/i,
    /admin/i,
  ];
  const offenders = sourceFiles()
    .filter(({ relative, source }) => {
      if (allow.some((rule) => rule.test(relative))) return false;
      return /\.run\s*\(\s*[`'"][\s\S]{0,250}\b(?:MERGE|CREATE|DELETE|SET)\b/i.test(source);
    })
    .map(({ relative }) => relative);
  assert.deepEqual(offenders, [], `direct Neo4j domain writers: ${offenders.join(', ')}`);
});

test('Wave 2 normalized consent authority exposes all approved entities and decisions', () => {
  const repositoryPath = path.join(SRC_ROOT, 'infrastructure/persistence/mongo/ConsentGovernanceV2Repository.js');
  assert.equal(fs.existsSync(repositoryPath), true, 'ConsentGovernanceV2Repository.js is required');
  const source = fs.readFileSync(repositoryPath, 'utf8');
  for (const token of [
    'consentPermissions',
    'consentDecisionEvents',
    'consentRevocations',
    'consentAuthorizationDecisions',
    'consentCommunicationEvents',
    "'permit'",
    "'deny'",
    "'review_required'"
  ]) {
    assert.equal(source.includes(token), true, `Consent v2 repository missing ${token}`);
  }
});

test('Wave 2 physical storage authority exposes normalized assignment chain', () => {
  const storePath = path.join(SRC_ROOT, 'infrastructure/persistence/mongo/NormalizedPhysicalStorageStore.js');
  assert.equal(fs.existsSync(storePath), true, 'NormalizedPhysicalStorageStore.js is required');
  const source = fs.readFileSync(storePath, 'utf8');
  for (const token of [
    'specimenContainerAssignments',
    'containerPositionAssignments',
    'rackLocationAssignments',
    'storagePositions',
    'storageRacks'
  ]) {
    assert.equal(source.includes(token), true, `physical storage v2 store missing ${token}`);
  }
});

test('Wave 2 telemetry summary is both persisted and projected', () => {
  const monitor = fs.readFileSync(path.join(SRC_ROOT, 'infrastructure/services/TelemetryMonitor.js'), 'utf8');
  const projector = fs.readFileSync(path.join(SRC_ROOT, 'services/neo4jCanonicalProjectionV2.service.js'), 'utf8');
  assert.match(monitor, /telemetryExposureSummaries/);
  assert.match(projector, /TELEMETRY_EXPOSURE_SUMMARIZED/);
});
