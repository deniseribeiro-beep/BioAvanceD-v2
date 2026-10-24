import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const env = require('../../src/config/env');
const { CANONICAL_COLLECTIONS } = require('../../src/config/collections');
const { rewriteEncryptedFields } = require('../../src/scripts/rewriteEncryptedFields');
const { rewriteFileBinaries } = require('../../src/services/fileBinaryRewrite.service');
const { encryptFileBuffer, decryptFileBuffer, computeChecksum } = require('../../src/utils/fileCrypto');
const { createFilesystemObjectStore, ownerSegment } = require('../../src/infrastructure/objectStorage/filesystemObjectStore');
const { createS3ObjectStore } = require('../../src/infrastructure/objectStorage/s3ObjectStore');

const OBJECT_STORAGE_PATH = require.resolve('../../src/infrastructure/objectStorage');
const VERSIONS = CANONICAL_COLLECTIONS.dataFileVersions;

// #1321: stored DataFile binaries are re-encrypted across a real key
// rotation. Rows are seeded by encrypting with the real encryptFileBuffer
// under the old key and putting the ciphertext through the real store, and
// the rotation ends by emptying the previous slot and reading every binary
// with the new key alone.
//
// The fake DB is the one rewriteEncryptedFields.1103.test.js uses.
function getPath(doc, keyPath) {
  return keyPath.split('.').reduce((value, key) => (value == null ? undefined : value[key]), doc);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function matchesCondition(value, cond) {
  if (!isObject(cond) || !Object.keys(cond).some((k) => k.startsWith('$'))) return value === cond;
  return Object.entries(cond).every(([op, arg]) => {
    if (op === '$exists') return (value !== undefined) === arg;
    if (op === '$ne') return value !== arg;
    if (op === '$nin') return !arg.includes(value === undefined ? null : value);
    if (op === '$type') return arg === 'object' && isObject(value);
    throw new Error(`fake: unsupported operator ${op}`);
  });
}

function matches(doc, filter) {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === '$or') return cond.some((sub) => matches(doc, sub));
    return matchesCondition(getPath(doc, key), cond);
  });
}

function createFakeDb() {
  const store = {};
  const collectionOf = (name) => {
    if (!store[name]) {
      const docs = [];
      store[name] = {
        docs,
        collectionName: name,
        async createIndex() { return 'ok'; },
        async createIndexes() { return ['ok']; },
        find(filter = {}) {
          return { toArray: async () => docs.filter((d) => matches(d, filter)).map((d) => structuredClone(d)) };
        },
        async countDocuments(filter = {}) { return docs.filter((d) => matches(d, filter)).length; },
        async updateOne(filter, update) {
          const doc = docs.find((d) => matches(d, filter));
          if (!doc) return { matchedCount: 0, modifiedCount: 0 };
          Object.assign(doc, structuredClone(update.$set));
          return { matchedCount: 1, modifiedCount: 1 };
        },
      };
    }
    return store[name];
  };
  return {
    store,
    collection: collectionOf,
    listCollections() { return { toArray: async () => Object.keys(store).map((name) => ({ name })) }; },
  };
}

const KEY_ENV = ['ENCRYPTION_KEY', 'ENCRYPTION_KEY_ID', 'ENCRYPTION_KEY_PREVIOUS', 'ENCRYPTION_KEY_PREVIOUS_ID'];

function useKeys(active, activeId, previous, previousId) {
  for (const name of KEY_ENV) delete process.env[name];
  if (active) { process.env.ENCRYPTION_KEY = active; process.env.ENCRYPTION_KEY_ID = activeId; }
  if (previous) { process.env.ENCRYPTION_KEY_PREVIOUS = previous; process.env.ENCRYPTION_KEY_PREVIOUS_ID = previousId; }
}

const rotate = () => useKeys('chave-nova', 'key-2026', 'chave-antiga', 'key-2025');

