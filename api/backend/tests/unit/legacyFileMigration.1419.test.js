import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const { CANONICAL_COLLECTIONS } = require('../../src/config/collections');
const { migrateLegacyFileBinaries } = require('../../src/services/legacyFileMigration.service');
const { run } = require('../../src/scripts/migrateLegacyFileBinaries');
const { encryptFileBuffer, decryptFileBuffer, computeChecksum } = require('../../src/utils/fileCrypto');
const { createFilesystemObjectStore, sha256Hex } = require('../../src/infrastructure/objectStorage/filesystemObjectStore');
const { createS3ObjectStore } = require('../../src/infrastructure/objectStorage/s3ObjectStore');

const VERSIONS = CANONICAL_COLLECTIONS.dataFileVersions;

// #1419: legacy DataFile rows, whose ciphertext sits on disk at storagePath,
// are moved into the object store. The ciphertext is seeded with the real
// encryptFileBuffer and read back through the real stores.
//
// The fake DB and fake S3 are the ones fileBinaryRewrite.1321.test.js uses,
// with Mongo's rule that a null condition matches a null or absent field.
function getPath(doc, keyPath) {
  return keyPath.split('.').reduce((value, key) => (value == null ? undefined : value[key]), doc);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function matchesCondition(value, cond) {
  if (cond === null) return value === null || value === undefined;
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
        find(filter = {}) {
          return { toArray: async () => docs.filter((d) => matches(d, filter)).map((d) => structuredClone(d)) };
        },
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

const KEY_ENV = ['ENCRYPTION_KEY', 'ENCRYPTION_KEY_ID', 'ENCRYPTION_KEY_PREVIOUS', 'ENCRYPTION_KEY_PREVIOUS_ID'];

// Whether this OS lets the test create a symlink (Windows without developer
// mode refuses with EPERM).
const canSymlink = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-symlink-probe-'));
  try {
    fs.writeFileSync(path.join(dir, 'target'), 'x');
    fs.symlinkSync(path.join(dir, 'target'), path.join(dir, 'link'));
    return true;
  } catch (error) {
    if (error.code === 'EPERM') return false;
    throw error;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();

const AREAS = { sample_files: ['samples', 'sampleID'], assayFiles: ['assays', 'assayId'], datasetFiles: ['datasets', 'datasetId'] };

// A legacy row as the pre-object-store upload wrote it: the ciphertext on
// disk under dir, a label storageUri and no storageObjectVersion.
function writeLegacy(dir, { collection = 'sample_files', id, owner = `${id}-owner`, text = `${id} conteudo` }) {
  const [area, ownerField] = AREAS[collection];
  const plaintext = Buffer.from(text);
  const encryption = encryptFileBuffer(plaintext);
  const fileName = `${id}.csv`;
  const storagePath = path.join(dir, area, owner, fileName);
  fs.mkdirSync(path.dirname(storagePath), { recursive: true });
  fs.writeFileSync(storagePath, encryption.ciphertext);
  return {
    plaintext,
    ciphertext: encryption.ciphertext,
    row: {
      _id: id,
      [ownerField]: owner,
      fileName,
      storagePath,
      storageUri: `objstore://${area}/${owner}/files/${fileName}`,
      checksum: computeChecksum(plaintext),
      encryptionAlgorithm: encryption.algorithm,
      encryptionKeyId: encryption.keyId,
      encryptionIv: encryption.iv,
      encryptionTag: encryption.tag,
    },
  };
}

function seed(db, collection, legacy) {
  db.collection(collection).docs.push(structuredClone(legacy.row));
  return legacy;
}

describe('migrateLegacyFileBinaries (#1419)', () => {
  let savedKeys;
  let legacyRoot;
  let storeRoot;
  let outside;
  beforeEach(() => {
    savedKeys = Object.fromEntries(KEY_ENV.map((name) => [name, process.env[name]]));
    for (const name of KEY_ENV) delete process.env[name];
    process.env.ENCRYPTION_KEY = 'chave-legado';
    process.env.ENCRYPTION_KEY_ID = 'key-2025';
    legacyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-root-'));
    storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-objstore-'));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-outside-'));
  });
  afterEach(() => {
    for (const name of KEY_ENV) {
      if (savedKeys[name] === undefined) delete process.env[name];
      else process.env[name] = savedKeys[name];
    }
    for (const dir of [legacyRoot, storeRoot, outside]) fs.rmSync(dir, { recursive: true, force: true });
  });

  const migrate = (db, options) => migrateLegacyFileBinaries(db, { roots: [legacyRoot], ...options });

  it('a legacy sample file: the dry run counts it and writes nothing, --apply puts the unchanged ciphertext and points the row at it', async () => {
    const store = createFilesystemObjectStore({ root: storeRoot });
    const db = createFakeDb();
    const legacy = seed(db, 'sample_files', writeLegacy(legacyRoot, { id: 'sf-1', owner: 'sample-1' }));
    const before = structuredClone(db.store.sample_files.docs);

    const dryRun = await migrate(db, { objectStore: store });
    expect(dryRun.sample_files).toEqual({
      candidates: 1, migrated: 1, versionsMigrated: 0, outsideRoots: 0, fileMissing: 0,
      notEncrypted: 0, unreadable: 0, noOwner: 0, changedMeanwhile: 0,
    });
    expect(db.store.sample_files.docs).toEqual(before);
    expect(fs.readdirSync(storeRoot)).toEqual([]);

    const applied = await migrate(db, { apply: true, objectStore: store });
    expect(applied.sample_files).toMatchObject({ candidates: 1, migrated: 1, changedMeanwhile: 0 });

    const row = db.store.sample_files.docs[0];
    const hex = sha256Hex(legacy.ciphertext);
    expect(row.storageUri).toBe(`objstore://samples/sample-1/sha256/${hex}`);
    expect(row.storageObjectVersion).toBe(`sha256:${hex}`);
    expect(row.storagePath).toBe(path.join(storeRoot, 'samples', 'sample-1', 'sha256', hex));
    // Nothing else on the row is set.
    expect({ ...row, storageUri: undefined, storageObjectVersion: undefined, storagePath: undefined })
      .toEqual({ ...before[0], storageUri: undefined, storageObjectVersion: undefined, storagePath: undefined });
    expect(decryptFileBuffer(await store.getObject(row.storageUri), row).equals(legacy.plaintext)).toBe(true);
    // The disk file is kept, byte for byte.
    expect(fs.readFileSync(legacy.row.storagePath).equals(legacy.ciphertext)).toBe(true);

    // A migrated row is no longer a candidate.
    expect((await migrate(db, { apply: true, objectStore: store })).sample_files.candidates).toBe(0);
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

    it('--apply puts the ciphertext into S3, with storagePath null', async () => {
      const store = createS3ObjectStore({ endpoint: fake.endpoint, bucket: 'biobank-files', accessKeyId: 'TESTACCESSKEY', secretAccessKey: 'test-secret' });
      const db = createFakeDb();
      const legacy = seed(db, 'sample_files', writeLegacy(legacyRoot, { id: 'sf-s3', owner: 'sample-s3' }));

      const applied = await migrate(db, { apply: true, objectStore: store });

      expect(applied.sample_files).toMatchObject({ candidates: 1, migrated: 1 });
      const row = db.store.sample_files.docs[0];
      const hex = sha256Hex(legacy.ciphertext);
      expect(row.storageUri).toBe(`objstore://samples/sample-s3/sha256/${hex}`);
      expect(row.storageObjectVersion).toBe(`sha256:${hex}`);
      expect(row.storagePath).toBeNull();
      expect(decryptFileBuffer(await store.getObject(row.storageUri), row).equals(legacy.plaintext)).toBe(true);
      expect(fs.readFileSync(legacy.row.storagePath).equals(legacy.ciphertext)).toBe(true);
    });
  });

  it('an assay file lands under area assays and a dataset file under datasets', async () => {
    const store = createFilesystemObjectStore({ root: storeRoot });
    const db = createFakeDb();
    seed(db, 'assayFiles', writeLegacy(legacyRoot, { collection: 'assayFiles', id: 'af-1', owner: 'assay-1' }));
    seed(db, 'datasetFiles', writeLegacy(legacyRoot, { collection: 'datasetFiles', id: 'df-1', owner: 'dataset-1' }));

    const applied = await migrate(db, { apply: true, objectStore: store });

    expect(applied.assayFiles).toMatchObject({ candidates: 1, migrated: 1 });
    expect(applied.datasetFiles).toMatchObject({ candidates: 1, migrated: 1 });
    expect(applied.sample_files.candidates).toBe(0);
    expect(db.store.assayFiles.docs[0].storageUri).toMatch(/^objstore:\/\/assays\/assay-1\/sha256\/[0-9a-f]{64}$/);
    expect(db.store.datasetFiles.docs[0].storageUri).toMatch(/^objstore:\/\/datasets\/dataset-1\/sha256\/[0-9a-f]{64}$/);
  });

  it('a version row holding the same binary under the same envelope moves with its file row; one under another envelope is left', async () => {
    const store = createFilesystemObjectStore({ root: storeRoot });
    const db = createFakeDb();
    const legacy = seed(db, 'sample_files', writeLegacy(legacyRoot, { id: 'sf-v', owner: 'sample-v' }));
    const { storageUri, encryptionIv } = legacy.row;
    db.collection(VERSIONS).docs.push(
      { _id: 'sf-v-v1', fileId: 'sf-v', versionNumber: 1, objectUri: storageUri, encryptionIv: 'outro-iv' },
      { _id: 'sf-v-v2', fileId: 'sf-v', versionNumber: 2, objectUri: storageUri, encryptionIv },
    );
    const older = structuredClone(db.store[VERSIONS].docs[0]);

    const dryRun = await migrate(db, { objectStore: store });
    expect(dryRun.sample_files).toMatchObject({ migrated: 1, versionsMigrated: 1 });
    expect(db.store[VERSIONS].docs[1].objectUri).toBe(storageUri);

    const applied = await migrate(db, { apply: true, objectStore: store });

    expect(applied.sample_files).toMatchObject({ migrated: 1, versionsMigrated: 1 });
    expect(db.store[VERSIONS].docs[1].objectUri).toBe(db.store.sample_files.docs[0].storageUri);
    expect(db.store[VERSIONS].docs[0]).toEqual(older);
  });

  describe('a run that stops between the writes is finished by a rerun', () => {
    function seedWithVersion(db) {
      const legacy = seed(db, 'sample_files', writeLegacy(legacyRoot, { id: 'sf-stop', owner: 'sample-stop' }));
      db.collection(VERSIONS).docs.push({
        _id: 'sf-stop-v1', fileId: 'sf-stop', versionNumber: 1,
        objectUri: legacy.row.storageUri, encryptionIv: legacy.row.encryptionIv,
      });
      return legacy;
    }

    // The collection's updateOne throws once, as a run that dies there.
    function failOnce(collection) {
      const updateOne = collection.updateOne;
      let failed = false;
      collection.updateOne = async (...args) => {
        if (!failed) {
          failed = true;
          throw new Error('fake: the run stops here');
        }
        return updateOne(...args);
      };
    }

    async function expectFinishedByRerun(db, store) {
      const rerun = await migrate(db, { apply: true, objectStore: store });
      expect(rerun.sample_files).toMatchObject({ candidates: 1, migrated: 1 });
      const file = db.store.sample_files.docs[0];
      expect(file.storageObjectVersion).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(db.store[VERSIONS].docs[0].objectUri).toBe(file.storageUri);
    }

    it('the version row update failing leaves the file row a candidate', async () => {
      const store = createFilesystemObjectStore({ root: storeRoot });
      const db = createFakeDb();
      seedWithVersion(db);
      failOnce(db.store[VERSIONS]);

      await expect(migrate(db, { apply: true, objectStore: store })).rejects.toThrow('the run stops here');
      expect(db.store.sample_files.docs[0].storageObjectVersion).toBeUndefined();

      await expectFinishedByRerun(db, store);
    });

    it('the file row update failing after its version row moved leaves the file row a candidate', async () => {
      const store = createFilesystemObjectStore({ root: storeRoot });
      const db = createFakeDb();
      seedWithVersion(db);
      failOnce(db.store.sample_files);

      await expect(migrate(db, { apply: true, objectStore: store })).rejects.toThrow('the run stops here');
      expect(db.store.sample_files.docs[0].storageObjectVersion).toBeUndefined();

      await expectFinishedByRerun(db, store);
    });

    it('a version row the guard no longer matches leaves the file row unmoved, counted changedMeanwhile', async () => {
      const real = createFilesystemObjectStore({ root: storeRoot });
      const db = createFakeDb();
      seedWithVersion(db);
      const racing = {
        getObject: real.getObject,
        async putObject(args) {
          db.store[VERSIONS].docs[0].encryptionIv = 'iv-novo';
          return real.putObject(args);
        },
      };

      const summary = await migrate(db, { apply: true, objectStore: racing });

      expect(summary.sample_files).toMatchObject({ migrated: 0, versionsMigrated: 0, changedMeanwhile: 1 });
      expect(db.store.sample_files.docs[0].storageObjectVersion).toBeUndefined();
    });
  });

  describe('a row without positive evidence is counted and left untouched', () => {
    async function expectLeft(db, outcome, options = {}) {
      const before = structuredClone(db.store.sample_files.docs);
      const store = options.objectStore || createFilesystemObjectStore({ root: storeRoot });
      const summary = await migrate(db, { apply: true, objectStore: store });
      expect(summary.sample_files).toMatchObject({ candidates: 1, migrated: 0, [outcome]: 1 });
      return { before, summary };
    }

    it('a storagePath outside the roots is outsideRoots', async () => {
      const db = createFakeDb();
      seed(db, 'sample_files', writeLegacy(outside, { id: 'sf-out' }));
      const { before } = await expectLeft(db, 'outsideRoots');
      expect(db.store.sample_files.docs).toEqual(before);
    });

    it.skipIf(!canSymlink)('a symlink inside a root is outsideRoots', async () => {
      const db = createFakeDb();
      const legacy = writeLegacy(legacyRoot, { id: 'sf-link' });
      const link = path.join(legacyRoot, 'link.csv');
      fs.symlinkSync(legacy.row.storagePath, link);
      seed(db, 'sample_files', { ...legacy, row: { ...legacy.row, storagePath: link } });
      const { before } = await expectLeft(db, 'outsideRoots');
      expect(db.store.sample_files.docs).toEqual(before);
    });

    it('a missing file is fileMissing', async () => {
      const db = createFakeDb();
      const legacy = seed(db, 'sample_files', writeLegacy(legacyRoot, { id: 'sf-gone' }));
      fs.rmSync(legacy.row.storagePath);
      const { before } = await expectLeft(db, 'fileMissing');
      expect(db.store.sample_files.docs).toEqual(before);
    });

    it('a row with no envelope is notEncrypted', async () => {
      const db = createFakeDb();
      const legacy = writeLegacy(legacyRoot, { id: 'sf-plain' });
      const { encryptionKeyId, encryptionIv, encryptionTag, ...plain } = legacy.row;
      seed(db, 'sample_files', { ...legacy, row: plain });
      const { before } = await expectLeft(db, 'notEncrypted');
      expect(db.store.sample_files.docs).toEqual(before);
    });

    it('a plaintext that does not match the checksum is unreadable', async () => {
      const db = createFakeDb();
      const legacy = writeLegacy(legacyRoot, { id: 'sf-sum' });
      seed(db, 'sample_files', { ...legacy, row: { ...legacy.row, checksum: computeChecksum(Buffer.from('outro conteudo')) } });
      const { before } = await expectLeft(db, 'unreadable');
      expect(db.store.sample_files.docs).toEqual(before);
      expect(fs.readdirSync(storeRoot)).toEqual([]);
    });

    it('a row the guard no longer matches is changedMeanwhile', async () => {
      const db = createFakeDb();
      seed(db, 'sample_files', writeLegacy(legacyRoot, { id: 'sf-race' }));
      const real = createFilesystemObjectStore({ root: storeRoot });
      // A write lands on the row between its read and its update.
      const racing = {
        getObject: real.getObject,
        async putObject(args) {
          db.store.sample_files.docs[0].encryptionIv = 'iv-novo';
          return real.putObject(args);
        },
      };
      await expectLeft(db, 'changedMeanwhile', { objectStore: racing });
      const row = db.store.sample_files.docs[0];
      expect(row.storageObjectVersion).toBeUndefined();
      expect(row.storageUri).toMatch(/\/files\//);
    });
  });

  it('a row already carrying storageObjectVersion is not a candidate', async () => {
    const db = createFakeDb();
    const legacy = writeLegacy(legacyRoot, { id: 'sf-done' });
    seed(db, 'sample_files', { ...legacy, row: { ...legacy.row, storageObjectVersion: 'sha256:abc' } });
    const before = structuredClone(db.store.sample_files.docs);

    const summary = await migrate(db, { apply: true, objectStore: createFilesystemObjectStore({ root: storeRoot }) });

    expect(summary.sample_files).toMatchObject({ candidates: 0, migrated: 0 });
    expect(db.store.sample_files.docs).toEqual(before);
  });

  describe('the script', () => {
    let savedExitCode;
    beforeEach(() => {
      savedExitCode = process.exitCode;
      process.exitCode = undefined;
      vi.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => {
      process.exitCode = savedExitCode;
      vi.restoreAllMocks();
    });

    it('exits 1 when a fileMissing row is counted, and not otherwise', async () => {
      const objectStore = createFilesystemObjectStore({ root: storeRoot });
      const db = createFakeDb();
      seed(db, 'sample_files', writeLegacy(legacyRoot, { id: 'sf-ok' }));
      await run([], { db, objectStore, roots: [legacyRoot] });
      expect(process.exitCode).toBeUndefined();

      const legacy = seed(db, 'assayFiles', writeLegacy(legacyRoot, { collection: 'assayFiles', id: 'af-gone' }));
      fs.rmSync(legacy.row.storagePath);
      const summaries = await run([], { db, objectStore, roots: [legacyRoot] });
      expect(summaries.assayFiles.fileMissing).toBe(1);
      expect(process.exitCode).toBe(1);
    });
  });
});
