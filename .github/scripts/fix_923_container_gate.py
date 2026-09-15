from pathlib import Path

TEST_PATH = Path('api/backend/tests/architecture/mongo-transaction-topology.arch.test.js')
COMPOSE_PATH = Path('compose.test.yml')

TEST_CONTENT = r'''const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// This gate runs directly from the repository checkout and inside
// backend-unit-runner. Keep every #923 assertion active in both contexts.
const backendRoot = path.resolve(__dirname, '../..');
const repoRoot = path.resolve(backendRoot, '../..');
const containerRepoRoot = '/repo-context';

function readRepo(relativePath) {
  const candidates = [
    path.join(repoRoot, relativePath),
    path.join(containerRepoRoot, relativePath),
  ];
  const resolved = candidates.find((candidate) => fs.existsSync(candidate));
  if (!resolved) {
    throw new Error(`Unable to resolve repository file ${relativePath}; tried: ${candidates.join(', ')}`);
  }
  return fs.readFileSync(resolved, 'utf8');
}

function readBackend(relativePath) {
  return fs.readFileSync(path.join(backendRoot, relativePath), 'utf8');
}

for (const file of ['compose.yml', 'compose.prod.yml']) {
  test(`#923 ${file} runs bundled MongoDB as authenticated-capable rs0`, () => {
    const source = readRepo(file);
    assert.match(source, /--replSet["',\s]+rs0/);
    assert.match(source, /--keyFile/);
    assert.match(source, /mongo-keyfile-init:/);
    assert.match(source, /mongo-rs-init:/);
    assert.match(source, /rs\.initiate\(\{ _id: ["']rs0["']/);
    assert.match(source, /isWritablePrimary/);
  });
}

test('#923 test stack remains a replica set as the executable reference topology', () => {
  const source = readRepo('compose.test.yml');
  assert.match(source, /mongodb-test:/);
  assert.match(source, /--replSet["',\s]+rs0/);
  assert.match(source, /mongo-rs-init-test:/);
  assert.match(source, /rs\.initiate/);
});

test('#923 storage custody still refuses a positively identified standalone deployment', () => {
  const service = readBackend('src/services/storageService.js');
  const repository = readBackend('src/infrastructure/persistence/mongo/MongoStorageRepository.js');
  assert.match(service, /isKnownStandaloneDeployment/);
  assert.match(repository, /isKnownStandaloneDeployment/);
  assert.match(service, /Transação Mongo indisponível/);
  assert.match(repository, /Transação Mongo indisponível/);
});
'''

TEST_PATH.write_text(TEST_CONTENT, encoding='utf-8')

compose = COMPOSE_PATH.read_text(encoding='utf-8')
anchor = '      - ./docs:/docs:ro\n    command: ["npm", "run", "current-state:ci"]\n'
replacement = '''      - ./docs:/docs:ro
      # #923: keep repository topology assertions active inside backend-unit-runner.
      - ./compose.yml:/repo-context/compose.yml:ro
      - ./compose.prod.yml:/repo-context/compose.prod.yml:ro
      - ./compose.test.yml:/repo-context/compose.test.yml:ro
    command: ["npm", "run", "current-state:ci"]
'''

if '/repo-context/compose.yml:ro' not in compose:
    if anchor not in compose:
        raise RuntimeError('backend-unit-runner volume anchor not found')
    compose = compose.replace(anchor, replacement, 1)
    COMPOSE_PATH.write_text(compose, encoding='utf-8')
