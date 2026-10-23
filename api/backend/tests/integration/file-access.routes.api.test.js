import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ObjectId } = require('mongodb');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const logService = require('../../src/services/log.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

// RNF029 C5 (#1321): a dataset file download redirects to a short-lived file
// access token URL, and that URL serves the bytes with no session. A
// tampered or expired token is refused, and no audit row carries the token.

const rbacCollectionsAdmin = buildRbacCollections([{ userAccountId: 'qa-1', accessType: 4 }]);
const LOCATION_PATTERN = /^\/api\/file-access\?token=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function makeToken(userID, accessType) {
  return jwt.sign(
    { userID, accessType, roleName: 'Administrador', name: 'QA', mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

let tmpDir;
let createLogSpy;

beforeEach(() => {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'sess-1' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'sess-1' });
  createLogSpy = vi.spyOn(logService, 'createLog').mockResolvedValue(undefined);
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-access-api-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function givenDatasetFile(content) {
  const storagePath = path.join(tmpDir, 'raw.csv');
  fs.writeFileSync(storagePath, content);
  const fileRow = {
    _id: new ObjectId(),
    datasetId: 'ds-1',
    fileName: 'raw.csv',
    fileType: 'CSV',
    fileSize: content.length,
    storagePath,
    storageUri: 'objstore://datasets/ds-1/files/raw.csv'
  };
  app.locals.db = createDbMock({
    datasets: createCollectionMock({ findOne: vi.fn().mockResolvedValue({ datasetId: 'ds-1' }) }),
    datasetFiles: createCollectionMock({ findOne: vi.fn().mockResolvedValue(fileRow) }),
    ...rbacCollectionsAdmin
  });
  return fileRow;
}

async function download(fileRow) {
  return request(app)
    .get(`/api/datasets/ds-1/files/${fileRow._id.toHexString()}/download`)
    .set('Authorization', `Bearer ${makeToken('qa-1', 4)}`)
    .redirects(0);
}

function tamperLast(text) {
  const last = text.slice(-1);
  return text.slice(0, -1) + (last === 'A' ? 'B' : 'A');
}

async function flushGlobalAuditRows() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

describe('GET /api/datasets/:datasetId/files/:fileID/download then GET /api/file-access', () => {
  it('redirects to a file access token URL that serves the bytes without a session', async () => {
    const content = Buffer.from('a,b\n1,2\n');
    const fileRow = givenDatasetFile(content);

    const redirect = await download(fileRow);
    expect(redirect.status).toBe(302);
    expect(redirect.headers['cache-control']).toBe('no-store');
    expect(redirect.headers.location).toMatch(LOCATION_PATTERN);

    const served = await request(app).get(redirect.headers.location).buffer(true).parse((res, cb) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(served.status).toBe(200);
    expect(served.headers['cache-control']).toBe('no-store');
    expect(Buffer.compare(served.body, content)).toBe(0);
  });

  it('refuses a Location with its last character replaced with 403 FILE_ACCESS_TOKEN_INVALID and records no part of the token', async () => {
    const fileRow = givenDatasetFile(Buffer.from('x'));
    const redirect = await download(fileRow);
    const location = redirect.headers.location;
    const token = location.slice(location.indexOf('=') + 1);

    const refused = await request(app).get(tamperLast(location));
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('FILE_ACCESS_TOKEN_INVALID');
    await flushGlobalAuditRows();

    const rows = createLogSpy.mock.calls.map(([, row]) => row);
    expect(rows.some((row) => String(row.action).toLowerCase() === 'file_access_token_refused')).toBe(true);
    const [payloadPart, signature] = token.split('.');
    const tamperedSignature = tamperLast(token).split('.')[1];
    for (const row of rows) {
      const recorded = JSON.stringify(row);
      expect(recorded).not.toContain(payloadPart);
      expect(recorded).not.toContain(signature);
      expect(recorded).not.toContain(tamperedSignature);
    }
  });

  it('refuses the Location 61 seconds later with 403 FILE_ACCESS_TOKEN_EXPIRED', async () => {
    const fileRow = givenDatasetFile(Buffer.from('x'));
    const redirect = await download(fileRow);
    const location = redirect.headers.location;
    const token = location.slice(location.indexOf('=') + 1);

    const issuedAt = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(issuedAt + 61 * 1000);
    const refused = await request(app).get(location);
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('FILE_ACCESS_TOKEN_EXPIRED');
    await flushGlobalAuditRows();

    const rows = createLogSpy.mock.calls.map(([, row]) => row);
    expect(rows.some((row) => String(row.action).toLowerCase() === 'file_access_token_refused')).toBe(true);
    const [payloadPart, signature] = token.split('.');
    for (const row of rows) {
      const recorded = JSON.stringify(row);
      expect(recorded).not.toContain(payloadPart);
      expect(recorded).not.toContain(signature);
    }
  });
});
