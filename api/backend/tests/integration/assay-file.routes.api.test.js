import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');
const {
  makeAuthToken,
  makeLegacyClaimsToken,
  buildAuthenticatedCollections,
  userForAccessType,
  TEST_USER_ACCOUNT_IDS,
} = require('../factories/auth.factory');


// #644: assay-file.routes.js (added in #643) mirrored sample.routes.js's
// file sub-routes but left out the organization-scope enforcement
// sample-file.controller.js applies via requireOrganizationScope +
// createLinkedFileController's own checkOrgScope hook. These tests prove a
// Coordenador scoped to one organization cannot reach files on an Assay
// whose laboratoryId belongs to a different organization -- accessType 3
// (not 4/Administrador, which bypasses org-scope entirely per
// buildRbacCollections' own docs).

const ASSAY_ID = 'assay-1';
const ASSAY_OTHER_ORG = { assayId: ASSAY_ID, laboratoryId: 'org-other', studyId: 'study-1' };

function makeToken(accessType = 4) {
  return makeAuthToken(accessType);
}

function givenSession() {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'sess-1' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'sess-1' });
}

beforeEach(() => { givenSession(); });
afterEach(() => { vi.restoreAllMocks(); });

const rbacCollectionsScoped = buildRbacCollections([{ userAccountId: TEST_USER_ACCOUNT_IDS[4], accessType: 3, organizationId: 'org-mine' }]);

describe('GET /api/assays/:assayId/files', () => {
  it('returns 403 when the assay belongs to a different organization', async () => {
    const assaysColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue(ASSAY_OTHER_ORG) });
    const assayFilesColl = createCollectionMock({ find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) });
    app.locals.db = createDbMock({ assays: assaysColl, assayFiles: assayFilesColl, ...rbacCollectionsScoped });

    const res = await request(app)
      .get(`/api/assays/${ASSAY_ID}/files`)
      .set('Authorization', `Bearer ${makeToken(TEST_USER_ACCOUNT_IDS[4], 3)}`);

    expect(res.status).toBe(403);
  });
});

describe('POST /api/assays/:assayId/files/upload', () => {
  it('returns 403 when the assay belongs to a different organization', async () => {
    const assaysColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue(ASSAY_OTHER_ORG) });
    const assayFilesColl = createCollectionMock();
    app.locals.db = createDbMock({ assays: assaysColl, assayFiles: assayFilesColl, ...rbacCollectionsScoped });

    const res = await request(app)
      .post(`/api/assays/${ASSAY_ID}/files/upload`)
      .set('Authorization', `Bearer ${makeToken(TEST_USER_ACCOUNT_IDS[4], 3)}`)
      .attach('file', Buffer.from('a,b,c\n1,2,3'), 'data.csv');

    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/assays/:assayId/files/:fileID', () => {
  it('returns 403 when the assay belongs to a different organization', async () => {
    const { ObjectId } = require('mongodb');
    const fileId = new ObjectId();
    const assaysColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue(ASSAY_OTHER_ORG) });
    const assayFilesColl = createCollectionMock({
      findOne: vi.fn().mockResolvedValue({ _id: fileId, assayId: ASSAY_ID, storagePath: '/tmp/x.csv' })
    });
    app.locals.db = createDbMock({ assays: assaysColl, assayFiles: assayFilesColl, ...rbacCollectionsScoped });

    const res = await request(app)
      .delete(`/api/assays/${ASSAY_ID}/files/${fileId.toString()}`)
      .set('Authorization', `Bearer ${makeToken(TEST_USER_ACCOUNT_IDS[4], 3)}`);

    expect(res.status).toBe(403);
  });
});
