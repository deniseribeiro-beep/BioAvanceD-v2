const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const env = require('../config/env');
const logger = require('../utils/logger');
const { signRequest, toAmzDate } = require('../infrastructure/objectStorage/awsSigV4');

// #1325 (RNF010 C1): the off-site copy of each encrypted backup run, PUT
// path-style (`<endpoint>/<bucket>/backups/<folder>/<path>`) to an
// S3-compatible bucket. Every PUT carries `If-None-Match: *`, so an existing
// object is never overwritten. Nothing is deleted off-site and nothing is
// read back: off-site retention is the bucket's lifecycle rule.
const MANIFEST_FILE = 'manifest.json';
const DEFAULT_REGION = 'us-east-1';
const PUT_TIMEOUT_MS = 300000;
const BUCKET_PATTERN = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const FAILURE = 'Cópia off-site falhou';

function isSet(value) {
  return value !== undefined && value !== null && String(value) !== '';
}

// None of the settings set skips the copy; only some of them set is
// misconfigured, and fails the run (backup-stores.service.js's rule).
function readSettings() {
  const settings = {
    BACKUP_OFFSITE_S3_ENDPOINT: env.BACKUP_OFFSITE_S3_ENDPOINT,
    BACKUP_OFFSITE_S3_BUCKET: env.BACKUP_OFFSITE_S3_BUCKET,
    BACKUP_OFFSITE_S3_ACCESS_KEY_ID: env.BACKUP_OFFSITE_S3_ACCESS_KEY_ID,
    BACKUP_OFFSITE_S3_SECRET_ACCESS_KEY: env.BACKUP_OFFSITE_S3_SECRET_ACCESS_KEY
  };
  const names = Object.keys(settings);
  const missing = names.filter((name) => !isSet(settings[name]));
  if (missing.length === names.length) return null;
  if (missing.length > 0) {
    throw new Error(`${FAILURE}: configuração parcial: ${missing.join(', ')} não configurada(s).`);
  }
  return {
    endpoint: String(settings.BACKUP_OFFSITE_S3_ENDPOINT),
    bucket: String(settings.BACKUP_OFFSITE_S3_BUCKET),
    accessKeyId: String(settings.BACKUP_OFFSITE_S3_ACCESS_KEY_ID),
    secretAccessKey: String(settings.BACKUP_OFFSITE_S3_SECRET_ACCESS_KEY),
    region: isSet(env.BACKUP_OFFSITE_S3_REGION) ? String(env.BACKUP_OFFSITE_S3_REGION) : DEFAULT_REGION
  };
}

// The object URLs are built from the parsed endpoint, so one with a query, a
// fragment or credentials is refused, as s3ObjectStore.js refuses it.
function parseEndpoint(endpoint) {
  let url;
  try {
    url = new URL(endpoint);
    decodeURIComponent(url.pathname);
  } catch (_error) {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.search || url.hash || url.username || url.password) return null;
  return url;
}

// RFC 3986: encodeURIComponent leaves !'()* unescaped, SigV4 does not.
function encodeRfc3986(segment) {
  return encodeURIComponent(segment)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

// Every regular file under the run's folder, as computeDirChecksum walks it.
async function listFiles(dirPath) {
  const files = [];
  async function walk(currentPath, relativePath) {
    const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
    const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of sorted) {
      const entryPath = path.join(currentPath, entry.name);
      const entryRelative = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(entryPath, entryRelative);
      } else if (entry.isFile()) {
        files.push(entryRelative);
      }
    }
  }
  await walk(dirPath, '');
  return files;
}

