import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const crypto = require('crypto');

const env = require('../../../src/config/env');
const { STORAGE_BASE } = require('../../../src/config/uploadConfig');
const filesystemObjectStore = require('../../../src/infrastructure/objectStorage/filesystemObjectStore');

const MODULE_PATH = require.resolve('../../../src/infrastructure/objectStorage');

const KEYS = [
  'OBJECT_STORE_DRIVER',
  'OBJECT_STORE_S3_ENDPOINT',
  'OBJECT_STORE_S3_BUCKET',
  'OBJECT_STORE_S3_REGION',
  'OBJECT_STORE_S3_ACCESS_KEY_ID',
  'OBJECT_STORE_S3_SECRET_ACCESS_KEY',
  'OBJECT_STORE_S3_TIMEOUT_MS'
];

const ENDPOINT = 'http://minio.test:9000';
const BUCKET = 'biobank-files';
const ACCESS_KEY_ID = 'TESTACCESSKEYVALUE';
const SECRET = 'test-secret-key-never-logged';

// getFileObjectStore memoizes its store, so each case loads a fresh module;
// vi.resetModules() does not clear Node's CJS require cache.
function freshObjectStorage() {
  delete require.cache[MODULE_PATH];
  return require('../../../src/infrastructure/objectStorage');
}

function setS3Env(overrides = {}) {
  Object.assign(env, {
    OBJECT_STORE_DRIVER: 's3',
    OBJECT_STORE_S3_ENDPOINT: ENDPOINT,
    OBJECT_STORE_S3_BUCKET: BUCKET,
    OBJECT_STORE_S3_REGION: undefined,
    OBJECT_STORE_S3_ACCESS_KEY_ID: ACCESS_KEY_ID,
    OBJECT_STORE_S3_SECRET_ACCESS_KEY: SECRET,
    OBJECT_STORE_S3_TIMEOUT_MS: undefined
  }, overrides);
}

function thrownBy(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return null;
}

