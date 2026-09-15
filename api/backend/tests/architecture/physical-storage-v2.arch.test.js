const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { stripComments } = require('./helpers/strip-comments');

const SRC_ROOT = path.resolve(__dirname, '../../src');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return entry.isFile() && /\.(js|cjs|mjs)$/.test(entry.name) ? [fullPath] : [];
  });
}

function source(file) {
  return stripComments(fs.readFileSync(file, 'utf8'));
}

test('physical-storage runtime contains no executable generic legacy facade', () => {
  const banned = [
    /\bStorageAssignment\b/,
    /\bstorageAssignment\b/,
    /\bstorageLocation\b/,
    /\bopenStorageAssignment\b/,
    /\bcloseStorageAssignment\b/,
    /\bfindCurrentStorageAssignment\b/,
    /\bgraphPersisted\b/,
    /STORAGE_ASSIGNMENT_(?:UPSERTED|RELEASED)/
  ];

  const violations = [];
  for (const file of walk(SRC_ROOT)) {
    const content = source(file);
    for (const pattern of banned) {
      if (pattern.test(content)) violations.push(`${path.relative(SRC_ROOT, file)}: ${pattern}`);
    }
  }

  assert.deepStrictEqual(violations, []);
});

test('canonical v2 physical-storage chain remains executable authority', () => {
  const modelFile = path.resolve(SRC_ROOT, 'models/PhysicalStorageV2.js');
  const content = fs.readFileSync(modelFile, 'utf8');
  for (const factory of [
    'specimenContainerAssignment',
    'containerPositionAssignment',
    'storagePosition',
    'storageRack',
    'rackLocationAssignment'
  ]) {
    assert.match(content, new RegExp(`\\b${factory}\\b`));
  }
});

test('storage command path persists projections only through outbox service', () => {
  const repositoryFile = path.resolve(
    SRC_ROOT,
    'infrastructure/persistence/mongo/MongoStorageRepository.js'
  );
  const graphProjectionFile = path.resolve(SRC_ROOT, 'services/graphProjection.service.js');
  const repository = source(repositoryFile);
  const projection = source(graphProjectionFile);

  assert.strictEqual(repository.includes('neo4jDriver'), false);
  assert.strictEqual(repository.includes('driver.session'), false);
  assert.match(repository, /appendSpecimenContainerAssignmentEvent/);
  assert.match(projection, /Neo4jOutboxService/);
  assert.match(projection, /SPECIMEN_CONTAINER_ASSIGNMENT_UPSERTED/);
  assert.match(projection, /SPECIMEN_CONTAINER_ASSIGNMENT_RELEASED/);
});

test('retired location backfill is absent from executable tree', () => {
  assert.strictEqual(
    fs.existsSync(path.resolve(SRC_ROOT, 'services/location-storage-backfill.service.js')),
    false
  );
  assert.strictEqual(
    fs.existsSync(path.resolve(SRC_ROOT, 'scripts/backfillLocationStorage.js')),
    false
  );
});
