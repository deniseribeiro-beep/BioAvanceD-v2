import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

// #643 (RF007 AC#6): wiring tests for /api/assays/:assayId/files and
// /api/datasets/:datasetId/files -- the shared controller logic itself is
// covered generically by createLinkedFileController.test.js; these only
// confirm the mount + auth/role gating on the real routes.

const rbacCollectionsAdmin = buildRbacCollections([{ userAccountId: 'qa-1', accessType: 4 }]);
const rbacCollectionsTechnician = buildRbacCollections([{ userAccountId: 'qa-2', accessType: 2 }]);

function makeToken(userID, accessType) {
  return jwt.sign(
    { userID, accessType, roleName: accessType >= 3 ? 'Coordenador' : 'Tecnico', name: 'QA', mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function givenSession() {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'sess-1' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'sess-1' });
}

beforeEach(() => { givenSession(); });
afterEach(() => { vi.restoreAllMocks(); });

describe.each([
  { entity: 'assays', idField: 'assayId', fileCollection: 'assayFiles', parentCollection: 'assays' },
  { entity: 'datasets', idField: 'datasetId', fileCollection: 'datasetFiles', parentCollection: 'datasets' }
])('$entity/:id/files', ({ entity, idField, fileCollection, parentCollection }) => {
  describe(`GET /api/${entity}/:id/files`, () => {
    it('returns 401 without token', async () => {
      const res = await request(app).get(`/api/${entity}/some-id/files`);
      expect(res.status).toBe(401);
    });

    it('returns 404 when the parent does not exist', async () => {
      const coll = createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) });
      app.locals.db = createDbMock({ [parentCollection]: coll, ...rbacCollectionsAdmin });

      const res = await request(app)
        .get(`/api/${entity}/missing-id/files`)
        .set('Authorization', `Bearer ${makeToken('qa-1', 4)}`);

      expect(res.status).toBe(404);
    });

    it('returns 200 with the file list for an existing parent', async () => {
      const parentColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue({ [idField]: 'p-1' }) });
      const fileColl = createCollectionMock({ find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) });
      app.locals.db = createDbMock({ [parentCollection]: parentColl, [fileCollection]: fileColl, ...rbacCollectionsAdmin });

      const res = await request(app)
        .get(`/api/${entity}/p-1/files`)
        .set('Authorization', `Bearer ${makeToken('qa-1', 4)}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });
  });

  describe(`POST /api/${entity}/:id/files/upload`, () => {
    it('returns 401 without token', async () => {
      const res = await request(app).post(`/api/${entity}/p-1/files/upload`);
      expect(res.status).toBe(401);
    });

    it('returns 403 for a role below Coordenador', async () => {
      app.locals.db = createDbMock({ ...rbacCollectionsTechnician });

      const res = await request(app)
        .post(`/api/${entity}/p-1/files/upload`)
        .set('Authorization', `Bearer ${makeToken('qa-2', 2)}`)
        .attach('file', Buffer.from('a,b,c'), 'data.csv');

      expect(res.status).toBe(403);
    });

    it('returns 404 when the parent does not exist, for a Coordenador+ role', async () => {
      const parentColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) });
      app.locals.db = createDbMock({ [parentCollection]: parentColl, ...rbacCollectionsAdmin });

      const res = await request(app)
        .post(`/api/${entity}/missing-id/files/upload`)
        .set('Authorization', `Bearer ${makeToken('qa-1', 4)}`)
        .attach('file', Buffer.from('a,b,c'), 'data.csv');

      expect(res.status).toBe(404);
    });

    // #1321 (RF007 AC1, RNF029 C1): content and MIME are checked through the
    // real multer before the handler looks the parent up.
    it('returns 400 for a .csv whose head is a PE executable', async () => {
      const findOne = vi.fn().mockResolvedValue({ [idField]: 'p-1' });
      const parentColl = createCollectionMock({ findOne });
      app.locals.db = createDbMock({ [parentCollection]: parentColl, ...rbacCollectionsAdmin });

      const res = await request(app)
        .post(`/api/${entity}/p-1/files/upload`)
        .set('Authorization', `Bearer ${makeToken('qa-1', 4)}`)
        .attach('file', Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]), 'data.csv');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, error: 'Conteúdo do arquivo não corresponde ao formato .csv' });
      expect(findOne).not.toHaveBeenCalled();
    });

    it('returns 400 for a .csv sent with a MIME of another format', async () => {
      const findOne = vi.fn().mockResolvedValue({ [idField]: 'p-1' });
      const parentColl = createCollectionMock({ findOne });
      app.locals.db = createDbMock({ [parentCollection]: parentColl, ...rbacCollectionsAdmin });

      const res = await request(app)
        .post(`/api/${entity}/p-1/files/upload`)
        .set('Authorization', `Bearer ${makeToken('qa-1', 4)}`)
        .attach('file', Buffer.from('a,b,c'), { filename: 'data.csv', contentType: 'application/pdf' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, error: 'Tipo MIME application/pdf não permitido para a extensão .csv' });
      expect(findOne).not.toHaveBeenCalled();
    });
  });

  describe(`DELETE /api/${entity}/:id/files/:fileID`, () => {
    it('returns 403 for a role below Coordenador', async () => {
      app.locals.db = createDbMock({ ...rbacCollectionsTechnician });

      const res = await request(app)
        .delete(`/api/${entity}/p-1/files/${new ObjectId()}`)
        .set('Authorization', `Bearer ${makeToken('qa-2', 2)}`);

      expect(res.status).toBe(403);
    });
  });
});
