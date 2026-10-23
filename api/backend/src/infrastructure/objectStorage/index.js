// RF007 AC2 / RNF016 C4 (#1321): one object-store interface for DataFile
// binaries, `putObject` and `getObject`, with no delete and no overwrite.
// OBJECT_STORE_DRIVER selects the adapter: unset, empty or "filesystem" is
// the filesystem store under STORAGE_BASE, "s3" is the S3-compatible store
// built from the OBJECT_STORE_S3_* keys. Any other value, or an S3 config the
// adapter refuses, throws 503 rather than falling back to the filesystem.
const env = require('../../config/env');
const { STORAGE_BASE } = require('../../config/uploadConfig');
const { createFilesystemObjectStore } = require('./filesystemObjectStore');
const { createS3ObjectStore } = require('./s3ObjectStore');

const TIMEOUT_MS_PATTERN = /^[1-9][0-9]{0,6}$/;

function objectStoreError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 503;
  return error;
}

function isUnset(value) {
  return value === undefined || value === '';
}

// The adapter's own messages never name the secret; the configured access
// key and secret are masked in the cause anyway, so none can reach a client.
function maskCredentials(message, credentials) {
  return credentials
    .filter((value) => typeof value === 'string' && value.length > 0)
    .reduce((masked, value) => masked.split(value).join('***'), message);
}

function buildS3ObjectStore() {
  const config = {
    endpoint: env.OBJECT_STORE_S3_ENDPOINT,
    bucket: env.OBJECT_STORE_S3_BUCKET,
    accessKeyId: env.OBJECT_STORE_S3_ACCESS_KEY_ID,
    secretAccessKey: env.OBJECT_STORE_S3_SECRET_ACCESS_KEY
  };
  const region = env.OBJECT_STORE_S3_REGION;
  if (!isUnset(region)) config.region = region;
  const timeoutMs = env.OBJECT_STORE_S3_TIMEOUT_MS;
  try {
    if (!isUnset(timeoutMs)) {
      if (typeof timeoutMs !== 'string' || !TIMEOUT_MS_PATTERN.test(timeoutMs)) {
        throw new Error(`OBJECT_STORE_S3_TIMEOUT_MS inválido: ${timeoutMs}`);
      }
      config.timeoutMs = Number(timeoutMs);
    }
    return createS3ObjectStore(config);
  } catch (error) {
    const cause = maskCredentials(error.message.replace(/\.$/, ''), [config.secretAccessKey, config.accessKeyId]);
    throw objectStoreError('OBJECT_STORE_MISCONFIGURED', `Object Storage S3 mal configurado: ${cause}.`);
  }
}

let fileObjectStore = null;

function getFileObjectStore() {
  if (!fileObjectStore) {
    const driver = env.OBJECT_STORE_DRIVER;
    if (driver === undefined || driver === null || driver === '' || driver === 'filesystem') {
      fileObjectStore = createFilesystemObjectStore({ root: STORAGE_BASE });
    } else if (driver === 's3') {
      fileObjectStore = buildS3ObjectStore();
    } else {
      throw objectStoreError(
        'OBJECT_STORE_DRIVER_UNKNOWN',
        `OBJECT_STORE_DRIVER desconhecido: ${driver}. Arquivo recusado para não gravar em um Object Storage não configurado.`
      );
    }
  }
  return fileObjectStore;
}

module.exports = { createFilesystemObjectStore, createS3ObjectStore, getFileObjectStore };
