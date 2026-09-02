import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { ObjectId } = require('mongodb');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const consentValidator = require('../../src/services/consent.validator');
const { createCollectionMock, createDbMock: baseCreateDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

// #421: every accessType this file's tokens use (1, 2, 4) needs its own
// UserRoleAssignment so requireRole/requirePermission resolve correctly
// regardless of which accessType a given test authenticates as. Each
// accessType gets its own synthesized userAccountId (see makeToken) so the
// assignments don't collide/union permissions for a single userID.
const RBAC_USERS = [1, 2, 3, 4].map((accessType) => ({ userAccountId: `qa-1-${accessType}`, accessType }));
const rbacCollections = buildRbacCollections(RBAC_USERS);

function createDbMock(collections = {}) {
  return baseCreateDbMock({ ...collections, ...rbacCollections });
}

function makeToken(accessType = 4) {
  return jwt.sign(
    { userID: `qa-1-${accessType}`, accessType, roleName: undefined, name: 'QA', mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function givenSession() {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'sess-1' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'sess-1' });
}

const SAMPLE_OID = new ObjectId().toString();
const RESULT_OID = new ObjectId().toString();
// #628: Result.specimenId stores the referenced Sample's own canonical
// specimenId (a business identifier, not a Mongo _id) — SAMPLE_OID is
// still used as the wire-request identifier in most tests below (the
// resolution logic accepts an _id, a specimenId, or a legacy numeric
// sampleID), but the persisted/returned Result document's own field is
// this separate value.
const SPECIMEN_ID = 'SPX-628-1';

const FAKE_RESULT = {
  _id: RESULT_OID,
  specimenId: SPECIMEN_ID,
  fileType: 'PDF',
  resultFilePath: '/tmp/whatever.pdf',
  filePath: '/tmp/whatever.pdf',
};

beforeEach(() => { givenSession(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('GET /api/results', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/results');
    expect(res.status).toBe(401);
  });

  it('returns 503 when db is unavailable', async () => {
    app.locals.db = null;
    const res = await request(app).get('/api/results').set('Authorization', `Bearer ${makeToken(4)}`);
    expect(res.status).toBe(503);
  });

  it('returns the result list and applies the importJobID filter', async () => {
    const findSpy = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([FAKE_RESULT]) });
    const resultsColl = createCollectionMock({ find: findSpy });
    app.locals.db = createDbMock({ results: resultsColl });

    const res = await request(app)
      .get('/api/results')
      .query({ importJobID: 'job-1' })
      .set('Authorization', `Bearer ${makeToken(4)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([FAKE_RESULT]);
    expect(findSpy).toHaveBeenCalledWith({ importJobID: 'job-1' });
  });

  it('returns 500 when the results collection throws', async () => {
    const resultsColl = createCollectionMock({
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockRejectedValue(new Error('db down')) }),
    });
    app.locals.db = createDbMock({ results: resultsColl });

    const res = await request(app).get('/api/results').set('Authorization', `Bearer ${makeToken(4)}`);
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('db down');
  });

  it('returns the full list when no importJobID filter is supplied', async () => {
    const findSpy = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([FAKE_RESULT]) });
    const resultsColl = createCollectionMock({ find: findSpy });
    app.locals.db = createDbMock({ results: resultsColl });

    const res = await request(app).get('/api/results').set('Authorization', `Bearer ${makeToken(4)}`);

    expect(res.status).toBe(200);
    expect(findSpy).toHaveBeenCalledWith({});
  });
});

describe('GET /api/results/:id', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get(`/api/results/${RESULT_OID}`);
    expect(res.status).toBe(401);
  });

  it('returns the result when found', async () => {
    const resultsColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue(FAKE_RESULT) });
    app.locals.db = createDbMock({ results: resultsColl });

    const res = await request(app).get(`/api/results/${RESULT_OID}`).set('Authorization', `Bearer ${makeToken(4)}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(FAKE_RESULT);
  });

  it('returns 404 when not found', async () => {
    const resultsColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) });
    app.locals.db = createDbMock({ results: resultsColl });

    const res = await request(app).get(`/api/results/${RESULT_OID}`).set('Authorization', `Bearer ${makeToken(4)}`);
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('returns 500 when id is not a valid ObjectId (unhandled cast error)', async () => {
    app.locals.db = createDbMock({ results: createCollectionMock() });

    const res = await request(app).get('/api/results/not-a-valid-id').set('Authorization', `Bearer ${makeToken(4)}`);
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });

  it('returns 500 when the results collection throws', async () => {
    const resultsColl = createCollectionMock({ findOne: vi.fn().mockRejectedValue(new Error('lookup failed')) });
    app.locals.db = createDbMock({ results: resultsColl });

    const res = await request(app).get(`/api/results/${RESULT_OID}`).set('Authorization', `Bearer ${makeToken(4)}`);
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('lookup failed');
  });
});