// The files the run's manifest accounts for: itself, the encrypted dump
// files of a mongodump run (encryptedFiles), the collection files of a
// JSON-fallback run (collections) and each store's files (stores.*.files).
// A file the folder holds beyond these, such as a plaintext dump file a
// failed mongodump left before the JSON fallback reused the folder, is
// never sent.
async function readAccountedFiles(backupDir) {
  let manifest;
  try {
    manifest = JSON.parse(await fs.promises.readFile(path.join(backupDir, MANIFEST_FILE), 'utf8'));
  } catch (_error) {
    throw new Error(`${FAILURE}: ${MANIFEST_FILE} ilegível.`);
  }
  const accounted = new Set([MANIFEST_FILE]);
  const addFiles = (entries) => {
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      if (entry && typeof entry.file === 'string') accounted.add(entry.file);
    }
  };
  addFiles(manifest && manifest.encryptedFiles);
  addFiles(manifest && manifest.collections);
  const stores = manifest && manifest.stores && typeof manifest.stores === 'object' ? manifest.stores : {};
  for (const store of Object.values(stores)) addFiles(store && store.files);
  return accounted;
}

async function uploadBackupRunOffsite(backupDir, encryptionEnabled, { fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
  const settings = readSettings();
  if (!settings) return { status: 'skipped', reason: 'not_configured' };

  // Only an encrypted run leaves the host: a plaintext run is never sent.
  if (encryptionEnabled !== true) {
    logger.warn('Cópia off-site ignorada: backup sem criptografia não é enviado.');
    return { status: 'skipped', reason: 'not_encrypted' };
  }

  const endpointUrl = parseEndpoint(settings.endpoint);
  if (!endpointUrl) {
    // Names the setting only: an endpoint with userinfo would print its secret.
    throw new Error(`${FAILURE}: BACKUP_OFFSITE_S3_ENDPOINT inválido.`);
  }
  const { bucket, region, accessKeyId, secretAccessKey } = settings;
  if (!BUCKET_PATTERN.test(bucket)) {
    throw new Error(`${FAILURE}: BACKUP_OFFSITE_S3_BUCKET inválido: ${bucket}.`);
  }

  const files = await listFiles(backupDir);
  if (!files.includes(MANIFEST_FILE)) {
    throw new Error(`${FAILURE}: ${MANIFEST_FILE} ausente.`);
  }
  const accounted = await readAccountedFiles(backupDir);
  const stray = files.find((name) => !accounted.has(name));
  if (stray !== undefined) {
    throw new Error(`${FAILURE}: ${stray} não consta do ${MANIFEST_FILE}.`);
  }
  // The manifest goes last, so a manifest present off-site means every other
  // file of the run is there too.
  const ordered = [...files.filter((name) => name !== MANIFEST_FILE), MANIFEST_FILE];

  const folder = path.basename(backupDir);
  const prefix = `backups/${folder}/`;
  const base = `${endpointUrl.origin}${endpointUrl.pathname.replace(/\/+$/, '')}`;

  for (const rel of ordered) {
    // eslint-disable-next-line no-await-in-loop
    const body = await fs.promises.readFile(path.join(backupDir, ...rel.split('/')));
    const payloadHash = crypto.createHash('sha256').update(body).digest('hex');
    const key = `${prefix}${rel}`.split('/').map(encodeRfc3986).join('/');
    const url = `${base}/${bucket}/${key}`;
    const date = now();
    const headers = {
      host: new URL(url).host,
      'if-none-match': '*',
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': toAmzDate(date)
    };
    const { authorization } = signRequest({
      method: 'PUT', url, headers, payloadHash, region, service: 's3', accessKeyId, secretAccessKey, date
    });
    // fetch sets Host from the URL, the same value signed above.
    const { host: _host, ...sent } = headers;
    let response;
    try {
      // eslint-disable-next-line no-await-in-loop
      response = await fetchImpl(url, {
        method: 'PUT',
        headers: { ...sent, authorization },
        body,
        signal: AbortSignal.timeout(PUT_TIMEOUT_MS)
      });
      // eslint-disable-next-line no-await-in-loop
      await response.arrayBuffer();
    } catch (error) {
      throw new Error(`${FAILURE}: PUT de ${rel} falhou (${(error && error.name) || 'erro'}).`);
    }
    // 412 included: an object already there is never overwritten.
    if (response.status !== 200) {
      throw new Error(`${FAILURE}: PUT de ${rel} respondeu ${response.status}.`);
    }
  }

  return { status: 'uploaded', bucket, prefix, files: ordered.length };
}

module.exports = { uploadBackupRunOffsite };
