import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { createS3ObjectStore } = require('../../../src/infrastructure/objectStorage/s3ObjectStore');
const { signRequest } = require('../../../src/infrastructure/objectStorage/awsSigV4');
const { createFilesystemObjectStore, ownerSegment } = require('../../../src/infrastructure/objectStorage/filesystemObjectStore');

const sha256Hex = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

const BUCKET = 'biobank-files';
const ACCESS_KEY_ID = 'TESTACCESSKEY';
const SECRET = 'test-secret-key-never-logged';

// An in-process fake S3: path-style objects in a Map, every request logged.
function createFakeS3() {
  const objects = new Map();
  const log = [];
  const fake = { objects, log, failWith: null, server: null, endpoint: null };

  fake.server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const entry = { method: req.method, path: req.url, headers: req.headers, body };
      log.push(entry);
      const answer = (status, payload) => {
        entry.status = status;
        res.statusCode = status;
        res.end(payload);
      };
      if (fake.failWith) return answer(fake.failWith);
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

describe('createS3ObjectStore (RF007 AC2, RNF016 C4)', () => {
  let fake;
  let store;

  beforeAll(async () => {
    fake = createFakeS3();
    await new Promise((resolve) => fake.server.listen(0, '127.0.0.1', resolve));
    fake.endpoint = `http://127.0.0.1:${fake.server.address().port}`;
  });
  afterAll(async () => {
    await new Promise((resolve) => fake.server.close(resolve));
  });
  beforeEach(() => {
    store = createS3ObjectStore({
      endpoint: `${fake.endpoint}/`,
      bucket: BUCKET,
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET
    });
  });
  afterEach(() => {
    fake.objects.clear();
    fake.log.length = 0;
    fake.failWith = null;
  });

  const keyPath = (area, owner, hex) => `/${BUCKET}/${area}/${owner}/sha256/${hex}`;
  const putsAnswered200 = (pathname) => fake.log.filter((e) => e.method === 'PUT' && e.path === pathname && e.status === 200);

  it('exposes only putObject and getObject: no delete and no overwrite', () => {
    expect(Object.keys(store).sort()).toEqual(['getObject', 'putObject']);
  });

  it('puts the body at its path-style key with If-None-Match, its payload hash and a SigV4 authorization', async () => {
    const body = Buffer.from('ciphertext bytes');
    const hex = sha256Hex(body);
    const dated = createS3ObjectStore({
      endpoint: fake.endpoint,
      bucket: BUCKET,
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET,
      now: () => new Date('2026-10-23T23:59:59Z')
    });

    const stored = await dated.putObject({ area: 'samples', ownerKey: 'owner-1', body });

    expect(stored).toEqual({ uri: `objstore://samples/owner-1/sha256/${hex}`, version: `sha256:${hex}`, path: null });
    expect(fake.objects.get(keyPath('samples', 'owner-1', hex)).equals(body)).toBe(true);
    const [put] = fake.log;
    expect(put.method).toBe('PUT');
    expect(put.headers['if-none-match']).toBe('*');
    expect(put.headers['x-amz-date']).toBe('20261023T235959Z');
    expect(put.headers['x-amz-content-sha256']).toBe(sha256Hex(put.body));
    expect(put.headers.authorization.startsWith(
      `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY_ID}/20261023/us-east-1/s3/aws4_request`
    )).toBe(true);
  });

  it('getObject returns the stored bytes for the uri putObject returned', async () => {
    const body = Buffer.from('round trip');
    const { uri } = await store.putObject({ area: 'samples', ownerKey: 'o', body });

    const read = await store.getObject(uri);

    expect(Buffer.isBuffer(read)).toBe(true);
    expect(read.equals(body)).toBe(true);
  });

  it('reuses the existing object for a second put of the same bytes without writing it again', async () => {
    const body = Buffer.from('same bytes');

    const first = await store.putObject({ area: 'samples', ownerKey: 'o', body });
    const second = await store.putObject({ area: 'samples', ownerKey: 'o', body });

    expect(second).toEqual(first);
    expect(putsAnswered200(keyPath('samples', 'o', sha256Hex(body)))).toHaveLength(1);
  });

  it('refuses a put whose key holds other bytes and leaves them unchanged', async () => {
    const body = Buffer.from('new bytes');
    const seededPath = keyPath('samples', 'o', sha256Hex(body));
    fake.objects.set(seededPath, Buffer.from('other bytes'));

    await expect(store.putObject({ area: 'samples', ownerKey: 'o', body }))
      .rejects.toMatchObject({ code: 'OBJECT_CONFLICT' });

    expect(fake.objects.get(seededPath).toString('utf8')).toBe('other bytes');
  });

  it('getObject refuses an object whose bytes do not hash to its key', async () => {
    const hex = sha256Hex(Buffer.from('original'));
    fake.objects.set(keyPath('samples', 'o', hex), Buffer.from('tampered'));

    await expect(store.getObject(`objstore://samples/o/sha256/${hex}`))
      .rejects.toMatchObject({ code: 'OBJECT_CONFLICT' });
  });

  it('getObject of a missing object rejects with ENOENT', async () => {
    await expect(store.getObject(`objstore://samples/o/sha256/${'a'.repeat(64)}`))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([
    ['an area of ..', () => store.putObject({ area: '..', ownerKey: 'o', body: Buffer.from('x') })],
    ['an area of a/b', () => store.putObject({ area: 'a/b', ownerKey: 'o', body: Buffer.from('x') })],
    ['an empty ownerKey', () => store.putObject({ area: 'samples', ownerKey: '', body: Buffer.from('x') })],
    ['a body that is not a Buffer', () => store.putObject({ area: 'samples', ownerKey: 'o', body: 'text' })],
    ['a malformed uri', () => store.getObject('objstore://samples/o/files/upload.csv')]
  ])('refuses %s with OBJECT_KEY_INVALID and sends no request', async (_label, call) => {
    await expect(call()).rejects.toMatchObject({ code: 'OBJECT_KEY_INVALID' });

    expect(fake.log).toEqual([]);
  });

  it('maps an ownerKey outside the plain pattern to its x- segment as ownerSegment does', async () => {
    const ownerKey = 'assay 1/é';
    const body = Buffer.from('mapped owner');
    const segment = `x-${sha256Hex(ownerKey)}`;

    const stored = await store.putObject({ area: 'assays', ownerKey, body });

    expect(ownerSegment(ownerKey)).toBe(segment);
    expect(stored.uri).toBe(`objstore://assays/${segment}/sha256/${sha256Hex(body)}`);
    expect(fake.objects.has(keyPath('assays', segment, sha256Hex(body)))).toBe(true);
  });

  it('reports a 500 and a failed fetch as OBJECT_STORE_UNAVAILABLE without naming the secret', async () => {
    fake.failWith = 500;
    const served = await store.putObject({ area: 'samples', ownerKey: 'o', body: Buffer.from('x') }).catch((e) => e);
    expect(served).toMatchObject({ code: 'OBJECT_STORE_UNAVAILABLE' });
    expect(served.message).toContain('500');
    expect(served.message).not.toContain(SECRET);

    const rejecting = createS3ObjectStore({
      endpoint: fake.endpoint,
      bucket: BUCKET,
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET,
      fetchImpl: () => Promise.reject(new Error('connect ECONNREFUSED'))
    });
    const refused = await rejecting.getObject(`objstore://samples/o/sha256/${'a'.repeat(64)}`).catch((e) => e);
    expect(refused).toMatchObject({ code: 'OBJECT_STORE_UNAVAILABLE' });
    expect(refused.message).not.toContain(SECRET);
  });

  it.each([
    ['a missing endpoint', { endpoint: undefined }],
    ['an ftp:// endpoint', { endpoint: 'ftp://127.0.0.1:21' }],
    ['a bucket of A_B', { bucket: 'A_B' }],
    ['an empty secret', { secretAccessKey: '' }],
    ['an endpoint with a query', { endpoint: 'http://127.0.0.1:9000?x=1' }],
    ['an endpoint with a fragment', { endpoint: 'http://127.0.0.1:9000#f' }],
    ['an endpoint with credentials', { endpoint: 'http://u:p@127.0.0.1:9000' }],
    ['an endpoint with a malformed percent-escape', { endpoint: 'http://127.0.0.1:9000/%zz' }]
  ])('refuses %s at create', (_label, overrides) => {
    const config = { endpoint: fake.endpoint, bucket: BUCKET, accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET, ...overrides };

    expect(() => createS3ObjectStore(config)).toThrow();
    expect(fake.log).toEqual([]);
  });

  it('puts the object under the path prefix of an endpoint with a trailing slash', async () => {
    const prefixed = createS3ObjectStore({
      endpoint: `${fake.endpoint}/prefix/`,
      bucket: BUCKET,
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET
    });
    const body = Buffer.from('prefixed bytes');

    await prefixed.putObject({ area: 'samples', ownerKey: 'o', body });

    expect(fake.log.map((e) => e.path)).toEqual([`/prefix${keyPath('samples', 'o', sha256Hex(body))}`]);
  });

  it('gives the same uri and version as the filesystem store for the same body', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'objstore-'));
    try {
      const body = Buffer.from('parity bytes');
      const onDisk = await createFilesystemObjectStore({ root }).putObject({ area: 'samples', ownerKey: 'o', body });
      const inS3 = await store.putObject({ area: 'samples', ownerKey: 'o', body });

      expect(inS3.uri).toBe(onDisk.uri);
      expect(inS3.version).toBe(onDisk.version);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('signRequest (AWS Signature Version 4)', () => {
  it('reproduces the published SigV4 S3 GET object example', () => {
    const { authorization, amzDate } = signRequest({
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      headers: {
        host: 'examplebucket.s3.amazonaws.com',
        range: 'bytes=0-9',
        'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        'x-amz-date': '20130524T000000Z'
      },
      payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      region: 'us-east-1',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      date: '2013-05-24T00:00:00Z'
    });

    expect(amzDate).toBe('20130524T000000Z');
    expect(authorization).toContain('SignedHeaders=host;range;x-amz-content-sha256;x-amz-date');
    expect(authorization).toContain('Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  });
});