describe('GET /api/results/:id/download', () => {
  it('returns 404 when the result does not exist', async () => {
    const resultsColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) });
    app.locals.db = createDbMock({ results: resultsColl });

    const res = await request(app).get(`/api/results/${RESULT_OID}/download`).set('Authorization', `Bearer ${makeToken(4)}`);
    expect(res.status).toBe(404);
  });

  it('redirects (200 + url) when filePath is an external URL', async () => {
    const remoteResult = { ...FAKE_RESULT, filePath: 'https://cdn.example.com/file.pdf' };
    const resultsColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue(remoteResult) });
    app.locals.db = createDbMock({ results: resultsColl });

    const res = await request(app).get(`/api/results/${RESULT_OID}/download`).set('Authorization', `Bearer ${makeToken(4)}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ redirect: true, url: 'https://cdn.example.com/file.pdf' });
  });

  it('returns 404 when the local file path does not exist on disk', async () => {
    const localResult = { ...FAKE_RESULT, filePath: path.join(__dirname, 'does-not-exist-xyz.pdf') };
    const resultsColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue(localResult) });
    app.locals.db = createDbMock({ results: resultsColl });

    const res = await request(app).get(`/api/results/${RESULT_OID}/download`).set('Authorization', `Bearer ${makeToken(4)}`);
    expect(res.status).toBe(404);
  });

  it('returns 500 when the collection throws', async () => {
    const resultsColl = createCollectionMock({ findOne: vi.fn().mockRejectedValue(new Error('boom')) });
    app.locals.db = createDbMock({ results: resultsColl });

    const res = await request(app).get(`/api/results/${RESULT_OID}/download`).set('Authorization', `Bearer ${makeToken(4)}`);
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('boom');
  });

  it('returns 404 when the result has no filePath at all', async () => {
    const noPathResult = { ...FAKE_RESULT, filePath: undefined };
    const resultsColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue(noPathResult) });
    app.locals.db = createDbMock({ results: resultsColl });

    const res = await request(app).get(`/api/results/${RESULT_OID}/download`).set('Authorization', `Bearer ${makeToken(4)}`);
    expect(res.status).toBe(404);
  });

  it('streams the file when the local path exists on disk', async () => {
    const filePath = path.join(__dirname, 'download-fixture.pdf');
    fs.writeFileSync(filePath, '%PDF-1.4 fixture');
    const localResult = { ...FAKE_RESULT, filePath };
    const resultsColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue(localResult) });
    app.locals.db = createDbMock({ results: resultsColl });

    try {
      const res = await request(app).get(`/api/results/${RESULT_OID}/download`).set('Authorization', `Bearer ${makeToken(4)}`);
      expect(res.status).toBe(200);
    } finally {
      fs.rmSync(filePath, { force: true });
    }
  });
});

describe('POST /api/results/upload', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).post('/api/results/upload').send({});
    expect(res.status).toBe(401);
  });

  it('returns 403 for a role without uploadFiles permission (accessType 1)', async () => {
    app.locals.db = createDbMock({});
    const res = await request(app)
      .post('/api/results/upload')
      .set('Authorization', `Bearer ${makeToken(1)}`)
      .field('specimenId', SAMPLE_OID);
    expect(res.status).toBe(403);
  });

  it('returns 503 when db is unavailable', async () => {
    app.locals.db = null;
    const res = await request(app)
      .post('/api/results/upload')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .field('specimenId', SAMPLE_OID)
      .attach('file', Buffer.from('%PDF-1.4 test'), 'test.pdf');

    expect(res.status).toBe(503);

    const resultDir = path.join(__dirname, '../../storage/results', SAMPLE_OID);
    if (fs.existsSync(resultDir)) fs.rmSync(resultDir, { recursive: true, force: true });
  });

  it('falls back to the legacy numeric sampleID lookup when _id and specimenId both miss', async () => {
    // #628: three-tier resolution -- _id, then specimenId, then the
    // legacy numeric Sample.sampleID -- only the third tier's query
    // actually matches here, proving the fallback itself works rather
    // than an earlier tier accidentally short-circuiting it.
    const sampleDoc = { _id: new ObjectId(), specimenId: SPECIMEN_ID, sampleID: 42 };
    const findOneSpy = vi.fn().mockImplementation(async (query) => (
      Object.prototype.hasOwnProperty.call(query, 'sampleID') ? sampleDoc : null
    ));
    const amostrasColl = createCollectionMock({ findOne: findOneSpy });
    const insertOne = vi.fn().mockResolvedValue({ insertedId: new ObjectId() });
    app.locals.db = createDbMock({ amostras: amostrasColl, results: createCollectionMock({ insertOne }) });
    vi.spyOn(consentValidator, 'validateAccess').mockResolvedValue(true);

    const res = await request(app)
      .post('/api/results/upload')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .field('specimenId', '42')
      .attach('file', Buffer.from('%PDF-1.4 test'), 'test.pdf');

    expect(res.status).toBe(201);
    expect(findOneSpy).toHaveBeenCalledWith({ specimenId: '42' });
    expect(findOneSpy).toHaveBeenCalledWith({ sampleID: 42 });
    expect(res.body.data.specimenId).toBe(SPECIMEN_ID);

    const resultDir = path.join(__dirname, '../../storage/results', '42');
    if (fs.existsSync(resultDir)) fs.rmSync(resultDir, { recursive: true, force: true });
  });

  it('returns 400 and cleans up the temp file when the insert throws', async () => {
    const sampleDoc = { _id: new ObjectId(SAMPLE_OID), specimenId: SPECIMEN_ID };
    const amostrasColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue(sampleDoc) });
    const insertOne = vi.fn().mockRejectedValue(new Error('insert failed'));
    app.locals.db = createDbMock({ amostras: amostrasColl, results: createCollectionMock({ insertOne }) });
    vi.spyOn(consentValidator, 'validateAccess').mockResolvedValue(true);

    const res = await request(app)
      .post('/api/results/upload')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .field('specimenId', SAMPLE_OID)
      .attach('file', Buffer.from('%PDF-1.4 test'), 'test.pdf');

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('insert failed');

    const resultDir = path.join(__dirname, '../../storage/results', SAMPLE_OID);
    if (fs.existsSync(resultDir)) fs.rmSync(resultDir, { recursive: true, force: true });
  });

  it('resolves specimenId from the parsed multipart body when checking commercial consent', async () => {
    const sampleDoc = { _id: new ObjectId(SAMPLE_OID), specimenId: SPECIMEN_ID };
    const amostrasColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue(sampleDoc) });
    app.locals.db = createDbMock({ amostras: amostrasColl, results: createCollectionMock() });
    const spy = vi.spyOn(consentValidator, 'validateAccess').mockResolvedValue(true);

    await request(app)
      .post('/api/results/upload')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .field('specimenId', SAMPLE_OID)
      .attach('file', Buffer.from('%PDF-1.4 test'), 'test.pdf');

    // resultUpload (multer) now runs before enforceCommercialConsent, so
    // req.body.specimenId is populated from the multipart stream by the
    // time consent validation resolves it.
    expect(spy).toHaveBeenCalledWith(SAMPLE_OID, 'uso_comercial');

    const resultDir = path.join(__dirname, '../../storage/results', SAMPLE_OID);
    if (fs.existsSync(resultDir)) fs.rmSync(resultDir, { recursive: true, force: true });
  });

  it('returns 403 when consent validation rejects the request', async () => {
    app.locals.db = createDbMock({});
    vi.spyOn(consentValidator, 'validateAccess').mockRejectedValue(new Error('sem consentimento'));

    const res = await request(app)
      .post('/api/results/upload')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .field('specimenId', SAMPLE_OID)
      .attach('file', Buffer.from('%PDF-1.4 test'), 'test.pdf');

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('sem consentimento');
  });

  it('returns 400 when no file is attached', async () => {
    app.locals.db = createDbMock({});
    vi.spyOn(consentValidator, 'validateAccess').mockResolvedValue(true);

    const res = await request(app)
      .post('/api/results/upload')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .field('specimenId', SAMPLE_OID);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Arquivo não fornecido');
  });

  it('returns 404 and removes the temp file when the sample is not found', async () => {
    const amostrasColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) });
    app.locals.db = createDbMock({ amostras: amostrasColl, results: createCollectionMock() });
    vi.spyOn(consentValidator, 'validateAccess').mockResolvedValue(true);

    const res = await request(app)
      .post('/api/results/upload')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .field('specimenId', SAMPLE_OID)
      .attach('file', Buffer.from('%PDF-1.4 test'), 'test.pdf');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Amostra não encontrada');

    // Cleanup any file written by multer's diskStorage before the route deleted it
    const resultDir = path.join(__dirname, '../../storage/results', SAMPLE_OID);
    if (fs.existsSync(resultDir)) fs.rmSync(resultDir, { recursive: true, force: true });
  });

  it('returns 400 for an invalid analysis method', async () => {
    const sampleDoc = { _id: new ObjectId(SAMPLE_OID), specimenId: SPECIMEN_ID };
    const amostrasColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue(sampleDoc) });
    app.locals.db = createDbMock({ amostras: amostrasColl, results: createCollectionMock() });
    vi.spyOn(consentValidator, 'validateAccess').mockResolvedValue(true);

    const res = await request(app)
      .post('/api/results/upload')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .field('specimenId', SAMPLE_OID)
      .field('method', 'Método Inexistente')
      .attach('file', Buffer.from('%PDF-1.4 test'), 'test.pdf');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid Analysis Method');

    const resultDir = path.join(__dirname, '../../storage/results', SAMPLE_OID);
    if (fs.existsSync(resultDir)) fs.rmSync(resultDir, { recursive: true, force: true });
  });

  it('creates the result on success, storing the sample\'s own specimenId, and stores the file under storage/results/<specimenId-as-sent>', async () => {
    const sampleDoc = { _id: new ObjectId(SAMPLE_OID), specimenId: SPECIMEN_ID };
    const amostrasColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue(sampleDoc) });
    const insertOne = vi.fn().mockResolvedValue({ insertedId: new ObjectId() });
    const resultsColl = createCollectionMock({ insertOne });
    app.locals.db = createDbMock({ amostras: amostrasColl, results: resultsColl });
    vi.spyOn(consentValidator, 'validateAccess').mockResolvedValue(true);

    const res = await request(app)
      .post('/api/results/upload')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .field('specimenId', SAMPLE_OID)
      .field('description', 'a description')
      .attach('file', Buffer.from('%PDF-1.4 test'), 'test.pdf');

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.fileType).toBe('PDF');
    // #628: the persisted/returned specimenId is always the resolved
    // Sample's own field -- never the raw wire value (SAMPLE_OID here is
    // a Mongo _id, not the sample's specimenId).
    expect(res.body.data.specimenId).toBe(SPECIMEN_ID);
    expect(insertOne).toHaveBeenCalledTimes(1);

    const resultDir = path.join(__dirname, '../../storage/results', SAMPLE_OID);
    expect(fs.existsSync(resultDir)).toBe(true);
    fs.rmSync(resultDir, { recursive: true, force: true });
  });

  it('accepts .zip, .csv, and .raw as valid result file extensions', async () => {
    const sampleDoc = { _id: new ObjectId(SAMPLE_OID), specimenId: SPECIMEN_ID };
    const amostrasColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue(sampleDoc) });
    vi.spyOn(consentValidator, 'validateAccess').mockResolvedValue(true);

    for (const [ext, expectedType] of [['zip', 'ZIP'], ['csv', 'CSV'], ['raw', 'RAW']]) {
      const insertOne = vi.fn().mockResolvedValue({ insertedId: new ObjectId() });
      app.locals.db = createDbMock({ amostras: amostrasColl, results: createCollectionMock({ insertOne }) });

      const res = await request(app)
        .post('/api/results/upload')
        .set('Authorization', `Bearer ${makeToken(2)}`)
        .field('specimenId', SAMPLE_OID)
        .attach('file', Buffer.from('content'), `test.${ext}`);

      expect(res.status).toBe(201);
      expect(res.body.data.fileType).toBe(expectedType);
    }

    const resultDir = path.join(__dirname, '../../storage/results', SAMPLE_OID);
    if (fs.existsSync(resultDir)) fs.rmSync(resultDir, { recursive: true, force: true });
  });

  it('stores equipmentID as a number when provided', async () => {
    const sampleDoc = { _id: new ObjectId(SAMPLE_OID), specimenId: SPECIMEN_ID };
    const amostrasColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue(sampleDoc) });
    const insertOne = vi.fn().mockResolvedValue({ insertedId: new ObjectId() });
    app.locals.db = createDbMock({ amostras: amostrasColl, results: createCollectionMock({ insertOne }) });
    vi.spyOn(consentValidator, 'validateAccess').mockResolvedValue(true);

    const res = await request(app)
      .post('/api/results/upload')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .field('specimenId', SAMPLE_OID)
      .field('equipmentID', '7')
      .attach('file', Buffer.from('%PDF-1.4 test'), 'test.pdf');

    expect(res.status).toBe(201);
    expect(res.body.data.equipmentID).toBe(7);

    const resultDir = path.join(__dirname, '../../storage/results', SAMPLE_OID);
    if (fs.existsSync(resultDir)) fs.rmSync(resultDir, { recursive: true, force: true });
  });

  it('rejects the upload (multer storage error) when specimenId is missing but a file is attached', async () => {
    app.locals.db = createDbMock({});
    vi.spyOn(consentValidator, 'validateAccess').mockResolvedValue(true);

    const res = await request(app)
      .post('/api/results/upload')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .attach('file', Buffer.from('%PDF-1.4 test'), 'test.pdf');

    // multer's diskStorage.destination calls cb(new Error('specimenId é
    // obrigatório')) before any directory is created; that becomes an
    // unhandled error passed to next(), same fallback as the fileFilter
    // rejection case above.
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('sample-not-found cleanup skips unlink when the temp file no longer exists on disk', async () => {
    const amostrasColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) });
    app.locals.db = createDbMock({ amostras: amostrasColl, results: createCollectionMock() });
    vi.spyOn(consentValidator, 'validateAccess').mockResolvedValue(true);
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    const res = await request(app)
      .post('/api/results/upload')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .field('specimenId', SAMPLE_OID)
      .attach('file', Buffer.from('%PDF-1.4 test'), 'test.pdf');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Amostra não encontrada');

    existsSpy.mockRestore();
    const resultDir = path.join(__dirname, '../../storage/results', SAMPLE_OID);
    if (fs.existsSync(resultDir)) fs.rmSync(resultDir, { recursive: true, force: true });
  });

  it('invalid-method cleanup skips unlink when the temp file no longer exists on disk', async () => {
    const sampleDoc = { _id: new ObjectId(SAMPLE_OID), specimenId: SPECIMEN_ID };
    const amostrasColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue(sampleDoc) });
    app.locals.db = createDbMock({ amostras: amostrasColl, results: createCollectionMock() });
    vi.spyOn(consentValidator, 'validateAccess').mockResolvedValue(true);
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    const res = await request(app)
      .post('/api/results/upload')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .field('specimenId', SAMPLE_OID)
      .field('method', 'Método Inexistente')
      .attach('file', Buffer.from('%PDF-1.4 test'), 'test.pdf');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid Analysis Method');

    existsSpy.mockRestore();
    const resultDir = path.join(__dirname, '../../storage/results', SAMPLE_OID);
    if (fs.existsSync(resultDir)) fs.rmSync(resultDir, { recursive: true, force: true });
  });

  it('insert-failure cleanup skips unlink when the temp file no longer exists on disk', async () => {
    const sampleDoc = { _id: new ObjectId(SAMPLE_OID), specimenId: SPECIMEN_ID };
    const amostrasColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue(sampleDoc) });
    const insertOne = vi.fn().mockRejectedValue(new Error('insert failed'));
    app.locals.db = createDbMock({ amostras: amostrasColl, results: createCollectionMock({ insertOne }) });
    vi.spyOn(consentValidator, 'validateAccess').mockResolvedValue(true);
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    const res = await request(app)
      .post('/api/results/upload')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .field('specimenId', SAMPLE_OID)
      .attach('file', Buffer.from('%PDF-1.4 test'), 'test.pdf');

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('insert failed');

    existsSpy.mockRestore();
    const resultDir = path.join(__dirname, '../../storage/results', SAMPLE_OID);
    if (fs.existsSync(resultDir)) fs.rmSync(resultDir, { recursive: true, force: true });
  });

  it('logs (does not throw) when the catch-block cleanup unlink itself fails', async () => {
    const sampleDoc = { _id: new ObjectId(SAMPLE_OID), specimenId: SPECIMEN_ID };
    const amostrasColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue(sampleDoc) });
    const insertOne = vi.fn().mockRejectedValue(new Error('insert failed'));
    app.locals.db = createDbMock({ amostras: amostrasColl, results: createCollectionMock({ insertOne }) });
    vi.spyOn(consentValidator, 'validateAccess').mockResolvedValue(true);
    const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => { throw new Error('unlink boom'); });

    const res = await request(app)
      .post('/api/results/upload')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .field('specimenId', SAMPLE_OID)
      .attach('file', Buffer.from('%PDF-1.4 test'), 'test.pdf');

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('insert failed');

    unlinkSpy.mockRestore();
    const resultDir = path.join(__dirname, '../../storage/results', SAMPLE_OID);
    if (fs.existsSync(resultDir)) fs.rmSync(resultDir, { recursive: true, force: true });
  });

  it('rejects the upload (multer storage error) when the destination directory cannot be created', async () => {
    const sampleDoc = { _id: new ObjectId(SAMPLE_OID), specimenId: SPECIMEN_ID };
    const amostrasColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue(sampleDoc) });
    app.locals.db = createDbMock({ amostras: amostrasColl, results: createCollectionMock() });
    vi.spyOn(consentValidator, 'validateAccess').mockResolvedValue(true);
    const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => { throw new Error('mkdir boom'); });

    const res = await request(app)
      .post('/api/results/upload')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .field('specimenId', SAMPLE_OID)
      .attach('file', Buffer.from('%PDF-1.4 test'), 'test.pdf');

    // resultStorage.destination's own try/catch turns the mkdirSync throw
    // into cb(error, null), which multer surfaces as an unhandled error.
    expect(res.status).toBeGreaterThanOrEqual(400);

    mkdirSpy.mockRestore();
    const resultDir = path.join(__dirname, '../../storage/results', SAMPLE_OID);
    if (fs.existsSync(resultDir)) fs.rmSync(resultDir, { recursive: true, force: true });
  });

  it('rejects the upload (multer storage error) when the unique filename cannot be generated', async () => {
    const sampleDoc = { _id: new ObjectId(SAMPLE_OID), specimenId: SPECIMEN_ID };
    const amostrasColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue(sampleDoc) });
    app.locals.db = createDbMock({ amostras: amostrasColl, results: createCollectionMock() });
    vi.spyOn(consentValidator, 'validateAccess').mockResolvedValue(true);
    const realRandomBytes = crypto.randomBytes;
    const randomBytesSpy = vi.spyOn(crypto, 'randomBytes').mockImplementation((size, ...rest) => {
      // form-data's own boundary generation also calls crypto.randomBytes
      // (with size 12) while building the multipart request client-side;
      // only fail the server-side diskStorage call (size 16) for a
      // filename-generation-catch test, not the client request itself.
      if (size === 16) throw new Error('random boom');
      return realRandomBytes(size, ...rest);
    });

    const res = await request(app)
      .post('/api/results/upload')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .field('specimenId', SAMPLE_OID)
      .attach('file', Buffer.from('%PDF-1.4 test'), 'test.pdf');

    // resultStorage.filename's own try/catch turns the crypto.randomBytes
    // throw into cb(error, null), which multer surfaces as an unhandled error.
    expect(res.status).toBeGreaterThanOrEqual(400);

    randomBytesSpy.mockRestore();
    const resultDir = path.join(__dirname, '../../storage/results', SAMPLE_OID);
    if (fs.existsSync(resultDir)) fs.rmSync(resultDir, { recursive: true, force: true });
  });

  it('rejects unsupported file extensions with a 400 from multer fileFilter', async () => {
    const sampleDoc = { _id: new ObjectId(SAMPLE_OID), specimenId: SPECIMEN_ID };
    const amostrasColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue(sampleDoc) });
    app.locals.db = createDbMock({ amostras: amostrasColl, results: createCollectionMock() });
    vi.spyOn(consentValidator, 'validateAccess').mockResolvedValue(true);

    const res = await request(app)
      .post('/api/results/upload')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .field('specimenId', SAMPLE_OID)
      .attach('file', Buffer.from('hello'), 'test.exe');

    // multer's fileFilter calls cb(new Error(...), false) which becomes an
    // unhandled error passed to next(); there is no app-level error handler,
    // so Express falls back to its default error responder.
    expect(res.status).toBeGreaterThanOrEqual(400);

    const resultDir = path.join(__dirname, '../../storage/results', SAMPLE_OID);
    if (fs.existsSync(resultDir)) fs.rmSync(resultDir, { recursive: true, force: true });
  });
});

describe('POST /api/results', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).post('/api/results').send({});
    expect(res.status).toBe(401);
  });

  it('returns 403 for a role without createResult permission (accessType 2)', async () => {
    app.locals.db = createDbMock({});
    const res = await request(app)
      .post('/api/results')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send({ specimenId: SAMPLE_OID, fileType: 'PDF', resultFilePath: '/x.pdf' });
    expect(res.status).toBe(403);
  });

  it('returns 403 when consent validation rejects (specimenId resolved from JSON body)', async () => {
    app.locals.db = createDbMock({});
    const spy = vi.spyOn(consentValidator, 'validateAccess').mockRejectedValue(new Error('sem consentimento'));

    const res = await request(app)
      .post('/api/results')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ specimenId: SAMPLE_OID, fileType: 'PDF', resultFilePath: '/x.pdf' });

    expect(res.status).toBe(403);
    expect(spy).toHaveBeenCalledWith(SAMPLE_OID, 'uso_comercial');
  });

  it('returns 422 for invalid payload (missing fileType/resultFilePath)', async () => {
    const amostrasColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue({ _id: new ObjectId(SAMPLE_OID), specimenId: SPECIMEN_ID }) });
    app.locals.db = createDbMock({ amostras: amostrasColl });
    vi.spyOn(consentValidator, 'validateAccess').mockResolvedValue(true);

    const res = await request(app)
      .post('/api/results')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ specimenId: SAMPLE_OID });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('Dados inválidos');
  });

  it('returns 404 when the referenced sample does not exist', async () => {
    const amostrasColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) });
    app.locals.db = createDbMock({ amostras: amostrasColl });
    vi.spyOn(consentValidator, 'validateAccess').mockResolvedValue(true);

    const res = await request(app)
      .post('/api/results')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ specimenId: SAMPLE_OID, fileType: 'PDF', resultFilePath: '/x.pdf' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Amostra não encontrada');
  });

  it('creates a result record on success, storing the sample\'s own specimenId', async () => {
    const amostrasColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue({ _id: new ObjectId(SAMPLE_OID), specimenId: SPECIMEN_ID }) });
    const insertOne = vi.fn().mockResolvedValue({ insertedId: new ObjectId() });
    app.locals.db = createDbMock({ amostras: amostrasColl, results: createCollectionMock({ insertOne }) });
    vi.spyOn(consentValidator, 'validateAccess').mockResolvedValue(true);

    const res = await request(app)
      .post('/api/results')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ specimenId: SAMPLE_OID, fileType: 'PDF', resultFilePath: '/x.pdf' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.specimenId).toBe(SPECIMEN_ID);
    expect(insertOne).toHaveBeenCalledTimes(1);
  });

  it('returns 503 when db is unavailable', async () => {
    app.locals.db = null;
    const res = await request(app)
      .post('/api/results')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ specimenId: SAMPLE_OID, fileType: 'PDF', resultFilePath: '/x.pdf' });
    expect(res.status).toBe(503);
  });

  it('returns 400 when the insert throws', async () => {
    const amostrasColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue({ _id: new ObjectId(SAMPLE_OID), specimenId: SPECIMEN_ID }) });
    const insertOne = vi.fn().mockRejectedValue(new Error('insert failed'));
    app.locals.db = createDbMock({ amostras: amostrasColl, results: createCollectionMock({ insertOne }) });
    vi.spyOn(consentValidator, 'validateAccess').mockResolvedValue(true);

    const res = await request(app)
      .post('/api/results')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ specimenId: SAMPLE_OID, fileType: 'PDF', resultFilePath: '/x.pdf' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('insert failed');
  });
});

describe('PUT /api/results/:id', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).put(`/api/results/${RESULT_OID}`).send({});
    expect(res.status).toBe(401);
  });

  it('returns 403 for a role without editResult permission', async () => {
    app.locals.db = createDbMock({});
    const res = await request(app)
      .put(`/api/results/${RESULT_OID}`)
      .set('Authorization', `Bearer ${makeToken(1)}`)
      .send({ description: 'new' });
    expect(res.status).toBe(403);
  });

  it('returns 404 when no document matches', async () => {
    const resultsColl = createCollectionMock({ updateOne: vi.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 }) });
    app.locals.db = createDbMock({ results: resultsColl });

    const res = await request(app)
      .put(`/api/results/${RESULT_OID}`)
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ description: 'new' });

    expect(res.status).toBe(404);
  });

  it('updates the result on success', async () => {
    const resultsColl = createCollectionMock({ updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }) });
    app.locals.db = createDbMock({ results: resultsColl });

    const res = await request(app)
      .put(`/api/results/${RESULT_OID}`)
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ description: 'new' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // #628: specimenId is a reference resolved from a real Sample lookup
  // (POST /upload, POST /, PUT /:id/link-sample) -- this generic update
  // must not let a caller overwrite it (or its legacy aliases) via a
  // plain $set; use PUT /:id/link-sample to change the linked sample.
  it('strips specimenId/sampleID/sampleId from the body before $set, even when the caller sends them', async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const resultsColl = createCollectionMock({ updateOne });
    app.locals.db = createDbMock({ results: resultsColl });

    const res = await request(app)
      .put(`/api/results/${RESULT_OID}`)
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ description: 'new', specimenId: 'attacker-supplied', sampleID: 'also-attacker-supplied', sampleId: 'still-attacker-supplied' });

    expect(res.status).toBe(200);
    expect(updateOne).toHaveBeenCalledWith(
      { _id: expect.any(ObjectId) },
      { $set: { description: 'new', updatedAt: expect.any(Date) } }
    );
  });

  // #875: the previous implementation only denylisted specimenId/sampleID/
  // sampleId and spread every other body key into $set -- an unrecognized
  // key like `injected` sailed through untouched. The allowlist must drop
  // it too, not just the identity/linkage fields covered by #628 above.
  it('drops unrecognized keys from the body before $set (#875)', async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const resultsColl = createCollectionMock({ updateOne });
    app.locals.db = createDbMock({ results: resultsColl });

    const res = await request(app)
      .put(`/api/results/${RESULT_OID}`)
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ description: 'new', injected: 'x', specimenId: 'inj' });

    expect(res.status).toBe(200);
    expect(updateOne).toHaveBeenCalledWith(
      { _id: expect.any(ObjectId) },
      { $set: { description: 'new', updatedAt: expect.any(Date) } }
    );
  });

  it('returns 503 when db is unavailable', async () => {
    app.locals.db = null;
    const res = await request(app)
      .put(`/api/results/${RESULT_OID}`)
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ description: 'new' });
    expect(res.status).toBe(503);
  });

  it('returns 400 when the update throws', async () => {
    const resultsColl = createCollectionMock({ updateOne: vi.fn().mockRejectedValue(new Error('update failed')) });
    app.locals.db = createDbMock({ results: resultsColl });

    const res = await request(app)
      .put(`/api/results/${RESULT_OID}`)
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ description: 'new' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('update failed');
  });
});

describe('PUT /api/results/:id/link-sample', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).put(`/api/results/${RESULT_OID}/link-sample`).send({});
    expect(res.status).toBe(401);
  });

  it('returns 403 for a role without editResult permission', async () => {
    app.locals.db = createDbMock({});
    const res = await request(app)
      .put(`/api/results/${RESULT_OID}/link-sample`)
      .set('Authorization', `Bearer ${makeToken(1)}`)
      .send({ specimenId: SAMPLE_OID });
    expect(res.status).toBe(403);
  });

  it('returns 400 when specimenId is missing', async () => {
    app.locals.db = createDbMock({});
    const res = await request(app)
      .put(`/api/results/${RESULT_OID}/link-sample`)
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('specimenId é obrigatório');
  });

  it('returns 404 when the referenced sample does not exist', async () => {
    const amostrasColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) });
    app.locals.db = createDbMock({ amostras: amostrasColl, results: createCollectionMock() });

    const res = await request(app)
      .put(`/api/results/${RESULT_OID}/link-sample`)
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ specimenId: SAMPLE_OID });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Amostra não encontrada');
  });

  it('returns 404 when no result document matches', async () => {
    const amostrasColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue({ _id: new ObjectId(SAMPLE_OID), specimenId: SPECIMEN_ID }) });
    const resultsColl = createCollectionMock({ updateOne: vi.fn().mockResolvedValue({ matchedCount: 0 }) });
    app.locals.db = createDbMock({ amostras: amostrasColl, results: resultsColl });

    const res = await request(app)
      .put(`/api/results/${RESULT_OID}/link-sample`)
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ specimenId: SAMPLE_OID });

    expect(res.status).toBe(404);
  });

  it('links the sample on success, storing the sample\'s own specimenId', async () => {
    const amostrasColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue({ _id: new ObjectId(SAMPLE_OID), specimenId: SPECIMEN_ID }) });
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const resultsColl = createCollectionMock({ updateOne });
    app.locals.db = createDbMock({ amostras: amostrasColl, results: resultsColl });

    const res = await request(app)
      .put(`/api/results/${RESULT_OID}/link-sample`)
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ specimenId: SAMPLE_OID });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(updateOne).toHaveBeenCalledWith(
      { _id: expect.any(ObjectId) },
      { $set: { specimenId: SPECIMEN_ID, updatedAt: expect.any(Date) } }
    );
  });

  it('returns 503 when db is unavailable', async () => {
    app.locals.db = null;
    const res = await request(app)
      .put(`/api/results/${RESULT_OID}/link-sample`)
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ specimenId: SAMPLE_OID });
    expect(res.status).toBe(503);
  });

  it('returns 400 when the update throws', async () => {
    const amostrasColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue({ _id: new ObjectId(SAMPLE_OID), specimenId: SPECIMEN_ID }) });
    const resultsColl = createCollectionMock({ updateOne: vi.fn().mockRejectedValue(new Error('link failed')) });
    app.locals.db = createDbMock({ amostras: amostrasColl, results: resultsColl });

    const res = await request(app)
      .put(`/api/results/${RESULT_OID}/link-sample`)
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ specimenId: SAMPLE_OID });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('link failed');
  });
});

describe('DELETE /api/results/:id', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).delete(`/api/results/${RESULT_OID}`);
    expect(res.status).toBe(401);
  });

  it('returns 403 for a role without deleteResult permission', async () => {
    app.locals.db = createDbMock({});
    const res = await request(app)
      .delete(`/api/results/${RESULT_OID}`)
      .set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(403);
  });

  it('returns 404 when nothing was deleted', async () => {
    const resultsColl = createCollectionMock({ deleteOne: vi.fn().mockResolvedValue({ deletedCount: 0 }) });
    app.locals.db = createDbMock({ results: resultsColl });

    const res = await request(app)
      .delete(`/api/results/${RESULT_OID}`)
      .set('Authorization', `Bearer ${makeToken(4)}`);

    expect(res.status).toBe(404);
  });

  it('deletes the result on success', async () => {
    const resultsColl = createCollectionMock({ deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }) });
    app.locals.db = createDbMock({ results: resultsColl });

    const res = await request(app)
      .delete(`/api/results/${RESULT_OID}`)
      .set('Authorization', `Bearer ${makeToken(4)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 503 when db is unavailable', async () => {
    app.locals.db = null;
    const res = await request(app)
      .delete(`/api/results/${RESULT_OID}`)
      .set('Authorization', `Bearer ${makeToken(4)}`);
    expect(res.status).toBe(503);
  });

  it('returns 400 when the delete throws', async () => {
    const resultsColl = createCollectionMock({ deleteOne: vi.fn().mockRejectedValue(new Error('delete failed')) });
    app.locals.db = createDbMock({ results: resultsColl });

    const res = await request(app)
      .delete(`/api/results/${RESULT_OID}`)
      .set('Authorization', `Bearer ${makeToken(4)}`);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('delete failed');
  });
});