describe('getFileObjectStore (RF007 AC2, RNF016 C4, #1321)', () => {
  const original = Object.fromEntries(KEYS.map((key) => [key, env[key]]));
  afterEach(() => {
    for (const key of KEYS) env[key] = original[key];
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete require.cache[MODULE_PATH];
    require('../../../src/infrastructure/objectStorage');
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['"filesystem"', 'filesystem']
  ])('with the driver %s builds the filesystem store under STORAGE_BASE', (_label, driver) => {
    env.OBJECT_STORE_DRIVER = driver;
    const built = { putObject: vi.fn(), getObject: vi.fn() };
    const spy = vi.spyOn(filesystemObjectStore, 'createFilesystemObjectStore').mockReturnValue(built);

    const store = freshObjectStorage().getFileObjectStore();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ root: STORAGE_BASE });
    expect(store).toBe(built);
  });

  it('with driver "s3" and a full config builds an S3 store that PUTs path-style and returns path null', async () => {
    setS3Env();
    const fetchSpy = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    const store = freshObjectStorage().getFileObjectStore();
    const body = Buffer.from('a,b\n1,2\n');
    const stored = await store.putObject({ area: 'samples', ownerKey: 'abc', body });

    const hex = crypto.createHash('sha256').update(body).digest('hex');
    const owner = filesystemObjectStore.ownerSegment('abc');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`${ENDPOINT}/${BUCKET}/samples/${owner}/sha256/${hex}`);
    expect(init.method).toBe('PUT');
    expect(stored).toEqual({ uri: `objstore://samples/${owner}/sha256/${hex}`, version: `sha256:${hex}`, path: null });
  });

  it.each(['S3', ' s3', 'minio'])('with driver %j throws OBJECT_STORE_DRIVER_UNKNOWN with status 503', (driver) => {
    env.OBJECT_STORE_DRIVER = driver;
    const spy = vi.spyOn(filesystemObjectStore, 'createFilesystemObjectStore');

    const thrown = thrownBy(() => freshObjectStorage().getFileObjectStore());

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.code).toBe('OBJECT_STORE_DRIVER_UNKNOWN');
    expect(thrown.statusCode).toBe(503);
    expect(thrown.message).toContain(`OBJECT_STORE_DRIVER desconhecido: ${driver}.`);
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    ['no bucket', { OBJECT_STORE_S3_BUCKET: undefined }],
    ['an ftp: endpoint', { OBJECT_STORE_S3_ENDPOINT: 'ftp://minio.test:21' }],
    ['no secret', { OBJECT_STORE_S3_SECRET_ACCESS_KEY: undefined }],
    ['timeout "0"', { OBJECT_STORE_S3_TIMEOUT_MS: '0' }],
    ['timeout "abc"', { OBJECT_STORE_S3_TIMEOUT_MS: 'abc' }],
    ['timeout "1.5"', { OBJECT_STORE_S3_TIMEOUT_MS: '1.5' }]
  ])('with driver "s3" and %s throws OBJECT_STORE_MISCONFIGURED with status 503, naming no credential', (_label, overrides) => {
    setS3Env(overrides);

    const thrown = thrownBy(() => freshObjectStorage().getFileObjectStore());

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.code).toBe('OBJECT_STORE_MISCONFIGURED');
    expect(thrown.statusCode).toBe(503);
    expect(thrown.message).toMatch(/^Object Storage S3 mal configurado: /);
    expect(thrown.message).not.toContain(SECRET);
    expect(thrown.message).not.toContain(ACCESS_KEY_ID);
  });

  it('with an endpoint carrying credentials throws OBJECT_STORE_MISCONFIGURED naming neither those nor the configured ones', () => {
    setS3Env({ OBJECT_STORE_S3_ENDPOINT: 'http://AKIAUSERINFO:s3cr3tUserinfo@minio:9000' });

    const thrown = thrownBy(() => freshObjectStorage().getFileObjectStore());

    expect(thrown.code).toBe('OBJECT_STORE_MISCONFIGURED');
    for (const value of ['AKIAUSERINFO', 's3cr3tUserinfo', ACCESS_KEY_ID, SECRET]) {
      expect(thrown.message).not.toContain(value);
    }
  });

  // The adapter's messages name no credential today; the wrapper masks the
  // configured ones anyway, so a future cause message cannot leak them.
  it('masks the configured access key and secret in a cause message that names them', () => {
    setS3Env({ OBJECT_STORE_S3_BUCKET: `${ACCESS_KEY_ID}-${SECRET}` });

    const thrown = thrownBy(() => freshObjectStorage().getFileObjectStore());

    expect(thrown.code).toBe('OBJECT_STORE_MISCONFIGURED');
    expect(thrown.message).toContain('***-***');
    expect(thrown.message).not.toContain(ACCESS_KEY_ID);
    expect(thrown.message).not.toContain(SECRET);
  });

  it('does not memoize a throw: once the env is fixed, the next call returns a store', () => {
    setS3Env({ OBJECT_STORE_S3_BUCKET: undefined });
    const objectStorage = freshObjectStorage();
    expect(thrownBy(() => objectStorage.getFileObjectStore()).code).toBe('OBJECT_STORE_MISCONFIGURED');

    env.OBJECT_STORE_S3_BUCKET = BUCKET;
    const store = objectStorage.getFileObjectStore();

    expect(Object.keys(store).sort()).toEqual(['getObject', 'putObject']);
  });

  it('memoizes a built store', () => {
    setS3Env({ OBJECT_STORE_S3_TIMEOUT_MS: '5000', OBJECT_STORE_S3_REGION: 'sa-east-1' });
    const objectStorage = freshObjectStorage();
    const store = objectStorage.getFileObjectStore();

    env.OBJECT_STORE_DRIVER = 'minio';

    expect(objectStorage.getFileObjectStore()).toBe(store);
  });
});