// An in-process fake S3, as in tests/unit/objectStorage/s3ObjectStore.test.js.
function createFakeS3() {
  const objects = new Map();
  const log = [];
  const fake = { objects, log, server: null, endpoint: null };
  fake.server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      log.push({ method: req.method, path: req.url });
      const answer = (status, payload) => {
        res.statusCode = status;
        res.end(payload);
      };
      if (req.method === 'PUT') {
        if (objects.has(req.url) && req.headers['if-none-match'] === '*') return answer(412);
        objects.set(req.url, body);
        return answer(200);
      }
      if (req.method === 'GET') {
        return objects.has(req.url) ? answer(200, objects.get(req.url)) : answer(404);
      }
      return answer(405);
    });
  });
  return fake;
}

async function putEncrypted(store, area, ownerKey, text) {
  const plaintext = Buffer.from(text);
  const encryption = encryptFileBuffer(plaintext);
  const stored = await store.putObject({ area, ownerKey, body: encryption.ciphertext });
  return {
    plaintext,
    stored,
    envelope: {
      checksum: computeChecksum(plaintext),
      encryptionAlgorithm: encryption.algorithm,
      encryptionKeyId: encryption.keyId,
      encryptionIv: encryption.iv,
      encryptionTag: encryption.tag,
    },
  };
}

function fileRow(id, put) {
  return {
    _id: id,
    fileName: `${id}.csv`,
    storagePath: put.stored.path,
    storageUri: put.stored.uri,
    storageObjectVersion: put.stored.version,
    ...put.envelope,
  };
}

// A DataFile row whose latest version row shares its object, plus an older
// version row; returns each row's plaintext by _id.
async function seedReplacedFile(db, store, { collection, id, area }) {
  const older = await putEncrypted(store, area, id, `${id} conteudo v1`);
  const latest = await putEncrypted(store, area, id, `${id} conteudo v2`);
  db.collection(collection).docs.push(fileRow(id, latest));
  db.collection(VERSIONS).docs.push(
    { _id: `${id}-v1`, fileId: id, versionNumber: 1, objectUri: older.stored.uri, ...older.envelope },
    { _id: `${id}-v2`, fileId: id, versionNumber: 2, objectUri: latest.stored.uri, ...latest.envelope },
  );
  return { [id]: latest.plaintext, [`${id}-v1`]: older.plaintext, [`${id}-v2`]: latest.plaintext };
}

async function seedThreeFiles(db, store) {
  return {
    ...(await seedReplacedFile(db, store, { collection: 'sample_files', id: 'sf-1', area: 'samples' })),
    ...(await seedReplacedFile(db, store, { collection: 'assayFiles', id: 'af-1', area: 'assays' })),
    ...(await seedReplacedFile(db, store, { collection: 'datasetFiles', id: 'df-1', area: 'datasets' })),
  };
}

const FILE_COLLECTIONS = ['sample_files', 'assayFiles', 'datasetFiles'];

function allRows(db) {
  return [...FILE_COLLECTIONS, VERSIONS].flatMap((name) => (db.store[name] ? db.store[name].docs : []))
    .map((row) => ({ row, uri: row.storageUri || row.objectUri }));
}

const snapshot = (db) => JSON.stringify(Object.fromEntries(
  Object.entries(db.store).filter(([, c]) => c.docs.length > 0).map(([n, c]) => [n, c.docs]),
));

async function expectRotationCompleted(db, store, plaintexts) {
  const verdict = await rewriteEncryptedFields(db, { objectStore: store });
  expect(verdict.safeToEmptyPreviousSlot).toBe(true);

  // The runbook's last step: the previous slot is emptied, and every binary
  // still reads with the new key alone.
  useKeys('chave-nova', 'key-2026');
  for (const { row, uri } of allRows(db)) {
    expect(row.encryptionKeyId).toBe('key-2026');
    expect(decryptFileBuffer(await store.getObject(uri), row).equals(plaintexts[row._id])).toBe(true);
  }
  for (const id of ['sf-1', 'af-1', 'df-1']) {
    const file = allRows(db).find(({ row }) => row._id === id).row;
    const latest = db.store[VERSIONS].docs.find((row) => row._id === `${id}-v2`);
    expect(latest.objectUri).toBe(file.storageUri);
    expect(file.storageObjectVersion).toBe(`sha256:${file.storageUri.split('/').pop()}`);
  }
}

