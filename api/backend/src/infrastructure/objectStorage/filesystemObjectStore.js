const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// RF007 AC2 / RNF016 C4 (#1321): a DataFile binary is written once to a
// content-addressed object, `objstore://<area>/<ownerKey>/sha256/<hex>`, the
// layout reference assets already use under STORAGE_BASE. The store has no
// delete and no overwrite: an object, once written, is evidence.
const KEY_SEGMENT_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
// An owner id is client-supplied data (an assay or dataset id may hold a
// space, an accent or a dot), never a path: one with no dot that is not in
// the `x-` namespace is its own segment, any other is `x-<sha256 of the id>`.
const PLAIN_OWNER_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MAPPED_OWNER_PREFIX = 'x-';
const OBJECT_URI_PATTERN = /^objstore:\/\/([^/]+)\/([^/]+)\/sha256\/([0-9a-f]{64})$/;

function storeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isValidSegment(segment) {
  return typeof segment === 'string'
    && KEY_SEGMENT_PATTERN.test(segment)
    && segment !== '.'
    && segment !== '..';
}

function assertSegment(name, segment) {
  if (!isValidSegment(segment)) {
    throw storeError('OBJECT_KEY_INVALID', `${name} inválido para o Object Storage: ${segment}.`);
  }
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function ownerSegment(ownerKey) {
  if (typeof ownerKey !== 'string' || ownerKey.length === 0) {
    throw storeError('OBJECT_KEY_INVALID', `ownerKey inválido para o Object Storage: ${ownerKey}.`);
  }
  if (PLAIN_OWNER_PATTERN.test(ownerKey) && !ownerKey.startsWith(MAPPED_OWNER_PREFIX)) {
    return ownerKey;
  }
  return `${MAPPED_OWNER_PREFIX}${sha256Hex(ownerKey)}`;
}

function removeQuietly(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (_error) {
    // Already gone; nothing is left behind either way.
  }
}

function createFilesystemObjectStore({ root }) {
  if (typeof root !== 'string' || root.length === 0) {
    throw new Error(`raiz do Object Storage inválida: ${root}.`);
  }

  function objectPath(area, ownerKey, hex) {
    return path.join(root, area, ownerKey, 'sha256', hex);
  }

  function verifyExisting(finalPath, uri, hex) {
    const stat = fs.lstatSync(finalPath);
    if (!stat.isFile()) {
      throw storeError('OBJECT_CONFLICT', `${uri} existe e não é um arquivo regular.`);
    }
    const stored = sha256Hex(fs.readFileSync(finalPath));
    if (stored !== hex) {
      // The stored object is never overwritten or deleted.
      throw storeError('OBJECT_CONFLICT', `${uri} já guarda outro conteúdo (sha256 ${stored}).`);
    }
  }

  async function putObject({ area, ownerKey, body } = {}) {
    assertSegment('area', area);
    const owner = ownerSegment(ownerKey);
    if (!Buffer.isBuffer(body)) {
      throw storeError('OBJECT_KEY_INVALID', 'O corpo do objeto deve ser um Buffer.');
    }

    const hex = sha256Hex(body);
    const uri = `objstore://${area}/${owner}/sha256/${hex}`;
    const finalPath = objectPath(area, owner, hex);
    const result = { uri, version: `sha256:${hex}`, path: finalPath };

    fs.mkdirSync(path.dirname(finalPath), { recursive: true });
    const tmpPath = `${finalPath}.tmp-${crypto.randomUUID()}`;
    try {
      fs.writeFileSync(tmpPath, body, { flag: 'wx' });
      try {
        // linkSync fails if the object already exists, so nothing is ever
        // overwritten.
        fs.linkSync(tmpPath, finalPath);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        verifyExisting(finalPath, uri, hex);
      }
      return result;
    } finally {
      removeQuietly(tmpPath);
    }
  }

  async function getObject(uri) {
    const match = typeof uri === 'string' ? OBJECT_URI_PATTERN.exec(uri) : null;
    if (!match || !isValidSegment(match[1]) || !PLAIN_OWNER_PATTERN.test(match[2])) {
      throw storeError('OBJECT_KEY_INVALID', `URI de Object Storage inválida: ${uri}.`);
    }
    const [, area, ownerKey, hex] = match;
    const body = fs.readFileSync(objectPath(area, ownerKey, hex));
    if (sha256Hex(body) !== hex) {
      throw storeError('OBJECT_CONFLICT', `${uri} não corresponde ao seu conteúdo.`);
    }
    return body;
  }

  return { putObject, getObject };
}

module.exports = { createFilesystemObjectStore, ownerSegment };
