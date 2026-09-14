const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

for (const file of ['compose.yml', 'compose.prod.yml']) {
  test(`#923 ${file} runs bundled MongoDB as authenticated-capable rs0`, () => {
    const source = read(file);
    assert.match(source, /--replSet["',\s]+rs0/);
    assert.match(source, /--keyFile/);
    assert.match(source, /mongo-keyfile-init:/);
    assert.match(source, /mongo-rs-init:/);
    assert.match(source, /rs\.initiate\(\{ _id: ["']rs0["']/);
    assert.match(source, /isWritablePrimary/);
  });
}

test('#923 test stack remains a replica set as the executable reference topology', () => {
  const source = read('compose.test.yml');
  assert.match(source, /mongodb-test:/);
  assert.match(source, /--replSet["',\s]+rs0/);
  assert.match(source, /mongo-rs-init-test:/);
  assert.match(source, /rs\.initiate/);
});

test('#923 storage custody still refuses a positively identified standalone deployment', () => {
  const service = read('api/backend/src/services/storageService.js');
  const repository = read('api/backend/src/infrastructure/persistence/mongo/MongoStorageRepository.js');
  assert.match(service, /isKnownStandaloneDeployment/);
  assert.match(repository, /isKnownStandaloneDeployment/);
  assert.match(service, /Transação Mongo indisponível/);
  assert.match(repository, /Transação Mongo indisponível/);
});