describe('rewriteFileBinaries (#1321)', () => {
  let savedKeys;
  let root;
  beforeEach(() => {
    savedKeys = Object.fromEntries(KEY_ENV.map((name) => [name, process.env[name]]));
    delete process.env.ALLOW_UNENCRYPTED_FIELD_STORAGE;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'objstore-rewrite-'));
  });
  afterEach(() => {
    for (const name of KEY_ENV) {
      if (savedKeys[name] === undefined) delete process.env[name];
      else process.env[name] = savedKeys[name];
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe('through an S3 store', () => {
    let fake;
    beforeAll(async () => {
      fake = createFakeS3();
      await new Promise((resolve) => fake.server.listen(0, '127.0.0.1', resolve));
      fake.endpoint = `http://127.0.0.1:${fake.server.address().port}`;
    });
    afterAll(async () => {
      await new Promise((resolve) => fake.server.close(resolve));
    });

    it('after a rotation, --apply re-encrypts a sample, assay and dataset file and their version rows held in S3, and the old slot can then be emptied', async () => {
      const store = createS3ObjectStore({ endpoint: fake.endpoint, bucket: 'biobank-files', accessKeyId: 'TESTACCESSKEY', secretAccessKey: 'test-secret' });
      const db = createFakeDb();
      useKeys('chave-antiga', 'key-2025');
      const plaintexts = await seedThreeFiles(db, store);
      const checksums = allRows(db).map(({ row }) => row.checksum);
      rotate();
      const puts = () => fake.log.filter((e) => e.method === 'PUT').length;
      const before = snapshot(db);
      const putsBefore = puts();

      const dryRun = await rewriteEncryptedFields(db, { objectStore: store });
      expect(dryRun.files.sample_files).toMatchObject({ candidates: 1, rewritten: 1, unreadable: 0 });
      expect(dryRun.files[VERSIONS]).toMatchObject({ candidates: 6, rewritten: 6 });
      expect(dryRun.safeToEmptyPreviousSlot).toBe(false);
      expect(snapshot(db)).toBe(before);
      expect(puts()).toBe(putsBefore);

      const applied = await rewriteEncryptedFields(db, { apply: true, objectStore: store });
      for (const name of FILE_COLLECTIONS) {
        expect(applied.files[name]).toMatchObject({ candidates: 1, rewritten: 1, changedMeanwhile: 0 });
      }
      expect(applied.files[VERSIONS]).toMatchObject({ candidates: 6, rewritten: 6 });
      // One new object per stored object: a file row and its latest version
      // row share theirs.
      expect(puts() - putsBefore).toBe(6);
      expect(allRows(db).map(({ row }) => row.checksum)).toEqual(checksums);
      for (const name of FILE_COLLECTIONS) expect(db.store[name].docs[0].storagePath).toBeNull();

      await expectRotationCompleted(db, store, plaintexts);
    });
  });

  it('after a rotation, --apply re-encrypts the binaries held in a filesystem store, with storagePath on the new object', async () => {
    const store = createFilesystemObjectStore({ root });
    const db = createFakeDb();
    useKeys('chave-antiga', 'key-2025');
    const plaintexts = await seedThreeFiles(db, store);
    const oldPath = db.store.sample_files.docs[0].storagePath;
    rotate();

    await rewriteEncryptedFields(db, { apply: true, objectStore: store });

    for (const name of FILE_COLLECTIONS) {
      const row = db.store[name].docs[0];
      const [, area, owner, , hex] = row.storageUri.replace('objstore://', '/').split('/');
      expect(row.storagePath).toBe(path.join(root, area, owner, 'sha256', hex));
      expect(fs.existsSync(row.storagePath)).toBe(true);
    }
    // Write-once: the old ciphertext object is kept.
    expect(fs.existsSync(oldPath)).toBe(true);
    await expectRotationCompleted(db, store, plaintexts);
  });

  it('a row whose plaintext does not match its checksum is counted unreadable and left untouched', async () => {
    const store = createFilesystemObjectStore({ root });
    const db = createFakeDb();
    useKeys('chave-antiga', 'key-2025');
    const put = await putEncrypted(store, 'samples', 'sf-1', 'conteudo');
    db.collection('sample_files').docs.push({ ...fileRow('sf-1', put), checksum: computeChecksum(Buffer.from('outro conteudo')) });
    const stored = structuredClone(db.store.sample_files.docs[0]);
    rotate();

    const files = await rewriteFileBinaries(db, { apply: true, activeKeyId: 'key-2026', objectStore: store });

    expect(files.sample_files).toMatchObject({ candidates: 1, rewritten: 0, unreadable: 1 });
    expect(db.store.sample_files.docs[0]).toEqual(stored);
    expect((await rewriteEncryptedFields(db, { objectStore: store })).safeToEmptyPreviousSlot).toBe(false);
  });

  it('a row under a key no slot holds is counted unreadable and left untouched', async () => {
    const store = createFilesystemObjectStore({ root });
    const db = createFakeDb();
    useKeys('chave-perdida', 'key-2024');
    db.collection('assayFiles').docs.push(fileRow('af-1', await putEncrypted(store, 'assays', 'af-1', 'conteudo')));
    const stored = structuredClone(db.store.assayFiles.docs[0]);
    rotate();

    const files = await rewriteFileBinaries(db, { apply: true, activeKeyId: 'key-2026', objectStore: store });

    expect(files.assayFiles).toMatchObject({ candidates: 1, rewritten: 0, unreadable: 1 });
    expect(db.store.assayFiles.docs[0]).toEqual(stored);
  });

  it('a row whose object is missing is counted objectMissing and left untouched', async () => {
    const store = createFilesystemObjectStore({ root });
    const db = createFakeDb();
    useKeys('chave-antiga', 'key-2025');
    const put = await putEncrypted(store, 'datasets', 'df-1', 'conteudo');
    fs.rmSync(put.stored.path);
    db.collection('datasetFiles').docs.push(fileRow('df-1', put));
    const stored = structuredClone(db.store.datasetFiles.docs[0]);
    rotate();

    const files = await rewriteFileBinaries(db, { apply: true, activeKeyId: 'key-2026', objectStore: store });

    expect(files.datasetFiles).toMatchObject({ candidates: 1, rewritten: 0, objectMissing: 1 });
    expect(db.store.datasetFiles.docs[0]).toEqual(stored);
  });

  it('a legacy row with no object version is counted notInObjectStore and calls no store', async () => {
    const throwing = {
      putObject: () => { throw new Error('putObject called'); },
      getObject: () => { throw new Error('getObject called'); },
    };
    const db = createFakeDb();
    useKeys('chave-antiga', 'key-2025');
    const encryption = encryptFileBuffer(Buffer.from('conteudo'));
    const envelope = { encryptionKeyId: encryption.keyId, encryptionIv: encryption.iv, encryptionTag: encryption.tag };
    db.collection('sample_files').docs.push(
      { _id: 'sf-disk', storagePath: '/uploads/samples/sf-disk.csv', storageUri: 'file:///uploads/samples/sf-disk.csv', ...envelope },
      { _id: 'sf-unversioned', storageUri: `objstore://samples/sf-unversioned/sha256/${'a'.repeat(64)}`, ...envelope },
    );
    db.collection(VERSIONS).docs.push({ _id: 'v-disk', fileId: 'sf-disk', objectUri: '/uploads/samples/sf-disk.csv', ...envelope });
    const before = snapshot(db);
    rotate();

    const files = await rewriteFileBinaries(db, { apply: true, activeKeyId: 'key-2026', objectStore: throwing });

    expect(files.sample_files).toMatchObject({ candidates: 2, notInObjectStore: 2, rewritten: 0 });
    expect(files[VERSIONS]).toMatchObject({ candidates: 1, notInObjectStore: 1, rewritten: 0 });
    expect(snapshot(db)).toBe(before);
  });

  it('a row rewritten between the read and the write is counted changedMeanwhile, not overwritten', async () => {
    const store = createFilesystemObjectStore({ root });
    const db = createFakeDb();
    useKeys('chave-antiga', 'key-2025');
    db.collection('sample_files').docs.push(fileRow('sf-1', await putEncrypted(store, 'samples', 'sf-1', 'conteudo')));
    const oldUri = db.store.sample_files.docs[0].storageUri;
    rotate();
    const wrapped = {
      putObject: (args) => store.putObject(args),
      getObject: async (uri) => {
        const bytes = await store.getObject(uri);
        db.store.sample_files.docs[0].encryptionIv = 'iv-de-outra-escrita';
        return bytes;
      },
    };

    const files = await rewriteFileBinaries(db, { apply: true, activeKeyId: 'key-2026', objectStore: wrapped });

    expect(files.sample_files).toMatchObject({ rewritten: 0, changedMeanwhile: 1 });
    expect(db.store.sample_files.docs[0]).toMatchObject({ encryptionIv: 'iv-de-outra-escrita', encryptionKeyId: 'key-2025', storageUri: oldUri });
  });

  it('an x- owner segment is kept by the re-encrypted object', async () => {
    const store = createFilesystemObjectStore({ root });
    const db = createFakeDb();
    useKeys('chave-antiga', 'key-2025');
    const put = await putEncrypted(store, 'assays', 'Assay 7.b', 'conteudo do ensaio');
    db.collection('assayFiles').docs.push(fileRow('af-7', put));
    const segment = ownerSegment('Assay 7.b');
    expect(put.stored.uri.split('/')[3]).toBe(segment);
    rotate();

    const files = await rewriteFileBinaries(db, { apply: true, activeKeyId: 'key-2026', objectStore: store });

    expect(files.assayFiles).toMatchObject({ rewritten: 1 });
    const row = db.store.assayFiles.docs[0];
    expect(row.storageUri).not.toBe(put.stored.uri);
    expect(row.storageUri.split('/')[3]).toBe(segment);
    useKeys('chave-nova', 'key-2026');
    expect(decryptFileBuffer(await store.getObject(row.storageUri), row).toString()).toBe('conteudo do ensaio');
  });

  describe('with a misconfigured S3 store', () => {
    const S3_KEYS = [
      'OBJECT_STORE_DRIVER',
      'OBJECT_STORE_S3_ENDPOINT',
      'OBJECT_STORE_S3_BUCKET',
      'OBJECT_STORE_S3_ACCESS_KEY_ID',
      'OBJECT_STORE_S3_SECRET_ACCESS_KEY',
    ];
    const original = Object.fromEntries(S3_KEYS.map((key) => [key, env[key]]));
    // getFileObjectStore memoizes a built store, so the case loads a fresh
    // module and leaves a fresh one behind.
    beforeEach(() => {
      delete require.cache[OBJECT_STORAGE_PATH];
    });
    afterEach(() => {
      for (const key of S3_KEYS) env[key] = original[key];
      delete require.cache[OBJECT_STORAGE_PATH];
      require('../../src/infrastructure/objectStorage');
    });

    it('a misconfigured S3 store aborts the run without printing the endpoint or a credential', async () => {
      Object.assign(env, {
        OBJECT_STORE_DRIVER: 's3',
        OBJECT_STORE_S3_ENDPOINT: 'http://AKIDLEAK:SECRETLEAK@127.0.0.1:9/',
        OBJECT_STORE_S3_BUCKET: 'biobank-files',
        OBJECT_STORE_S3_ACCESS_KEY_ID: 'AKIDLEAK',
        OBJECT_STORE_S3_SECRET_ACCESS_KEY: 'SECRETLEAK',
      });
      const db = createFakeDb();
      useKeys('chave-antiga', 'key-2025');
      const encryption = encryptFileBuffer(Buffer.from('conteudo'));
      const hex = 'b'.repeat(64);
      db.collection('sample_files').docs.push({
        _id: 'sf-1',
        storageUri: `objstore://samples/sf-1/sha256/${hex}`,
        storageObjectVersion: `sha256:${hex}`,
        checksum: computeChecksum(Buffer.from('conteudo')),
        encryptionKeyId: encryption.keyId,
        encryptionIv: encryption.iv,
        encryptionTag: encryption.tag,
      });
      rotate();

      const error = await rewriteEncryptedFields(db).catch((e) => e);

      expect(error).toMatchObject({ code: 'OBJECT_STORE_MISCONFIGURED' });
      for (const leak of ['AKIDLEAK', 'SECRETLEAK', '127.0.0.1']) expect(error.message).not.toContain(leak);
    });
  });
});
