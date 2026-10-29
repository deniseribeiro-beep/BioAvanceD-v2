import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ObjectId } = require('mongodb');
const { serveFileByAccessToken } = require('../../src/controllers/fileAccess.controller');
const { issueFileAccessToken } = require('../../src/services/dataFileAccessToken.service');
const { encryptFileBuffer } = require('../../src/utils/fileCrypto');
const objectStorage = require('../../src/infrastructure/objectStorage');
const auditLogger = require('../../src/utils/auditLogger');

// RNF029 C5 (#1321): GET /api/file-access?token=... serves the one file a
// download handler issued a token for, and refuses and audits every other
// token without ever recording the token itself.

function createRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    send: vi.fn(),
    headersSent: false
  };
}

function createDb(row) {
  const findOne = vi.fn().mockResolvedValue(row);
  return { db: { collection: vi.fn(() => ({ findOne })) }, findOne };
}

function auditCallsWithoutReq(logSpy) {
  return logSpy.mock.calls.map(([options]) => {
    const { req, ...rest } = options;
    return JSON.stringify(rest);
  });
}

describe('fileAccess.controller serveFileByAccessToken', () => {
  let storeRoot;
  let store;
  let logSpy;

  beforeEach(() => {
    storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'file-access-objstore-'));
    store = objectStorage.createFilesystemObjectStore({ root: storeRoot });
    vi.spyOn(objectStorage, 'getFileObjectStore').mockReturnValue(store);
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(storeRoot, { recursive: true, force: true });
  });

  async function encryptedObjectRow(plaintext) {
    const envelope = encryptFileBuffer(plaintext);
    const stored = await store.putObject({ area: 'datasets', ownerKey: 'ds-1', body: envelope.ciphertext });
    return {
      _id: new ObjectId(),
      datasetId: 'ds-1',
      fileName: 'raw.csv',
      storageUri: stored.uri,
      storagePath: stored.path,
      storageObjectVersion: stored.version,
      encryptionAlgorithm: envelope.algorithm,
      encryptionKeyId: envelope.keyId,
      encryptionIv: envelope.iv,
      encryptionTag: envelope.tag
    };
  }

  function requestFor(db, token) {
    return { app: { locals: { db } }, query: { token }, path: '/' };
  }

  it('serves the plaintext of an encrypted object-store row with Cache-Control no-store and audits file_access_token_used', async () => {
    const plaintext = Buffer.from('RNF029 C5 plaintext');
    const row = await encryptedObjectRow(plaintext);
    const { db, findOne } = createDb(row);
    const { token, tokenId } = issueFileAccessToken({ collection: 'datasetFiles', fileRecord: row, userId: 'u-1' });
    const res = createRes();

    await serveFileByAccessToken(requestFor(db, token), res);

    expect(db.collection).toHaveBeenCalledWith('datasetFiles');
    expect(findOne).toHaveBeenCalledWith({ _id: row._id });
    expect(res.status).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="raw.csv"');
    expect(res.send).toHaveBeenCalledWith(plaintext);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'file_access_token_used',
      status: 'success',
      severity: 'info',
      resourceType: 'DatasetFile',
      resourceId: row._id.toHexString(),
      payload: { tokenId },
      module: 'Arquivos'
    }));
  });

  it('serves a legacy row (no storageObjectVersion) from its storagePath', async () => {
    const legacyPath = path.join(storeRoot, 'legacy.csv');
    fs.writeFileSync(legacyPath, 'legacy bytes');
    const row = { _id: new ObjectId(), specimenId: 's-1', fileName: 'legacy.csv', storagePath: legacyPath, storageUri: 'objstore://samples/s-1/files/legacy.csv' };
    const { db } = createDb(row);
    const getObjectSpy = vi.spyOn(store, 'getObject');
    const { token } = issueFileAccessToken({ collection: 'sample_files', fileRecord: row, userId: 'u-1' });
    const res = createRes();

    await serveFileByAccessToken(requestFor(db, token), res);

    expect(getObjectSpy).not.toHaveBeenCalled();
    expect(res.send).toHaveBeenCalledWith(Buffer.from('legacy bytes'));
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ action: 'file_access_token_used', resourceType: 'SampleFile' }));
  });

  it('refuses a tampered token with 403 FILE_ACCESS_TOKEN_INVALID, audits it once and never records the token', async () => {
    const row = await encryptedObjectRow(Buffer.from('x'));
    const { db, findOne } = createDb(row);
    const { token } = issueFileAccessToken({ collection: 'datasetFiles', fileRecord: row, userId: 'u-1' });
    const tampered = token.slice(0, -1) + (token.slice(-1) === 'A' ? 'B' : 'A');
    const res = createRes();

    await serveFileByAccessToken(requestFor(db, tampered), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Link de download inválido ou expirado', code: 'FILE_ACCESS_TOKEN_INVALID' });
    expect(findOne).not.toHaveBeenCalled();
    expect(res.send).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'file_access_token_refused',
      status: 'error',
      severity: 'warning',
      resourceType: 'DataFile',
      resourceId: null,
      payload: { reason: 'invalid' }
    }));
    const [payloadPart, signature] = tampered.split('.');
    for (const recorded of auditCallsWithoutReq(logSpy)) {
      expect(recorded).not.toContain(payloadPart);
      expect(recorded).not.toContain(signature);
    }
    expect(JSON.stringify(res.json.mock.calls)).not.toContain(payloadPart);
  });

  it('refuses a repeated token parameter as invalid', async () => {
    const row = await encryptedObjectRow(Buffer.from('x'));
    const { db } = createDb(row);
    const { token } = issueFileAccessToken({ collection: 'datasetFiles', fileRecord: row, userId: 'u-1' });
    const res = createRes();

    await serveFileByAccessToken(requestFor(db, [token, token]), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'FILE_ACCESS_TOKEN_INVALID' }));
  });

  it('refuses an expired token with 403 FILE_ACCESS_TOKEN_EXPIRED and audits it once without the token', async () => {
    const row = await encryptedObjectRow(Buffer.from('x'));
    const { db } = createDb(row);
    const { token } = issueFileAccessToken({ collection: 'datasetFiles', fileRecord: row, userId: 'u-1', now: Date.now() - 61 * 1000 });
    const res = createRes();

    await serveFileByAccessToken(requestFor(db, token), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Link de download inválido ou expirado', code: 'FILE_ACCESS_TOKEN_EXPIRED' });
    expect(res.send).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ action: 'file_access_token_refused', payload: { reason: 'expired' } }));
    const [payloadPart, signature] = token.split('.');
    for (const recorded of auditCallsWithoutReq(logSpy)) {
      expect(recorded).not.toContain(payloadPart);
      expect(recorded).not.toContain(signature);
    }
  });

  it('answers 404 for a file deleted after the token was issued and audits not_found once', async () => {
    const row = await encryptedObjectRow(Buffer.from('x'));
    const { token, tokenId } = issueFileAccessToken({ collection: 'datasetFiles', fileRecord: row, userId: 'u-1' });
    const { db } = createDb({ ...row, deletedAt: new Date() });
    const res = createRes();

    await serveFileByAccessToken(requestFor(db, token), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'file_access_token_refused',
      resourceType: 'DatasetFile',
      resourceId: row._id.toHexString(),
      payload: { reason: 'not_found', tokenId }
    }));
    const [payloadPart, signature] = token.split('.');
    for (const recorded of auditCallsWithoutReq(logSpy)) {
      expect(recorded).not.toContain(payloadPart);
      expect(recorded).not.toContain(signature);
    }
  });

  it('answers 403 for a file replaced after the token was issued and audits superseded once', async () => {
    const row = await encryptedObjectRow(Buffer.from('old'));
    const { token, tokenId } = issueFileAccessToken({ collection: 'datasetFiles', fileRecord: row, userId: 'u-1' });
    const replacement = await encryptedObjectRow(Buffer.from('new'));
    const { db } = createDb({ ...replacement, _id: row._id });
    const res = createRes();

    await serveFileByAccessToken(requestFor(db, token), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'FILE_ACCESS_TOKEN_INVALID' }));
    expect(res.send).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'file_access_token_refused',
      payload: { reason: 'superseded', tokenId }
    }));
  });

  it('answers 500 and sends no bytes when the stored object no longer hashes to its key', async () => {
    const row = await encryptedObjectRow(Buffer.from('evidence'));
    fs.writeFileSync(row.storagePath, Buffer.from('overwritten bytes'));
    const { db } = createDb(row);
    const { token } = issueFileAccessToken({ collection: 'datasetFiles', fileRecord: row, userId: 'u-1' });
    const res = createRes();

    await serveFileByAccessToken(requestFor(db, token), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'file_access_token_used' }));
  });

  it('answers 404 when the object is missing from the store', async () => {
    const row = await encryptedObjectRow(Buffer.from('gone'));
    fs.rmSync(row.storagePath);
    const { db } = createDb(row);
    const { token } = issueFileAccessToken({ collection: 'datasetFiles', fileRecord: row, userId: 'u-1' });
    const res = createRes();

    await serveFileByAccessToken(requestFor(db, token), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).not.toHaveBeenCalled();
  });

  // Moved from sample-file.controller.test.js: the download handlers no
  // longer read bytes, so a corrupt ciphertext is refused here.
  it('answers 500 when decryption fails (tampered or corrupt ciphertext)', async () => {
    const stored = await store.putObject({ area: 'samples', ownerKey: 's-1', body: Buffer.from('not really valid ciphertext bytes!!') });
    const row = {
      _id: new ObjectId(),
      specimenId: 's-1',
      fileName: 'a.csv',
      storageUri: stored.uri,
      storagePath: stored.path,
      storageObjectVersion: stored.version,
      encryptionAlgorithm: 'aes-256-gcm',
      encryptionKeyId: require('../../src/config/keyRegistry').getActiveKeyId(),
      encryptionIv: Buffer.alloc(12).toString('base64'),
      encryptionTag: Buffer.alloc(16).toString('base64')
    };
    const { db } = createDb(row);
    const { token } = issueFileAccessToken({ collection: 'sample_files', fileRecord: row, userId: 'u-1' });
    const res = createRes();

    await serveFileByAccessToken(requestFor(db, token), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).not.toHaveBeenCalled();
  });

  // #1398: a name Node refuses in a header value no longer answers 500.
  it('serves a non-ASCII file name with an ASCII filename fallback and an RFC 5987 filename* that Node accepts', async () => {
    const plaintext = Buffer.from('cjk name');
    const row = { ...(await encryptedObjectRow(plaintext)), fileName: '数据 "a".csv' };
    const { db } = createDb(row);
    const { token } = issueFileAccessToken({ collection: 'datasetFiles', fileRecord: row, userId: 'u-1' });
    const res = createRes();
    res.setHeader = vi.fn((name, value) => require('http').validateHeaderValue(name, value));

    await serveFileByAccessToken(requestFor(db, token), res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="__ _a_.csv"; filename*=UTF-8\'\'%E6%95%B0%E6%8D%AE%20%22a%22.csv'
    );
    expect(res.send).toHaveBeenCalledWith(plaintext);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ action: 'file_access_token_used' }));
  });

  it('answers 500 and audits no success when setting a header throws', async () => {
    const row = await encryptedObjectRow(Buffer.from('x'));
    const { db } = createDb(row);
    const { token } = issueFileAccessToken({ collection: 'datasetFiles', fileRecord: row, userId: 'u-1' });
    const res = createRes();
    res.setHeader = vi.fn((name) => {
      if (name === 'Content-Disposition') throw new Error('invalid header');
    });

    await serveFileByAccessToken(requestFor(db, token), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'file_access_token_used' }));
  });

  it('answers 503 when the database is unavailable', async () => {
    const res = createRes();
    await serveFileByAccessToken({ app: { locals: {} }, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });
});
