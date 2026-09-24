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


// #421: enforcement resolves permissions purely by req.user.userID (via
// UserRoleAssignment), ignoring accessType/roleName carried in the JWT.
// Different accessType levels therefore need distinct userIDs so each one
// resolves to the correct seeded role.
function makeToken(accessType = 4) {
  return makeAuthToken(accessType);
}

const rbacCollections = buildRbacCollections([
  { userAccountId: 'qa-4', accessType: 4 },
  { userAccountId: 'qa-2', accessType: 2 },
]);

function givenSession() {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'session-1' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'session-1' });
}

describe('GET /api/analysis-types', () => {
  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns the seeded list of analysis types for an authenticated user', async () => {
    const seedDoc = { _id: 'type-1', name: 'PCR Real Time', active: true };
    const coll = createCollectionMock({ find: vi.fn().mockImplementation(() => ({
      toArray: vi.fn().mockResolvedValue([seedDoc]),
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    }))});
    app.locals.db = createDbMock({ analysis_types: coll, analysistypes: coll, ...rbacCollections });

    const response = await request(app)
      .get('/api/analysis-types')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body) || Array.isArray(response.body.data)).toBeTruthy();
  });

  it('returns 401 when no token is provided', async () => {
    const response = await request(app).get('/api/analysis-types');
    expect(response.status).toBe(401);
  });
});

describe('POST /api/analysis-types', () => {
  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('creates a new analysis type when called by an admin (accessType 4)', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(null),
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'new-type-id' }),
    });
    app.locals.db = createDbMock({ analysis_types: coll, analysistypes: coll, ...rbacCollections });

    const response = await request(app)
      .post('/api/analysis-types')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ name: 'Sequenciamento NGS', description: 'Next-generation sequencing', active: true });

    expect([200, 201]).toContain(response.status);
  });

  it('blocks creation for a non-admin user (accessType 2)', async () => {
    const response = await request(app)
      .post('/api/analysis-types')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send({ name: 'Illegal Type' });

    expect(response.status).toBe(403);
  });
});