// #910: ROUTE_ACCESS granted Usuario Externo ALL_ROLES on /results, and the
// three backend read routes carried `authenticate` ONLY -- no permission, no
// organization scope. Any authenticated principal could list every analysis
// result, read any by id, and DOWNLOAD any result file, which is the analysis
// data itself rather than a summary. RF002 AC#4 entitles Usuario Externo to
// "somente dados e relatorios previamente autorizados"; RNF008 AC#1 makes
// deny-by-default the policy.
//
// Every pre-existing test in this file authenticates as makeToken(4)
// (Administrador -> scope 'global'), so none of them exercises the gate at
// all -- they were green before this fix and after it. These are the tests
// that would go red if the gate were removed.
describe('GET /api/results organization scoping (#910)', () => {
  const IN_SCOPE_SPECIMEN = 'SPX-IN-SCOPE';
  const OUT_SCOPE_SPECIMEN = 'SPX-OTHER-ORG';
  // buildRbacCollections gives every non-accessType-4 user
  // scopeType 'organization' with scopeId 'test-org-default'.
  const MY_ORG = 'test-org-default';

  const SAMPLES = [
    { specimenId: IN_SCOPE_SPECIMEN, collectionSite: MY_ORG },
    { specimenId: OUT_SCOPE_SPECIMEN, collectionSite: 'some-other-org' },
  ];

  // Honours the filter it is handed rather than returning a canned list --
  // a distinct() mock that ignored its filter would pass whether or not the
  // route scoped anything, which is the #797/#803 mock-fidelity trap.
  function amostrasMock() {
    return createCollectionMock({
      distinct: vi.fn(async (field, filter = {}) => {
        const allowed = filter.collectionSite && filter.collectionSite.$in;
        const matched = allowed
          ? SAMPLES.filter((d) => allowed.includes(d.collectionSite))
          : SAMPLES;
        return [...new Set(matched.map((d) => d[field]))];
      }),
      findOne: vi.fn(async (query = {}) => SAMPLES.find((d) => d.specimenId === query.specimenId) || null),
    });
  }

  it('narrows the list query to the specimenIds of in-scope samples', async () => {
    const findSpy = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
    app.locals.db = createDbMock({ results: createCollectionMock({ find: findSpy }), amostras: amostrasMock() });

    const res = await request(app).get('/api/results').set('Authorization', `Bearer ${makeToken(2)}`);

    expect(res.status).toBe(200);
    expect(findSpy).toHaveBeenCalledWith({ specimenId: { $in: [IN_SCOPE_SPECIMEN] } });
  });

  it('leaves the list query unfiltered for a global scope, preserving the Administrador bypass', async () => {
    const findSpy = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
    app.locals.db = createDbMock({ results: createCollectionMock({ find: findSpy }), amostras: amostrasMock() });

    const res = await request(app).get('/api/results').set('Authorization', `Bearer ${makeToken(4)}`);

    expect(res.status).toBe(200);
    expect(findSpy).toHaveBeenCalledWith({});
  });

  it('403s a detail read of a result whose sample belongs to another organization', async () => {
    const outOfScope = { ...FAKE_RESULT, specimenId: OUT_SCOPE_SPECIMEN };
    app.locals.db = createDbMock({
      results: createCollectionMock({ findOne: vi.fn().mockResolvedValue(outOfScope) }),
      amostras: amostrasMock(),
    });

    const res = await request(app).get(`/api/results/${RESULT_OID}`).set('Authorization', `Bearer ${makeToken(2)}`);

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Este resultado pertence a outra organização');
  });

  it('allows a detail read of an in-scope result', async () => {
    const inScope = { ...FAKE_RESULT, specimenId: IN_SCOPE_SPECIMEN };
    app.locals.db = createDbMock({
      results: createCollectionMock({ findOne: vi.fn().mockResolvedValue(inScope) }),
      amostras: amostrasMock(),
    });

    const res = await request(app).get(`/api/results/${RESULT_OID}`).set('Authorization', `Bearer ${makeToken(2)}`);

    expect(res.status).toBe(200);
  });

  it('403s the download of an out-of-scope result WITHOUT leaking its external URL', async () => {
    // The sharp leg: this route redirects to result.filePath when it is an
    // external URL, so a check placed after that point would still hand the
    // caller the location of the file.
    const outOfScope = { ...FAKE_RESULT, specimenId: OUT_SCOPE_SPECIMEN, filePath: 'https://example.invalid/secret.pdf' };
    app.locals.db = createDbMock({
      results: createCollectionMock({ findOne: vi.fn().mockResolvedValue(outOfScope) }),
      amostras: amostrasMock(),
    });

    const res = await request(app).get(`/api/results/${RESULT_OID}/download`).set('Authorization', `Bearer ${makeToken(2)}`);

    expect(res.status).toBe(403);
    expect(res.body.redirect).toBeUndefined();
    expect(res.body.url).toBeUndefined();
  });

  it('fails closed when a result has no specimenId to resolve a sample from', async () => {
    // An orphaned result is precisely what an attacker would reach for if the
    // join were treated as "no sample, no restriction".
    const orphan = { ...FAKE_RESULT, specimenId: undefined };
    app.locals.db = createDbMock({
      results: createCollectionMock({ findOne: vi.fn().mockResolvedValue(orphan) }),
      amostras: amostrasMock(),
    });

    const res = await request(app).get(`/api/results/${RESULT_OID}`).set('Authorization', `Bearer ${makeToken(2)}`);

    expect(res.status).toBe(403);
  });
});
